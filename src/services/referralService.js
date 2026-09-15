/**
 * 单级推荐：每个登录用户都是推广员，持有唯一推荐码。
 * 触发点由 referral_triggers 后台配置：开关 / 奖励积分 / 可否叠加 / 每日限频。
 */
const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { shortCode } = require('../utils/id')
const { getConfig, setConfig } = require('./configService')

async function run(conn, sqlNamed, sqlPos, named, pos) {
  if (conn) {
    const [rows] = await conn.execute(sqlPos, pos)
    return rows
  }
  return query(sqlNamed, named)
}

async function isReferralEnabled() {
  const v = await getConfig('referral_enabled', '1')
  return String(v) !== '0'
}

async function getTrigger(conn, triggerKey) {
  try {
    const rows = await run(
      conn,
      `SELECT trigger_key, name, enabled, reward_points, stackable, daily_limit
       FROM referral_triggers WHERE trigger_key=:k LIMIT 1`,
      `SELECT trigger_key, name, enabled, reward_points, stackable, daily_limit
       FROM referral_triggers WHERE trigger_key=? LIMIT 1`,
      { k: triggerKey },
      [triggerKey]
    )
    return rows.length ? rows[0] : null
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || String(e.message || '').includes('referral_triggers'))) {
      return null
    }
    throw e
  }
}

async function todayCount(conn, inviterId, triggerKey) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS n FROM referral_records
     WHERE inviter_user_id=? AND trigger_type=? AND DATE(created_at)=CURDATE()`,
    [inviterId, triggerKey]
  )
  return Number(rows[0].n) || 0
}

async function todayTotal(conn, inviterId) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS n FROM referral_records
     WHERE inviter_user_id=? AND reward_points > 0 AND DATE(created_at)=CURDATE()`,
    [inviterId]
  )
  return Number(rows[0].n) || 0
}

async function ensureOwnerUser(conn, merchant) {
  if (merchant.owner_user_id) return Number(merchant.owner_user_id)
  const code = `${merchant.invite_code}_U`
  const [exist] = await conn.execute(
    'SELECT id FROM users WHERE invite_code=? AND status=1 LIMIT 1',
    [code]
  )
  let userId = exist.length ? Number(exist[0].id) : 0
  if (!userId) {
    const [ins] = await conn.execute(
      `INSERT INTO users (invite_code, nickname, points_balance, status)
       VALUES (?, ?, 0, 1)`,
      [code, merchant.name || '商户']
    )
    userId = Number(ins.insertId) || 0
  }
  if (userId) {
    await conn.execute(
      'UPDATE merchants SET owner_user_id=? WHERE id=? AND (owner_user_id IS NULL OR owner_user_id=0)',
      [userId, merchant.id]
    )
  }
  return userId
}

/** 用户码或商户码均可解析为推广员 userId */
async function resolveInviterUserId(conn, inviteCode) {
  const code = String(inviteCode || '').trim()
  if (!code) return 0
  const [users] = await conn.execute(
    'SELECT id FROM users WHERE invite_code=? AND status=1 LIMIT 1',
    [code]
  )
  if (users.length) return Number(users[0].id)
  const [merchants] = await conn.execute(
    'SELECT id, name, invite_code, owner_user_id FROM merchants WHERE invite_code=? AND status=1 LIMIT 1',
    [code]
  )
  if (!merchants.length) return 0
  return ensureOwnerUser(conn, merchants[0])
}

async function award(conn, { triggerKey, inviterUserId, inviteeUserId, inviteeMerchantId, bizId }) {
  if (!(await isReferralEnabled())) return null
  const trigger = await getTrigger(conn, triggerKey)
  if (!trigger || !Number(trigger.enabled)) return null

  let inviterId = Number(inviterUserId) || 0
  if (!inviterId && inviteeUserId) {
    const [u] = await conn.execute('SELECT referrer_user_id FROM users WHERE id=?', [inviteeUserId])
    inviterId = u.length && u[0].referrer_user_id ? Number(u[0].referrer_user_id) : 0
  }
  if (!inviterId && inviteeMerchantId) {
    const [m] = await conn.execute('SELECT referrer_user_id FROM merchants WHERE id=?', [inviteeMerchantId])
    inviterId = m.length && m[0].referrer_user_id ? Number(m[0].referrer_user_id) : 0
  }
  if (!inviterId) return null
  if (inviterId === Number(inviteeUserId)) return null

  const stackable = !!Number(trigger.stackable)
  const inviteeKey = Number(inviteeUserId) || 0
  let bizKey = ''
  if (stackable) bizKey = String(bizId || '').slice(0, 64)
  else if (!inviteeKey && inviteeMerchantId) bizKey = `m:${inviteeMerchantId}`

  const [exists] = await conn.execute(
    `SELECT id FROM referral_records
     WHERE invitee_user_id=? AND trigger_type=? AND biz_key=? LIMIT 1`,
    [inviteeKey, triggerKey, bizKey]
  )
  if (exists.length) return null

  const perTriggerCap = Number(trigger.daily_limit) || 0
  if (perTriggerCap > 0 && (await todayCount(conn, inviterId, triggerKey)) >= perTriggerCap) {
    return { skipped: 'daily_limit', triggerKey }
  }
  const globalCap = Number(await getConfig('referral_risk_daily_cap', '0')) || 0
  if (globalCap > 0 && (await todayTotal(conn, inviterId)) >= globalCap) {
    return { skipped: 'risk_cap', triggerKey }
  }

  const reward = Math.max(0, Number(trigger.reward_points) || 0)
  if (reward > 0) {
    await conn.execute('UPDATE users SET points_balance = points_balance + ? WHERE id=?', [
      reward,
      inviterId
    ])
    const [bal] = await conn.execute('SELECT points_balance FROM users WHERE id=?', [inviterId])
    await conn.execute(
      `INSERT INTO user_points_ledger
        (user_id, change_amount, balance_after, biz_type, biz_id, title)
       VALUES (?, ?, ?, 'referral', ?, ?)`,
      [
        inviterId,
        reward,
        bal[0] ? bal[0].points_balance : reward,
        bizId || null,
        `${trigger.name} +${reward}`
      ]
    )
  }
  try {
    await conn.execute(
      `INSERT INTO referral_records
        (inviter_user_id, invitee_user_id, invitee_merchant_id, trigger_type, biz_key, biz_id, reward_points)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        inviterId,
        inviteeKey,
        inviteeMerchantId ? Number(inviteeMerchantId) : null,
        triggerKey,
        bizKey,
        bizId || null,
        reward
      ]
    )
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return null
    if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('Unknown column'))) {
      await conn.execute(
        `INSERT INTO referral_records
          (inviter_user_id, invitee_user_id, trigger_type, reward_points)
         VALUES (?, ?, ?, ?)`,
        [inviterId, inviteeKey || inviteeMerchantId || 0, triggerKey, reward]
      )
    } else {
      throw e
    }
  }
  return { inviterId, reward, triggerKey, triggerName: trigger.name }
}

async function bindReferrer({ userId, inviteCode }) {
  const code = String(inviteCode || '').trim()
  if (!code) throw new HttpError(400, '请填写推荐人邀请码')
  if (!userId) throw new HttpError(400, '当前账号未绑定推广身份')
  return withTransaction(async (conn) => {
    const [me] = await conn.execute(
      'SELECT id, referrer_user_id, invite_code FROM users WHERE id=? FOR UPDATE',
      [userId]
    )
    if (!me.length) throw new HttpError(404, '用户不存在')
    if (me[0].referrer_user_id) throw new HttpError(400, '已绑定推荐人，不可更改')
    if (String(me[0].invite_code || '').toUpperCase() === code.toUpperCase()) {
      throw new HttpError(400, '不能填写自己的邀请码')
    }

    const inviterId = await resolveInviterUserId(conn, code)
    if (!inviterId) throw new HttpError(404, '推荐人邀请码无效')
    if (inviterId === Number(userId)) throw new HttpError(400, '不能填写自己的邀请码')

    await conn.execute('UPDATE users SET referrer_user_id=? WHERE id=?', [inviterId, userId])

    const rewarded = await award(conn, {
      triggerKey: 'register',
      inviterUserId: inviterId,
      inviteeUserId: userId
    })
    return {
      inviterUserId: inviterId,
      triggerType: 'register',
      rewardPoints: rewarded && rewarded.reward ? rewarded.reward : 0
    }
  })
}

async function hasPriorConsumerOrder(conn, userId, currentOrderNo) {
  const [stall] = await conn.execute(
    `SELECT COUNT(*) AS n FROM consumer_orders
     WHERE user_id=? AND pay_status='paid' AND order_status='completed' AND order_no<>?`,
    [userId, currentOrderNo]
  )
  const [cross] = await conn.execute(
    `SELECT COUNT(*) AS n FROM cross_orders
     WHERE user_id=? AND status='completed' AND order_no<>?`,
    [userId, currentOrderNo]
  )
  return Number(stall[0].n) + Number(cross[0].n) > 0
}

/** 点餐完成或异业核销后调用：首单 / 复购 / 首次异业 */
async function onConsumerOrderDone(conn, { inviteeUserId, orderNo, kind }) {
  if (!inviteeUserId) return null
  const prior = await hasPriorConsumerOrder(conn, inviteeUserId, orderNo)
  const out = {}
  if (!prior) {
    out.firstOrder = await award(conn, {
      triggerKey: 'first_order',
      inviteeUserId,
      bizId: orderNo
    })
  } else {
    out.repurchase = await award(conn, {
      triggerKey: 'repurchase',
      inviteeUserId,
      bizId: orderNo
    })
  }
  if (kind === 'cross') {
    out.firstCross = await award(conn, {
      triggerKey: 'first_cross_order',
      inviteeUserId,
      bizId: orderNo
    })
  }
  return out
}

async function rewardFirstOrder(conn, { inviteeUserId, orderNo }) {
  return onConsumerOrderDone(conn, { inviteeUserId, orderNo, kind: 'stall' })
}

async function rewardFirstCrossOrder(conn, { inviteeUserId, orderNo }) {
  return onConsumerOrderDone(conn, { inviteeUserId, orderNo, kind: 'cross' })
}

async function rewardMerchantApproved(conn, { inviterUserId, merchantId, applyNo, inviteeUserId }) {
  return award(conn, {
    triggerKey: 'merchant_approved',
    inviterUserId,
    inviteeUserId: inviteeUserId || 0,
    inviteeMerchantId: merchantId,
    bizId: applyNo
  })
}

async function listMyReferrals(userId) {
  const rows = await query(
    `SELECT r.id, r.trigger_type AS triggerType, r.reward_points AS rewardPoints,
            r.created_at AS createdAt, r.invitee_user_id AS inviteeUserId,
            r.invitee_merchant_id AS inviteeMerchantId,
            u.nickname AS inviteeName, u.invite_code AS inviteeCode,
            m.name AS inviteeMerchantName,
            IFNULL(t.name, r.trigger_type) AS triggerName
     FROM referral_records r
     LEFT JOIN users u ON u.id = r.invitee_user_id AND r.invitee_user_id > 0
     LEFT JOIN merchants m ON m.id = r.invitee_merchant_id
     LEFT JOIN referral_triggers t ON t.trigger_key = r.trigger_type
     WHERE r.inviter_user_id = :uid
     ORDER BY r.id DESC LIMIT 100`,
    { uid: userId }
  )
  return rows.map((r) => ({
    ...r,
    inviteeName: r.inviteeName || r.inviteeMerchantName || '新用户'
  }))
}

async function listTriggers() {
  try {
    return await query(
      `SELECT id, trigger_key AS triggerKey, name, enabled, reward_points AS rewardPoints,
              stackable, daily_limit AS dailyLimit, sort_order AS sortOrder, remark,
              updated_at AS updatedAt
       FROM referral_triggers ORDER BY sort_order, id`
    )
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || String(e.message || '').includes('referral_triggers'))) {
      return []
    }
    throw e
  }
}

async function saveTrigger(body = {}) {
  const key = String(body.triggerKey || '').trim()
  if (!key) throw new HttpError(400, '缺少触发点标识')
  await query(
    `INSERT INTO referral_triggers
      (trigger_key, name, enabled, reward_points, stackable, daily_limit, sort_order, remark)
     VALUES (:key, :name, :enabled, :reward, :stackable, :limit, :sort, :remark)
     ON DUPLICATE KEY UPDATE
       name=VALUES(name), enabled=VALUES(enabled), reward_points=VALUES(reward_points),
       stackable=VALUES(stackable), daily_limit=VALUES(daily_limit),
       sort_order=VALUES(sort_order), remark=VALUES(remark)`,
    {
      key,
      name: String(body.name || key).slice(0, 64),
      enabled: body.enabled ? 1 : 0,
      reward: Math.max(0, Number(body.rewardPoints) || 0),
      stackable: body.stackable ? 1 : 0,
      limit: Math.max(0, Number(body.dailyLimit) || 0),
      sort: Number(body.sortOrder) || 0,
      remark: body.remark || null
    }
  )
  if (key === 'first_order') {
    await setConfig('referral_first_order_reward', String(Math.max(0, Number(body.rewardPoints) || 0)), '与推荐触发点「好友首单」同步')
  }
  return { triggerKey: key }
}

async function getSettings() {
  const triggers = await listTriggers()
  const enabled = await isReferralEnabled()
  const dailyCap = Number(await getConfig('referral_risk_daily_cap', '10')) || 0
  return { enabled: enabled ? 1 : 0, dailyCap, triggers }
}

async function saveSettings({ enabled, dailyCap } = {}) {
  if (enabled != null) await setConfig('referral_enabled', enabled ? '1' : '0', '推荐奖励总开关')
  if (dailyCap != null) {
    await setConfig(
      'referral_risk_daily_cap',
      String(Math.max(0, Number(dailyCap) || 0)),
      '单个推广员每日奖励次数上限（0=不限）'
    )
  }
  return getSettings()
}

async function ensureUserInviteCode(userId) {
  if (!userId) return ''
  const rows = await query('SELECT invite_code FROM users WHERE id=:id LIMIT 1', { id: userId })
  if (!rows.length) return ''
  if (rows[0].invite_code) return rows[0].invite_code
  const code = shortCode('C')
  await query('UPDATE users SET invite_code=:c WHERE id=:id AND (invite_code IS NULL OR invite_code=\'\')', {
    c: code,
    id: userId
  })
  return code
}

async function getHome(userId, { merchantId } = {}) {
  if (!userId) throw new HttpError(400, '当前账号未绑定推广身份')
  const personalCode = await ensureUserInviteCode(userId)
  let shareCode = personalCode
  if (merchantId) {
    const m = await query('SELECT invite_code FROM merchants WHERE id=:id LIMIT 1', { id: merchantId })
    if (m.length && m[0].invite_code) shareCode = m[0].invite_code
  }
  const me = await query(
    `SELECT u.referrer_user_id AS referrerUserId, r.invite_code AS referrerCode, r.nickname AS referrerName
     FROM users u
     LEFT JOIN users r ON r.id = u.referrer_user_id
     WHERE u.id=:id`,
    { id: userId }
  )
  const bound = !!(me[0] && me[0].referrerUserId)
  const triggers = await listTriggers()
  const rules = triggers
    .filter((t) => t.triggerKey !== 'custom_1' && t.triggerKey !== 'custom_2')
    .map((t) => ({
      triggerKey: t.triggerKey,
      name: t.name,
      enabled: !!Number(t.enabled),
      rewardPoints: Number(t.rewardPoints) || 0,
      remark: t.remark || ''
    }))
  const records = await listMyReferrals(userId)
  const invited = new Set(records.map((r) => `${r.inviteeUserId || ''}-${r.inviteeMerchantId || r.inviteeCode || r.inviteeName}`)).size
  const rewardedPoints = records.reduce((s, r) => s + (Number(r.rewardPoints) || 0), 0)
  return {
    shareCode,
    personalCode,
    bound,
    referrerName: bound ? me[0].referrerName : '',
    referrerCode: bound ? me[0].referrerCode : '',
    rules,
    records: records.map((r, i) => ({
      id: r.id || i,
      name: r.inviteeName,
      triggerName: r.triggerName,
      triggerType: r.triggerType,
      time: r.createdAt,
      reward: Number(r.rewardPoints) || 0
    })),
    stats: { invited, rewardedPoints }
  }
}

module.exports = {
  award,
  bindReferrer,
  rewardFirstOrder,
  rewardFirstCrossOrder,
  rewardMerchantApproved,
  onConsumerOrderDone,
  listMyReferrals,
  listTriggers,
  saveTrigger,
  getSettings,
  saveSettings,
  getHome,
  ensureUserInviteCode,
  resolveInviterUserId
}

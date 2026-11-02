const { query } = require('../utils/db')
const { signToken } = require('../middleware/auth')
const { HttpError } = require('../utils/response')
const { shortCode } = require('../utils/id')
const { getCashRate, pointsToCash } = require('./configService')
const rbacService = require('./rbacService')
const wxService = require('./wxService')

/** 演示邀请码登录（与小程序演示码对齐） */
async function loginByInviteCode(code) {
  const invite = String(code || '').trim()
  if (!invite) throw new HttpError(400, '请输入邀请码/账号')

  // 运营邀请码 / 兼容 A001 → 超级管理员
  const adminSession = await rbacService.loginByAdminInviteCode(invite)
  if (adminSession) return adminSession

  // 商户邀请码
  const merchants = await query(
    `SELECT id, role, name, invite_code, owner_user_id AS ownerUserId
     FROM merchants
     WHERE invite_code = :code AND status = 1 LIMIT 1`,
    { code: invite }
  )
  if (merchants.length) {
    const m = merchants[0]
    let userId = m.ownerUserId ? Number(m.ownerUserId) : 0

    if (!userId) {
      // 兼容：历史演示可能已写入 invite / invite_U
      const owners = await query(
        `SELECT id FROM users
         WHERE invite_code IN (:c, :cu) AND status = 1
         ORDER BY id ASC LIMIT 1`,
        { c: invite, cu: `${invite}_U` }
      )
      if (owners.length) {
        userId = Number(owners[0].id)
      } else {
        const r = await query(
          `INSERT INTO users (invite_code, nickname, points_balance, status)
           VALUES (:c, :n, 0, 1)`,
          { c: `${invite}_U`, n: m.name }
        )
        userId = Number(r.insertId) || 0
      }
      if (userId) {
        await query(
          `UPDATE merchants SET owner_user_id = :uid
           WHERE id = :id AND (owner_user_id IS NULL OR owner_user_id = 0)`,
          { uid: userId, id: m.id }
        )
      }
    }

    const token = signToken({
      role: m.role,
      merchantId: m.id,
      userId: userId || 0,
      shopName: m.name
    })
    return {
      token,
      role: m.role,
      merchantId: m.id,
      userId: userId || 0,
      shopName: m.name,
      name: m.name,
      inviteCode: m.invite_code
    }
  }

  // 消费者邀请码 / openid 演示
  const users = await query(
    `SELECT id, nickname, invite_code, points_balance FROM users
     WHERE invite_code = :code AND status = 1 LIMIT 1`,
    { code: invite }
  )
  if (users.length) {
    const u = users[0]
    const token = signToken({
      role: 'consumer',
      userId: u.id,
      merchantId: null,
      shopName: ''
    })
    const rate = await getCashRate()
    return {
      token,
      role: 'consumer',
      userId: u.id,
      name: u.nickname,
      points: u.points_balance,
      cashValue: pointsToCash(u.points_balance, rate),
      inviteCode: u.invite_code
    }
  }

  throw new HttpError(400, '邀请码/账号无效')
}

function isAutoNickname(name) {
  const n = String(name || '').trim()
  if (!n) return true
  if (n === '微信用户') return true
  return /^尾号\d{4}微信用户$/.test(n)
}

function nicknameFromPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  const last4 = digits.slice(-4)
  return last4.length === 4 ? `尾号${last4}微信用户` : '微信用户'
}

function pickUserRow(u) {
  return {
    id: u.id,
    nickname: u.nickname,
    avatar_url: u.avatar_url,
    phone: u.phone,
    gender: u.gender != null ? Number(u.gender) : 0,
    points_balance: u.points_balance,
    invite_code: u.invite_code
  }
}

async function consumerSession(u) {
  const token = signToken({
    role: 'consumer',
    userId: u.id,
    merchantId: null,
    shopName: ''
  })
  const rate = await getCashRate()
  return {
    token,
    role: 'consumer',
    userId: u.id,
    name: u.nickname || '微信用户',
    avatarUrl: u.avatar_url || '',
    coverUrl: u.avatar_url || '',
    phone: u.phone || '',
    gender: u.gender != null ? Number(u.gender) : 0,
    needPhone: !u.phone,
    points: u.points_balance,
    cashValue: pointsToCash(u.points_balance, rate),
    cashRate: rate,
    inviteCode: u.invite_code
  }
}

/** 演示消费者：仅测试入口 C001 使用，不再作为真实微信登录 */
async function loginAsConsumer({ nickname } = {}) {
  let rows = await query(
    `SELECT id, nickname, avatar_url, phone, points_balance, invite_code
     FROM users WHERE invite_code = 'C001' LIMIT 1`
  )
  if (!rows.length) {
    await query(
      `INSERT INTO users (openid, invite_code, nickname, points_balance, status)
       VALUES ('wx_demo', 'C001', :n, 0, 1)`,
      { n: nickname || '演示消费者' }
    )
    rows = await query(
      `SELECT id, nickname, avatar_url, phone, points_balance, invite_code
       FROM users WHERE invite_code = 'C001' LIMIT 1`
    )
  }
  return consumerSession(pickUserRow(rows[0]))
}

async function loginWithWeChat({ jsCode, nickname, avatarUrl, openid, unionid } = {}) {
  let oid = String(openid || '').trim()
  let uid = String(unionid || '').trim()
  if (!oid && jsCode) {
    const sess = await wxService.code2Session(jsCode)
    oid = sess.openid || ''
    uid = sess.unionid || uid
  }
  if (!oid) {
    throw new HttpError(
      400,
      '未能获取微信身份。请在微信内打开小程序，或在云托管环境使用 callContainer。测试请用下方演示身份。'
    )
  }

  let rows
  try {
    rows = await query(
      `SELECT id, nickname, avatar_url, phone, gender, points_balance, invite_code, openid, unionid
       FROM users WHERE openid = :oid LIMIT 1`,
      { oid }
    )
  } catch (e) {
    rows = await query(
      `SELECT id, nickname, avatar_url, phone, points_balance, invite_code, openid, unionid
       FROM users WHERE openid = :oid LIMIT 1`,
      { oid }
    )
  }
  if (!rows.length && uid) {
    try {
      rows = await query(
        `SELECT id, nickname, avatar_url, phone, gender, points_balance, invite_code, openid, unionid
         FROM users WHERE unionid = :uid LIMIT 1`,
        { uid }
      )
    } catch (e) {
      rows = await query(
        `SELECT id, nickname, avatar_url, phone, points_balance, invite_code, openid, unionid
         FROM users WHERE unionid = :uid LIMIT 1`,
        { uid }
      )
    }
  }

  const nextName = String(nickname || '').trim().slice(0, 64)
  const nextAvatar = String(avatarUrl || '').trim().slice(0, 512)

  if (!rows.length) {
    let invite = shortCode('W')
    for (let i = 0; i < 5; i += 1) {
      const clash = await query('SELECT id FROM users WHERE invite_code = :c LIMIT 1', { c: invite })
      if (!clash.length) break
      invite = shortCode('W')
    }
    const r = await query(
      `INSERT INTO users (openid, unionid, invite_code, nickname, avatar_url, points_balance, status)
       VALUES (:oid, :uid, :invite, :n, :a, 0, 1)`,
      {
        oid,
        uid: uid || null,
        invite,
        n: nextName || '微信用户',
        a: nextAvatar || null
      }
    )
    rows = await query(
      `SELECT id, nickname, avatar_url, phone, gender, points_balance, invite_code
       FROM users WHERE id = :id LIMIT 1`,
      { id: r.insertId }
    )
  } else {
    const u = rows[0]
    if (!u.openid) {
      await query('UPDATE users SET openid = :oid WHERE id = :id', { oid, id: u.id })
    }
    if (uid && !u.unionid) {
      await query('UPDATE users SET unionid = :uid WHERE id = :id', { uid, id: u.id })
    }
    const patch = {}
    if (nextName) patch.nickname = nextName
    if (nextAvatar) patch.avatar_url = nextAvatar
    if (Object.keys(patch).length) {
      await query(
        `UPDATE users SET
           nickname = IFNULL(:n, nickname),
           avatar_url = IFNULL(:a, avatar_url)
         WHERE id = :id`,
        { id: u.id, n: patch.nickname || null, a: patch.avatar_url || null }
      )
    }
    rows = await query(
      `SELECT id, nickname, avatar_url, phone, gender, points_balance, invite_code
       FROM users WHERE id = :id LIMIT 1`,
      { id: u.id }
    )
  }
  return consumerSession(pickUserRow(rows[0]))
}

async function bindPhone(userId, phoneCode, openid) {
  const phone = await wxService.getPhoneNumber(phoneCode, openid)
  const uid = Number(userId)
  let rows
  try {
    rows = await query(
      `SELECT id, nickname, avatar_url, phone, gender, points_balance, invite_code
       FROM users WHERE id = :id LIMIT 1`,
      { id: uid }
    )
  } catch (e) {
    rows = await query(
      `SELECT id, nickname, avatar_url, phone, points_balance, invite_code
       FROM users WHERE id = :id LIMIT 1`,
      { id: uid }
    )
  }
  if (!rows.length) throw new HttpError(404, '用户不存在')
  const u = rows[0]
  const nextName = isAutoNickname(u.nickname) ? nicknameFromPhone(phone) : u.nickname
  try {
    await query('UPDATE users SET phone = :p, nickname = :n WHERE id = :id', {
      p: phone,
      n: nextName,
      id: uid
    })
  } catch (e) {
    await query('UPDATE users SET phone = :p WHERE id = :id', { p: phone, id: uid })
    if (isAutoNickname(u.nickname) && nextName) {
      await query('UPDATE users SET nickname = :n WHERE id = :id', { n: nextName, id: uid })
    }
  }
  const fresh = await query(
    `SELECT id, nickname, avatar_url, phone, gender, points_balance, invite_code
     FROM users WHERE id = :id LIMIT 1`,
    { id: uid }
  )
  return consumerSession(pickUserRow(fresh[0] || { ...u, phone, nickname: nextName }))
}

async function updateConsumerProfile(userId, { nickname, avatarUrl, gender } = {}) {
  const nextName = String(nickname || '').trim().slice(0, 64)
  const nextAvatar = String(avatarUrl || '').trim().slice(0, 512)
  const hasGender = gender !== undefined && gender !== null && gender !== ''
  const nextGender = hasGender ? Math.min(2, Math.max(0, Number(gender) || 0)) : null
  if (!nextName && !nextAvatar && !hasGender) throw new HttpError(400, '没有可更新的资料')
  try {
    await query(
      `UPDATE users SET
         nickname = IF(:n = '', nickname, :n),
         avatar_url = IF(:a = '', avatar_url, :a),
         gender = IF(:g IS NULL, gender, :g)
       WHERE id = :id`,
      { id: Number(userId), n: nextName, a: nextAvatar, g: nextGender }
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('gender')))) throw e
    await query(
      `UPDATE users SET
         nickname = IF(:n = '', nickname, :n),
         avatar_url = IF(:a = '', avatar_url, :a)
       WHERE id = :id`,
      { id: Number(userId), n: nextName, a: nextAvatar }
    )
  }
  const rows = await query(
    `SELECT id, nickname, avatar_url, phone, gender, points_balance, invite_code
     FROM users WHERE id = :id LIMIT 1`,
    { id: Number(userId) }
  )
  if (!rows.length) throw new HttpError(404, '用户不存在')
  return consumerSession(pickUserRow(rows[0]))
}

async function getProfile(auth) {
  const rate = await getCashRate()
  if (auth.role === 'admin') {
    return {
      role: 'admin',
      userId: 0,
      name: '平台运营',
      shopName: '万业互联云运营台',
      cashRate: rate
    }
  }
  if (auth.role === 'consumer' || auth.role === 'partner' || auth.role === 'founder') {
    let rows
    try {
      rows = await query(
        `SELECT id, nickname, invite_code, points_balance, phone, avatar_url, gender,
                IFNULL(is_partner,0) AS is_partner, IFNULL(is_founder,0) AS is_founder
         FROM users WHERE id = :id`,
        { id: auth.userId }
      )
    } catch (e) {
      rows = await query(
        'SELECT id, nickname, invite_code, points_balance, phone, avatar_url, gender FROM users WHERE id = :id',
        { id: auth.userId }
      )
    }
    if (!rows.length) throw new HttpError(404, '用户不存在')
    const u = rows[0]
    const base = {
      userId: u.id,
      name: u.nickname,
      inviteCode: u.invite_code,
      phone: u.phone || '',
      avatarUrl: u.avatar_url || '',
      coverUrl: u.avatar_url || '',
      gender: u.gender != null ? Number(u.gender) : 0,
      needPhone: !u.phone,
      points: u.points_balance,
      cashValue: pointsToCash(u.points_balance, rate),
      cashRate: rate,
      isPartner: !!Number(u.is_partner),
      isFounder: !!Number(u.is_founder)
    }
    if (auth.role === 'partner') {
      return { ...base, role: 'partner', shopName: '区域合伙人', displayRole: 'partner' }
    }
    if (auth.role === 'founder') {
      return { ...base, role: 'founder', shopName: '平台总控', displayRole: 'founder' }
    }
    return { ...base, role: 'consumer', displayRole: 'consumer' }
  }
  const rows = await query(
    `SELECT id, role, name, invite_code, city, address, status, cover_url, materials_json,
            contact_name, contact_phone, owner_user_id
     FROM merchants WHERE id = :id`,
    { id: auth.merchantId }
  )
  if (!rows.length) throw new HttpError(404, '商户不存在')
  const m = rows[0]
  const { pickCoverFromLicenses } = require('../utils/mediaPick')
  const coverUrl = m.cover_url || pickCoverFromLicenses(m.materials_json) || ''
  const pools = await query(
    'SELECT balance FROM merchant_points_pool WHERE merchant_id = :id',
    { id: m.id }
  )
  const shopTypeLabel = SHOP_TYPE_LABEL[m.role] || m.role
  return {
    role: m.role,
    displayRole: 'merchant',
    shopType: m.role,
    shopTypeLabel,
    merchantId: m.id,
    userId: auth.userId || m.owner_user_id || 0,
    name: m.contact_name || m.name,
    shopName: m.name,
    inviteCode: m.invite_code,
    city: m.city,
    address: m.address,
    coverUrl,
    contactPhone: m.contact_phone,
    poolBalance: pools[0] ? pools[0].balance : 0,
    cashRate: rate,
    status: m.status,
    open: Number(m.status) === 1
  }
}

/** 登录可切换的五类身份（说明书）；商家内部再分经营类型 stall|cross|supply */
const SHOP_TYPE_LABEL = {
  stall: '地摊',
  cross: '异业门店',
  supply: '供应链供货'
}

const MERCHANT_STATUS = { pending: 0, open: 1, closed: 2, rejected: 3 }

const IDENTITY_ROLES = [
  {
    role: 'consumer',
    label: '消费者',
    seal: '顾',
    desc: '点餐、下单、饭票/积分、逛市集',
    applyTitle: '',
    applyPath: ''
  },
  {
    role: 'merchant',
    label: '商家',
    seal: '店',
    desc: '门店经营：地摊 / 异业 / 供应链供货',
    applyTitle: '立即申请成为商家',
    applyPath: '/pages/apply/apply'
  },
  {
    role: 'partner',
    label: '合伙人',
    seal: '合',
    desc: '区域推广佣金、商家订单与供应链采购',
    applyTitle: '立即申请成为合伙人',
    applyPath: '/partner/apply/apply'
  },
  {
    role: 'founder',
    label: '创始人',
    seal: '创',
    desc: '平台总控：审核、名单与经营监控',
    applyTitle: '立即申请成为创始人',
    applyPath: '/pages/identity-apply/identity-apply?role=founder'
  },
  {
    role: 'lead',
    label: '负责人',
    seal: '负',
    desc: '创始人权限子集：审核与经营监控（脱敏）',
    applyTitle: '立即申请成为负责人',
    applyPath: '/pages/identity-apply/identity-apply?role=lead'
  }
]

const MERCHANT_SHOP_TYPES = ['stall', 'cross', 'supply']

async function resolveAccountUserId(auth) {
  if (!auth) return 0
  if (auth.role === 'admin') return 0
  if (auth.userId) return Number(auth.userId) || 0
  if (auth.merchantId) {
    const rows = await query(
      'SELECT owner_user_id AS uid FROM merchants WHERE id = :id LIMIT 1',
      { id: auth.merchantId }
    )
    return rows.length && rows[0].uid ? Number(rows[0].uid) : 0
  }
  return 0
}

async function loadAccountUser(userId) {
  if (!userId) throw new HttpError(401, '无法识别微信账号，请重新登录')
  let rows
  try {
    rows = await query(
      `SELECT id, nickname, avatar_url, phone, gender, points_balance, invite_code, openid,
              IFNULL(is_partner,0) AS is_partner, IFNULL(is_founder,0) AS is_founder,
              IFNULL(is_lead,0) AS is_lead
       FROM users WHERE id = :id AND status = 1 LIMIT 1`,
      { id: userId }
    )
  } catch (e) {
    rows = await query(
      `SELECT id, nickname, avatar_url, phone, gender, points_balance, invite_code, openid,
              IFNULL(is_partner,0) AS is_partner, IFNULL(is_founder,0) AS is_founder
       FROM users WHERE id = :id AND status = 1 LIMIT 1`,
      { id: userId }
    )
  }
  if (!rows.length) throw new HttpError(404, '用户不存在')
  const u = pickUserRow(rows[0])
  u.is_partner = Number(rows[0].is_partner) || 0
  u.is_founder = Number(rows[0].is_founder) || 0
  u.is_lead = Number(rows[0].is_lead) || 0
  return u
}

async function findPendingPartnerApply(userId) {
  if (!userId) return null
  try {
    const rows = await query(
      `SELECT id, apply_no AS applyNo, status, city
       FROM partner_applications
       WHERE user_id = :uid AND status = 'pending'
       ORDER BY id DESC LIMIT 1`,
      { uid: userId }
    )
    return rows[0] || null
  } catch (_) {
    return null
  }
}

async function findPendingPlatformRoleApply(userId, applyRole) {
  if (!userId || !applyRole) return null
  try {
    const rows = await query(
      `SELECT id, apply_no AS applyNo, apply_role AS applyRole, status, contact_phone AS contactPhone
       FROM platform_role_applications
       WHERE user_id = :uid AND apply_role = :role AND status = 'pending'
       ORDER BY id DESC LIMIT 1`,
      { uid: userId, role: applyRole }
    )
    return rows[0] || null
  } catch (_) {
    return null
  }
}

function partnerSession(user) {
  const token = signToken({
    role: 'partner',
    userId: user.id,
    merchantId: null,
    shopName: '区域合伙人'
  })
  return {
    token,
    role: 'partner',
    displayRole: 'partner',
    userId: user.id,
    name: user.nickname || '合伙人',
    shopName: '区域合伙人',
    avatarUrl: user.avatar_url || '',
    coverUrl: user.avatar_url || '',
    phone: user.phone || '',
    inviteCode: user.invite_code,
    points: user.points_balance
  }
}

function founderSession(user, { asLead = false } = {}) {
  const token = signToken({
    role: 'founder',
    userId: user.id,
    merchantId: null,
    shopName: asLead ? '平台负责人' : '平台总控',
    isLead: asLead ? 1 : 0
  })
  return {
    token,
    role: 'founder',
    displayRole: asLead ? 'lead' : 'founder',
    isLead: !!asLead,
    userId: user.id,
    name: user.nickname || (asLead ? '负责人' : '创始人'),
    shopName: asLead ? '平台负责人' : '平台总控',
    avatarUrl: user.avatar_url || '',
    coverUrl: user.avatar_url || '',
    phone: user.phone || '',
    inviteCode: user.invite_code,
    points: user.points_balance
  }
}

async function findOwnedMerchants(userId, phone, { includeDeleted = false } = {}) {
  const delClause = includeDeleted ? '' : ' AND deleted_at IS NULL'
  const byOwner = await query(
    `SELECT id, role, name, status, invite_code, contact_phone, cover_url, deleted_at
     FROM merchants
     WHERE owner_user_id = :uid${delClause}
     ORDER BY id ASC`,
    { uid: userId }
  )
  if (byOwner.length) return byOwner
  const p = String(phone || '').trim()
  if (!/^1\d{10}$/.test(p)) return []
  return query(
    `SELECT id, role, name, status, invite_code, contact_phone, cover_url, deleted_at
     FROM merchants
     WHERE contact_phone = :phone${delClause}
     ORDER BY id ASC`,
    { phone: p }
  )
}

function isMerchantOpen(m) {
  return m && !m.deleted_at && Number(m.status) === MERCHANT_STATUS.open
}

async function findPendingApplies(phone) {
  const p = String(phone || '').trim()
  if (!/^1\d{10}$/.test(p)) return []
  return query(
    `SELECT id, role, shop_name AS shopName, status, apply_no AS applyNo
     FROM merchant_applications
     WHERE contact_phone = :phone AND status = 'pending'
     ORDER BY id DESC`,
    { phone: p }
  )
}

async function merchantSessionFromRow(m, userId) {
  const token = signToken({
    role: m.role,
    merchantId: m.id,
    userId: userId || 0,
    shopName: m.name
  })
  return {
    token,
    role: m.role,
    displayRole: 'merchant',
    shopType: m.role,
    shopTypeLabel: SHOP_TYPE_LABEL[m.role] || m.role,
    merchantId: m.id,
    userId: userId || 0,
    shopName: m.name,
    name: m.name,
    inviteCode: m.invite_code,
    coverUrl: m.cover_url || ''
  }
}

/**
 * 同一微信账号下的身份清单（说明书五身份）：
 * 消费者 / 商家（经营类型 stall|cross|supply）/ 合伙人 / 创始人 / 负责人
 * 商家仅 status=1 且未软删视为已开通；停用/删除后可重新申请
 */
async function listIdentities(auth) {
  const userId = await resolveAccountUserId(auth)
  const user = await loadAccountUser(userId)
  const merchants = await findOwnedMerchants(userId, user.phone)
  const allMerchants = await findOwnedMerchants(userId, user.phone, { includeDeleted: true })
  const pending = await findPendingApplies(user.phone)
  const partnerPending = await findPendingPartnerApply(userId)
  const founderPending = await findPendingPlatformRoleApply(userId, 'founder')
  const leadPending = await findPendingPlatformRoleApply(userId, 'lead')
  const openMerchants = merchants.filter(isMerchantOpen)
  const activeMerchant =
    openMerchants.find((m) => Number(auth.merchantId) === Number(m.id)) ||
    openMerchants[0] ||
    null
  const anyPending = pending[0] || null
  const merchantOpened = openMerchants.length > 0
  const hadStopped = !merchantOpened && merchants.some((m) => Number(m.status) === MERCHANT_STATUS.closed)
  const hadDeleted =
    !merchantOpened &&
    !hadStopped &&
    allMerchants.some((m) => m.deleted_at || Number(m.status) === MERCHANT_STATUS.rejected)
  const canReapply = !merchantOpened
  const merchantActive = MERCHANT_SHOP_TYPES.includes(auth.role) && merchantOpened
  const shopTypeLabel = activeMerchant ? SHOP_TYPE_LABEL[activeMerchant.role] || activeMerchant.role : ''

  const cards = IDENTITY_ROLES.map((meta) => {
    if (meta.role === 'consumer') {
      return {
        role: 'consumer',
        label: meta.label,
        seal: meta.seal,
        desc: meta.desc,
        opened: true,
        active: auth.role === 'consumer',
        pending: false,
        merchantId: null,
        shopName: user.nickname || '微信用户',
        badge: '已开通',
        applyTitle: '',
        applyPath: ''
      }
    }
    if (meta.role === 'merchant') {
      let badge = '未开通'
      if (merchantOpened) badge = '已开通'
      else if (anyPending) badge = '审核中'
      else if (hadStopped) badge = '已停用，可重申'
      else if (hadDeleted) badge = '已删除，可重申'
      const shopName = merchantOpened
        ? `${activeMerchant.name} · ${shopTypeLabel}`
        : anyPending
          ? anyPending.shopName
          : hadStopped || hadDeleted
            ? '原门店已失效，可重新申请'
            : ''
      return {
        role: 'merchant',
        label: meta.label,
        seal: meta.seal,
        desc: meta.desc,
        opened: merchantOpened,
        active: merchantActive,
        pending: !merchantOpened && !!anyPending,
        canReapply,
        merchantId: activeMerchant ? Number(activeMerchant.id) : null,
        shopType: activeMerchant ? activeMerchant.role : '',
        shopTypeLabel,
        shopName,
        badge,
        applyTitle: hadStopped || hadDeleted ? '重新申请成为商家' : meta.applyTitle,
        applyPath: meta.applyPath,
        applyNo: anyPending ? anyPending.applyNo : '',
        shops: merchants.map((m) => ({
          merchantId: Number(m.id),
          shopType: m.role,
          shopTypeLabel: SHOP_TYPE_LABEL[m.role] || m.role,
          shopName: m.name,
          status: Number(m.status),
          opened: isMerchantOpen(m)
        }))
      }
    }
    if (meta.role === 'partner') {
      const opened = !!Number(user.is_partner)
      let badge = '未开通'
      if (opened) badge = '已开通'
      else if (partnerPending) badge = '审核中'
      return {
        role: 'partner',
        label: meta.label,
        seal: meta.seal,
        desc: meta.desc,
        opened,
        active: auth.role === 'partner',
        pending: !opened && !!partnerPending,
        merchantId: null,
        shopName: opened ? '区域合伙人' : '',
        badge,
        applyTitle: meta.applyTitle,
        applyPath: meta.applyPath,
        applyNo: partnerPending ? partnerPending.applyNo : ''
      }
    }
    if (meta.role === 'founder') {
      const opened = !!Number(user.is_founder)
      let badge = '未开通'
      if (opened) badge = '已开通'
      else if (founderPending) badge = '审核中'
      return {
        role: 'founder',
        label: meta.label,
        seal: meta.seal,
        desc: meta.desc,
        opened,
        active: auth.role === 'founder' && !Number(auth.isLead),
        pending: !opened && !!founderPending,
        merchantId: null,
        shopName: opened ? '平台总控' : '',
        badge,
        applyTitle: meta.applyTitle,
        applyPath: meta.applyPath,
        applyNo: founderPending ? founderPending.applyNo : ''
      }
    }
    // lead
    const opened = !!Number(user.is_lead) || !!Number(user.is_founder)
    let badge = '未开通'
    if (Number(user.is_founder)) badge = '已开通(创始人含)'
    else if (Number(user.is_lead)) badge = '已开通'
    else if (leadPending) badge = '审核中'
    return {
      role: 'lead',
      label: meta.label,
      seal: meta.seal,
      desc: meta.desc,
      opened,
      active: auth.role === 'founder' && !!Number(auth.isLead),
      pending: !opened && !!leadPending,
      merchantId: null,
      shopName: opened ? '平台负责人' : '',
      badge,
      applyTitle: meta.applyTitle,
      applyPath: meta.applyPath,
      applyNo: leadPending ? leadPending.applyNo : ''
    }
  })

  return {
    userId,
    phone: user.phone || '',
    openidBound: true,
    currentRole: auth.role,
    currentDisplayRole: MERCHANT_SHOP_TYPES.includes(auth.role)
      ? 'merchant'
      : auth.role,
    currentMerchantId: auth.merchantId || null,
    cards
  }
}

async function switchIdentity(auth, { role, merchantId } = {}) {
  let targetRole = String(role || '').trim()
  const userId = await resolveAccountUserId(auth)
  const user = await loadAccountUser(userId)

  // 兼容旧客户端直接传 stall|cross|supply
  if (MERCHANT_SHOP_TYPES.includes(targetRole)) {
    targetRole = 'merchant'
  }

  if (targetRole === 'consumer') {
    return consumerSession(user)
  }
  if (targetRole === 'partner') {
    if (!Number(user.is_partner)) throw new HttpError(403, '当前暂未开通合伙人身份')
    return partnerSession(user)
  }
  if (targetRole === 'founder') {
    if (!Number(user.is_founder)) throw new HttpError(403, '当前暂未开通创始人身份')
    return founderSession(user, { asLead: false })
  }
  if (targetRole === 'lead') {
    if (!Number(user.is_lead) && !Number(user.is_founder)) {
      throw new HttpError(403, '当前暂未开通负责人身份')
    }
    return founderSession(user, { asLead: true })
  }
  if (targetRole !== 'merchant') {
    throw new HttpError(400, '无效的身份类型')
  }

  const merchants = await findOwnedMerchants(userId, user.phone)
  const openMerchants = merchants.filter(isMerchantOpen)
  let target = null
  const mid = Number(merchantId) || 0
  if (mid) {
    target = openMerchants.find((m) => Number(m.id) === mid) || null
  } else {
    target = openMerchants[0] || null
  }
  if (!target) {
    if (merchants.length) {
      throw new HttpError(403, '商家身份已停用或删除，请重新申请')
    }
    throw new HttpError(403, '当前暂未开通商家身份')
  }

  await query(
    `UPDATE merchants SET owner_user_id = :uid
     WHERE id = :id AND (owner_user_id IS NULL OR owner_user_id = 0)`,
    { uid: userId, id: target.id }
  )

  const session = await merchantSessionFromRow(target, userId)
  session.displayRole = 'merchant'
  session.shopType = target.role
  session.shopTypeLabel = SHOP_TYPE_LABEL[target.role] || target.role
  return session
}

module.exports = {
  loginByInviteCode,
  loginAsConsumer,
  loginWithWeChat,
  bindPhone,
  updateConsumerProfile,
  getProfile,
  listIdentities,
  switchIdentity,
  SHOP_TYPE_LABEL,
  MERCHANT_SHOP_TYPES,
  IDENTITY_ROLES,
  loginAdmin: (username, password) => rbacService.loginByPassword(username, password)
}

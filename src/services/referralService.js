const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { getConfig } = require('./configService')

async function bindReferrer({ userId, inviteCode }) {
  const code = String(inviteCode || '').trim()
  if (!code) throw new HttpError(400, '请填写推荐人邀请码')
  return withTransaction(async (conn) => {
    const [me] = await conn.execute(
      'SELECT id, referrer_user_id, invite_code FROM users WHERE id=? FOR UPDATE',
      [userId]
    )
    if (!me.length) throw new HttpError(404, '用户不存在')
    if (me[0].referrer_user_id) throw new HttpError(400, '已绑定推荐人，不可更改')
    if (me[0].invite_code === code) throw new HttpError(400, '不能填写自己的邀请码')

    const [inv] = await conn.execute(
      'SELECT id FROM users WHERE invite_code=? AND status=1 LIMIT 1',
      [code]
    )
    if (!inv.length) throw new HttpError(404, '推荐人邀请码无效')
    const inviterId = inv[0].id
    await conn.execute('UPDATE users SET referrer_user_id=? WHERE id=?', [inviterId, userId])
    await conn.execute(
      `INSERT INTO referral_records (inviter_user_id, invitee_user_id, trigger_type, reward_points)
       VALUES (?, ?, 'register', 0)
       ON DUPLICATE KEY UPDATE trigger_type=trigger_type`,
      [inviterId, userId]
    )
    return { inviterUserId: inviterId, triggerType: 'register' }
  })
}

/** 好友首单：给推荐人发积分奖励（幂等） */
async function rewardFirstOrder(conn, { inviteeUserId, orderNo }) {
  const [u] = await conn.execute(
    'SELECT referrer_user_id FROM users WHERE id=?',
    [inviteeUserId]
  )
  if (!u.length || !u[0].referrer_user_id) return null
  const inviterId = u[0].referrer_user_id

  const [exists] = await conn.execute(
    `SELECT id FROM referral_records
     WHERE invitee_user_id=? AND trigger_type='first_order' LIMIT 1`,
    [inviteeUserId]
  )
  if (exists.length) return null

  const reward = Number(await getConfig('referral_first_order_reward', '50')) || 50
  await conn.execute(
    'UPDATE users SET points_balance = points_balance + ? WHERE id=?',
    [reward, inviterId]
  )
  const [bal] = await conn.execute('SELECT points_balance FROM users WHERE id=?', [inviterId])
  await conn.execute(
    `INSERT INTO user_points_ledger
      (user_id, change_amount, balance_after, biz_type, biz_id, title)
     VALUES (?, ?, ?, 'referral', ?, ?)`,
    [inviterId, reward, bal[0].points_balance, orderNo, `好友首单推荐奖励 +${reward}`]
  )
  await conn.execute(
    `INSERT INTO referral_records (inviter_user_id, invitee_user_id, trigger_type, reward_points)
     VALUES (?, ?, 'first_order', ?)`,
    [inviterId, inviteeUserId, reward]
  )
  return { inviterId, reward }
}

async function listMyReferrals(userId) {
  return query(
    `SELECT r.id, r.trigger_type AS triggerType, r.reward_points AS rewardPoints,
            r.created_at AS createdAt, u.nickname AS inviteeName, u.invite_code AS inviteeCode
     FROM referral_records r
     JOIN users u ON u.id=r.invitee_user_id
     WHERE r.inviter_user_id=:uid
     ORDER BY r.id DESC LIMIT 100`,
    { uid: userId }
  )
}

module.exports = { bindReferrer, rewardFirstOrder, listMyReferrals }

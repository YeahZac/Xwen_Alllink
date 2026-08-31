const { query, withTransaction } = require('../utils/db')
const { signToken } = require('../middleware/auth')
const { HttpError } = require('../utils/response')
const { shortCode } = require('../utils/id')
const { getCashRate, pointsToCash } = require('./configService')
const rbacService = require('./rbacService')

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
      cashValue: pointsToCash(u.points_balance, rate)
    }
  }

  throw new HttpError(400, '邀请码/账号无效')
}

/** 微信快捷登录演示：无 code 时创建/返回默认消费者 */
async function loginAsConsumer({ nickname } = {}) {
  let rows = await query(
    `SELECT id, nickname, points_balance FROM users WHERE invite_code = 'C001' LIMIT 1`
  )
  if (!rows.length) {
    await query(
      `INSERT INTO users (openid, invite_code, nickname, points_balance, status)
       VALUES ('wx_demo', 'C001', :n, 0, 1)`,
      { n: nickname || '微信用户' }
    )
    rows = await query(
      `SELECT id, nickname, points_balance FROM users WHERE invite_code = 'C001' LIMIT 1`
    )
  }
  const u = rows[0]
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
    name: u.nickname || nickname || '微信用户',
    points: u.points_balance,
    cashValue: pointsToCash(u.points_balance, rate),
    cashRate: rate,
    inviteCode: 'C001'
  }
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
  if (auth.role === 'consumer') {
    const rows = await query(
      'SELECT id, nickname, invite_code, points_balance, phone, avatar_url FROM users WHERE id = :id',
      { id: auth.userId }
    )
    if (!rows.length) throw new HttpError(404, '用户不存在')
    const u = rows[0]
    return {
      role: 'consumer',
      userId: u.id,
      name: u.nickname,
      inviteCode: u.invite_code,
      phone: u.phone,
      avatarUrl: u.avatar_url,
      points: u.points_balance,
      cashValue: pointsToCash(u.points_balance, rate),
      cashRate: rate
    }
  }
  const rows = await query(
    `SELECT id, role, name, invite_code, city, address, status, cover_url, contact_name, contact_phone
     FROM merchants WHERE id = :id`,
    { id: auth.merchantId }
  )
  if (!rows.length) throw new HttpError(404, '商户不存在')
  const m = rows[0]
  const pools = await query(
    'SELECT balance FROM merchant_points_pool WHERE merchant_id = :id',
    { id: m.id }
  )
  return {
    role: m.role,
    merchantId: m.id,
    name: m.contact_name || m.name,
    shopName: m.name,
    inviteCode: m.invite_code,
    city: m.city,
    address: m.address,
    coverUrl: m.cover_url,
    contactPhone: m.contact_phone,
    poolBalance: pools[0] ? pools[0].balance : 0,
    cashRate: rate
  }
}

module.exports = {
  loginByInviteCode,
  loginAsConsumer,
  getProfile,
  loginAdmin: (username, password) => rbacService.loginByPassword(username, password)
}

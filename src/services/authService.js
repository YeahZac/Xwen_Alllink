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
  if (auth.role === 'consumer') {
    let rows
    try {
      rows = await query(
        'SELECT id, nickname, invite_code, points_balance, phone, avatar_url, gender FROM users WHERE id = :id',
        { id: auth.userId }
      )
    } catch (e) {
      rows = await query(
        'SELECT id, nickname, invite_code, points_balance, phone, avatar_url FROM users WHERE id = :id',
        { id: auth.userId }
      )
    }
    if (!rows.length) throw new HttpError(404, '用户不存在')
    const u = rows[0]
    return {
      role: 'consumer',
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
      cashRate: rate
    }
  }
  const rows = await query(
    `SELECT id, role, name, invite_code, city, address, status, cover_url, contact_name, contact_phone,
            owner_user_id
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
    userId: auth.userId || m.owner_user_id || 0,
    name: m.contact_name || m.name,
    shopName: m.name,
    inviteCode: m.invite_code,
    city: m.city,
    address: m.address,
    coverUrl: m.cover_url,
    contactPhone: m.contact_phone,
    poolBalance: pools[0] ? pools[0].balance : 0,
    cashRate: rate,
    status: m.status,
    open: Number(m.status) === 1
  }
}

module.exports = {
  loginByInviteCode,
  loginAsConsumer,
  loginWithWeChat,
  bindPhone,
  updateConsumerProfile,
  getProfile,
  loginAdmin: (username, password) => rbacService.loginByPassword(username, password)
}

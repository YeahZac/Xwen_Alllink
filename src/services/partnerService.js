const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { orderNo } = require('../utils/id')
const { getCashRate, pointsToCash } = require('./configService')
const referralService = require('./referralService')

async function submitPartnerApply(body, auth) {
  const userId = Number(auth.userId) || 0
  if (!userId) throw new HttpError(401, '请先登录')
  const contactName = String(body.contactName || '').trim()
  const contactPhone = String(body.contactPhone || '').trim()
  const city = String(body.city || '').trim()
  const referrerCode = String(body.referrerCode || '').trim()
  const remark = String(body.remark || '').trim()
  if (!contactName) throw new HttpError(400, '请填写姓名')
  if (!/^1\d{10}$/.test(contactPhone)) throw new HttpError(400, '手机号格式不正确')

  const users = await query(
    `SELECT id, IFNULL(is_partner,0) AS is_partner FROM users WHERE id=:id AND status=1 LIMIT 1`,
    { id: userId }
  )
  if (!users.length) throw new HttpError(404, '用户不存在')
  if (Number(users[0].is_partner)) throw new HttpError(400, '您已是合伙人，无需重复申请')

  try {
    const pending = await query(
      `SELECT id FROM partner_applications WHERE user_id=:uid AND status='pending' LIMIT 1`,
      { uid: userId }
    )
    if (pending.length) throw new HttpError(400, '已有审核中的合伙人申请')
  } catch (e) {
    if (e instanceof HttpError) throw e
    if (/partner_applications|doesn't exist/i.test(String(e.message || ''))) {
      throw new HttpError(503, '合伙人申请表未初始化，请先执行 sql/26_user_identities.sql')
    }
    throw e
  }

  const applyNo = orderNo('PA')
  await query(
    `INSERT INTO partner_applications
      (apply_no, user_id, contact_name, contact_phone, city, referrer_code, remark, status)
     VALUES
      (:applyNo, :userId, :contactName, :contactPhone, :city, :referrerCode, :remark, 'pending')`,
    { applyNo, userId, contactName, contactPhone, city, referrerCode, remark }
  )
  return {
    applyNo,
    status: 'pending',
    statusText: '审核中',
    remark: '已提交合伙人申请，预计1-3个工作日由创始人/运营审核'
  }
}

async function getDashboard(auth) {
  const userId = Number(auth.userId) || 0
  if (!userId) throw new HttpError(401, '请先登录')
  const home = await referralService.getHome(userId, {})
  const rate = await getCashRate()
  const rewardedPoints = Number((home.stats && home.stats.rewardedPoints) || 0)
  const records = home.records || []
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(d - ((today.getDay() + 6) % 7))
  startOfWeek.setHours(0, 0, 0, 0)

  let todayPts = 0
  let weekPts = 0
  let monthPts = 0
  for (const r of records) {
    const t = r.time ? new Date(r.time) : null
    if (!t || Number.isNaN(t.getTime())) continue
    const pts = Number(r.reward) || 0
    if (t.getFullYear() === y && t.getMonth() === m && t.getDate() === d) todayPts += pts
    if (t >= startOfWeek) weekPts += pts
    if (t.getFullYear() === y && t.getMonth() === m) monthPts += pts
  }

  let withdrawPending = 0
  try {
    const rows = await query(
      `SELECT COUNT(*) AS c FROM partner_withdraw_requests
       WHERE user_id=:uid AND status='pending'`,
      { uid: userId }
    )
    withdrawPending = Number(rows[0] && rows[0].c) || 0
  } catch (_) {}

  return {
    name: home.shareCode ? '区域合伙人' : '合伙人',
    shareCode: home.shareCode,
    personalCode: home.personalCode,
    stats: {
      invited: (home.stats && home.stats.invited) || 0,
      rewardedPoints,
      cashValue: pointsToCash(rewardedPoints, rate),
      todayPts,
      weekPts,
      monthPts,
      withdrawPending
    },
    records: records.slice(0, 20),
    menus: [
      { id: 'books', title: '内部账目', sub: '佣金流水与累计', url: '/pages/recommend/recommend' },
      { id: 'orders', title: '推广记录', sub: '邀请与奖励明细', url: '/pages/recommend/recommend' },
      { id: 'supply', title: '供应链', sub: '首期查看推广规则与佣金', url: '/pages/recommend/recommend' },
      { id: 'purchase', title: '采购跟进', sub: '切回商家身份后可下采购单', url: '' }
    ]
  }
}

async function submitWithdraw(auth, body) {
  const userId = Number(auth.userId) || 0
  if (!userId) throw new HttpError(401, '请先登录')
  const amountPoints = Math.floor(Number(body.amountPoints) || 0)
  if (amountPoints < 1) throw new HttpError(400, '请填写提现积分数量')
  const users = await query(
    `SELECT points_balance, IFNULL(is_partner,0) AS is_partner FROM users WHERE id=:id LIMIT 1`,
    { id: userId }
  )
  if (!users.length || !Number(users[0].is_partner)) {
    throw new HttpError(403, '仅合伙人可申请提现')
  }
  if (Number(users[0].points_balance) < amountPoints) {
    throw new HttpError(400, '可用积分不足')
  }
  const rate = await getCashRate()
  const amountCash = pointsToCash(amountPoints, rate)
  try {
    await query(
      `INSERT INTO partner_withdraw_requests
        (user_id, amount_points, amount_cash, bank_name, bank_account, account_name, status)
       VALUES
        (:uid, :pts, :cash, :bn, :ba, :an, 'pending')`,
      {
        uid: userId,
        pts: amountPoints,
        cash: amountCash,
        bn: String(body.bankName || '').trim(),
        ba: String(body.bankAccount || '').trim(),
        an: String(body.accountName || '').trim()
      }
    )
  } catch (e) {
    if (/partner_withdraw|doesn't exist/i.test(String(e.message || ''))) {
      throw new HttpError(503, '提现表未初始化，请先执行 sql/26_user_identities.sql')
    }
    throw e
  }
  return { status: 'pending', amountPoints, amountCash, remark: '已提交，等待创始人/运营审核' }
}

async function listPartnerApplies({ status } = {}) {
  let sql = `SELECT id, apply_no AS applyNo, user_id AS userId, contact_name AS contactName,
                    contact_phone AS contactPhone, city, referrer_code AS referrerCode,
                    remark, status, reject_reason AS rejectReason, created_at AS createdAt
             FROM partner_applications`
  const params = {}
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    sql += ` WHERE status = :status`
    params.status = status
  }
  sql += ` ORDER BY id DESC LIMIT 100`
  try {
    return await query(sql, params)
  } catch (e) {
    if (/partner_applications|doesn't exist/i.test(String(e.message || ''))) return []
    throw e
  }
}

async function approvePartnerApply(id, { reviewerId } = {}) {
  const rows = await query(
    `SELECT id, user_id AS userId, status FROM partner_applications WHERE id=:id LIMIT 1`,
    { id: Number(id) }
  )
  if (!rows.length) throw new HttpError(404, '申请不存在')
  if (rows[0].status !== 'pending') throw new HttpError(400, '申请已处理')
  await query(
    `UPDATE partner_applications
     SET status='approved', reviewed_by=:rid, reviewed_at=NOW()
     WHERE id=:id`,
    { id: Number(id), rid: reviewerId || null }
  )
  try {
    await query(`UPDATE users SET is_partner=1 WHERE id=:uid`, { uid: rows[0].userId })
  } catch (e) {
    if (/Unknown column.*is_partner/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/26_user_identities.sql 增加 is_partner 字段')
    }
    throw e
  }
  return { ok: true, userId: rows[0].userId }
}

async function rejectPartnerApply(id, { reason, reviewerId } = {}) {
  const rows = await query(
    `SELECT id, status FROM partner_applications WHERE id=:id LIMIT 1`,
    { id: Number(id) }
  )
  if (!rows.length) throw new HttpError(404, '申请不存在')
  if (rows[0].status !== 'pending') throw new HttpError(400, '申请已处理')
  const rejectReason = String(reason || '').trim() || '资料不完整'
  await query(
    `UPDATE partner_applications
     SET status='rejected', reject_reason=:r, reviewed_by=:rid, reviewed_at=NOW()
     WHERE id=:id`,
    { id: Number(id), r: rejectReason, rid: reviewerId || null }
  )
  return { ok: true }
}

async function listPartnerWithdraws({ status } = {}) {
  let sql = `SELECT id, user_id AS userId, amount_points AS amountPoints, amount_cash AS amountCash,
                    bank_name AS bankName, bank_account AS bankAccount, account_name AS accountName,
                    status, reject_reason AS rejectReason, created_at AS createdAt
             FROM partner_withdraw_requests`
  const params = {}
  if (status) {
    sql += ` WHERE status=:status`
    params.status = status
  }
  sql += ` ORDER BY id DESC LIMIT 100`
  try {
    return await query(sql, params)
  } catch (_) {
    return []
  }
}

async function reviewPartnerWithdraw(id, { action, reason, reviewerId } = {}) {
  const rows = await query(
    `SELECT id, user_id AS userId, amount_points AS amountPoints, status
     FROM partner_withdraw_requests WHERE id=:id LIMIT 1`,
    { id: Number(id) }
  )
  if (!rows.length) throw new HttpError(404, '提现单不存在')
  if (rows[0].status !== 'pending') throw new HttpError(400, '提现单已处理')
  if (action === 'reject') {
    await query(
      `UPDATE partner_withdraw_requests
       SET status='rejected', reject_reason=:r, reviewed_by=:rid, reviewed_at=NOW()
       WHERE id=:id`,
      { id: Number(id), r: String(reason || '驳回'), rid: reviewerId || null }
    )
    return { ok: true, status: 'rejected' }
  }
  // approve: 扣减积分
  const pts = Number(rows[0].amountPoints) || 0
  const uid = Number(rows[0].userId)
  const bal = await query(`SELECT points_balance FROM users WHERE id=:id LIMIT 1`, { id: uid })
  if (!bal.length || Number(bal[0].points_balance) < pts) {
    throw new HttpError(400, '用户积分不足，无法通过')
  }
  await query(`UPDATE users SET points_balance = points_balance - :pts WHERE id=:id`, {
    pts,
    id: uid
  })
  await query(
    `UPDATE partner_withdraw_requests
     SET status='approved', reviewed_by=:rid, reviewed_at=NOW()
     WHERE id=:id`,
    { id: Number(id), rid: reviewerId || null }
  )
  return { ok: true, status: 'approved' }
}

const PURCHASE_STATUS_TEXT = {
  pending: '待处理',
  sent: '已下发',
  accepted: '已接单',
  shipped: '配送中',
  done: '已完成',
  cancelled: '已取消'
}

const ORDER_STATUS_TEXT = {
  pending: '进行中',
  completed: '已完成',
  cancelled: '已取消',
  unpaid: '未支付',
  paid: '已支付',
  refunded: '已退款'
}

async function listMerchantOrders(auth) {
  const userId = Number(auth.userId) || 0
  if (!userId) throw new HttpError(401, '请先登录')
  // 管辖：商户推荐人=本人，或商户主账号为本人邀请的用户
  try {
    const rows = await query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS amount,
              o.order_status AS status, o.created_at AS createdAt, m.name AS shopName
       FROM consumer_orders o
       JOIN merchants m ON m.id = o.merchant_id
       WHERE m.referrer_user_id = :uid
          OR m.owner_user_id IN (
               SELECT invitee_user_id FROM referral_records WHERE inviter_user_id = :uid
             )
          OR m.owner_user_id IN (
               SELECT id FROM users WHERE referrer_user_id = :uid
             )
       ORDER BY o.id DESC LIMIT 50`,
      { uid: userId }
    )
    if (rows.length) {
      return rows.map((r) => ({
        id: r.id,
        shopName: r.shopName || '门店',
        orderNo: r.orderNo,
        amount: Number(r.amount) || 0,
        status: r.status,
        statusText: ORDER_STATUS_TEXT[r.status] || r.status || '',
        createdAt: r.createdAt
      }))
    }
  } catch (_) {}

  // 回退：推荐事件流水
  try {
    const rows = await query(
      `SELECT r.id, r.trigger_type AS triggerType, r.reward_points AS rewardPoints,
              r.created_at AS createdAt, r.invitee_user_id AS inviteeUserId,
              u.nickname AS inviteeName, u.phone AS inviteePhone
       FROM referral_records r
       LEFT JOIN users u ON u.id = r.invitee_user_id
       WHERE r.inviter_user_id = :uid
       ORDER BY r.id DESC LIMIT 50`,
      { uid: userId }
    )
    return rows.map((r) => ({
      id: r.id,
      shopName: r.inviteeName || `用户#${r.inviteeUserId || '-'}`,
      orderNo: r.triggerType || `R${r.id}`,
      amount: Number(r.rewardPoints) || 0,
      status: 'reward',
      statusText: '推广奖励',
      createdAt: r.createdAt
    }))
  } catch (_) {
    return []
  }
}

async function listPurchaseOrders(auth) {
  const userId = Number(auth.userId) || 0
  if (!userId) throw new HttpError(401, '请先登录')
  try {
    const rows = await query(
      `SELECT id, order_no AS orderNo, goods_name AS goodsName, qty_text AS qtyText,
              note, status, created_at AS createdAt
       FROM partner_purchase_orders WHERE user_id=:uid ORDER BY id DESC LIMIT 50`,
      { uid: userId }
    )
    return rows.map((r) => ({
      ...r,
      statusText: PURCHASE_STATUS_TEXT[r.status] || r.status
    }))
  } catch (e) {
    if (/partner_purchase_orders|doesn't exist/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/27_partner_founder_ops.sql')
    }
    throw e
  }
}

async function listAllPurchaseOrders({ status, limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  let sql = `SELECT p.id, p.order_no AS orderNo, p.user_id AS userId, p.goods_name AS goodsName,
                    p.qty_text AS qtyText, p.note, p.status, p.created_at AS createdAt,
                    u.nickname AS userName, u.phone AS userPhone
             FROM partner_purchase_orders p
             LEFT JOIN users u ON u.id = p.user_id WHERE 1=1`
  const params = {}
  if (status) {
    sql += ` AND p.status=:st`
    params.st = status
  }
  sql += ` ORDER BY p.id DESC LIMIT ${lim}`
  try {
    const rows = await query(sql, params)
    return rows.map((r) => ({
      ...r,
      statusText: PURCHASE_STATUS_TEXT[r.status] || r.status
    }))
  } catch (e) {
    if (/partner_purchase_orders|doesn't exist/i.test(String(e.message || ''))) {
      return []
    }
    throw e
  }
}

async function updatePurchaseStatus(id, status) {
  const allowed = Object.keys(PURCHASE_STATUS_TEXT)
  if (!allowed.includes(status)) throw new HttpError(400, '无效状态')
  await query(`UPDATE partner_purchase_orders SET status=:st WHERE id=:id`, {
    id: Number(id),
    st: status
  })
  return { ok: true, id: Number(id), status }
}

async function submitPurchase(auth, body) {
  const userId = Number(auth.userId) || 0
  if (!userId) throw new HttpError(401, '请先登录')
  const goodsName = String(body.goodsName || '').trim()
  if (!goodsName) throw new HttpError(400, '请填写采购品名')
  const no = orderNo('PP')
  try {
    await query(
      `INSERT INTO partner_purchase_orders (order_no, user_id, goods_name, qty_text, note, status)
       VALUES (:no, :uid, :g, :q, :n, 'pending')`,
      {
        no,
        uid: userId,
        g: goodsName,
        q: String(body.qtyText || '').trim(),
        n: String(body.note || '').trim()
      }
    )
  } catch (e) {
    if (/partner_purchase_orders|doesn't exist/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/27_partner_founder_ops.sql')
    }
    throw e
  }
  return { ok: true, orderNo: no, status: 'pending', statusText: '待处理' }
}

async function submitPlatformRoleApply(body, auth) {
  const userId = Number(auth.userId) || 0
  if (!userId) throw new HttpError(401, '请先登录')
  const applyRole = String(body.applyRole || body.role || '').trim()
  if (!['founder', 'lead'].includes(applyRole)) {
    throw new HttpError(400, '仅支持申请创始人或负责人')
  }
  const contactName = String(body.contactName || '').trim()
  const contactPhone = String(body.contactPhone || '').trim()
  const city = String(body.city || '').trim()
  const remark = String(body.remark || '').trim()
  if (!contactName) throw new HttpError(400, '请填写姓名')
  if (!/^1\d{10}$/.test(contactPhone)) throw new HttpError(400, '手机号格式不正确')

  try {
    const users = await query(
      `SELECT id, IFNULL(is_founder,0) AS is_founder, IFNULL(is_lead,0) AS is_lead
       FROM users WHERE id=:id AND status=1 LIMIT 1`,
      { id: userId }
    )
    if (!users.length) throw new HttpError(404, '用户不存在')
    if (applyRole === 'founder' && Number(users[0].is_founder)) {
      throw new HttpError(400, '您已是创始人，无需重复申请')
    }
    if (applyRole === 'lead' && (Number(users[0].is_lead) || Number(users[0].is_founder))) {
      throw new HttpError(400, '您已具备负责人/创始人权限，无需重复申请')
    }
  } catch (e) {
    if (e instanceof HttpError) throw e
    if (/Unknown column.*is_lead/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/28_ops_roles_and_platform_applies.sql')
    }
    throw e
  }

  try {
    const pending = await query(
      `SELECT id FROM platform_role_applications
       WHERE user_id=:uid AND apply_role=:role AND status='pending' LIMIT 1`,
      { uid: userId, role: applyRole }
    )
    if (pending.length) throw new HttpError(400, '已有审核中的申请')
  } catch (e) {
    if (e instanceof HttpError) throw e
    if (/platform_role_applications|doesn't exist/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/28_ops_roles_and_platform_applies.sql')
    }
    throw e
  }

  const applyNo = orderNo(applyRole === 'founder' ? 'FA' : 'LA')
  await query(
    `INSERT INTO platform_role_applications
      (apply_no, user_id, apply_role, contact_name, contact_phone, city, remark, status)
     VALUES
      (:applyNo, :userId, :applyRole, :contactName, :contactPhone, :city, :remark, 'pending')`,
    { applyNo, userId, applyRole, contactName, contactPhone, city, remark }
  )
  return {
    applyNo,
    applyRole,
    status: 'pending',
    statusText: '审核中',
    remark: '已提交，预计1-3个工作日由超管/创始人审核'
  }
}

async function listPlatformRoleApplies({ status, role } = {}) {
  let sql = `SELECT id, apply_no AS applyNo, user_id AS userId, apply_role AS applyRole,
                    contact_name AS contactName, contact_phone AS contactPhone, city, remark,
                    status, reject_reason AS rejectReason, created_at AS createdAt
             FROM platform_role_applications WHERE 1=1`
  const params = {}
  if (status) {
    sql += ` AND status=:st`
    params.st = status
  }
  if (role && ['founder', 'lead'].includes(role)) {
    sql += ` AND apply_role=:role`
    params.role = role
  }
  sql += ` ORDER BY id DESC LIMIT 100`
  try {
    return await query(sql, params)
  } catch (_) {
    return []
  }
}

async function approvePlatformRoleApply(id, { reviewerId } = {}) {
  const rows = await query(
    `SELECT id, user_id AS userId, apply_role AS applyRole, status
     FROM platform_role_applications WHERE id=:id LIMIT 1`,
    { id: Number(id) }
  )
  if (!rows.length) throw new HttpError(404, '申请不存在')
  if (rows[0].status !== 'pending') throw new HttpError(400, '申请已处理')
  const col = rows[0].applyRole === 'founder' ? 'is_founder' : 'is_lead'
  await query(`UPDATE users SET ${col}=1 WHERE id=:uid`, { uid: Number(rows[0].userId) })
  if (rows[0].applyRole === 'founder') {
    try {
      await query(`UPDATE users SET is_lead=1 WHERE id=:uid`, { uid: Number(rows[0].userId) })
    } catch (_) {}
  }
  await query(
    `UPDATE platform_role_applications
     SET status='approved', reviewed_by=:rid, reviewed_at=NOW() WHERE id=:id`,
    { id: Number(id), rid: reviewerId || null }
  )
  return { ok: true, status: 'approved', applyRole: rows[0].applyRole }
}

async function rejectPlatformRoleApply(id, { reviewerId, reason } = {}) {
  const rows = await query(
    `SELECT id, status FROM platform_role_applications WHERE id=:id LIMIT 1`,
    { id: Number(id) }
  )
  if (!rows.length) throw new HttpError(404, '申请不存在')
  if (rows[0].status !== 'pending') throw new HttpError(400, '申请已处理')
  await query(
    `UPDATE platform_role_applications
     SET status='rejected', reject_reason=:r, reviewed_by=:rid, reviewed_at=NOW()
     WHERE id=:id`,
    { id: Number(id), r: String(reason || '资料不完整').slice(0, 200), rid: reviewerId || null }
  )
  return { ok: true, status: 'rejected' }
}

module.exports = {
  submitPartnerApply,
  getDashboard,
  submitWithdraw,
  listPartnerApplies,
  approvePartnerApply,
  rejectPartnerApply,
  listPartnerWithdraws,
  reviewPartnerWithdraw,
  listMerchantOrders,
  listPurchaseOrders,
  listAllPurchaseOrders,
  updatePurchaseStatus,
  submitPurchase,
  submitPlatformRoleApply,
  listPlatformRoleApplies,
  approvePlatformRoleApply,
  rejectPlatformRoleApply
}

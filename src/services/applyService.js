const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { orderNo, shortCode } = require('../utils/id')

const ROLE_LICENSE_RULES = {
  stall: ['businessLicense', 'foodLicense', 'idCardFront', 'idCardBack'],
  cross: ['businessLicense', 'idCardFront', 'idCardBack', 'storePhoto'],
  supply: ['businessLicense', 'idCardFront', 'idCardBack']
}

function assertApplyPayload(body) {
  const role = body.role
  if (!['stall', 'cross', 'supply'].includes(role)) {
    throw new HttpError(400, '请选择入驻身份')
  }
  const required = [
    'shopName',
    'creditCode',
    'legalPerson',
    'contactName',
    'contactPhone',
    'city',
    'address'
  ]
  for (const k of required) {
    if (!String(body[k] || '').trim()) throw new HttpError(400, `请填写必填字段`)
  }
  if (!/^1\d{10}$/.test(String(body.contactPhone))) {
    throw new HttpError(400, '联系电话格式不正确')
  }
  if (String(body.creditCode).length !== 18) {
    throw new HttpError(400, '统一社会信用代码应为18位')
  }
  if (!body.agreed) throw new HttpError(400, '请同意入驻协议')
  const licenses = body.licenses || {}
  for (const key of ROLE_LICENSE_RULES[role]) {
    if (!licenses[key]) throw new HttpError(400, `请上传必填证照：${key}`)
  }
}

async function submitApply(body) {
  assertApplyPayload(body)
  const pending = await query(
    `SELECT id FROM merchant_applications
     WHERE contact_phone = :phone AND status = 'pending' LIMIT 1`,
    { phone: body.contactPhone }
  )
  if (pending.length) {
    throw new HttpError(400, '该手机号已有审核中的申请，请勿重复提交')
  }
  const applyNo = orderNo('AP')
  await query(
    `INSERT INTO merchant_applications
      (apply_no, role, shop_name, credit_code, legal_person, contact_name, contact_phone,
       city, address, license_json, status)
     VALUES
      (:applyNo, :role, :shopName, :creditCode, :legalPerson, :contactName, :contactPhone,
       :city, :address, CAST(:licenseJson AS JSON), 'pending')`,
    {
      applyNo,
      role: body.role,
      shopName: body.shopName,
      creditCode: body.creditCode,
      legalPerson: body.legalPerson,
      contactName: body.contactName,
      contactPhone: body.contactPhone,
      city: body.city,
      address: body.address,
      licenseJson: JSON.stringify(body.licenses || {})
    }
  )
  return {
    applyNo,
    status: 'pending',
    statusText: '审核中',
    remark: '预计1-3个工作日审核，通过后将通知商户邀请码'
  }
}

async function queryByPhone(phone) {
  const rows = await query(
    `SELECT apply_no, role, shop_name, status, reject_reason, created_at, merchant_id
     FROM merchant_applications
     WHERE contact_phone = :phone
     ORDER BY id DESC LIMIT 1`,
    { phone }
  )
  if (!rows.length) throw new HttpError(404, '未找到申请记录')
  const r = rows[0]
  const statusMap = { pending: '审核中', approved: '已通过', rejected: '已驳回' }
  return {
    applyNo: r.apply_no,
    role: r.role,
    shopName: r.shop_name,
    status: r.status,
    statusText: statusMap[r.status] || r.status,
    rejectReason: r.reject_reason,
    merchantId: r.merchant_id,
    createdAt: r.created_at
  }
}

/** 运营审核通过：创建商户 + 额度池 + 账户 + 邀请码 */
async function approveApply(applyId, { reviewerId } = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT * FROM merchant_applications WHERE id = ? FOR UPDATE`,
      [applyId]
    )
    if (!rows.length) throw new HttpError(404, '申请不存在')
    const a = rows[0]
    if (a.status !== 'pending') throw new HttpError(400, '申请状态不可审核')

    const inviteCode = shortCode(a.role === 'stall' ? 'D' : a.role === 'cross' ? 'Y' : 'G')
    const merchantNo = orderNo('M')
    const [ins] = await conn.execute(
      `INSERT INTO merchants
        (merchant_no, role, name, credit_code, legal_person, contact_name, contact_phone,
         city, address, status, invite_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        merchantNo,
        a.role,
        a.shop_name,
        a.credit_code,
        a.legal_person,
        a.contact_name,
        a.contact_phone,
        a.city,
        a.address,
        inviteCode
      ]
    )
    const merchantId = ins.insertId
    await conn.execute(
      `INSERT INTO merchant_points_pool (merchant_id, balance) VALUES (?, 0)`,
      [merchantId]
    )
    if (a.role === 'supply') {
      await conn.execute(
        `INSERT INTO merchant_accounts (merchant_id, account_type, balance) VALUES
         (?, 'cash_goods', 0), (?, 'points_redeem', 0)`,
        [merchantId, merchantId]
      )
    } else {
      await conn.execute(
        `INSERT INTO merchant_accounts (merchant_id, account_type, balance)
         VALUES (?, 'cash_settlement', 0)`,
        [merchantId]
      )
    }
    await conn.execute(
      `UPDATE merchant_applications
       SET status='approved', merchant_id=?, reviewer_id=?, reviewed_at=NOW()
       WHERE id=?`,
      [merchantId, reviewerId || null, applyId]
    )
    return { merchantId, inviteCode, merchantNo }
  })
}

async function listApplies({ status, limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 200)
  let sql = `SELECT id, apply_no, role, shop_name, contact_name, contact_phone, city,
                    status, reject_reason, merchant_id, created_at, reviewed_at
             FROM merchant_applications`
  const params = {}
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    sql += ` WHERE status = :status`
    params.status = status
  }
  sql += ` ORDER BY id DESC LIMIT ${lim}`
  const rows = await query(sql, params)
  const statusMap = { pending: '审核中', approved: '已通过', rejected: '已驳回' }
  const roleMap = { stall: '地摊', cross: '异业', supply: '供应链' }
  return rows.map((r) => ({
    id: r.id,
    applyNo: r.apply_no,
    role: r.role,
    roleLabel: roleMap[r.role] || r.role,
    shopName: r.shop_name,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    city: r.city,
    status: r.status,
    statusText: statusMap[r.status] || r.status,
    rejectReason: r.reject_reason,
    merchantId: r.merchant_id,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at
  }))
}

async function rejectApply(applyId, { reason, reviewerId } = {}) {
  const rows = await query(`SELECT id, status FROM merchant_applications WHERE id = :id`, {
    id: applyId
  })
  if (!rows.length) throw new HttpError(404, '申请不存在')
  if (rows[0].status !== 'pending') throw new HttpError(400, '申请状态不可审核')
  await query(
    `UPDATE merchant_applications
     SET status='rejected', reject_reason=:reason, reviewer_id=:rid, reviewed_at=NOW()
     WHERE id=:id`,
    {
      id: applyId,
      reason: String(reason || '资料不符合要求').slice(0, 255),
      rid: reviewerId || null
    }
  )
  return { id: applyId, status: 'rejected' }
}

async function listMerchants({ role, limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 200)
  let sql = `SELECT m.id, m.merchant_no, m.role, m.name, m.city, m.invite_code, m.status,
                    m.contact_phone, IFNULL(p.balance, 0) AS pool_balance
             FROM merchants m
             LEFT JOIN merchant_points_pool p ON p.merchant_id = m.id`
  const params = {}
  if (role && ['stall', 'cross', 'supply'].includes(role)) {
    sql += ` WHERE m.role = :role`
    params.role = role
  }
  sql += ` ORDER BY m.id ASC LIMIT ${lim}`
  const rows = await query(sql, params)
  const roleMap = { stall: '地摊', cross: '异业', supply: '供应链' }
  return rows.map((r) => ({
    id: r.id,
    merchantNo: r.merchant_no,
    role: r.role,
    roleLabel: roleMap[r.role] || r.role,
    name: r.name,
    city: r.city,
    inviteCode: r.invite_code,
    status: r.status,
    contactPhone: r.contact_phone,
    poolBalance: r.pool_balance
  }))
}

module.exports = {
  ROLE_LICENSE_RULES,
  submitApply,
  queryByPhone,
  approveApply,
  listApplies,
  rejectApply,
  listMerchants
}

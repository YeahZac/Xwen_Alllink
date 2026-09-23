const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { orderNo, shortCode } = require('../utils/id')
const cityService = require('./cityService')
const referralService = require('./referralService')

const ROLE_LICENSE_RULES = {
  // 地摊：无需营业执照；异业 / 供应链照常
  stall: ['foodLicense', 'idCardFront', 'idCardBack'],
  cross: ['businessLicense', 'idCardFront', 'idCardBack', 'storePhoto'],
  supply: ['businessLicense', 'idCardFront', 'idCardBack']
}

function assertApplyPayload(body) {
  const role = body.role
  if (!['stall', 'cross', 'supply'].includes(role)) {
    throw new HttpError(400, '请选择入驻身份')
  }
  const required = ['shopName', 'legalPerson', 'contactName', 'contactPhone', 'address']
  if (role !== 'stall') required.splice(1, 0, 'creditCode')
  for (const k of required) {
    if (!String(body[k] || '').trim()) throw new HttpError(400, `请填写必填字段`)
  }
  if (!/^1\d{10}$/.test(String(body.contactPhone))) {
    throw new HttpError(400, '联系电话格式不正确')
  }
  if (role !== 'stall' && !String(body.creditCode || '').trim()) {
    throw new HttpError(400, '请填写统一社会信用代码')
  }
  if (!body.agreed) throw new HttpError(400, '请同意入驻协议')
  const licenses = body.licenses || {}
  for (const key of ROLE_LICENSE_RULES[role]) {
    if (!licenses[key]) throw new HttpError(400, `请上传必填证照：${key}`)
  }
  // 全部入驻类型均需地图定位（便于查询与导航）；经营城市由坐标自动识别
  const lat = Number(body.latitude)
  const lng = Number(body.longitude)
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw new HttpError(400, '请用地图标注经营地址点位')
  }
}

/** 推荐码可来自 C 端用户，也可来自已入驻商户的邀请码 */
async function resolveReferrer(code) {
  const c = String(code || '').trim()
  if (!c) return { code: null, userId: null }
  const users = await query(
    'SELECT id FROM users WHERE invite_code = :c AND status = 1 LIMIT 1',
    { c }
  )
  if (users.length) return { code: c, userId: Number(users[0].id) }
  const merchants = await query(
    'SELECT owner_user_id AS uid FROM merchants WHERE invite_code = :c AND status = 1 LIMIT 1',
    { c }
  )
  if (merchants.length) {
    return { code: c, userId: merchants[0].uid ? Number(merchants[0].uid) : null }
  }
  throw new HttpError(400, '推荐人邀请码无效')
}

async function submitApply(body) {
  assertApplyPayload(body)
  let city = String(body.city || '').trim()
  if (!city) {
    const resolved = await cityService.resolveCity(body.latitude, body.longitude)
    city = resolved.city
  }
  await cityService.ensureOpen(city)
  const referrer = await resolveReferrer(body.referrerCode)
  const applicantUserId = Number(body.applicantUserId || body.userId) || 0
  const pending = await query(
    `SELECT id FROM merchant_applications
     WHERE contact_phone = :phone AND status = 'pending' LIMIT 1`,
    { phone: body.contactPhone }
  )
  if (pending.length) {
    throw new HttpError(400, '该手机号已有审核中的申请，请勿重复提交')
  }
  const applyNo = orderNo('AP')
  try {
    await query(
      `INSERT INTO merchant_applications
        (apply_no, role, shop_name, credit_code, legal_person, contact_name, contact_phone,
         applicant_user_id, city, address, license_json, referrer_code, latitude, longitude, status)
       VALUES
        (:applyNo, :role, :shopName, :creditCode, :legalPerson, :contactName, :contactPhone,
         :applicantUserId, :city, :address, CAST(:licenseJson AS JSON), :referrerCode, :lat, :lng, 'pending')`,
      {
        applyNo,
        role: body.role,
        shopName: body.shopName,
        creditCode: body.creditCode || '',
        legalPerson: body.legalPerson,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        applicantUserId: applicantUserId || null,
        city,
        address: body.address,
        licenseJson: JSON.stringify(body.licenses || {}),
        referrerCode: referrer.code,
        lat: Number(body.latitude) || null,
        lng: Number(body.longitude) || null
      }
    )
  } catch (e) {
    // 兼容尚未跑迁移的库：无 applicant_user_id 列时回退旧插入
    if (!/applicant_user_id|Unknown column/i.test(String(e.message || ''))) throw e
    await query(
      `INSERT INTO merchant_applications
        (apply_no, role, shop_name, credit_code, legal_person, contact_name, contact_phone,
         city, address, license_json, referrer_code, latitude, longitude, status)
       VALUES
        (:applyNo, :role, :shopName, :creditCode, :legalPerson, :contactName, :contactPhone,
         :city, :address, CAST(:licenseJson AS JSON), :referrerCode, :lat, :lng, 'pending')`,
      {
        applyNo,
        role: body.role,
        shopName: body.shopName,
        creditCode: body.creditCode || '',
        legalPerson: body.legalPerson,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        city,
        address: body.address,
        licenseJson: JSON.stringify(body.licenses || {}),
        referrerCode: referrer.code,
        lat: Number(body.latitude) || null,
        lng: Number(body.longitude) || null
      }
    )
  }
  return {
    applyNo,
    status: 'pending',
    statusText: '审核中',
    referrerCode: referrer.code,
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
  return mapStatusRow(rows[0])
}

async function queryByUserId(userId) {
  const uid = Number(userId) || 0
  if (!uid) throw new HttpError(401, '请先登录后再查询')

  let rows = []
  try {
    rows = await query(
      `SELECT apply_no, role, shop_name, status, reject_reason, created_at, merchant_id
       FROM merchant_applications
       WHERE applicant_user_id = :uid
       ORDER BY id DESC LIMIT 1`,
      { uid }
    )
  } catch (e) {
    if (!/applicant_user_id|Unknown column/i.test(String(e.message || ''))) throw e
  }

  if (!rows.length) {
    const users = await query(
      'SELECT phone FROM users WHERE id = :uid AND status = 1 LIMIT 1',
      { uid }
    )
    const phone = users.length ? String(users[0].phone || '').trim() : ''
    if (phone) {
      rows = await query(
        `SELECT apply_no, role, shop_name, status, reject_reason, created_at, merchant_id
         FROM merchant_applications
         WHERE contact_phone = :phone
         ORDER BY id DESC LIMIT 1`,
        { phone }
      )
    }
  }
  if (!rows.length) throw new HttpError(404, '未找到申请记录')
  return mapStatusRow(rows[0])
}

function mapStatusRow(r) {
  const statusMap = { pending: '审核中', approved: '已通过', rejected: '已驳回' }
  const roleMap = { stall: '地摊', cross: '异业门店', supply: '供应链' }
  return {
    applyNo: r.apply_no,
    role: r.role,
    roleLabel: roleMap[r.role] || r.role,
    shopName: r.shop_name,
    status: r.status,
    statusText: statusMap[r.status] || r.status,
    rejectReason: r.reject_reason,
    remark: r.reject_reason || '',
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

    // 审核通过即开通经营权限，城市必须仍处于开通状态
    const [city] = await conn.execute(
      'SELECT status FROM operating_cities WHERE name=? LIMIT 1',
      [a.city]
    )
    if (!city.length || !Number(city[0].status)) {
      throw new HttpError(400, `经营城市「${a.city}」未开通，请先开城再审核通过`)
    }

    // 商户级推荐人：入驻时写入的推荐码在此固化为关系（BRD §4.1）
    let referrerUserId = null
    if (a.referrer_code) {
      const [ru] = await conn.execute(
        'SELECT id FROM users WHERE invite_code=? AND status=1 LIMIT 1',
        [a.referrer_code]
      )
      if (ru.length) referrerUserId = Number(ru[0].id)
      else {
        const [rm] = await conn.execute(
          'SELECT owner_user_id AS uid FROM merchants WHERE invite_code=? LIMIT 1',
          [a.referrer_code]
        )
        if (rm.length && rm[0].uid) referrerUserId = Number(rm[0].uid)
      }
    }

    // 体验期按等级档位计算（BRD §4.6.3 ①：入驻后免费体验 1-3 个月）
    const [lv] = await conn.execute(
      "SELECT trial_months FROM merchant_levels WHERE code='normal' LIMIT 1"
    )
    const trialMonths = lv.length ? Number(lv[0].trial_months) || 1 : 1

    const inviteCode = shortCode(a.role === 'stall' ? 'D' : a.role === 'cross' ? 'Y' : 'G')
    const merchantNo = orderNo('M')
    const [ins] = await conn.execute(
      `INSERT INTO merchants
        (merchant_no, role, name, credit_code, legal_person, contact_name, contact_phone,
         city, address, latitude, longitude, status, invite_code,
         referrer_user_id, level_code, trial_end_at, service_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'normal',
               DATE_ADD(CURDATE(), INTERVAL ? MONTH), 'trial')`,
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
        a.latitude,
        a.longitude,
        inviteCode,
        referrerUserId,
        trialMonths
      ]
    )
    const merchantId = ins.insertId
    await conn.execute(
      `INSERT INTO merchant_points_pool (merchant_id, balance) VALUES (?, 0)`,
      [merchantId]
    )

    // 按联系电话创建/关联经营主体用户，写入 owner_user_id
    let ownerUserId = 0
    const [byPhone] = await conn.execute(
      "SELECT id FROM users WHERE phone=? AND status=1 LIMIT 1",
      [a.contact_phone]
    )
    if (byPhone.length) {
      ownerUserId = Number(byPhone[0].id)
    } else {
      const ownerInvite = `${inviteCode}_U`
      const [uins] = await conn.execute(
        `INSERT INTO users (invite_code, nickname, phone, points_balance, status)
         VALUES (?, ?, ?, 0, 1)`,
        [ownerInvite, a.contact_name || a.shop_name, a.contact_phone]
      )
      ownerUserId = Number(uins.insertId) || 0
    }
    if (ownerUserId) {
      await conn.execute('UPDATE merchants SET owner_user_id=? WHERE id=?', [ownerUserId, merchantId])
    }
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

    // 触发点：商户入驻审核通过（BRD §4.5 第 4 步第 3 项）
    const rewarded = await referralService.rewardMerchantApproved(conn, {
      inviterUserId: referrerUserId,
      merchantId,
      applyNo: a.apply_no,
      inviteeUserId: ownerUserId
    })

    return {
      merchantId,
      inviteCode,
      merchantNo,
      ownerUserId,
      referrerUserId,
      referralReward: rewarded && rewarded.reward ? rewarded.reward : 0
    }
  })
}

function mapApplyRow(r) {
  const statusMap = { pending: '审核中', approved: '已通过', rejected: '已驳回' }
  const roleMap = { stall: '地摊', cross: '异业门店', supply: '供应链' }
  let licenses = r.license_json
  if (typeof licenses === 'string') {
    try {
      licenses = JSON.parse(licenses)
    } catch (_) {
      licenses = {}
    }
  }
  licenses = licenses && typeof licenses === 'object' ? licenses : {}
  const licenseUrls = Object.values(licenses)
    .map((v) => (typeof v === 'string' ? v : v?.url || ''))
    .filter(Boolean)
  return {
    id: r.id,
    applyNo: r.apply_no,
    role: r.role,
    roleLabel: roleMap[r.role] || r.role,
    shopName: r.shop_name,
    creditCode: r.credit_code,
    legalPerson: r.legal_person,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    city: r.city,
    address: r.address,
    licenses,
    licensePreview: licenseUrls[0] || '',
    licenseCount: licenseUrls.length,
    status: r.status,
    statusText: statusMap[r.status] || r.status,
    rejectReason: r.reject_reason,
    merchantId: r.merchant_id,
    referrerCode: r.referrer_code || '',
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at
  }
}

async function listApplies({ status, limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 200)
  let sql = `SELECT id, apply_no, role, shop_name, credit_code, legal_person, contact_name, contact_phone,
                    city, address, license_json, referrer_code, latitude, longitude,
                    status, reject_reason, merchant_id, created_at, reviewed_at
             FROM merchant_applications`
  const params = {}
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    sql += ` WHERE status = :status`
    params.status = status
  }
  sql += ` ORDER BY id DESC LIMIT ${lim}`
  const rows = await query(sql, params)
  return rows.map(mapApplyRow)
}

async function getApplyDetail(id) {
  const rows = await query(
    `SELECT id, apply_no, role, shop_name, credit_code, legal_person, contact_name, contact_phone,
            city, address, license_json, referrer_code, latitude, longitude,
                    status, reject_reason, merchant_id, created_at, reviewed_at
     FROM merchant_applications WHERE id=:id`,
    { id }
  )
  if (!rows.length) throw new HttpError(404, '申请不存在')
  return mapApplyRow(rows[0])
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
  queryByUserId,
  approveApply,
  listApplies,
  getApplyDetail,
  rejectApply,
  listMerchants
}

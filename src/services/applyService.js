const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { orderNo, shortCode } = require('../utils/id')
const { parsePaging, pageResult } = require('../utils/paging')
const cityService = require('./cityService')
const referralService = require('./referralService')
const { getConfig } = require('./configService')
const { parseMaybeJson, pickCoverFromLicenses } = require('../utils/mediaPick')

const ROLE_LICENSE_RULES = {
  // 地摊（微信收付通小微）：身份证人像/国徽 + 经营场景照；无营业执照/食品证亦可
  // 异业 / 供应链：需营业执照；三类均需门店/摊位封面图，审核通过后写入 merchants.cover_url
  stall: ['idCardFront', 'idCardBack', 'storePhoto'],
  cross: ['businessLicense', 'idCardFront', 'idCardBack', 'storePhoto'],
  supply: ['businessLicense', 'idCardFront', 'idCardBack', 'storePhoto']
}

/** 地摊可选上传材料（有则存档，无则不拦） */
const ROLE_OPTIONAL_LICENSES = {
  stall: ['foodLicense', 'businessLicense', 'idCardHandheld']
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
  // 无证地摊必须勾选合规经营承诺，才能走通入驻审核路径
  if (role === 'stall' && !body.stallCommitment) {
    throw new HttpError(400, '请确认地摊合规经营承诺')
  }
  const licenses = body.licenses || {}
  for (const key of ROLE_LICENSE_RULES[role]) {
    if (!licenses[key]) throw new HttpError(400, `请上传必填证照：${key}`)
  }
  // 微信小微进件必填文本字段（写入 license_json，供运营台与进件）
  if (role === 'stall') {
    const idNo = String(body.idCardNumber || licenses.idCardNumber || '')
      .trim()
      .toUpperCase()
    if (!/^\d{17}[\dX]$/.test(idNo)) {
      throw new HttpError(400, '请填写正确的经营者身份证号码')
    }
    const begin = String(body.idCardValidBegin || licenses.idCardValidBegin || '').trim()
    const end = String(body.idCardValidEnd || licenses.idCardValidEnd || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(begin)) {
      throw new HttpError(400, '请填写身份证有效期起（YYYY-MM-DD）')
    }
    if (!(end === '长期' || /^\d{4}-\d{2}-\d{2}$/.test(end))) {
      throw new HttpError(400, '请填写身份证有效期止（日期或长期）')
    }
    const bankNo = String(body.bankAccountNo || licenses.bankAccountNo || '').replace(/\s/g, '')
    if (!bankNo) throw new HttpError(400, '请填写本人结算银行卡号')
    const bankName = String(body.bankName || licenses.bankName || '').trim()
    if (!bankName) throw new HttpError(400, '请填写开户银行')
  }
  // 全部入驻类型均需地图定位（便于查询与导航）；经营城市由坐标自动识别
  const lat = Number(body.latitude)
  const lng = Number(body.longitude)
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw new HttpError(400, '请用地图标注经营地址点位')
  }
}

function roleLabelOf(role) {
  return { stall: '地摊', cross: '异业', supply: '供应链' }[role] || role
}

/**
 * 一人一活跃店：手机号、微信账号分开查，避免「或」条件误报，并给出可理解的原因。
 * @returns {{ id:number, name:string, reason:'phone'|'wechat' }|null}
 */
async function findActiveShopConflict({ role, phone, userId } = {}) {
  const r = String(role || '').trim()
  const p = String(phone || '').trim()
  const uid = Number(userId) || 0
  if (!r) return null

  if (/^1\d{10}$/.test(p)) {
    const byPhone = await query(
      `SELECT id, name FROM merchants
       WHERE role=:role AND deleted_at IS NULL AND status=1 AND contact_phone=:phone
       ORDER BY id DESC LIMIT 1`,
      { role: r, phone: p }
    )
    if (byPhone.length) {
      return { id: Number(byPhone[0].id), name: byPhone[0].name, reason: 'phone' }
    }
  }

  if (uid > 0) {
    const byOwner = await query(
      `SELECT id, name FROM merchants
       WHERE role=:role AND deleted_at IS NULL AND status=1 AND owner_user_id=:uid
       ORDER BY id DESC LIMIT 1`,
      { role: r, uid }
    )
    if (byOwner.length) {
      return { id: Number(byOwner[0].id), name: byOwner[0].name, reason: 'wechat' }
    }
  }
  return null
}

function throwActiveShopConflict(role, hit) {
  const roleLabel = roleLabelOf(role)
  if (!hit) return
  if (hit.reason === 'phone') {
    throw new HttpError(
      400,
      `该手机号已有营业中的${roleLabel}门店「${hit.name}」；一人仅可经营一个${roleLabel}，请先在后台删除旧店后再申请`
    )
  }
  throw new HttpError(
    400,
    `当前微信已绑定营业中的${roleLabel}门店「${hit.name}」；与表单手机号无关。如需换店请先在后台删除旧店，或使用其他微信登录后再申请`
  )
}

/** 软删停业未删门店，使「已停用，可重申」与一人一店规则一致 */
async function retireClosedMerchantsForReapply({ role, phone, userId } = {}) {
  const r = String(role || '').trim()
  const p = String(phone || '').trim()
  const uid = Number(userId) || 0
  if (!r) return { retired: 0 }
  const idSet = new Set()
  try {
    if (/^1\d{10}$/.test(p)) {
      const byPhone = await query(
        `SELECT id FROM merchants
         WHERE role=:role AND deleted_at IS NULL AND status=2 AND contact_phone=:phone`,
        { role: r, phone: p }
      )
      byPhone.forEach((row) => idSet.add(Number(row.id)))
    }
    if (uid > 0) {
      const byOwner = await query(
        `SELECT id FROM merchants
         WHERE role=:role AND deleted_at IS NULL AND status=2 AND owner_user_id=:uid`,
        { role: r, uid }
      )
      byOwner.forEach((row) => idSet.add(Number(row.id)))
    }
  } catch (_) {
    return { retired: 0 }
  }
  const ids = [...idSet]
  if (!ids.length) return { retired: 0 }
  const opsService = require('./opsService')
  let retired = 0
  for (const id of ids) {
    try {
      await opsService.softDeleteMerchant(id)
      retired += 1
    } catch (_) {
      /* 已删或并发忽略 */
    }
  }
  return { retired }
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

/**
 * @param {object} body
 * @param {{ auth?: { userId?: number }, source?: 'mp'|'admin' }} [opts]
 *  - mp：applicantUserId 只信任登录态，忽略客户端伪造
 *  - admin：代客入驻可带 applicantUserId；默认只按手机号一人一店
 */
async function submitApply(body, opts = {}) {
  assertApplyPayload(body)
  let city = String(body.city || '').trim()
  if (!city) {
    const resolved = await cityService.resolveCity(body.latitude, body.longitude)
    city = resolved.city
  }
  await cityService.ensureOpen(city)
  const referrer = await resolveReferrer(body.referrerCode)
  const source = opts.source === 'admin' ? 'admin' : 'mp'
  const authUid = Number(opts.auth && opts.auth.userId) || 0
  const bodyUid = Number(body.applicantUserId || body.userId) || 0
  // 小程序：必须用 JWT 用户，防止脏会话/伪造 userId 误伤他人或误绑
  const applicantUserId = source === 'admin' ? bodyUid : authUid
  if (source === 'mp' && !applicantUserId) {
    throw new HttpError(401, '请先登录后再提交入驻申请')
  }
  const phone = String(body.contactPhone || '').trim()

  // 停业未删的旧店：先软删以便「可重申」与一人一店一致
  await retireClosedMerchantsForReapply({
    role: body.role,
    phone,
    userId: applicantUserId
  })

  // 一人一活跃店：手机号 / 微信分查，地摊·异业·供应链同一规则
  const activeHit = await findActiveShopConflict({
    role: body.role,
    phone,
    userId: applicantUserId
  })
  throwActiveShopConflict(body.role, activeHit)

  // 审核中查重：手机号；已登录再按申请人微信防重复
  let pending = []
  try {
    pending = await query(
      `SELECT id FROM merchant_applications
       WHERE role=:role AND status='pending' AND deleted_at IS NULL AND contact_phone=:phone
       LIMIT 1`,
      { role: body.role, phone }
    )
  } catch (e) {
    if (/Unknown column.*deleted_at/i.test(String(e.message || ''))) {
      pending = await query(
        `SELECT id FROM merchant_applications
         WHERE role=:role AND status='pending' AND contact_phone=:phone
         LIMIT 1`,
        { role: body.role, phone }
      )
    } else {
      throw e
    }
  }
  if (!pending.length && applicantUserId > 0) {
    try {
      pending = await query(
        `SELECT id FROM merchant_applications
         WHERE role=:role AND status='pending' AND deleted_at IS NULL AND applicant_user_id=:uid
         LIMIT 1`,
        { role: body.role, uid: applicantUserId }
      )
    } catch (e) {
      if (!/Unknown column.*applicant_user_id|Unknown column.*deleted_at/i.test(String(e.message || ''))) {
        throw e
      }
    }
  }
  if (pending.length) {
    throw new HttpError(400, '您已有审核中的入驻申请，请勿重复提交')
  }
  // 停用(status=2) / 软删除 / 驳回 不拦截：允许重新提交商家申请
  const applyNo = orderNo('AP')
  const licensePayload = { ...(body.licenses || {}) }
  if (body.role === 'stall' && body.stallCommitment) {
    licensePayload.stallCommitment = true
    licensePayload.stallCommitmentAt = new Date().toISOString()
    licensePayload.stallPath = 'no_license_personal' // 无证个人经营者 / 微信小微路径
    licensePayload.microPaySubject = licensePayload.microPaySubject || 'SUBJECT_TYPE_MICRO'
    licensePayload.microBizType = licensePayload.microBizType || body.microBizType || 'MICRO_TYPE_MOBILE'
    licensePayload.idCardName = body.legalPerson
    licensePayload.idCardNumber = String(body.idCardNumber || licensePayload.idCardNumber || '')
      .trim()
      .toUpperCase()
    licensePayload.idCardValidBegin = body.idCardValidBegin || licensePayload.idCardValidBegin
    licensePayload.idCardValidEnd = body.idCardValidEnd || licensePayload.idCardValidEnd
    licensePayload.bankAccountName =
      body.bankAccountName || licensePayload.bankAccountName || body.legalPerson
    licensePayload.bankAccountNo = String(
      body.bankAccountNo || licensePayload.bankAccountNo || ''
    ).replace(/\s/g, '')
    licensePayload.bankName = body.bankName || licensePayload.bankName
    licensePayload.bankAccountType = 'BANK_ACCOUNT_TYPE_PERSONAL'
  }
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
        licenseJson: JSON.stringify(licensePayload),
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
        licenseJson: JSON.stringify(licensePayload),
        referrerCode: referrer.code,
        lat: Number(body.latitude) || null,
        lng: Number(body.longitude) || null
      }
    )
  }
  const base = {
    applyNo,
    status: 'pending',
    statusText: '审核中',
    referrerCode: referrer.code,
    remark:
      body.role === 'stall'
        ? '已提交（无证个人经营者路径），资料齐全将自动审核；也可由运营台人工复核'
        : '预计1-3个工作日审核，通过后将通知商户邀请码'
  }

  // 可选自动审核（默认开，角色白名单默认仅 stall）
  try {
    const auto = await maybeAutoApproveByApplyNo(applyNo, body.role)
    if (auto && auto.approved) {
      return {
        ...base,
        status: 'approved',
        statusText: '已通过',
        merchantId: auto.merchantId,
        inviteCode: auto.inviteCode,
        autoApproved: true,
        wxApplyment: auto.wxApplyment || null,
        remark: '资料校验通过，已自动审核入驻'
      }
    }
    if (auto && auto.skipped) base.autoApproveSkipped = auto.reason
  } catch (e) {
    console.warn('[apply] auto-approve', e.message)
    base.autoApproveError = e.message
  }
  return base
}

async function findApplyIdByNo(applyNo) {
  const rows = await query(
    'SELECT id FROM merchant_applications WHERE apply_no=:no LIMIT 1',
    { no: String(applyNo || '') }
  )
  return rows.length ? Number(rows[0].id) : 0
}

async function maybeAutoApproveByApplyNo(applyNo, role) {
  const enabled = String(await getConfig('apply_auto_approve', '1')) === '1'
  if (!enabled) return { skipped: true, reason: 'config_off' }
  const rolesRaw = String(await getConfig('apply_auto_approve_roles', 'stall'))
  const allow = rolesRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allow.length && !allow.includes(String(role))) {
    return { skipped: true, reason: 'role_not_allowed' }
  }
  const applyId = await findApplyIdByNo(applyNo)
  if (!applyId) return { skipped: true, reason: 'apply_not_found' }
  const approved = await approveApply(applyId, {
    reviewerId: 0,
    reviewerName: 'system-auto',
    remark: '自动审核通过'
  })
  // 事务外异步进件，避免拖慢入驻响应
  let wxApplyment = null
  if (approved && approved.merchantId) {
    setImmediate(() => {
      const subMerchantService = require('./subMerchantService')
      subMerchantService
        .maybeAutoSubmitAfterApprove(approved.merchantId)
        .then((r) => console.log('[apply] auto 进件', approved.merchantId, r))
        .catch((e) => console.warn('[apply] auto 进件', e.message))
    })
    wxApplyment = { queued: true }
  }
  return { approved: true, ...approved, wxApplyment }
}

async function queryByPhone(phone, { applyNo } = {}) {
  const p = String(phone || '').trim()
  if (!/^1\d{10}$/.test(p)) throw new HttpError(400, '手机号无效')
  const ano = String(applyNo || '').trim()
  // 防刷：必须同时提供申请单号，避免仅凭手机号枚举
  if (!ano) throw new HttpError(400, '请提供申请单号 applyNo')
  const rows = await query(
    `SELECT apply_no, role, shop_name, status, reject_reason, created_at, merchant_id
     FROM merchant_applications
     WHERE contact_phone = :phone AND apply_no = :ano
     ORDER BY id DESC LIMIT 1`,
    { phone: p, ano }
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

async function appendApplyReviewLog(payload) {
  try {
    const applyReviewLogService = require('./applyReviewLogService')
    await applyReviewLogService.writeLog(payload)
  } catch (e) {
    console.warn('[apply] review log', e.message)
  }
}

/** 地摊通过后植入「到店消费」占位 SKU，保证空店也能走收款码 */
async function ensureStallPlaceholderGoods(conn, merchantId, role) {
  const mid = Number(merchantId)
  if (!mid || role !== 'stall') return null
  try {
    const [exist] = await conn.execute(
      `SELECT id FROM stall_goods WHERE merchant_id=? AND deleted_at IS NULL LIMIT 1`,
      [mid]
    )
    if (exist.length) return Number(exist[0].id)
  } catch (_) {
    try {
      const [exist] = await conn.execute(
        `SELECT id FROM stall_goods WHERE merchant_id=? LIMIT 1`,
        [mid]
      )
      if (exist.length) return Number(exist[0].id)
    } catch (e2) {
      return null
    }
  }
  try {
    const [ins] = await conn.execute(
      `INSERT INTO stall_goods
        (merchant_id, name, sku_code, price, points_grant, category, unit, desc_text, stock, on_sale)
       VALUES (?, '到店消费', ?, 0.01, 0, '收款', '次', '收款码占位商品，可改价或下架', 9999, 1)`,
      [mid, `SCAN${mid}`]
    )
    return ins.insertId || null
  } catch (e) {
    console.warn('[apply] placeholder goods', e.message)
    return null
  }
}

/** 运营审核通过：创建商户 + 额度池 + 账户 + 邀请码（支持驳回后改审通过） */
async function approveApply(applyId, { reviewerId, reviewerName, remark } = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT * FROM merchant_applications WHERE id = ? FOR UPDATE`,
      [applyId]
    )
    if (!rows.length) throw new HttpError(404, '申请不存在')
    const a = rows[0]
    if (!['pending', 'rejected'].includes(a.status)) {
      throw new HttpError(400, '当前状态不可改为通过（已通过请勿重复操作）')
    }
    const fromStatus = a.status

    // 已有商户：改审通过并回写申请资料到门店
    if (a.merchant_id) {
      const adminRemark = String(remark || '').trim()
      const licenses = parseMaybeJson(a.license_json) || {}
      if (adminRemark) licenses.adminRemark = adminRemark.slice(0, 255)
      const coverUrl = pickCoverFromLicenses(licenses) || null
      try {
        await conn.execute(
          `UPDATE merchant_applications
           SET status='approved', reject_reason=NULL, reviewer_id=?, reviewed_at=NOW(),
               license_json=CAST(? AS JSON)
           WHERE id=?`,
          [reviewerId || null, JSON.stringify(licenses), applyId]
        )
      } catch (_) {
        await conn.execute(
          `UPDATE merchant_applications
           SET status='approved', reject_reason=NULL, reviewer_id=?, reviewed_at=NOW()
           WHERE id=?`,
          [reviewerId || null, applyId]
        )
      }
      try {
        await conn.execute(
          `UPDATE merchants SET
             status=1, deleted_at=NULL,
             name=?, credit_code=?, legal_person=?, contact_name=?, contact_phone=?,
             city=?, address=?, latitude=?, longitude=?,
             cover_url=COALESCE(?, cover_url),
             materials_json=CAST(? AS JSON)
           WHERE id=?`,
          [
            a.shop_name,
            a.credit_code,
            a.legal_person,
            a.contact_name,
            a.contact_phone,
            a.city,
            a.address,
            a.latitude,
            a.longitude,
            coverUrl,
            JSON.stringify(licenses),
            a.merchant_id
          ]
        )
      } catch (_) {
        await conn.execute(
          `UPDATE merchants SET status=1, deleted_at=NULL,
             name=?, legal_person=?, contact_name=?, contact_phone=?, city=?, address=?
           WHERE id=?`,
          [
            a.shop_name,
            a.legal_person,
            a.contact_name,
            a.contact_phone,
            a.city,
            a.address,
            a.merchant_id
          ]
        )
      }
      await ensureStallPlaceholderGoods(conn, Number(a.merchant_id), a.role)
      await appendApplyReviewLog({
        applyType: 'merchant',
        applyId,
        fromStatus,
        toStatus: 'approved',
        reason: adminRemark || (fromStatus === 'rejected' ? '改审为通过' : '审核通过'),
        reviewerId,
        reviewerName
      })
      return {
        merchantId: Number(a.merchant_id),
        inviteCode: null,
        merchantNo: null,
        ownerUserId: null,
        referrerUserId: null,
        referralReward: 0,
        reopened: fromStatus === 'rejected'
      }
    }

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
    const licenses = parseMaybeJson(a.license_json) || {}
    const adminRemark = String(remark || '').trim()
    if (adminRemark) licenses.adminRemark = adminRemark.slice(0, 255)
    const coverUrl = pickCoverFromLicenses(licenses) || null
    const materialsJson = JSON.stringify(licenses)
    const [ins] = await conn.execute(
      `INSERT INTO merchants
        (merchant_no, role, name, credit_code, legal_person, contact_name, contact_phone,
         city, address, latitude, longitude, status, invite_code,
         referrer_user_id, level_code, trial_end_at, service_status,
         cover_url, materials_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'normal',
               DATE_ADD(CURDATE(), INTERVAL ? MONTH), 'trial',
               ?, CAST(? AS JSON))`,
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
        trialMonths,
        coverUrl,
        materialsJson
      ]
    )
    const merchantId = ins.insertId
    await conn.execute(
      `INSERT INTO merchant_points_pool (merchant_id, balance) VALUES (?, 0)`,
      [merchantId]
    )

    // 优先绑定申请人账号，手机号匹配为兜底，避免 owner 与申请人错位
    let ownerUserId = 0
    const applicantId = Number(a.applicant_user_id) || 0
    if (applicantId > 0) {
      try {
        const [byApplicant] = await conn.execute(
          'SELECT id FROM users WHERE id=? AND status=1 AND deleted_at IS NULL LIMIT 1',
          [applicantId]
        )
        if (byApplicant.length) ownerUserId = Number(byApplicant[0].id)
      } catch (e) {
        if (!/deleted_at|Unknown column/i.test(String(e.message || ''))) throw e
        const [byApplicant] = await conn.execute(
          'SELECT id FROM users WHERE id=? AND status=1 LIMIT 1',
          [applicantId]
        )
        if (byApplicant.length) ownerUserId = Number(byApplicant[0].id)
      }
    }
    if (!ownerUserId) {
      let phoneRows = []
      try {
        const [byPhone] = await conn.execute(
          'SELECT id FROM users WHERE phone=? AND status=1 AND deleted_at IS NULL LIMIT 1',
          [a.contact_phone]
        )
        phoneRows = byPhone
      } catch (e) {
        if (!/deleted_at|Unknown column/i.test(String(e.message || ''))) throw e
        const [byPhone] = await conn.execute(
          'SELECT id FROM users WHERE phone=? AND status=1 LIMIT 1',
          [a.contact_phone]
        )
        phoneRows = byPhone
      }
      if (phoneRows.length) {
        ownerUserId = Number(phoneRows[0].id)
      } else {
        const ownerInvite = `${inviteCode}_U`
        const [uins] = await conn.execute(
          `INSERT INTO users (invite_code, nickname, phone, points_balance, status)
           VALUES (?, ?, ?, 0, 1)`,
          [ownerInvite, a.contact_name || a.shop_name, a.contact_phone]
        )
        ownerUserId = Number(uins.insertId) || 0
      }
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
    // 回写可选审核备注到 license_json.adminRemark，避免强依赖新列
    if (adminRemark) {
      try {
        await conn.execute(
          `UPDATE merchant_applications
           SET status='approved', merchant_id=?, reviewer_id=?, reviewed_at=NOW(),
               license_json=CAST(? AS JSON)
           WHERE id=?`,
          [merchantId, reviewerId || null, JSON.stringify(licenses), applyId]
        )
      } catch (_) {
        await conn.execute(
          `UPDATE merchant_applications
           SET status='approved', merchant_id=?, reviewer_id=?, reviewed_at=NOW()
           WHERE id=?`,
          [merchantId, reviewerId || null, applyId]
        )
      }
    } else {
      await conn.execute(
        `UPDATE merchant_applications
         SET status='approved', merchant_id=?, reviewer_id=?, reviewed_at=NOW()
         WHERE id=?`,
        [merchantId, reviewerId || null, applyId]
      )
    }

    await ensureStallPlaceholderGoods(conn, merchantId, a.role)

    // 触发点：商户入驻审核通过（BRD §4.5 第 4 步第 3 项）
    const rewarded = await referralService.rewardMerchantApproved(conn, {
      inviterUserId: referrerUserId,
      merchantId,
      applyNo: a.apply_no,
      inviteeUserId: ownerUserId
    })

    await appendApplyReviewLog({
      applyType: 'merchant',
      applyId,
      fromStatus,
      toStatus: 'approved',
      reason: adminRemark || (fromStatus === 'rejected' ? '改审为通过' : '审核通过'),
      reviewerId,
      reviewerName
    })

    const result = {
      merchantId,
      inviteCode,
      merchantNo,
      ownerUserId,
      referrerUserId,
      referralReward: rewarded && rewarded.reward ? rewarded.reward : 0,
      reopened: fromStatus === 'rejected'
    }
    // 人工审核通过后同样排队自动进件（资料不齐则跳过，可运营台补提）
    if (merchantId && String(reviewerName || '') !== 'system-auto') {
      setImmediate(() => {
        const subMerchantService = require('./subMerchantService')
        subMerchantService
          .maybeAutoSubmitAfterApprove(merchantId)
          .then((r) => console.log('[apply] post-approve 进件', merchantId, r))
          .catch((e) => console.warn('[apply] post-approve 进件', e.message))
      })
    }
    return result
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
  // 仅收集真正的图片/文件 URL，避免把 bankName「交通银行」等文本当成附件链接
  const { licenseUrl } = require('../utils/mediaPick')
  const isMedia = (u) =>
    /^(https?:\/\/|wxfile:\/\/|cloud:\/\/|\/uploads\/|\/static\/)/i.test(String(u || '').trim())
  const licenseUrls = Object.entries(licenses)
    .filter(
      ([k]) =>
        !['adminRemark', 'stallCommitment', 'stallCommitmentAt', 'stallPath', 'adminProxy', 'source'].includes(
          k
        )
    )
    .map(([, v]) => licenseUrl(v))
    .filter((u) => u && isMedia(u))
  const licensePreview = pickCoverFromLicenses(licenses) || licenseUrls[0] || ''
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
    licensePreview,
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

async function listApplies({ status, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const params = {}
  const clauses = ['deleted_at IS NULL']
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    clauses.push('status = :status')
    params.status = status
  }
  const where = ` WHERE ${clauses.join(' AND ')}`
  let countRows
  let rows
  try {
    countRows = await query(`SELECT COUNT(*) AS c FROM merchant_applications${where}`, params)
    rows = await query(
      `SELECT id, apply_no, role, shop_name, credit_code, legal_person, contact_name, contact_phone,
              city, address, license_json, referrer_code, latitude, longitude,
              status, reject_reason, merchant_id, created_at, reviewed_at
       FROM merchant_applications${where}
       ORDER BY id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  } catch (e) {
    if (!/Unknown column.*deleted_at/i.test(String(e.message || ''))) throw e
    const legacyWhere =
      status && ['pending', 'approved', 'rejected'].includes(status)
        ? ' WHERE status = :status'
        : ''
    countRows = await query(`SELECT COUNT(*) AS c FROM merchant_applications${legacyWhere}`, params)
    rows = await query(
      `SELECT id, apply_no, role, shop_name, credit_code, legal_person, contact_name, contact_phone,
              city, address, license_json, referrer_code, latitude, longitude,
              status, reject_reason, merchant_id, created_at, reviewed_at
       FROM merchant_applications${legacyWhere}
       ORDER BY id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  }
  const total = Number(countRows[0]?.c) || 0
  const list = rows.map(mapApplyRow)
  try {
    const applyReviewLogService = require('./applyReviewLogService')
    const logMap = await applyReviewLogService.listLogsBatch(
      'merchant',
      list.map((r) => r.id)
    )
    for (const item of list) {
      item.reviewLogs = logMap[String(item.id)] || []
      const latest = item.reviewLogs[0]
      item.lastReviewAction = latest ? latest.actionText : ''
      item.lastReviewReason = latest ? latest.reason || item.rejectReason || '' : item.rejectReason || ''
    }
  } catch (_) {
    for (const item of list) {
      item.reviewLogs = []
      item.lastReviewAction = ''
      item.lastReviewReason = item.rejectReason || ''
    }
  }
  return pageResult(list, total, paging)
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
  const detail = mapApplyRow(rows[0])
  const applyReviewLogService = require('./applyReviewLogService')
  detail.reviewLogs = await applyReviewLogService.listLogs('merchant', id)
  return detail
}

async function listApplyReviewLogs(id) {
  const applyReviewLogService = require('./applyReviewLogService')
  return applyReviewLogService.listLogs('merchant', id)
}

/** 删除入驻申请：软删申请单；若已生成门店则一并软删，便于重新入驻 */
async function deleteApply(applyId, { reviewerId, reviewerName } = {}) {
  const id = Number(applyId)
  let rows
  try {
    rows = await query(
      `SELECT id, status, merchant_id AS merchantId, shop_name AS shopName, apply_no AS applyNo,
              role, deleted_at AS deletedAt
       FROM merchant_applications WHERE id=:id`,
      { id }
    )
  } catch (e) {
    if (!/Unknown column.*deleted_at/i.test(String(e.message || ''))) throw e
    rows = await query(
      `SELECT id, status, merchant_id AS merchantId, shop_name AS shopName, apply_no AS applyNo, role
       FROM merchant_applications WHERE id=:id`,
      { id }
    )
  }
  if (!rows.length) throw new HttpError(404, '申请不存在')
  const row = rows[0]
  if (row.deletedAt) throw new HttpError(404, '申请已删除')
  const mid = Number(row.merchantId) || 0
  if (mid) {
    try {
      await require('./opsService').softDeleteMerchant(mid)
    } catch (e) {
      if (!(e && Number(e.status) === 404)) throw e
    }
  }
  try {
    await query(
      `UPDATE merchant_applications
       SET deleted_at=NOW(),
           status='rejected',
           reject_reason='已由平台删除，可重新提交入驻',
           reviewer_id=:rid,
           reviewed_at=NOW()
       WHERE id=:id`,
      { id, rid: reviewerId || null }
    )
  } catch (e) {
    if (!/Unknown column.*deleted_at/i.test(String(e.message || ''))) throw e
    await query(`DELETE FROM merchant_applications WHERE id=:id`, { id })
  }
  await appendApplyReviewLog({
    applyType: 'merchant',
    applyId: id,
    fromStatus: row.status,
    toStatus: 'deleted',
    reason: '平台删除申请，可重新入驻',
    reviewerId,
    reviewerName
  })
  return {
    id,
    deleted: true,
    applyNo: row.applyNo,
    shopName: row.shopName,
    merchantId: mid || null,
    reapplyAllowed: true
  }
}

async function rejectApply(applyId, { reason, reviewerId, reviewerName } = {}) {
  const rows = await query(
    `SELECT id, status, merchant_id AS merchantId FROM merchant_applications WHERE id = :id`,
    { id: applyId }
  )
  if (!rows.length) throw new HttpError(404, '申请不存在')
  if (!['pending', 'approved'].includes(rows[0].status)) {
    throw new HttpError(400, '当前状态不可改为驳回')
  }
  const fromStatus = rows[0].status
  const rejectReason = String(reason || '').trim()
  if (!rejectReason) throw new HttpError(400, '请填写驳回原因')
  await query(
    `UPDATE merchant_applications
     SET status='rejected', reject_reason=:reason, reviewer_id=:rid, reviewed_at=NOW()
     WHERE id=:id`,
    {
      id: applyId,
      reason: rejectReason.slice(0, 255),
      rid: reviewerId || null
    }
  )
  // 已通过改驳回：软删门店释放一人一店，入驻单仍保留在审核列表
  if (fromStatus === 'approved' && rows[0].merchantId) {
    try {
      await require('./opsService').softDeleteMerchant(rows[0].merchantId, {
        hideApplies: false
      })
    } catch (e) {
      if (!(e && Number(e.status) === 404)) {
        try {
          await query(`UPDATE merchants SET status=2, deleted_at=NOW() WHERE id=:mid`, {
            mid: rows[0].merchantId
          })
        } catch (_) {
          await query(`UPDATE merchants SET status=2 WHERE id=:mid`, { mid: rows[0].merchantId })
        }
      }
    }
  }
  await appendApplyReviewLog({
    applyType: 'merchant',
    applyId,
    fromStatus,
    toStatus: 'rejected',
    reason: rejectReason,
    reviewerId,
    reviewerName
  })
  return { id: applyId, status: 'rejected', fromStatus, reapplyAllowed: true }
}

async function listMerchants({ role, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = 'WHERE m.deleted_at IS NULL'
  const params = {}
  if (role && ['stall', 'cross', 'supply'].includes(role)) {
    where += ` AND m.role = :role`
    params.role = role
  }
  const countRows = await query(
    `SELECT COUNT(*) AS c FROM merchants m ${where}`,
    params
  )
  const total = Number(countRows[0]?.c) || 0
  const rows = await query(
    `SELECT m.id, m.merchant_no, m.role, m.name, m.city, m.invite_code, m.status,
            m.contact_phone, m.cover_url, m.materials_json,
            IFNULL(p.balance, 0) AS pool_balance
     FROM merchants m
     LEFT JOIN merchant_points_pool p ON p.merchant_id = m.id
     ${where}
     ORDER BY m.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
    params
  )
  const roleMap = { stall: '地摊', cross: '异业', supply: '供应链' }
  const list = rows.map((r) => {
    const coverUrl = r.cover_url || pickCoverFromLicenses(r.materials_json) || ''
    return {
      id: r.id,
      merchantNo: r.merchant_no,
      role: r.role,
      roleLabel: roleMap[r.role] || r.role,
      name: r.name,
      city: r.city,
      inviteCode: r.invite_code,
      status: r.status,
      contactPhone: r.contact_phone,
      poolBalance: r.pool_balance,
      coverUrl,
      coverImage: coverUrl
    }
  })
  return pageResult(list, total, paging)
}

/**
 * 运营台代客入驻：写入 pending 申请，不直建门店；审核通过后进入用户与门店
 */
async function submitAdminApply(body = {}) {
  const role = String(body.role || '').trim()
  if (!['stall', 'cross', 'supply'].includes(role)) {
    throw new HttpError(400, '请选择入驻身份：地摊/异业/供应链')
  }
  const shopName = String(body.shopName || body.name || '').trim()
  const legalPerson = String(body.legalPerson || body.contactName || '').trim()
  const contactName = String(body.contactName || legalPerson || shopName).trim()
  const contactPhone = String(body.contactPhone || '').trim()
  const city = String(body.city || '').trim()
  const address = String(body.address || '').trim()
  if (!shopName) throw new HttpError(400, '请填写店铺名称')
  if (!legalPerson) throw new HttpError(400, '请填写法人/经营者')
  if (!contactPhone || !/^1\d{10}$/.test(contactPhone)) {
    throw new HttpError(400, '请填写正确的联系电话')
  }
  if (!city) throw new HttpError(400, '请填写城市')
  if (!address) throw new HttpError(400, '请填写详细地址')
  if (role !== 'stall' && !String(body.creditCode || '').trim()) {
    throw new HttpError(400, '异业/供应链请填写统一社会信用代码')
  }
  await cityService.ensureOpen(city)

  const licenses = { ...(body.licenses || {}), adminProxy: true, source: 'admin' }
  if (body.coverUrl) {
    licenses.storePhoto = body.coverUrl
    licenses.coverUrl = body.coverUrl
  }
  // 代客草稿：证照可后补，审核前运营台详情可再改；地摊承诺由平台代勾
  return submitApply(
    {
      role,
      shopName,
      creditCode: body.creditCode || '',
      legalPerson,
      contactName,
      contactPhone,
      city,
      address,
      latitude: body.latitude != null ? Number(body.latitude) : 22.5431,
      longitude: body.longitude != null ? Number(body.longitude) : 114.0579,
      agreed: true,
      stallCommitment: role === 'stall' ? true : undefined,
      idCardNumber: body.idCardNumber || '110101199001011234',
      idCardValidBegin: body.idCardValidBegin || '2020-01-01',
      idCardValidEnd: body.idCardValidEnd || '长期',
      bankAccountNo: body.bankAccountNo || '6222020000000000000',
      bankName: body.bankName || '待补全',
      bankAccountName: body.bankAccountName || legalPerson,
      licenses: {
        ...licenses,
        idCardFront: licenses.idCardFront || body.coverUrl || '/static/placeholder-id-front.png',
        idCardBack: licenses.idCardBack || body.coverUrl || '/static/placeholder-id-back.png',
        storePhoto: licenses.storePhoto || body.coverUrl || '/static/placeholder-store.png',
        businessLicense:
          role === 'stall'
            ? licenses.businessLicense
            : licenses.businessLicense || body.coverUrl || '/static/placeholder-license.png'
      },
      applicantUserId: body.applicantUserId || body.userId || 0,
      referrerCode: body.referrerCode || ''
    },
    { source: 'admin' }
  )
}

module.exports = {
  ROLE_LICENSE_RULES,
  ROLE_OPTIONAL_LICENSES,
  submitApply,
  submitAdminApply,
  queryByPhone,
  queryByUserId,
  approveApply,
  listApplies,
  getApplyDetail,
  listApplyReviewLogs,
  rejectApply,
  deleteApply,
  listMerchants
}

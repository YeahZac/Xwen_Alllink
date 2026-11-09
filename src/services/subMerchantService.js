/**
 * 电商收付通二级商户：进件提交/状态同步、分账比例、支付后分账
 * 字段与流程对齐微信 POST /v3/ecommerce/applyments/
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { URL } = require('url')
const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { orderNo } = require('../utils/id')
const { parseMaybeJson, licenseUrl } = require('../utils/mediaPick')
const { getConfig } = require('./configService')
const wxPayService = require('./wxPayService')

const STATE_LABEL = {
  DRAFT: '草稿',
  CHECKING: '资料校验中',
  ACCOUNT_NEED_VERIFY: '待账户验证',
  AUDITING: '审核中',
  REJECTED: '已驳回',
  NEED_SIGN: '待签约',
  FINISH: '已完成',
  FROZEN: '已冻结',
  CANCELED: '已作废'
}

const BANK_SHORT = [
  '工商银行',
  '农业银行',
  '中国银行',
  '建设银行',
  '交通银行',
  '招商银行',
  '邮储银行',
  '中信银行',
  '光大银行',
  '华夏银行',
  '民生银行',
  '广发银行',
  '平安银行',
  '兴业银行',
  '浦发银行',
  '北京银行',
  '上海银行',
  '宁波银行'
]

function maskAccount(no) {
  const s = String(no || '').replace(/\s/g, '')
  if (s.length < 8) return s ? '****' : ''
  return `${s.slice(0, 4)}****${s.slice(-4)}`
}

function resolveOrgType(merchant, materials) {
  const forced = String(materials.organizationType || materials.orgType || '').trim()
  if (forced) return forced
  if (merchant.role === 'stall' || materials.stallPath === 'no_license_personal') return '2401'
  const code = String(merchant.credit_code || materials.creditCode || '').trim()
  if (!code) return '2401'
  // 个体户信用代码常见 9 开头 18 位，此处默认个体；企业可运营台覆盖 organizationType=2
  if (materials.subjectType === 'enterprise' || materials.orgTypeName === '企业') return '2'
  return '4'
}

function resolveAccountBank(bankName) {
  const raw = String(bankName || '').trim()
  if (!raw) return { account_bank: '其他银行', bank_name: '' }
  for (const short of BANK_SHORT) {
    if (raw.includes(short)) return { account_bank: short, bank_name: '' }
  }
  return { account_bank: '其他银行', bank_name: raw }
}

function downloadBuffer(urlOrPath) {
  return new Promise((resolve, reject) => {
    const raw = String(urlOrPath || '').trim()
    if (!raw) {
      reject(new HttpError(400, '图片地址为空'))
      return
    }
    if (raw.startsWith('/') && !raw.startsWith('//')) {
      const local = path.join(__dirname, '../../public', raw)
      fs.readFile(local, (err, buf) => {
        if (err) reject(new HttpError(400, `本地图片不可读：${raw}`))
        else resolve(buf)
      })
      return
    }
    if (/^file:\/\//i.test(raw)) {
      const p = raw.replace(/^file:\/\//i, '')
      fs.readFile(p, (err, buf) => {
        if (err) reject(err)
        else resolve(buf)
      })
      return
    }
    let u
    try {
      u = new URL(raw)
    } catch (_) {
      reject(new HttpError(400, `无效图片地址：${raw}`))
      return
    }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.get(
      raw,
      { timeout: 20000, headers: { 'User-Agent': 'wanye-alllink/1.0' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadBuffer(res.headers.location).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new HttpError(502, `下载图片失败 HTTP ${res.statusCode}`))
          res.resume()
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new HttpError(504, '下载图片超时'))
    })
  })
}

async function uploadMediaFromUrl(url, filename) {
  const buf = await downloadBuffer(url)
  if (!buf || buf.length < 100) throw new HttpError(400, `图片过小或损坏：${filename}`)
  return wxPayService.uploadMerchantMedia(buf, filename)
}

async function loadMerchant(id) {
  const rows = await query(
    `SELECT id, merchant_no, role, name, credit_code, legal_person, contact_name, contact_phone,
            city, address, cover_url, materials_json, status,
            wx_sub_mch_id, wx_applyment_id, wx_out_request_no, wx_apply_state, wx_apply_state_desc,
            wx_sign_url, wx_settlement_json, profit_share_rate, wx_apply_synced_at
     FROM merchants WHERE id=:id AND deleted_at IS NULL LIMIT 1`,
    { id: Number(id) }
  )
  if (!rows.length) throw new HttpError(404, '商户不存在')
  return rows[0]
}

function materialsOf(m) {
  return parseMaybeJson(m.materials_json) || {}
}

function settlementOf(m) {
  return parseMaybeJson(m.wx_settlement_json) || {}
}

async function listSubMerchants({ q, state, role, page, pageSize, limit } = {}) {
  const { parsePaging, pageResult } = require('../utils/paging')
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const where = ['m.deleted_at IS NULL']
  const params = {}
  if (role) {
    where.push('m.role = :role')
    params.role = role
  }
  if (state) {
    where.push("IFNULL(m.wx_apply_state, '') = :state")
    params.state = state
  }
  if (q) {
    where.push(
      '(m.name LIKE :q OR m.merchant_no LIKE :q OR m.contact_phone LIKE :q OR m.wx_sub_mch_id LIKE :q)'
    )
    params.q = `%${String(q).trim()}%`
  }
  const whereSql = where.join(' AND ')
  let rows
  let total = 0
  try {
    const countRows = await query(`SELECT COUNT(*) AS c FROM merchants m WHERE ${whereSql}`, params)
    total = Number(countRows[0]?.c) || 0
    rows = await query(
      `SELECT m.id, m.merchant_no AS merchantNo, m.role, m.name, m.city, m.contact_phone AS contactPhone,
              m.status, m.wx_sub_mch_id AS wxSubMchId, m.wx_applyment_id AS wxApplymentId,
              m.wx_out_request_no AS wxOutRequestNo, m.wx_apply_state AS wxApplyState,
              m.wx_apply_state_desc AS wxApplyStateDesc, m.wx_sign_url AS wxSignUrl,
              m.profit_share_rate AS profitShareRate, m.wx_apply_synced_at AS wxApplySyncedAt
       FROM merchants m
       WHERE ${whereSql}
       ORDER BY
         CASE WHEN m.wx_sub_mch_id IS NULL OR m.wx_sub_mch_id='' THEN 0 ELSE 1 END,
         m.id DESC
       LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  } catch (e) {
    if (/Unknown column.*wx_apply_state|Unknown column.*profit_share/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/36_wx_sub_merchant.sql')
    }
    throw e
  }
  const list = rows.map((r) => ({
    ...r,
    profitShareRate: Number(r.profitShareRate) || 0,
    profitSharePercent: Math.round((Number(r.profitShareRate) || 0) * 10000) / 100,
    stateLabel: STATE_LABEL[r.wxApplyState] || r.wxApplyState || '未进件',
    ready: Boolean(r.wxSubMchId)
  }))
  return pageResult(list, total, paging)
}

async function getSubMerchantDetail(id) {
  const m = await loadMerchant(id)
  const materials = materialsOf(m)
  const settlement = settlementOf(m)
  const applyRows = await query(
    `SELECT id, out_request_no AS outRequestNo, applyment_id AS applymentId,
            organization_type AS organizationType, state, state_desc AS stateDesc,
            sub_mchid AS subMchid, sign_url AS signUrl, sign_state AS signState,
            reject_detail_json AS rejectDetail, last_error AS lastError,
            submitted_at AS submittedAt, synced_at AS syncedAt, created_at AS createdAt
     FROM wx_sub_applyments WHERE merchant_id=:id ORDER BY id DESC LIMIT 20`,
    { id: Number(id) }
  ).catch((e) => {
    if (/doesn't exist|Unknown table/i.test(String(e.message || ''))) return []
    throw e
  })
  const orgType = resolveOrgType(m, materials)
  return {
    id: m.id,
    merchantNo: m.merchant_no,
    role: m.role,
    name: m.name,
    creditCode: m.credit_code || '',
    legalPerson: m.legal_person || '',
    contactName: m.contact_name || '',
    contactPhone: m.contact_phone || '',
    city: m.city,
    address: m.address,
    coverUrl: m.cover_url || '',
    status: m.status,
    wxSubMchId: m.wx_sub_mch_id || '',
    wxApplymentId: m.wx_applyment_id || null,
    wxOutRequestNo: m.wx_out_request_no || '',
    wxApplyState: m.wx_apply_state || '',
    wxApplyStateDesc: m.wx_apply_state_desc || '',
    wxSignUrl: m.wx_sign_url || '',
    profitShareRate: Number(m.profit_share_rate) || 0,
    profitSharePercent: Math.round((Number(m.profit_share_rate) || 0) * 10000) / 100,
    wxApplySyncedAt: m.wx_apply_synced_at,
    stateLabel: STATE_LABEL[m.wx_apply_state] || m.wx_apply_state || '未进件',
    organizationType: orgType,
    materials: {
      hasIdCardFront: Boolean(licenseUrl(materials.idCardFront)),
      hasIdCardBack: Boolean(licenseUrl(materials.idCardBack)),
      hasStorePhoto: Boolean(licenseUrl(materials.storePhoto || materials.stallPhoto)),
      hasBusinessLicense: Boolean(licenseUrl(materials.businessLicense)),
      idCardName: materials.idCardName || m.legal_person || '',
      idCardNumberMasked: maskAccount(materials.idCardNumber),
      idCardValidBegin: materials.idCardValidBegin || '',
      idCardValidEnd: materials.idCardValidEnd || '',
      bankName: materials.bankName || settlement.bankName || '',
      bankAccountNoMasked: maskAccount(materials.bankAccountNo || settlement.bankAccountNo),
      bankAccountName: materials.bankAccountName || m.legal_person || '',
      stallPath: materials.stallPath || ''
    },
    settlement,
    applyments: applyRows,
    wxPayReady: wxPayService.wxPayConfigured()
  }
}

/**
 * 进件资料是否齐备（不上传媒体，仅本地校验）
 * @returns {{ ready: boolean, missing: string[], organizationType: string }}
 */
function materialsReadyForApplyment(merchantOrRow, materialsIn, settlementIn) {
  const merchant = merchantOrRow || {}
  const materials = materialsIn || materialsOf(merchant)
  const settlement = settlementIn || settlementOf(merchant)
  const orgType = resolveOrgType(merchant, { ...materials, ...settlement })
  const missing = []
  const idName = String(materials.idCardName || merchant.legal_person || '').trim()
  const idNo = String(materials.idCardNumber || '').trim().toUpperCase()
  const idBegin = String(materials.idCardValidBegin || '').trim()
  const idEnd = String(materials.idCardValidEnd || '').trim()
  const phone = String(merchant.contact_phone || materials.contactPhone || '').trim()
  const bankNo = String(materials.bankAccountNo || settlement.bankAccountNo || '').replace(/\s/g, '')
  const bankName = String(materials.bankName || settlement.bankName || '').trim()
  if (!idName) missing.push('身份证姓名')
  if (!/^\d{17}[\dX]$/.test(idNo)) missing.push('身份证号码')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(idBegin)) missing.push('证件有效期起')
  if (!(idEnd === '长期' || /^\d{4}-\d{2}-\d{2}$/.test(idEnd))) missing.push('证件有效期止')
  if (!phone) missing.push('联系手机')
  if (!bankNo) missing.push('结算银行卡号')
  if (!bankName) missing.push('开户银行')
  if (!licenseUrl(materials.idCardFront)) missing.push('身份证人像面')
  if (!licenseUrl(materials.idCardBack)) missing.push('身份证国徽面')
  if (!licenseUrl(materials.storePhoto || materials.stallPhoto || merchant.cover_url)) {
    missing.push('经营场景照')
  }
  if (orgType !== '2401' && orgType !== '2500') {
    if (!licenseUrl(materials.businessLicense)) missing.push('营业执照')
    if (!String(merchant.credit_code || materials.creditCode || '').trim()) {
      missing.push('统一社会信用代码')
    }
  }
  return { ready: missing.length === 0, missing, organizationType: orgType }
}

/** 审核通过后异步自动进件（不阻塞审核事务） */
async function maybeAutoSubmitAfterApprove(merchantId) {
  const enabled = String(await getConfig('wx_applyment_auto_submit', '1')) === '1'
  if (!enabled) return { skipped: true, reason: 'config_off' }
  if (!wxPayService.wxPayConfigured()) return { skipped: true, reason: 'wxpay_unconfigured' }
  const m = await loadMerchant(merchantId)
  if (m.wx_sub_mch_id) return { skipped: true, reason: 'already_sub_mch' }
  const check = materialsReadyForApplyment(m)
  if (!check.ready) {
    return { skipped: true, reason: 'materials_incomplete', missing: check.missing }
  }
  try {
    const detail = await submitApplyment(merchantId, {})
    return {
      ok: true,
      state: detail.wxApplyState,
      applymentId: detail.wxApplymentId,
      organizationType: check.organizationType
    }
  } catch (e) {
    console.warn('[subMerchant] auto submit after approve', merchantId, e.message)
    return { ok: false, error: e.message, missing: check.missing }
  }
}

async function buildApplymentBody(merchant, materials, settlement, { outRequestNo, media } = {}) {
  const orgType = resolveOrgType(merchant, { ...materials, ...settlement })
  const idName = String(materials.idCardName || merchant.legal_person || '').trim()
  const idNo = String(materials.idCardNumber || '').trim().toUpperCase()
  const idBegin = String(materials.idCardValidBegin || '').trim()
  let idEnd = String(materials.idCardValidEnd || '').trim()
  if (idEnd === '长期' || /^2099/.test(idEnd)) idEnd = '长期'
  const phone = String(merchant.contact_phone || materials.contactPhone || '').trim()
  const bankNo = String(
    materials.bankAccountNo || settlement.bankAccountNo || ''
  ).replace(/\s/g, '')
  const bankAccountName = String(
    materials.bankAccountName || settlement.bankAccountName || idName
  ).trim()
  const bankRaw = materials.bankName || settlement.bankName || ''
  const bank = resolveAccountBank(bankRaw)

  if (!idName || !idNo) throw new HttpError(400, '缺少身份证姓名/号码，请先在入驻资料中补全')
  if (!idBegin || !idEnd) throw new HttpError(400, '缺少身份证有效期')
  if (!bankNo) throw new HttpError(400, '缺少结算银行卡号')
  if (!phone) throw new HttpError(400, '缺少联系手机号')
  if (!media.idCardFront || !media.idCardBack) {
    throw new HttpError(400, '身份证正反面需先上传至微信媒体库')
  }
  if (!media.storeScene) throw new HttpError(400, '经营场景照缺失')

  const shortName = String(merchant.name || '万业互联云商家').slice(0, 21)
  const body = {
    out_request_no: outRequestNo,
    organization_type: orgType,
    id_doc_type: 'IDENTIFICATION_TYPE_MAINLAND_IDCARD',
    id_card_info: {
      id_card_copy: media.idCardFront,
      id_card_national: media.idCardBack,
      id_card_name: wxPayService.encryptSensitive(idName),
      id_card_number: wxPayService.encryptSensitive(idNo),
      id_card_valid_time_begin: idBegin,
      id_card_valid_time: idEnd
    },
    account_info: {
      bank_account_type: orgType === '2' ? '74' : '75',
      account_bank: bank.account_bank,
      account_name: wxPayService.encryptSensitive(bankAccountName),
      account_number: wxPayService.encryptSensitive(bankNo)
    },
    contact_info: {
      contact_type: '65',
      contact_name: wxPayService.encryptSensitive(idName),
      contact_id_card_number: wxPayService.encryptSensitive(idNo),
      mobile_phone: wxPayService.encryptSensitive(phone)
    },
    sales_scene_info: {
      store_name: String(merchant.name || shortName).slice(0, 256),
      store_qr_code: media.storeScene
    },
    merchant_shortname: shortName
  }
  if (bank.bank_name) body.account_info.bank_name = bank.bank_name

  const appId = wxPayService.payConfig().appId
  if (appId) body.sales_scene_info.mini_program_sub_appid = appId

  if (orgType !== '2401' && orgType !== '2500') {
    if (!media.businessLicense) throw new HttpError(400, '个体/企业主体需上传营业执照')
    const licenseNo = String(merchant.credit_code || materials.creditCode || '').trim()
    if (!licenseNo) throw new HttpError(400, '缺少统一社会信用代码')
    body.business_license_info = {
      business_license_copy: media.businessLicense,
      business_license_number: licenseNo,
      merchant_name: String(merchant.name).slice(0, 128),
      legal_person: idName
    }
    if (merchant.address) body.business_license_info.company_address = String(merchant.address).slice(0, 512)
  }

  if (orgType === '2500') {
    body.business_addition_desc =
      '个人卖家声明：该商户已持续从事电子商务经营活动满6个月，且期间经营收入累计超过20万元。'
  }

  const settlementId = Number(settlement.settlementId || materials.settlementId)
  if (Number.isFinite(settlementId) && settlementId > 0) {
    body.settlement_info = { settlement_id: settlementId }
    if (settlement.qualificationType || materials.qualificationType) {
      body.settlement_info.qualification_type = String(
        settlement.qualificationType || materials.qualificationType
      )
    }
  }

  return body
}

async function prepareMediaIds(materials, merchant) {
  const front = licenseUrl(materials.idCardFront)
  const back = licenseUrl(materials.idCardBack)
  const store = licenseUrl(materials.storePhoto || materials.stallPhoto || merchant.cover_url)
  const license = licenseUrl(materials.businessLicense)
  if (!front || !back) throw new HttpError(400, '请先上传身份证人像面与国徽面')
  if (!store) throw new HttpError(400, '请先上传摊位/门店经营场景照')
  const media = {
    idCardFront: await uploadMediaFromUrl(front, 'id_front.jpg'),
    idCardBack: await uploadMediaFromUrl(back, 'id_back.jpg'),
    storeScene: await uploadMediaFromUrl(store, 'store.jpg')
  }
  if (license) {
    media.businessLicense = await uploadMediaFromUrl(license, 'license.jpg')
  }
  return media
}

function redactSnapshot(body) {
  const snap = JSON.parse(JSON.stringify(body || {}))
  const redact = (obj, keys) => {
    if (!obj) return
    for (const k of keys) {
      if (obj[k]) obj[k] = '[encrypted]'
    }
  }
  redact(snap.id_card_info, ['id_card_name', 'id_card_number'])
  redact(snap.account_info, ['account_name', 'account_number'])
  redact(snap.contact_info, ['contact_name', 'contact_id_card_number', 'mobile_phone'])
  return snap
}

async function applyMerchantStatus(merchantId, patch) {
  const fields = []
  const params = { id: Number(merchantId) }
  const map = {
    wx_applyment_id: 'applymentId',
    wx_out_request_no: 'outRequestNo',
    wx_apply_state: 'state',
    wx_apply_state_desc: 'stateDesc',
    wx_sign_url: 'signUrl',
    wx_sub_mch_id: 'subMchid',
    wx_apply_synced_at: 'syncedAt'
  }
  for (const [col, key] of Object.entries(map)) {
    if (patch[key] === undefined) continue
    fields.push(`${col} = :${key}`)
    params[key] = patch[key]
  }
  if (!fields.length) return
  await query(`UPDATE merchants SET ${fields.join(', ')} WHERE id=:id`, params)
}

/**
 * 提交/覆盖进件（同 out_request_no 可在驳回后重提）
 */
async function submitApplyment(merchantId, body = {}) {
  if (!wxPayService.wxPayConfigured()) {
    throw new HttpError(503, '微信支付未配置完整，无法进件')
  }
  const c = wxPayService.payConfig()
  if (!c.wechatPubKey || !c.wechatPubKeyId) {
    throw new HttpError(503, '未配置微信支付公钥/公钥ID，无法加密进件敏感字段')
  }

  const m = await loadMerchant(merchantId)
  if (m.wx_sub_mch_id && m.wx_apply_state === 'FINISH' && !body.force) {
    throw new HttpError(400, '该商户已完成进件，如需变更请走微信商户平台或强制重提')
  }

  const materials = { ...materialsOf(m), ...(body.materials || {}) }
  const settlement = { ...settlementOf(m), ...(body.settlement || {}) }
  if (body.organizationType) materials.organizationType = body.organizationType
  if (body.bankAccountNo) materials.bankAccountNo = String(body.bankAccountNo).replace(/\s/g, '')
  if (body.bankName) materials.bankName = body.bankName
  if (body.bankAccountName) materials.bankAccountName = body.bankAccountName
  if (body.idCardNumber) materials.idCardNumber = String(body.idCardNumber).trim().toUpperCase()
  if (body.idCardValidBegin) materials.idCardValidBegin = body.idCardValidBegin
  if (body.idCardValidEnd) materials.idCardValidEnd = body.idCardValidEnd

  // 持久化运营台补录字段（不含图片二进制）
  const nextMaterials = { ...materialsOf(m), ...materials }
  const nextSettlement = { ...settlementOf(m), ...settlement }
  await query(
    `UPDATE merchants SET materials_json=CAST(:mj AS JSON), wx_settlement_json=CAST(:sj AS JSON) WHERE id=:id`,
    {
      id: Number(merchantId),
      mj: JSON.stringify(nextMaterials),
      sj: JSON.stringify(nextSettlement)
    }
  )

  const outRequestNo =
    String(m.wx_out_request_no || '').trim() ||
    String(body.outRequestNo || '').trim() ||
    orderNo('WA').slice(0, 40)

  const media = await prepareMediaIds(nextMaterials, m)
  const wxBody = await buildApplymentBody(m, nextMaterials, nextSettlement, {
    outRequestNo,
    media
  })

  let wxRes
  try {
    wxRes = await wxPayService.submitEcommerceApplyment(wxBody)
  } catch (e) {
    const msg = e.message || '进件提交失败'
    await query(
      `INSERT INTO wx_sub_applyments
        (merchant_id, out_request_no, organization_type, state, state_desc, last_error, request_snapshot_json)
       VALUES (:mid, :ono, :ot, 'DRAFT', :desc, :err, CAST(:snap AS JSON))
       ON DUPLICATE KEY UPDATE last_error=VALUES(last_error), state_desc=VALUES(state_desc),
         request_snapshot_json=VALUES(request_snapshot_json), updated_at=NOW()`,
      {
        mid: Number(merchantId),
        ono: outRequestNo,
        ot: wxBody.organization_type,
        desc: msg.slice(0, 255),
        err: msg.slice(0, 512),
        snap: JSON.stringify(redactSnapshot(wxBody))
      }
    ).catch(() => {})
    throw e
  }

  const applymentId = wxRes.applyment_id || wxRes.applymentId || null
  await query(
    `INSERT INTO wx_sub_applyments
      (merchant_id, out_request_no, applyment_id, organization_type, state, state_desc,
       request_snapshot_json, submitted_at, synced_at)
     VALUES (:mid, :ono, :aid, :ot, 'CHECKING', '已提交微信', CAST(:snap AS JSON), NOW(), NOW())
     ON DUPLICATE KEY UPDATE applyment_id=VALUES(applyment_id), state='CHECKING',
       state_desc='已提交微信', request_snapshot_json=VALUES(request_snapshot_json),
       submitted_at=NOW(), synced_at=NOW(), last_error=NULL, updated_at=NOW()`,
    {
      mid: Number(merchantId),
      ono: outRequestNo,
      aid: applymentId,
      ot: wxBody.organization_type,
      snap: JSON.stringify(redactSnapshot(wxBody))
    }
  )

  await applyMerchantStatus(merchantId, {
    applymentId,
    outRequestNo,
    state: 'CHECKING',
    stateDesc: '已提交微信审核',
    syncedAt: new Date()
  })

  // 提交后立即拉一次状态
  try {
    return await syncApplymentStatus(merchantId)
  } catch (_) {
    return getSubMerchantDetail(merchantId)
  }
}

function mapWxApplyState(data) {
  const state = String(data.applyment_state || data.applymentState || '').toUpperCase()
  const desc =
    data.applyment_state_desc ||
    data.applymentStateDesc ||
    data.applyment_state_msg ||
    STATE_LABEL[state] ||
    state
  const subMchid = data.sub_mchid || data.subMchid || ''
  const signUrl = data.sign_url || data.signUrl || ''
  const signState = data.sign_state || data.signState || ''
  const applymentId = data.applyment_id || data.applymentId || null
  let rejectDetail = data.audit_detail || data.auditDetail || null
  if (rejectDetail && typeof rejectDetail !== 'string') {
    try {
      rejectDetail = JSON.stringify(rejectDetail)
    } catch (_) {
      rejectDetail = String(rejectDetail)
    }
  }
  return { state, desc, subMchid, signUrl, signState, applymentId, rejectDetail, raw: data }
}

async function syncApplymentStatus(merchantId) {
  const m = await loadMerchant(merchantId)
  if (!m.wx_out_request_no && !m.wx_applyment_id) {
    throw new HttpError(400, '尚未提交进件，无法查询状态')
  }
  let data
  if (m.wx_applyment_id) {
    data = await wxPayService.queryEcommerceApplymentById(m.wx_applyment_id)
  } else {
    data = await wxPayService.queryEcommerceApplymentByOutNo(m.wx_out_request_no)
  }
  const mapped = mapWxApplyState(data)

  await query(
    `UPDATE wx_sub_applyments
     SET applyment_id=IFNULL(:aid, applyment_id),
         state=:st, state_desc=:desc,
         sub_mchid=NULLIF(:sub, ''),
         sign_url=NULLIF(:sign, ''),
         sign_state=NULLIF(:ss, ''),
         reject_detail_json=CAST(:rej AS JSON),
         synced_at=NOW(), last_error=NULL
     WHERE merchant_id=:mid AND out_request_no=:ono`,
    {
      aid: mapped.applymentId,
      st: mapped.state || 'AUDITING',
      desc: String(mapped.desc || '').slice(0, 255),
      sub: mapped.subMchid || '',
      sign: mapped.signUrl || '',
      ss: mapped.signState || '',
      rej: mapped.rejectDetail || null,
      mid: Number(merchantId),
      ono: m.wx_out_request_no
    }
  ).catch(() => {})

  await applyMerchantStatus(merchantId, {
    applymentId: mapped.applymentId || m.wx_applyment_id,
    outRequestNo: m.wx_out_request_no,
    state: mapped.state || m.wx_apply_state,
    stateDesc: String(mapped.desc || '').slice(0, 255),
    signUrl: mapped.signUrl || null,
    subMchid: mapped.subMchid || m.wx_sub_mch_id || null,
    syncedAt: new Date()
  })

  // 进件完成：自动添加平台为分账接收方（平台 mchid）
  if (mapped.state === 'FINISH' && mapped.subMchid) {
    try {
      const c = wxPayService.payConfig()
      await wxPayService.addProfitSharingReceiver({
        type: 'MERCHANT_ID',
        account: c.mchId,
        relationType: 'PLATFORM'
      })
    } catch (e) {
      // 已添加过会报错，忽略
      console.warn('[subMerchant] add receiver', e.message)
    }
  }

  return getSubMerchantDetail(merchantId)
}

async function syncPendingApplyments({ limit = 30 } = {}) {
  const rows = await query(
    `SELECT id FROM merchants
     WHERE deleted_at IS NULL
       AND wx_out_request_no IS NOT NULL
       AND (wx_apply_state IS NULL OR wx_apply_state NOT IN ('FINISH','CANCELED'))
     ORDER BY wx_apply_synced_at IS NULL DESC, wx_apply_synced_at ASC
     LIMIT ${Math.min(Number(limit) || 30, 100)}`
  )
  const results = []
  for (const r of rows) {
    try {
      const d = await syncApplymentStatus(r.id)
      results.push({ id: r.id, ok: true, state: d.wxApplyState })
    } catch (e) {
      results.push({ id: r.id, ok: false, error: e.message })
    }
  }
  return { synced: results.length, results }
}

async function setProfitShareRate(merchantId, rate) {
  let r = Number(rate)
  if (!Number.isFinite(r)) throw new HttpError(400, '分账比例无效')
  // 支持传入 0.1 或 10（表示 10%）
  if (r > 1) r = r / 100
  if (r < 0 || r > 0.3) throw new HttpError(400, '平台分账比例需在 0%～30% 之间（微信上限）')
  await query('UPDATE merchants SET profit_share_rate=:r WHERE id=:id', {
    r: Math.round(r * 1e6) / 1e6,
    id: Number(merchantId)
  })
  return getSubMerchantDetail(merchantId)
}

async function setSubMchIdManual(merchantId, subMchId) {
  const sub = String(subMchId || '').trim()
  if (sub && !/^\d{8,12}$/.test(sub)) {
    throw new HttpError(400, '二级商户号格式不正确')
  }
  await query(
    `UPDATE merchants
     SET wx_sub_mch_id=NULLIF(:sub, ''),
         wx_apply_state=IF(:sub='', wx_apply_state, IFNULL(wx_apply_state, 'FINISH')),
         wx_apply_state_desc=IF(:sub='', wx_apply_state_desc, IFNULL(wx_apply_state_desc, '人工录入')),
         wx_apply_synced_at=NOW()
     WHERE id=:id`,
    { sub, id: Number(merchantId) }
  )
  if (sub) {
    try {
      const c = wxPayService.payConfig()
      await wxPayService.addProfitSharingReceiver({
        type: 'MERCHANT_ID',
        account: c.mchId,
        relationType: 'PLATFORM'
      })
    } catch (e) {
      console.warn('[subMerchant] add receiver', e.message)
    }
  }
  return getSubMerchantDetail(merchantId)
}

async function updateSettlementDraft(merchantId, body = {}) {
  const m = await loadMerchant(merchantId)
  const materials = materialsOf(m)
  const settlement = settlementOf(m)
  const keys = [
    'bankName',
    'bankAccountNo',
    'bankAccountName',
    'idCardNumber',
    'idCardValidBegin',
    'idCardValidEnd',
    'idCardName',
    'organizationType',
    'settlementId',
    'qualificationType'
  ]
  for (const k of keys) {
    if (body[k] === undefined) continue
    if (['bankName', 'bankAccountNo', 'bankAccountName', 'settlementId', 'qualificationType'].includes(k)) {
      settlement[k] = body[k]
    }
    materials[k] = body[k]
  }
  if (body.bankAccountNo) {
    materials.bankAccountNo = String(body.bankAccountNo).replace(/\s/g, '')
    settlement.bankAccountNo = materials.bankAccountNo
  }
  await query(
    `UPDATE merchants SET materials_json=CAST(:mj AS JSON), wx_settlement_json=CAST(:sj AS JSON) WHERE id=:id`,
    {
      id: Number(merchantId),
      mj: JSON.stringify(materials),
      sj: JSON.stringify(settlement)
    }
  )
  return getSubMerchantDetail(merchantId)
}

/** 商家端：查看本店进件状态（可补结算卡信息后由运营提交） */
async function getMerchantSelfWxStatus(merchantId) {
  return getSubMerchantDetail(merchantId)
}

async function merchantUpdateSettlement(merchantId, body = {}) {
  // 商家仅允许补结算与证件文本，不可改组织类型以外的敏感运营字段随意覆盖 org
  const allowed = {
    bankName: body.bankName,
    bankAccountNo: body.bankAccountNo,
    bankAccountName: body.bankAccountName,
    idCardNumber: body.idCardNumber,
    idCardValidBegin: body.idCardValidBegin,
    idCardValidEnd: body.idCardValidEnd,
    idCardName: body.idCardName
  }
  const clean = {}
  for (const [k, v] of Object.entries(allowed)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') clean[k] = v
  }
  return updateSettlementDraft(merchantId, clean)
}

/**
 * 支付成功后按商户 profit_share_rate 向平台分账
 */
async function maybeAutoProfitShare({
  merchantId,
  orderNo: ono,
  transactionId,
  amountYuan
} = {}) {
  const auto = String(await getConfig('wx_profit_share_auto', '1')) === '1'
  if (!auto) return { skipped: true, reason: 'auto_off' }
  if (!wxPayService.payConfig().profitSharing) return { skipped: true, reason: 'env_off' }
  if (!transactionId) return { skipped: true, reason: 'no_transaction' }

  const m = await loadMerchant(merchantId)
  if (!m.wx_sub_mch_id) return { skipped: true, reason: 'no_sub_mch' }
  let rate = Number(m.profit_share_rate)
  if (!Number.isFinite(rate) || rate <= 0) {
    rate = Number(await getConfig('wx_profit_share_rate_default', '0.10')) || 0
  }
  if (rate <= 0) return { skipped: true, reason: 'rate_zero' }
  if (rate > 0.3) rate = 0.3

  const totalFen = Math.round(Number(amountYuan || 0) * 100)
  if (totalFen < 1) return { skipped: true, reason: 'amount' }
  const platformFen = Math.floor(totalFen * rate)
  if (platformFen < 1) return { skipped: true, reason: 'platform_fen_zero' }

  const outOrderNo = `PS${String(ono || '').replace(/\W/g, '').slice(-20)}${Date.now().toString(36)}`.slice(
    0,
    64
  )
  const c = wxPayService.payConfig()
  const receivers = [
    {
      type: 'MERCHANT_ID',
      receiver_account: c.mchId,
      amount: platformFen,
      description: '平台服务费分账'
    }
  ]

  await query(
    `INSERT INTO wx_profit_share_orders
      (merchant_id, order_no, transaction_id, sub_mchid, out_order_no,
       amount_total_fen, platform_amount_fen, rate, state)
     VALUES (:mid, :ono, :tid, :sub, :out, :total, :plat, :rate, 'PENDING')
     ON DUPLICATE KEY UPDATE updated_at=NOW()`,
    {
      mid: Number(merchantId),
      ono: String(ono),
      tid: String(transactionId),
      sub: m.wx_sub_mch_id,
      out: outOrderNo,
      total: totalFen,
      plat: platformFen,
      rate
    }
  ).catch(() => {})

  try {
    const res = await wxPayService.createProfitSharingOrder({
      subMchid: m.wx_sub_mch_id,
      transactionId,
      outOrderNo,
      receivers,
      finish: true
    })
    await query(
      `UPDATE wx_profit_share_orders
       SET state=:st, wx_response_json=CAST(:j AS JSON) WHERE out_order_no=:out`,
      {
        st: res.status || res.state || 'PROCESSING',
        j: JSON.stringify(res),
        out: outOrderNo
      }
    ).catch(() => {})
    return { ok: true, outOrderNo, platformFen, rate, res }
  } catch (e) {
    await query(
      `UPDATE wx_profit_share_orders
       SET state='FAILED', wx_response_json=CAST(:j AS JSON) WHERE out_order_no=:out`,
      { j: JSON.stringify({ message: e.message, wx: e.wx || null }), out: outOrderNo }
    ).catch(() => {})
    console.warn('[subMerchant] profit share fail', e.message)
    return { ok: false, error: e.message, outOrderNo, platformFen, rate }
  }
}

module.exports = {
  STATE_LABEL,
  listSubMerchants,
  getSubMerchantDetail,
  submitApplyment,
  syncApplymentStatus,
  syncPendingApplyments,
  setProfitShareRate,
  setSubMchIdManual,
  updateSettlementDraft,
  getMerchantSelfWxStatus,
  merchantUpdateSettlement,
  maybeAutoProfitShare,
  materialsReadyForApplyment,
  maybeAutoSubmitAfterApprove
}

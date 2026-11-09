/**
 * 微信支付 APIv3（服务商 / 电商收付通）
 * - 二级商户未进件时：WX_PAY_MODE=direct，用平台商户号直收做联调
 * - 有 sub_mchid 时：WX_PAY_MODE=ecommerce（或 auto）走收付通二级商户收款
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const https = require('https')
const { URL } = require('url')
const { HttpError } = require('../utils/response')

const ROOT = path.join(__dirname, '../..')

function env(name, fallback = '') {
  const v = process.env[name]
  return v == null || v === '' ? fallback : String(v).trim()
}

function resolvePath(p) {
  if (!p) return ''
  return path.isAbsolute(p) ? p : path.join(ROOT, p)
}

function readFileOptional(p) {
  const full = resolvePath(p)
  if (!full || !fs.existsSync(full)) return ''
  return fs.readFileSync(full, 'utf8')
}

function payConfig() {
  const mchId = env('WX_PAY_MCH_ID') || env('WX_SP_MCHID')
  const apiV3Key = env('WX_PAY_API_V3_KEY') || env('WX_PAY_APIV3_KEY')
  const serialNo = env('WX_PAY_SERIAL_NO') || env('WX_PAY_MCH_SERIAL_NO')
  const appId = env('WX_APPID') || env('WX_PAY_APPID')
  const privateKey =
    env('WX_PAY_PRIVATE_KEY') ||
    readFileOptional(env('WX_PAY_PRIVATE_KEY_PATH', 'secrets/wxpay/apiclient_key.pem'))
  const wechatPubKey =
    env('WX_PAY_PUBLIC_KEY') ||
    readFileOptional(env('WX_PAY_PUBLIC_KEY_PATH', 'secrets/wxpay/pub_key.pem'))
  const wechatPubKeyId = env('WX_PAY_PUBLIC_KEY_ID') || env('WX_PAY_PUB_KEY_ID')
  const notifyUrl =
    env('WX_PAY_NOTIFY_URL') ||
    (() => {
      const base = env('PUBLIC_BASE_URL') || env('ADMIN_PUBLIC_URL') || 'https://wanye.cloud'
      return `${base.replace(/\/+$/, '')}/api/wxpay/notify`
    })()
  const mode = (env('WX_PAY_MODE', 'auto') || 'auto').toLowerCase()
  const platformSubMchId = env('WX_PAY_SUB_MCH_ID') || env('WX_PAY_PLATFORM_SUB_MCH_ID')
  const allowDirect = env('WX_PAY_ALLOW_DIRECT', '1') !== '0'
  const profitSharing = env('WX_PAY_PROFIT_SHARING', '1') !== '0'
  return {
    mchId,
    apiV3Key,
    serialNo,
    appId,
    privateKey,
    wechatPubKey,
    wechatPubKeyId,
    notifyUrl,
    mode,
    platformSubMchId,
    allowDirect,
    profitSharing
  }
}

function wxPayConfigured() {
  const c = payConfig()
  return Boolean(c.mchId && c.apiV3Key && c.serialNo && c.privateKey && c.appId)
}

function nonceStr(len = 32) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len)
}

function signMessage(message, privateKeyPem) {
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(message)
  signer.end()
  return signer.sign(privateKeyPem, 'base64')
}

function authorizationHeader(method, urlPathWithQuery, body = '') {
  const c = payConfig()
  if (!c.privateKey || !c.serialNo || !c.mchId) {
    throw new HttpError(503, '微信支付商户证书未配置完整')
  }
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = nonceStr(32)
  const payload = typeof body === 'string' ? body : body == null ? '' : JSON.stringify(body)
  const message = `${method}\n${urlPathWithQuery}\n${timestamp}\n${nonce}\n${payload}\n`
  const signature = signMessage(message, c.privateKey)
  return `WECHATPAY2-SHA256-RSA2048 mchid="${c.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${c.serialNo}"`
}

function requestWxPay(method, apiPath, bodyObj) {
  const c = payConfig()
  const payload = bodyObj == null ? '' : JSON.stringify(bodyObj)
  const auth = authorizationHeader(method, apiPath, payload)
  const headers = {
    Accept: 'application/json',
    Authorization: auth,
    'Content-Type': 'application/json',
    'User-Agent': 'wanye-alllink-wxpay/1.0'
  }
  if (c.wechatPubKeyId) {
    headers['Wechatpay-Serial'] = c.wechatPubKeyId
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: 'api.mch.weixin.qq.com',
        path: apiPath,
        method,
        headers,
        timeout: 15000
      },
      (res) => {
        const chunks = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = text ? JSON.parse(text) : {}
          } catch (_) {
            json = { raw: text }
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, data: json, headers: res.headers })
            return
          }
          const msg =
            (json && (json.message || json.detail || json.code)) ||
            `微信支付错误 HTTP ${res.statusCode}`
          const err = new HttpError(502, String(msg))
          err.wx = json
          err.statusCode = res.statusCode
          reject(err)
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new HttpError(504, '微信支付接口超时'))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

function yuanToFen(yuan) {
  return Math.round(Number(yuan || 0) * 100)
}

function resolvePayMode(subMchId) {
  const c = payConfig()
  const sub = String(subMchId || c.platformSubMchId || '').trim()
  if (c.mode === 'direct') return { mode: 'direct', subMchId: '' }
  if (c.mode === 'ecommerce' || c.mode === 'partner') {
    if (!sub) {
      if (c.allowDirect) return { mode: 'direct', subMchId: '' }
      throw new HttpError(400, '二级商户未进件，无法发起收付通收款。请先配置门店 wx_sub_mch_id 或 WX_PAY_SUB_MCH_ID')
    }
    return { mode: c.mode === 'partner' ? 'partner' : 'ecommerce', subMchId: sub }
  }
  // auto
  if (sub) return { mode: 'ecommerce', subMchId: sub }
  if (c.allowDirect) return { mode: 'direct', subMchId: '' }
  throw new HttpError(400, '二级商户未进件，且未开启平台直收测试（WX_PAY_ALLOW_DIRECT）')
}

function buildJsapiPayParams(prepayId) {
  const c = payConfig()
  const timeStamp = Math.floor(Date.now() / 1000).toString()
  const nonce = nonceStr(32)
  const pkg = `prepay_id=${prepayId}`
  const message = `${c.appId}\n${timeStamp}\n${nonce}\n${pkg}\n`
  const paySign = signMessage(message, c.privateKey)
  return {
    appId: c.appId,
    timeStamp,
    nonceStr: nonce,
    package: pkg,
    signType: 'RSA',
    paySign
  }
}

/**
 * 创建 JSAPI 预支付
 * @returns {{ prepayId, payParams, mode, subMchId, notifyUrl }}
 */
async function createJsapiPrepay({
  orderNo,
  description,
  amountYuan,
  openid,
  subMchId,
  attach
} = {}) {
  if (!wxPayConfigured()) {
    throw new HttpError(503, '微信支付未配置完整（商户号/APIv3/证书序列号/私钥/AppID）')
  }
  const c = payConfig()
  const oid = String(openid || '').trim()
  if (!oid) throw new HttpError(400, '缺少付款人 openid，请用微信登录后再支付')
  const totalFen = yuanToFen(amountYuan)
  if (!Number.isFinite(totalFen) || totalFen < 1) {
    throw new HttpError(400, '支付金额无效')
  }
  const resolved = resolvePayMode(subMchId)
  const desc = String(description || '万业互联云收款').slice(0, 127)
  const outTradeNo = String(orderNo || '').slice(0, 32)
  const notifyUrl = c.notifyUrl

  let apiPath
  let body
  if (resolved.mode === 'ecommerce') {
    apiPath = '/v3/ecommerce/transactions/jsapi'
    body = {
      sp_appid: c.appId,
      sp_mchid: c.mchId,
      sub_mchid: resolved.subMchId,
      description: desc,
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      amount: { total: totalFen, currency: 'CNY' },
      payer: { sp_openid: oid },
      attach: String(attach || outTradeNo).slice(0, 128)
    }
    if (c.profitSharing) {
      body.settle_info = { profit_sharing: true }
    }
  } else if (resolved.mode === 'partner') {
    apiPath = '/v3/pay/partner/transactions/jsapi'
    body = {
      sp_appid: c.appId,
      sp_mchid: c.mchId,
      sub_mchid: resolved.subMchId,
      description: desc,
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      amount: { total: totalFen, currency: 'CNY' },
      payer: { sp_openid: oid },
      attach: String(attach || outTradeNo).slice(0, 128)
    }
  } else {
    // 平台直收联调（二级商户到位前）
    apiPath = '/v3/pay/transactions/jsapi'
    body = {
      appid: c.appId,
      mchid: c.mchId,
      description: desc,
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      amount: { total: totalFen, currency: 'CNY' },
      payer: { openid: oid },
      attach: String(attach || outTradeNo).slice(0, 128)
    }
  }

  const res = await requestWxPay('POST', apiPath, body)
  const prepayId = res.data && res.data.prepay_id
  if (!prepayId) {
    throw new HttpError(502, '微信未返回 prepay_id')
  }
  return {
    prepayId,
    payParams: buildJsapiPayParams(prepayId),
    mode: resolved.mode,
    subMchId: resolved.subMchId || null,
    notifyUrl,
    outTradeNo
  }
}

function decryptResourceAesGcm(resource, apiV3Key) {
  const { ciphertext, associated_data: aad, nonce } = resource || {}
  if (!ciphertext || !nonce) throw new Error('回调 resource 缺少密文')
  const key = Buffer.from(apiV3Key, 'utf8')
  const buf = Buffer.from(ciphertext, 'base64')
  const authTag = buf.subarray(buf.length - 16)
  const data = buf.subarray(0, buf.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'))
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(authTag)
  const decoded = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  return JSON.parse(decoded)
}

function verifyNotifySignature({ timestamp, nonce, body, signature, serial }) {
  const c = payConfig()
  if (!c.wechatPubKey) {
    // 未配置微信公钥时跳过验签但打日志（联调兜底）；生产务必配置
    console.warn('[wxpay] notify skip verify: missing WX_PAY_PUBLIC_KEY')
    return true
  }
  if (c.wechatPubKeyId && serial && serial !== c.wechatPubKeyId) {
    console.warn('[wxpay] notify serial mismatch', serial, c.wechatPubKeyId)
  }
  const message = `${timestamp}\n${nonce}\n${body}\n`
  const verifier = crypto.createVerify('RSA-SHA256')
  verifier.update(message)
  verifier.end()
  return verifier.verify(c.wechatPubKey, signature, 'base64')
}

async function parsePayNotify({ headers, rawBody }) {
  const c = payConfig()
  const h = headers || {}
  const timestamp = h['wechatpay-timestamp'] || h['Wechatpay-Timestamp']
  const nonce = h['wechatpay-nonce'] || h['Wechatpay-Nonce']
  const signature = h['wechatpay-signature'] || h['Wechatpay-Signature']
  const serial = h['wechatpay-serial'] || h['Wechatpay-Serial']
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '')
  if (!verifyNotifySignature({ timestamp, nonce, body, signature, serial })) {
    throw new HttpError(401, '微信支付回调验签失败')
  }
  const envelope = JSON.parse(body || '{}')
  const resource = envelope.resource
  if (!resource) throw new HttpError(400, '回调缺少 resource')
  const plain = decryptResourceAesGcm(resource, c.apiV3Key)
  return {
    eventType: envelope.event_type || envelope.eventType || '',
    summary: envelope.summary || '',
    tradeState: plain.trade_state || plain.tradeState || '',
    outTradeNo: plain.out_trade_no || plain.outTradeNo || '',
    transactionId: plain.transaction_id || plain.transactionId || '',
    amountTotalFen: plain.amount && (plain.amount.total || plain.amount.payer_total),
    payer: plain.payer || {},
    raw: plain
  }
}

async function queryOrderByOutTradeNo(outTradeNo, { subMchId } = {}) {
  const c = payConfig()
  const ono = encodeURIComponent(String(outTradeNo || ''))
  const resolved = resolvePayMode(subMchId)
  let apiPath
  if (resolved.mode === 'ecommerce') {
    apiPath = `/v3/ecommerce/transactions/out-trade-no/${ono}?sp_mchid=${encodeURIComponent(
      c.mchId
    )}&sub_mchid=${encodeURIComponent(resolved.subMchId)}`
  } else if (resolved.mode === 'partner') {
    apiPath = `/v3/pay/partner/transactions/out-trade-no/${ono}?sp_mchid=${encodeURIComponent(
      c.mchId
    )}&sub_mchid=${encodeURIComponent(resolved.subMchId)}`
  } else {
    apiPath = `/v3/pay/transactions/out-trade-no/${ono}?mchid=${encodeURIComponent(c.mchId)}`
  }
  const res = await requestWxPay('GET', apiPath, null)
  return res.data
}

function notifyUrlForDisplay() {
  return payConfig().notifyUrl
}

/** 敏感字段：微信支付公钥 RSA-OAEP(SHA1) */
function encryptSensitive(plain) {
  const c = payConfig()
  if (!c.wechatPubKey) {
    throw new HttpError(503, '未配置微信支付公钥，无法加密进件敏感字段')
  }
  const text = String(plain == null ? '' : plain)
  return crypto
    .publicEncrypt(
      {
        key: c.wechatPubKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha1'
      },
      Buffer.from(text, 'utf8')
    )
    .toString('base64')
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/** 图片上传 → MediaID（电商进件证照必用） */
async function uploadMerchantMedia(buffer, filename = 'image.jpg') {
  if (!buffer || !buffer.length) throw new HttpError(400, '空图片')
  const c = payConfig()
  if (!wxPayConfigured()) throw new HttpError(503, '微信支付未配置')
  const name = String(filename || 'image.jpg').replace(/[^\w.\-]/g, '_')
  const meta = JSON.stringify({ filename: name, sha256: sha256Hex(buffer) })
  const boundary = `----wanye${Date.now()}${Math.random().toString(16).slice(2)}`
  const parts = []
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\nContent-Type: application/json\r\n\r\n${meta}\r\n`
    )
  )
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/jpeg\r\n\r\n`
    )
  )
  parts.push(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  const body = Buffer.concat(parts)
  const apiPath = '/v3/merchant/media/upload'
  const auth = authorizationHeader('POST', apiPath, meta)
  const headers = {
    Accept: 'application/json',
    Authorization: auth,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
    'User-Agent': 'wanye-alllink-wxpay/1.0'
  }
  if (c.wechatPubKeyId) headers['Wechatpay-Serial'] = c.wechatPubKeyId

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: 'api.mch.weixin.qq.com',
        path: apiPath,
        method: 'POST',
        headers,
        timeout: 30000
      },
      (res) => {
        const chunks = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = {}
          try {
            json = text ? JSON.parse(text) : {}
          } catch (_) {
            json = { raw: text }
          }
          if (res.statusCode >= 200 && res.statusCode < 300 && json.media_id) {
            resolve(json.media_id)
            return
          }
          const msg = (json && (json.message || json.code)) || `上传媒体失败 HTTP ${res.statusCode}`
          const err = new HttpError(502, String(msg))
          err.wx = json
          reject(err)
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new HttpError(504, '上传媒体超时'))
    })
    req.write(body)
    req.end()
  })
}

async function submitEcommerceApplyment(body) {
  const res = await requestWxPay('POST', '/v3/ecommerce/applyments/', body)
  return res.data
}

async function queryEcommerceApplymentById(applymentId) {
  const id = encodeURIComponent(String(applymentId))
  const res = await requestWxPay('GET', `/v3/ecommerce/applyments/${id}`, null)
  return res.data
}

async function queryEcommerceApplymentByOutNo(outRequestNo) {
  const no = encodeURIComponent(String(outRequestNo))
  const res = await requestWxPay('GET', `/v3/ecommerce/applyments/out-request-no/${no}`, null)
  return res.data
}

async function addProfitSharingReceiver({ type, account, name, relationType } = {}) {
  const c = payConfig()
  const body = {
    appid: c.appId,
    type: type || 'MERCHANT_ID',
    account: String(account || ''),
    relation_type: relationType || 'PLATFORM'
  }
  if (name) {
    if (body.type === 'PERSONAL_OPENID') body.name = encryptSensitive(name)
    else body.name = name
  }
  const res = await requestWxPay('POST', '/v3/ecommerce/profitsharing/receivers/add', body)
  return res.data
}

async function createProfitSharingOrder({
  subMchid,
  transactionId,
  outOrderNo,
  receivers,
  finish = true
} = {}) {
  const c = payConfig()
  const body = {
    appid: c.appId,
    sub_mchid: String(subMchid),
    transaction_id: String(transactionId),
    out_order_no: String(outOrderNo).slice(0, 64),
    receivers: receivers || [],
    finish: !!finish
  }
  const res = await requestWxPay('POST', '/v3/ecommerce/profitsharing/orders', body)
  return res.data
}

module.exports = {
  wxPayConfigured,
  payConfig,
  createJsapiPrepay,
  parsePayNotify,
  queryOrderByOutTradeNo,
  notifyUrlForDisplay,
  yuanToFen,
  encryptSensitive,
  uploadMerchantMedia,
  submitEcommerceApplyment,
  queryEcommerceApplymentById,
  queryEcommerceApplymentByOutNo,
  addProfitSharingReceiver,
  createProfitSharingOrder,
  requestWxPay
}

/**
 * 微信支付 APIv3（服务商 / 平台收付通）
 * - 二级商户未进件时：WX_PAY_MODE=direct，用平台商户号直收做联调
 * - 有 sub_mchid 时：WX_PAY_MODE=ecommerce|partner|auto → 走服务商 JSAPI
 *   POST /v3/pay/partner/transactions/jsapi（旧路径 /v3/ecommerce/transactions/jsapi 已 404）
 * - 进件 / 分账仍用 /v3/ecommerce/* 系列接口
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

/**
 * 云托管环境变量常见坑：
 * - 换行被存成字面量 \n / \\n
 * - 控制台粘贴把换行挤成空格或整段单行 → OpenSSL3 DECODER unsupported
 * - 首尾多一层引号、BOM、零宽字符
 */
function normalizePem(pem) {
  let s = String(pem || '')
  if (!s.trim()) return ''
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim()
  }
  // 多层转义：\\\\n → \\n → 真换行（云托管/JSON 双重转义）
  for (let i = 0; i < 4; i++) {
    if (s.includes('\\\\n')) s = s.replace(/\\\\n/g, '\\n')
    else break
  }
  for (let i = 0; i < 4; i++) {
    if (s.includes('\\n')) s = s.replace(/\\n/g, '\n')
    else break
  }
  s = s.replace(/\\r\\n/g, '\n').replace(/\\r/g, '\n')
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // 只要能识别 PEM 头尾，就规范化 body（去空格/重排 64 列），兼容云托管粘贴挤行
  const block = s.match(/(-----BEGIN [^-]+-----)\s*([\s\S]*?)\s*(-----END [^-]+-----)/)
  if (block) {
    s = rewrapPemOneLine(`${block[1]}\n${block[2]}\n${block[3]}`)
  }

  s = s.trim()
  return s.endsWith('\n') ? s : `${s}\n`
}

/** 单行 / 空格分隔的 PEM → 标准多行 */
function rewrapPemOneLine(raw) {
  const m = String(raw || '').match(/^(-----BEGIN [^-]+-----)\s*([\s\S]*?)\s*(-----END [^-]+-----)$/)
  if (!m) return String(raw || '')
  const header = m[1]
  const footer = m[3]
  const body = m[2].replace(/\s+/g, '')
  if (!body) return `${header}\n${footer}\n`
  const lines = body.match(/.{1,64}/g) || [body]
  return `${header}\n${lines.join('\n')}\n${footer}\n`
}

function diagnosePem(pem) {
  const s = String(pem || '')
  if (!s.trim()) return 'empty'
  if (/BEGIN\s+PRIVATE\s+KEY|BEGIN\s+RSA\s+PRIVATE\s+KEY/i.test(s)) return 'private_key'
  if (/BEGIN\s+CERTIFICATE/i.test(s)) return 'certificate'
  if (/BEGIN\s+PUBLIC\s+KEY/i.test(s)) return 'public_key'
  return 'unknown'
}

/** 解析微信支付公钥（支持 PUBLIC KEY / CERTIFICATE；拒绝误配成私钥） */
function resolveWechatPublicKey(pem) {
  const normalized = normalizePem(pem)
  if (!normalized) {
    throw new HttpError(503, '未配置微信支付公钥，无法加密进件敏感字段')
  }
  const kind = diagnosePem(normalized)
  if (kind === 'private_key') {
    throw new HttpError(
      503,
      'WX_PAY_PUBLIC_KEY 误配成了商户私钥。请改为微信商户平台「API安全 → 微信支付公钥」下载的公钥 PEM，并配置 WX_PAY_PUBLIC_KEY_ID'
    )
  }
  try {
    return crypto.createPublicKey(normalized)
  } catch (e) {
    const msg = String((e && e.message) || e)
    throw new HttpError(
      503,
      `微信支付公钥无法解析（${msg}）。请确认 PEM 含 -----BEGIN PUBLIC KEY----- 或证书，云托管环境变量换行用真实换行或 \\n，且公钥 ID 与文件配对`
    )
  }
}

function payConfig() {
  const mchId = env('WX_PAY_MCH_ID') || env('WX_SP_MCHID')
  const apiV3Key = env('WX_PAY_API_V3_KEY') || env('WX_PAY_APIV3_KEY')
  const serialNo = env('WX_PAY_SERIAL_NO') || env('WX_PAY_MCH_SERIAL_NO')
  const appId = env('WX_APPID') || env('WX_PAY_APPID')
  const privateKey = normalizePem(
    env('WX_PAY_PRIVATE_KEY') ||
      readFileOptional(env('WX_PAY_PRIVATE_KEY_PATH', 'secrets/wxpay/apiclient_key.pem'))
  )
  const wechatPubKey = normalizePem(
    env('WX_PAY_PUBLIC_KEY') ||
      readFileOptional(env('WX_PAY_PUBLIC_KEY_PATH', 'secrets/wxpay/pub_key.pem'))
  )
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

/** 商户 API 私钥（apiclient_key.pem）；OpenSSL3 下用 KeyObject 避免 DECODER unsupported */
function resolveMerchantPrivateKey(pem) {
  const normalized = normalizePem(pem)
  if (!normalized) {
    throw new HttpError(503, '未配置商户 API 私钥 WX_PAY_PRIVATE_KEY / WX_PAY_PRIVATE_KEY_PATH')
  }
  const kind = diagnosePem(normalized)
  if (kind === 'public_key' || kind === 'certificate') {
    throw new HttpError(
      503,
      'WX_PAY_PRIVATE_KEY 误配成了公钥/证书。请填写商户平台下载的 apiclient_key.pem（BEGIN PRIVATE KEY）'
    )
  }
  try {
    return crypto.createPrivateKey(normalized)
  } catch (e) {
    const msg = String((e && e.message) || e)
    throw new HttpError(
      503,
      `商户 API 私钥无法解析（${msg}）。请重新粘贴 apiclient_key.pem 全文；云托管换行用真实换行或 \\n；勿加密口令保护的私钥`
    )
  }
}

function signMessage(message, privateKeyPem) {
  let keyObj
  try {
    keyObj = resolveMerchantPrivateKey(privateKeyPem)
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(503, `商户私钥无效：${e.message || e}`)
  }
  try {
    const signer = crypto.createSign('RSA-SHA256')
    signer.update(message)
    signer.end()
    return signer.sign(keyObj, 'base64')
  } catch (e) {
    const msg = String((e && e.message) || e)
    if (/DECODER|unsupported|ERR_OSSL/i.test(msg)) {
      throw new HttpError(
        503,
        `微信支付请求签名失败（私钥格式不被支持）。请检查云托管 WX_PAY_PRIVATE_KEY 是否为未加密的 apiclient_key.pem；原始错误：${msg}`
      )
    }
    throw new HttpError(503, `微信支付请求签名失败：${msg}`)
  }
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

function privateKeyHealth() {
  const c = payConfig()
  const raw = c.privateKey || ''
  const lines = raw.split('\n').filter((x) => x.length)
  const out = {
    hasPrivateKey: Boolean(raw),
    pemKind: diagnosePem(raw),
    lineCount: lines.length,
    header: lines[0] || null,
    footer: lines.length > 1 ? lines[lines.length - 1] : null,
    looksSingleLine: Boolean(raw) && !String(process.env.WX_PAY_PRIVATE_KEY || '').includes('\n') &&
      !String(process.env.WX_PAY_PRIVATE_KEY || '').includes('\\n') &&
      String(process.env.WX_PAY_PRIVATE_KEY || '').length > 80,
    parseOk: false,
    signOk: false,
    error: null
  }
  if (!raw) {
    out.error = 'missing_private_key'
    return out
  }
  if (/BEGIN\s+ENCRYPTED\s+PRIVATE\s+KEY/i.test(raw)) {
    out.error = 'encrypted_private_key_not_supported'
    return out
  }
  try {
    const keyObj = resolveMerchantPrivateKey(raw)
    out.parseOk = true
    const signer = crypto.createSign('RSA-SHA256')
    signer.update('ping')
    signer.end()
    signer.sign(keyObj, 'base64')
    out.signOk = true
  } catch (e) {
    out.error = e.message || String(e)
  }
  return out
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
          let msg =
            (json && (json.message || json.detail || json.code)) ||
            `微信支付错误 HTTP ${res.statusCode}`
          // nginx HTML 404：接口路径不存在（常见于误用已下线的 /v3/ecommerce/transactions/*）
          if (
            res.statusCode === 404 &&
            typeof text === 'string' &&
            /<!DOCTYPE|<html/i.test(text)
          ) {
            msg = `微信支付接口不存在(404)：${method} ${apiPath}。收付通下单请使用 /v3/pay/partner/transactions/jsapi`
          }
          const err = new HttpError(502, String(msg))
          err.wx = json
          err.statusCode = res.statusCode
          err.apiPath = apiPath
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
  if (resolved.mode === 'ecommerce' || resolved.mode === 'partner') {
    // 平台收付通 / 普通服务商：统一服务商 JSAPI（电商旧 transactions 路径已下线返回 nginx 404）
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
    if (c.profitSharing) {
      body.settle_info = { profit_sharing: true }
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
  if (resolved.mode === 'ecommerce' || resolved.mode === 'partner') {
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
  let keyObj
  try {
    keyObj = resolveWechatPublicKey(c.wechatPubKey)
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(503, `微信支付公钥无效：${e.message || e}`)
  }
  if (!c.wechatPubKeyId) {
    throw new HttpError(
      503,
      '缺少 WX_PAY_PUBLIC_KEY_ID（微信支付公钥 ID）。进件加密请求头 Wechatpay-Serial 必须与公钥配对'
    )
  }
  const text = String(plain == null ? '' : plain)
  try {
    return crypto
      .publicEncrypt(
        {
          key: keyObj,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha1'
        },
        Buffer.from(text, 'utf8')
      )
      .toString('base64')
  } catch (e) {
    const msg = String((e && e.message) || e)
    if (/DECODER|unsupported|ERR_OSSL/i.test(msg)) {
      throw new HttpError(
        503,
        `进件敏感字段加密失败（密钥格式不被支持）。请重新下载「微信支付公钥」写入 WX_PAY_PUBLIC_KEY，勿用商户 API 证书私钥；原始错误：${msg}`
      )
    }
    throw new HttpError(503, `进件敏感字段加密失败：${msg}`)
  }
}

function publicKeyHealth() {
  const c = payConfig()
  const out = {
    hasPublicKey: Boolean(c.wechatPubKey),
    publicKeyId: c.wechatPubKeyId || null,
    pemKind: diagnosePem(c.wechatPubKey),
    parseOk: false,
    encryptOk: false,
    error: null
  }
  if (!c.wechatPubKey) {
    out.error = 'missing_public_key'
    return out
  }
  try {
    const keyObj = resolveWechatPublicKey(c.wechatPubKey)
    out.parseOk = true
    crypto.publicEncrypt(
      {
        key: keyObj,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha1'
      },
      Buffer.from('ping', 'utf8')
    )
    out.encryptOk = true
  } catch (e) {
    out.error = e.message || String(e)
  }
  return out
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
  publicKeyHealth,
  privateKeyHealth,
  normalizePem,
  uploadMerchantMedia,
  submitEcommerceApplyment,
  queryEcommerceApplymentById,
  queryEcommerceApplymentByOutNo,
  addProfitSharingReceiver,
  createProfitSharingOrder,
  requestWxPay
}

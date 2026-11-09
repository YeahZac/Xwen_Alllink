const fs = require('fs')
const http = require('http')
const https = require('https')
const tls = require('tls')
const { URL } = require('url')
const config = require('../config')
const { HttpError } = require('../utils/response')

const CLOUD_CA = '/app/cert/certificate.crt'
const PHONE_PATH = '/wxa/business/getuserphonenumber'

let extraCa
function httpsAgentOptions() {
  if (extraCa !== undefined) return extraCa
  extraCa = null
  try {
    const pem = fs.readFileSync(CLOUD_CA)
    extraCa = { ca: tls.rootCertificates.concat(pem.toString()) }
  } catch (_) {}
  return extraCa
}

function requestRaw(method, url, body, { json = true, timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? http : https
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : JSON.stringify(body)
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method,
        timeout,
        ...(lib === https ? httpsAgentOptions() || {} : {}),
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : {}
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (!json) {
            resolve({ status: res.statusCode, headers: res.headers, buffer: buf })
            return
          }
          const text = buf.toString('utf8')
          try {
            resolve(JSON.parse(text))
          } catch (e) {
            reject(new Error(text.slice(0, 200) || '微信接口返回异常'))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('微信接口超时'))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

function requestJson(method, url, body) {
  return requestRaw(method, url, body, { json: true })
}

let tokenCache = { token: '', expireAt: 0 }

function wxCreds() {
  return {
    appId: config.wx.appId || process.env.APPID || process.env.WX_APPID || '',
    secret: config.wx.appSecret || process.env.WX_APPSECRET || process.env.WX_APP_SECRET || ''
  }
}

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expireAt) return tokenCache.token
  const { appId, secret } = wxCreds()
  if (!appId || !secret) {
    throw new HttpError(500, '未配置 WX_APPID / WX_APP_SECRET，无法换取手机号')
  }
  const data = await requestJson(
    'GET',
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(
      appId
    )}&secret=${encodeURIComponent(secret)}`
  )
  if (!data.access_token) {
    const errMsg = String(data.errmsg || '')
    const code = Number(data.errcode) || 0
    // 40125 invalid appsecret：全局配置错误，所有商户生成小程序码都会失败
    if (code === 40125 || /invalid appsecret/i.test(errMsg)) {
      throw new HttpError(
        502,
        '微信 AppSecret 无效或已重置（errcode 40125）。请到小程序后台「开发→开发管理→开发设置」复制 AppSecret，更新云托管环境变量 WX_APP_SECRET（或 WX_APPSECRET）后重启服务；此问题与具体门店无关，所有商户点餐码/收款码都会失败。'
      )
    }
    if (code === 40013 || /invalid appid/i.test(errMsg)) {
      throw new HttpError(
        502,
        '微信 AppID 无效。请核对云托管 WX_APPID 是否与当前小程序一致后重启服务。'
      )
    }
    throw new HttpError(502, errMsg || '获取微信凭证失败')
  }
  tokenCache = {
    token: data.access_token,
    expireAt: Date.now() + Math.max(60, Number(data.expires_in || 7200) - 120) * 1000
  }
  return tokenCache.token
}

async function code2Session(jsCode) {
  const code = String(jsCode || '').trim()
  if (!code) return { openid: '', unionid: '', session_key: '' }
  const { appId, secret } = wxCreds()
  if (!appId || !secret) return { openid: '', unionid: '', session_key: '' }
  const data = await requestJson(
    'GET',
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(
      appId
    )}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
  )
  if (data.errcode) {
    throw new HttpError(400, data.errmsg || '微信登录凭证无效')
  }
  return {
    openid: data.openid || '',
    unionid: data.unionid || '',
    session_key: data.session_key || ''
  }
}

function phoneFromPayload(data) {
  if (!data || (data.errcode && data.errcode !== 0)) return ''
  const info = data.phone_info || {}
  return String(info.purePhoneNumber || info.phoneNumber || '').replace(/\s+/g, '')
}

async function getPhoneNumber(phoneCode, openid) {
  const code = String(phoneCode || '').trim()
  if (!code) throw new HttpError(400, '缺少手机号授权码')
  const body = { code }
  const oid = String(openid || '').trim()
  if (oid) body.openid = oid

  // 云托管开放接口走 http，由网关注入 token。直接 https 会撞上容器自签证书。
  let cloudError = ''
  try {
    const cloud = await requestJson('POST', `http://api.weixin.qq.com${PHONE_PATH}`, body)
    const phone = phoneFromPayload(cloud)
    if (phone) return phone
    cloudError = cloud.errmsg || ''
  } catch (e) {
    cloudError = e.message || ''
  }

  let data
  try {
    const token = await getAccessToken()
    data = await requestJson(
      'POST',
      `https://api.weixin.qq.com${PHONE_PATH}?access_token=${encodeURIComponent(token)}`,
      body
    )
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(
      502,
      '换取手机号失败。请在云托管开启「开放接口服务」，把 /wxa/business/getuserphonenumber 加入微信令牌权限后重新发布；或配置 WX_APPID / WX_APP_SECRET'
    )
  }
  const phone = phoneFromPayload(data)
  if (!phone) {
    throw new HttpError(400, (data && data.errmsg) || cloudError || '手机号授权失败')
  }
  return phone
}

const wxPayService = require('./wxPayService')

function wxPayConfigured() {
  return wxPayService.wxPayConfigured()
}

function buildPayResult({
  orderNo,
  cashAmount,
  simulated,
  payParams = null,
  payChannel,
  message
} = {}) {
  const cash = Math.round(Number(cashAmount || 0) * 100) / 100
  if (cash <= 0) {
    return {
      simulated: true,
      payChannel: 'points',
      cashAmount: 0,
      orderNo,
      payParams: null,
      message: message || '现金为 0，无需拉起微信支付'
    }
  }
  const useSim = simulated == null ? !wxPayConfigured() : !!simulated
  if (useSim) {
    return {
      simulated: true,
      payChannel: payChannel || 'wxpay_sim',
      cashAmount: cash,
      orderNo,
      payParams: null,
      message: message || '未配置微信支付商户号，已按微信支付成功入账（可继续联调业务）'
    }
  }
  return {
    simulated: false,
    payChannel: payChannel || 'wxpay',
    cashAmount: cash,
    orderNo,
    payParams: payParams || null,
    message: message || (payParams ? '请拉起微信支付' : '请配置 JSAPI 预下单参数后拉起微信支付'),
    notifyUrl: wxPayService.notifyUrlForDisplay()
  }
}

async function createJsapiPayForOrder(opts) {
  return wxPayService.createJsapiPrepay(opts)
}

/**
 * 生成小程序码（无数量限制）。scene 最长 32 字符。
 * 成功返回 PNG Buffer；失败抛 HttpError。
 */
async function getUnlimitedQrCode({ scene, page = 'pages/login/login', envVersion } = {}) {
  const sc = String(scene || '').trim().slice(0, 32)
  if (!sc) throw new HttpError(400, '缺少 scene')
  const token = await getAccessToken()
  const body = {
    scene: sc,
    page,
    check_path: false,
    width: 430
  }
  const ver = String(envVersion || process.env.WX_QRCODE_ENV || '').trim()
  if (ver) body.env_version = ver
  const res = await requestRaw(
    'POST',
    `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`,
    body,
    { json: false, timeout: 20000 }
  )
  const buf = res.buffer || Buffer.alloc(0)
  const head = buf.slice(0, 1).toString('utf8')
  if (head === '{' || head === '[') {
    let err = {}
    try {
      err = JSON.parse(buf.toString('utf8'))
    } catch (_) {}
    throw new HttpError(502, err.errmsg || '生成小程序码失败')
  }
  if (buf.length < 100) throw new HttpError(502, '生成小程序码失败：空图')
  return buf
}

module.exports = {
  code2Session,
  getPhoneNumber,
  getAccessToken,
  getUnlimitedQrCode,
  wxPayConfigured,
  buildPayResult,
  createJsapiPayForOrder,
  parsePayNotify: (...args) => wxPayService.parsePayNotify(...args),
  queryWxOrder: (...args) => wxPayService.queryOrderByOutTradeNo(...args),
  notifyUrlForDisplay: () => wxPayService.notifyUrlForDisplay()
}

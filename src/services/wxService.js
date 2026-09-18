const https = require('https')
const { URL } = require('url')
const config = require('../config')
const { HttpError } = require('../utils/response')

function requestJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = body == null ? null : JSON.stringify(body)
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method,
        timeout: 12000,
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
          const text = Buffer.concat(chunks).toString('utf8')
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
    throw new HttpError(502, data.errmsg || '获取微信凭证失败')
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

async function getPhoneNumber(phoneCode) {
  const code = String(phoneCode || '').trim()
  if (!code) throw new HttpError(400, '缺少手机号授权码')

  let data = await requestJson(
    'POST',
    'https://api.weixin.qq.com/wxa/business/getuserphonenumber',
    { code }
  )
  if (data.errcode && data.errcode !== 0) {
    const token = await getAccessToken()
    data = await requestJson(
      'POST',
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`,
      { code }
    )
  }
  if (data.errcode && data.errcode !== 0) {
    throw new HttpError(400, data.errmsg || '手机号授权失败')
  }
  const info = data.phone_info || {}
  const phone = String(info.purePhoneNumber || info.phoneNumber || '').replace(/\s+/g, '')
  if (!phone) throw new HttpError(400, '未取得手机号')
  return phone
}

function wxPayConfigured() {
  return Boolean(process.env.WX_PAY_MCH_ID && process.env.WX_PAY_API_V3_KEY)
}

function buildPayResult({ orderNo, cashAmount, simulated = !wxPayConfigured() }) {
  const cash = Math.round(Number(cashAmount || 0) * 100) / 100
  if (cash <= 0) {
    return {
      simulated: true,
      payChannel: 'points',
      cashAmount: 0,
      orderNo,
      payParams: null,
      message: '现金为 0，无需拉起微信支付'
    }
  }
  if (simulated) {
    return {
      simulated: true,
      payChannel: 'wxpay_sim',
      cashAmount: cash,
      orderNo,
      payParams: null,
      message: '未配置微信支付商户号，已按微信支付成功入账（可继续联调业务）'
    }
  }
  return {
    simulated: false,
    payChannel: 'wxpay',
    cashAmount: cash,
    orderNo,
    payParams: null,
    message: '请配置 JSAPI 预下单参数后拉起微信支付'
  }
}

module.exports = {
  code2Session,
  getPhoneNumber,
  wxPayConfigured,
  buildPayResult
}

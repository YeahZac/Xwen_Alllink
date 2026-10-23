const { request, setToken, getToken, uploadFile: uploadViaHttp } = require('./request')
const image = require('./image')

function toQuery(obj) {
  const parts = []
  Object.keys(obj || {}).forEach((key) => {
    const value = obj[key]
    if (value === undefined || value === null || value === '') return
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  })
  return parts.length ? `?${parts.join('&')}` : ''
}

function guessMime(filePath) {
  const name = String(filePath || '').split('/').pop() || 'upload.jpg'
  const lower = name.toLowerCase()
  if (lower.endsWith('.png')) return { name, mime: 'image/png' }
  if (lower.endsWith('.webp')) return { name, mime: 'image/webp' }
  if (lower.endsWith('.gif')) return { name, mime: 'image/gif' }
  if (lower.endsWith('.pdf')) return { name, mime: 'application/pdf' }
  return { name: name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg' }
}

function isPayloadTooLarge(err) {
  const msg = String((err && (err.message || err.errMsg)) || err || '')
  const code = err && (err.errCode != null ? err.errCode : err.code)
  return (
    code === -606001 ||
    code === 606001 ||
    /-606001|payload|too large|过大|超过.*限制|request entity too large|413/i.test(msg)
  )
}

function readBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve(res.data),
      fail: (e) => reject(new Error((e && e.errMsg) || '读取文件失败'))
    })
  })
}

/** callContainer 整包约 100KB 级限制；单片 base64 控制在 60KB 内 */
const CHUNK_CHARS = 60 * 1024

function makeUploadId() {
  return `u${Date.now()}${Math.random().toString(36).slice(2, 10)}`
}

async function postBase64Single(filePath, bizType) {
  const { name, mime } = guessMime(filePath)
  const content = await readBase64(filePath)
  return request({
    path: '/media/upload-base64',
    method: 'POST',
    auth: false,
    timeout: 60000,
    data: { content, fileName: name, mime, bizType }
  })
}

async function postBase64Chunked(filePath, bizType) {
  const { name, mime } = guessMime(filePath)
  const content = await readBase64(filePath)
  const total = Math.ceil(content.length / CHUNK_CHARS) || 1
  const uploadId = makeUploadId()
  for (let i = 0; i < total; i++) {
    const piece = content.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS)
    await request({
      path: '/media/upload-base64-chunk',
      method: 'POST',
      auth: false,
      timeout: 30000,
      data: {
        uploadId,
        index: i,
        total,
        content: piece,
        fileName: name,
        mime,
        bizType
      }
    })
  }
  return request({
    path: '/media/upload-base64-finish',
    method: 'POST',
    auth: false,
    timeout: 60000,
    data: { uploadId }
  })
}

/**
 * 读本地临时文件上传（适配云托管 callContainer）。
 * 先压到约 600KB；base64 超过约 60KB 时走分片，避免 -606001。
 * 若线上尚未部署分片接口，则再压到约 45KB 单包上传（兼容旧后端）。
 */
async function uploadLocalFile(filePath, bizType = 'license') {
  const lower = String(filePath || '').toLowerCase()
  const isPdf = lower.endsWith('.pdf')
  let path = filePath

  if (!isPdf) {
    const packed = await image.compressUnderLimit(filePath, image.DEFAULT_MAX)
    path = packed.filePath
  }

  const content = await readBase64(path)
  if (content.length <= CHUNK_CHARS) {
    return postBase64Single(path, bizType)
  }

  try {
    return await postBase64Chunked(path, bizType)
  } catch (err) {
    const msg = String((err && err.message) || '')
    const needFallback =
      isPayloadTooLarge(err) ||
      /404|not found|不存在|Cannot POST|上传会话/i.test(msg)
    if (!needFallback || isPdf) throw err
    // 旧后端无分片接口：再压到 callContainer 安全体积（约 70KB，base64 < 100KB）
    const tiny = await image.compressUnderLimit(path, 70 * 1024)
    try {
      return await postBase64Single(tiny.filePath, bizType)
    } catch (err2) {
      if (isPayloadTooLarge(err2)) {
        throw new Error('图片过大，云托管无法直传，请换一张更小的照片')
      }
      throw err2
    }
  }
}

const api = {
  getToken,
  setToken,

  health: () => request({ path: '/health', auth: false }),

  loginByCode: (code) =>
    request({ path: '/auth/login', method: 'POST', auth: false, data: { code } }),

  wxLogin: (body) =>
    request({
      path: '/auth/wx-login',
      method: 'POST',
      auth: false,
      data: typeof body === 'string' ? { nickname: body } : body || {}
    }),

  bindPhone: (code) =>
    request({ path: '/auth/bind-phone', method: 'POST', data: { code } }),

  updateProfile: (body) =>
    request({ path: '/auth/profile', method: 'POST', data: body || {} }),

  profile: () => request({ path: '/auth/profile' }),

  listIdentities: () => request({ path: '/auth/identities' }),

  switchIdentity: (body) =>
    request({ path: '/auth/switch-identity', method: 'POST', data: body || {} }),

  banners: (role = 'consumer', pageKey = '') => {
    const q = [`role=${encodeURIComponent(role)}`]
    if (pageKey) q.push(`page=${encodeURIComponent(pageKey)}`)
    return request({ path: `/banners?${q.join('&')}`, auth: false })
  },

  cashRate: () => request({ path: '/config/cash-rate', auth: false }),

  cities: () => request({ path: '/cities', auth: false }),

  resolveCity: (lat, lng) =>
    request({
      path: `/cities/resolve?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
      auth: false
    }),

  stalls: (q) => request({ path: `/stalls${toQuery(q)}`, auth: false }),

  stallMenu: (id) => request({ path: `/stalls/${id}/menu`, auth: false }),

  crossStores: (q) => request({ path: `/cross-stores${toQuery(q)}`, auth: false }),

  crossStore: (id) => request({ path: `/cross-stores/${id}`, auth: false }),

  supplyGoods: () => request({ path: '/supply/goods', auth: false }),

  supplyMerchants: (q) => request({ path: `/supply/merchants${toQuery(q)}`, auth: false }),

  payStall: (body) => request({ path: '/orders/stall/pay', method: 'POST', data: body }),

  scanPay: (body) => request({ path: '/orders/stall/scan-pay', method: 'POST', data: body }),

  redeemCross: (body) => request({ path: '/orders/cross/redeem', method: 'POST', data: body }),

  myOrders: () => request({ path: '/orders/mine' }),

  myPoints: () => request({ path: '/points/me' }),

  licenseRules: () => request({ path: '/apply/license-rules', auth: false }),

  submitApply: (body) =>
    request({ path: '/apply/submit', method: 'POST', auth: false, data: body }),

  applyStatus: (phone) =>
    request({ path: `/apply/status?phone=${encodeURIComponent(phone)}`, auth: false }),

  applyStatusMine: () => request({ path: '/apply/status/mine' }),

  bindReferral: (code) =>
    request({ path: '/referral/bind', method: 'POST', data: { code } }),

  myReferrals: () => request({ path: '/referral/mine' }),
  referralHome: () => request({ path: '/referral/home' }),

  complaint: (body) => request({ path: '/complaints', method: 'POST', data: body }),

  supplyNeed: (body) =>
    request({ path: '/supply-needs', method: 'POST', data: body }),

  mySupplyNeeds: () => request({ path: '/supply-needs/mine' }),

  trackVisit: (body) =>
    request({ path: '/track/visit', method: 'POST', auth: false, data: body || {} }),

  uploadFile: uploadLocalFile,
  uploadViaHttp,

  merchantDashboard: () => request({ path: '/merchant/dashboard' }),
  merchantOrders: (type) =>
    request({ path: `/merchant/orders${type ? `?type=${type}` : ''}` }),
  completeStallOrder: (id) =>
    request({ path: `/merchant/orders/${id}/complete`, method: 'POST', data: {} }),
  merchantGoods: () => request({ path: '/merchant/goods' }),
  merchantGoodsDetail: (id) => request({ path: `/merchant/goods/${id}` }),
  saveMerchantGoods: (body) =>
    request({ path: '/merchant/goods', method: 'POST', data: body }),
  merchantGoodsOptions: (id) => request({ path: `/merchant/goods/${id}/options` }),
  saveMerchantGoodsOptions: (id, groups) =>
    request({ path: `/merchant/goods/${id}/options`, method: 'PUT', data: { groups } }),
  merchantCustomers: () => request({ path: '/merchant/customers' }),
  merchantFlow: () => request({ path: '/merchant/flow' }),
  merchantSupplyNeeds: () => request({ path: '/merchant/supply-needs' }),
  quoteSupplyNeed: (id, body) =>
    request({ path: `/merchant/supply-needs/${id}/quote`, method: 'POST', data: body || {} }),
  merchantPool: () => request({ path: '/merchant/points-pool' }),
  merchantAccounts: () => request({ path: '/merchant/accounts' }),
  merchantWithdraws: () => request({ path: '/merchant/withdraws' }),
  merchantWithdraw: (body) =>
    request({ path: '/merchant/withdraw', method: 'POST', data: body }),
  merchantPurchase: (body) =>
    request({ path: '/merchant/purchase', method: 'POST', data: body }),
  purchaseShip: (id) =>
    request({ path: `/merchant/purchase/${id}/ship`, method: 'POST', data: {} }),
  purchaseConfirm: (id) =>
    request({ path: `/merchant/purchase/${id}/confirm`, method: 'POST', data: {} }),
  purchaseCancel: (id, reason) =>
    request({ path: `/merchant/purchase/${id}/cancel`, method: 'POST', data: { reason } }),
  setMerchantOpen: (open) =>
    request({ path: '/merchant/profile/status', method: 'POST', data: { open: open ? 1 : 0 } }),
  merchantFeeStatus: () => request({ path: '/merchant/fees/status' })
}

module.exports = api

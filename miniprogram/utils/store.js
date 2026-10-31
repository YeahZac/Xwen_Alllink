const api = require('./api')
const { setToken, getToken } = require('./request')

/**
 * 万业互联云 · 本地状态
 * 登录态/Token 来自后端；购物车仍本地
 */

const KEYS = {
  session: 'wy_session',
  cart: 'wy_cart',
  cashRate: 'wy_cash_rate',
  /** 用户主动退出后禁止静默自动登录，直到再次主动授权登录 */
  manualLogout: 'wy_manual_logout'
}

const ROLE_HOME = {
  consumer: '/pages/index/index',
  stall: '/merchant/home/home',
  cross: '/merchant/home/home',
  supply: '/merchant/home/home'
}

const ROLE_LABEL = {
  consumer: '消费者',
  stall: '地摊商户',
  cross: '异业门店',
  supply: '供应链'
}

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v === undefined || v === null ? fallback : v
  } catch (e) {
    return fallback
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {}
}

function getCashRate() {
  return read(KEYS.cashRate, 0.01)
}

function setCashRate(rate) {
  write(KEYS.cashRate, Number(rate) || 0.01)
}

function pointsToCash(points) {
  return Math.round(Number(points || 0) * getCashRate() * 100) / 100
}

function cashToPoints(cash) {
  const rate = getCashRate()
  if (!rate) return 0
  return Math.max(0, Math.floor(Number(cash || 0) / rate))
}

function getSession() {
  return read(KEYS.session, null)
}

function setSession(session) {
  write(KEYS.session, session)
}

function isLoggedIn() {
  const s = getSession()
  return !!(s && s.role && getToken())
}

function clearManualLogout() {
  write(KEYS.manualLogout, null)
  try {
    wx.removeStorageSync(KEYS.manualLogout)
  } catch (_) {}
}

function markManualLogout() {
  write(KEYS.manualLogout, 1)
}

function isManualLogout() {
  return !!read(KEYS.manualLogout, null)
}

function applyAuthResult(data) {
  if (!data) throw new Error('登录失败')
  if (data.token) setToken(data.token)
  else if (!getToken()) throw new Error('登录失败：无 token')
  // 用户主动登录成功后，才允许后续静默恢复
  clearManualLogout()
  if (data.cashRate) setCashRate(data.cashRate)
  const cur = getSession() || {}
  const session = {
    role: data.role || cur.role,
    name: data.name || data.shopName || cur.name || '',
    shopName: data.shopName || cur.shopName || '',
    merchantId: data.merchantId != null ? data.merchantId : cur.merchantId || null,
    userId: data.userId != null ? data.userId : cur.userId || null,
    inviteCode: data.inviteCode || data.code || cur.inviteCode || '',
    coverUrl: data.coverUrl || data.avatarUrl || cur.coverUrl || '',
    avatarUrl: data.avatarUrl || data.coverUrl || cur.avatarUrl || '',
    phone: data.phone != null ? data.phone : cur.phone || '',
    gender: data.gender != null ? Number(data.gender) : cur.gender || 0,
    needPhone: data.needPhone != null ? !!data.needPhone : !(data.phone || cur.phone),
    points: data.points != null ? data.points : cur.points || 0,
    poolBalance: data.poolBalance != null ? data.poolBalance : cur.poolBalance || 0,
    loginAt: Date.now()
  }
  setSession(session)
  return { ok: true, session, home: ROLE_HOME[session.role] || ROLE_HOME.consumer }
}

async function loginWithCode(code) {
  try {
    const data = await api.loginByCode(code)
    return applyAuthResult(data)
  } catch (e) {
    return { ok: false, message: e.message || '登录失败' }
  }
}

async function loginAsConsumer(extra = {}) {
  return loginWithWeChat(extra)
}

async function loginWithWeChat(extra = {}) {
  try {
    const data = await api.wxLogin({
      jsCode: extra.jsCode || '',
      nickname: extra.nickname || extra.name || '',
      avatarUrl: extra.avatarUrl || ''
    })
    return applyAuthResult(data)
  } catch (e) {
    return { ok: false, message: e.message || '微信登录失败' }
  }
}

function wxLoginCode() {
  return new Promise((resolve) => {
    wx.login({
      success: (r) => resolve((r && r.code) || ''),
      fail: () => resolve('')
    })
  })
}

/** 静默微信登录：已绑定手机号的用户可直接恢复会话，无需再点授权 */
async function silentWeChatLogin() {
  if (isManualLogout()) {
    return { ok: false, message: '已退出登录', manualLogout: true }
  }
  const jsCode = await wxLoginCode()
  if (!jsCode) return { ok: false, message: '无法获取微信登录码' }
  if (isManualLogout()) {
    return { ok: false, message: '已退出登录', manualLogout: true }
  }
  let data
  try {
    data = await api.wxLogin({ jsCode })
  } catch (e) {
    return { ok: false, message: (e && e.message) || '微信登录失败' }
  }
  // 请求返回期间用户可能已点退出：丢弃结果，绝不写回会话
  if (isManualLogout()) {
    return { ok: false, message: '已退出登录', manualLogout: true }
  }
  const res = applyAuthResult(data)
  if (res.session && res.session.needPhone) {
    return { ok: false, message: '需要手机号授权', needPhone: true, session: res.session }
  }
  return res
}

/**
 * 启动时恢复登录态：
 * 1) 本地 token + session 仍在 → 拉 profile 校验
 * 2) 用户主动退出过 → 不静默登录，留在登录页
 * 3) 否则 token 失效/无会话 → 静默微信登录（已绑手机号则直接进首页）
 */
async function bootstrapSession() {
  if (isLoggedIn()) {
    try {
      const session = await refreshProfile()
      return { ok: true, session, source: 'token' }
    } catch (e) {
      const msg = String((e && e.message) || '')
      if (!/登录已失效|未登录|401/.test(msg)) {
        // 网络/冷启动失败时保留本地会话，避免误踢
        return { ok: true, session: getSession(), source: 'cache' }
      }
      // 仅清会话，不记「手动退出」，允许后续静默恢复
      setToken('')
      write(KEYS.session, null)
    }
  }
  if (isManualLogout()) {
    return { ok: false, message: '已退出登录', manualLogout: true }
  }
  try {
    const silent = await silentWeChatLogin()
    if (silent.ok) return { ok: true, session: silent.session, source: 'silent' }
    return silent
  } catch (e) {
    return { ok: false, message: (e && e.message) || '自动登录失败' }
  }
}

async function refreshProfile() {
  const data = await api.profile()
  const cur = getSession() || {}
  if (data.cashRate) setCashRate(data.cashRate)
  const session = {
    ...cur,
    role: data.role,
    name: data.name || data.shopName || cur.name,
    shopName: data.shopName || cur.shopName || '',
    merchantId: data.merchantId || cur.merchantId || null,
    userId: data.userId || cur.userId || null,
    inviteCode: data.inviteCode || cur.inviteCode || '',
    coverUrl: data.coverUrl || data.avatarUrl || cur.coverUrl || '',
    avatarUrl: data.avatarUrl || data.coverUrl || cur.avatarUrl || '',
    phone: data.phone != null ? data.phone : cur.phone || '',
    gender: data.gender != null ? Number(data.gender) : cur.gender || 0,
    needPhone: data.needPhone != null ? !!data.needPhone : !data.phone && !cur.phone,
    points: data.points != null ? data.points : cur.points,
    poolBalance: data.poolBalance != null ? data.poolBalance : cur.poolBalance
  }
  setSession(session)
  return session
}

function logout() {
  setToken('')
  write(KEYS.session, null)
  markManualLogout()
  // 取消进行中的启动静默登录，避免退出后又被 bootPromise 写回会话
  try {
    const app = getApp()
    if (app && app.globalData) app.globalData.bootPromise = null
  } catch (_) {}
}

function requireRole(roles) {
  const s = getSession()
  if (!s) return false
  const list = Array.isArray(roles) ? roles : [roles]
  return list.indexOf(s.role) >= 0
}

function resumePendingPay() {
  const scan = require('./scan')
  const pending = scan.getPendingPay()
  if (!pending || !pending.stallId) return false
  const pages = getCurrentPages() || []
  const prev = pages.length >= 2 ? pages[pages.length - 2] : null
  const prevRoute = String((prev && prev.route) || '')
  if (prevRoute.indexOf('pages/scan-pay/scan-pay') >= 0) {
    wx.navigateBack()
    return true
  }
  wx.reLaunch({ url: scan.scanPayUrl(pending.stallId, pending.amount) })
  return true
}

function routeAfterLogin() {
  const s = getSession()
  if (!s) {
    // 游客浏览中：不要再强制拉回登录
    if (preferGuestBrowse()) {
      wx.reLaunch({ url: '/pages/index/index' })
      return
    }
    wx.reLaunch({ url: '/pages/login/login' })
    return
  }
  try {
    wx.removeStorageSync('wy_guest_browse')
    const app = getApp()
    if (app && app.globalData) app.globalData.preferGuest = false
  } catch (_) {}
  try {
    const ref = wx.getStorageSync('wy_pending_ref')
    if (ref) {
      wx.removeStorageSync('wy_pending_ref')
      api
        .bindReferral(String(ref))
        .then(() => {
          wx.showToast({ title: '推荐关系已绑定', icon: 'none' })
        })
        .catch((err) => {
          wx.showToast({
            title: (err && err.message) || '推荐码绑定失败',
            icon: 'none'
          })
        })
    }
  } catch (e) {}
  if (resumePendingPay()) return
  if (s.role === 'consumer') {
    wx.switchTab({ url: ROLE_HOME.consumer })
  } else {
    wx.reLaunch({ url: ROLE_HOME[s.role] || '/merchant/home/home' })
  }
}

function ensureLoggedIn() {
  const s = getSession()
  if (!s || !getToken()) {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => wx.reLaunch({ url: '/pages/login/login' })
    })
    return false
  }
  return true
}

/**
 * @param {{ allowGuest?: boolean, soft?: boolean }} [opts]
 * - allowGuest: 未登录也可继续（浏览首页/兑换等）
 * - soft: 未登录用 navigateTo 进登录页（可返回），避免 reLaunch 卡住
 */
function ensureConsumerOrRedirect(opts = {}) {
  const allowGuest = !!(opts && opts.allowGuest)
  const soft = !!(opts && opts.soft)
  const s = getSession()
  if (!s || !getToken()) {
    if (allowGuest) return true
    if (soft) {
      wx.navigateTo({
        url: '/pages/login/login',
        fail: () => wx.reLaunch({ url: '/pages/login/login' })
      })
    } else {
      wx.reLaunch({ url: '/pages/login/login' })
    }
    return false
  }
  if (s.role !== 'consumer') {
    wx.reLaunch({ url: '/merchant/home/home' })
    return false
  }
  return true
}

/** 游客进入首页浏览（不强制登录） */
function enterAsGuest() {
  try {
    wx.setStorageSync('wy_guest_browse', 1)
  } catch (_) {}
  // 打断启动态自动路由，避免「先逛逛」后又被拉回登录页
  try {
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.bootPromise = null
      app.globalData.preferGuest = true
    }
  } catch (_) {}
  // reLaunch 最稳：清空含登录页在内的栈，直接进首页
  wx.reLaunch({
    url: '/pages/index/index',
    fail: () => {
      wx.switchTab({
        url: '/pages/index/index',
        fail: () => {
          wx.showToast({ title: '无法打开首页，请重试', icon: 'none' })
        }
      })
    }
  })
}

function preferGuestBrowse() {
  try {
    const app = getApp()
    if (app && app.globalData && app.globalData.preferGuest) return true
  } catch (_) {}
  try {
    return !!wx.getStorageSync('wy_guest_browse')
  } catch (_) {
    return false
  }
}

function ensureMerchantOrRedirect() {
  const s = getSession()
  if (!s || !getToken()) {
    wx.reLaunch({ url: '/pages/login/login' })
    return false
  }
  if (s.role === 'consumer') {
    wx.switchTab({ url: '/pages/index/index' })
    return false
  }
  return true
}

function getCart() {
  return read(KEYS.cart, { stallId: '', items: [] })
}

function setCart(cart) {
  write(KEYS.cart, cart)
}

function clearCart() {
  write(KEYS.cart, { stallId: '', items: [] })
}

function addToCart(stallId, goods, qty = 1) {
  const cart = getCart()
  if (cart.stallId && String(cart.stallId) !== String(stallId)) cart.items = []
  cart.stallId = stallId
  const optionIds = (goods.optionIds || []).map(Number).filter(Boolean).sort((a, b) => a - b)
  const lineKey =
    goods.lineKey || `${goods.id}_${optionIds.join('-') || 'base'}`
  const found = cart.items.find((i) => String(i.lineKey || i.id) === String(lineKey))
  if (found) found.qty += qty
  else {
    cart.items.push({
      id: goods.id,
      lineKey,
      name: goods.name,
      optionsText: goods.optionsText || '',
      optionIds,
      price: Number(goods.price) || 0,
      pointsGrant: Number(goods.pointsGrant) || 0,
      qty
    })
  }
  setCart(cart)
  return cart
}

function updateQty(lineKeyOrId, qty) {
  const cart = getCart()
  cart.items = cart.items
    .map((i) => {
      const key = i.lineKey || String(i.id)
      return String(key) === String(lineKeyOrId) ? { ...i, qty } : i
    })
    .filter((i) => i.qty > 0)
  if (!cart.items.length) cart.stallId = ''
  setCart(cart)
  return cart
}

function cartSummary(cart) {
  const items = (cart && cart.items) || []
  return {
    totalPrice: Math.round(items.reduce((s, i) => s + Number(i.price) * i.qty, 0) * 100) / 100,
    totalPoints: items.reduce((s, i) => s + (Number(i.pointsGrant) || 0) * i.qty, 0),
    totalQty: items.reduce((s, i) => s + i.qty, 0)
  }
}

function getConsumerPoints() {
  const s = getSession()
  return s && s.points != null ? Number(s.points) : 0
}

function setConsumerPoints(n) {
  const s = getSession() || {}
  s.points = Math.max(0, Math.floor(n))
  setSession(s)
}

module.exports = {
  ROLE_HOME,
  ROLE_LABEL,
  getCashRate,
  setCashRate,
  pointsToCash,
  cashToPoints,
  getSession,
  setSession,
  isLoggedIn,
  loginWithCode,
  loginAsConsumer,
  loginWithWeChat,
  applyAuthResult,
  refreshProfile,
  silentWeChatLogin,
  bootstrapSession,
  logout,
  isManualLogout,
  clearManualLogout,
  requireRole,
  routeAfterLogin,
  ensureLoggedIn,
  ensureConsumerOrRedirect,
  ensureMerchantOrRedirect,
  enterAsGuest,
  preferGuestBrowse,
  getCart,
  setCart,
  clearCart,
  addToCart,
  updateQty,
  cartSummary,
  getConsumerPoints,
  setConsumerPoints,
  getPoints: getConsumerPoints,
  setPoints: setConsumerPoints,
  getToken
}

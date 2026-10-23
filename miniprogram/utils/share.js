/**
 * 全站转发：挂到 Page，每个页面右上角菜单可转发好友 / 朋友圈。
 * 页面若已自定义 onShareAppMessage / onShareTimeline，优先用页面自己的。
 */

const BRAND_TITLE = '万业互联云 · 供货 · 点餐 · 积分通用'

function buildQuery(options) {
  const opts = options || {}
  return Object.keys(opts)
    .filter((k) => opts[k] !== undefined && opts[k] !== null && opts[k] !== '')
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(opts[k])}`)
    .join('&')
}

function currentRoute(page) {
  if (page && page.route) return String(page.route).replace(/^\//, '')
  try {
    const pages = getCurrentPages() || []
    const cur = pages[pages.length - 1]
    if (cur && cur.route) return String(cur.route).replace(/^\//, '')
  } catch (_) {}
  return 'pages/index/index'
}

function withReferral(path) {
  let next = path || '/pages/index/index'
  try {
    const store = require('./store')
    const session = store.getSession() || {}
    const code = String(session.inviteCode || '').trim()
    if (!code || /[?&]ref=/.test(next)) return next
    next += (next.indexOf('?') >= 0 ? '&' : '?') + `ref=${encodeURIComponent(code)}`
  } catch (_) {}
  return next
}

function defaultShareAppMessage(page) {
  const route = currentRoute(page)
  const qs = buildQuery(page && page.options)
  const path = withReferral(qs ? `/${route}?${qs}` : `/${route}`)
  return {
    title: BRAND_TITLE,
    path
  }
}

function defaultShareTimeline(page) {
  const share = defaultShareAppMessage(page)
  const q = String(share.path || '').split('?')[1] || ''
  return {
    title: share.title,
    query: q
  }
}

function enableShareMenu() {
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })
  } catch (_) {}
}

/** 在 App 启动最早处调用一次，覆盖全局 Page */
function installPageShare() {
  if (installPageShare._done) return
  installPageShare._done = true
  const originPage = Page
  // eslint-disable-next-line no-global-assign
  Page = function (config) {
    const options = Object.assign({}, config || {})
    const userShare = options.onShareAppMessage
    const userTimeline = options.onShareTimeline
    const userShow = options.onShow
    const userLoad = options.onLoad

    options.onShareAppMessage = function (res) {
      if (typeof userShare === 'function') {
        const custom = userShare.call(this, res)
        if (custom) return custom
      }
      return defaultShareAppMessage(this)
    }

    options.onShareTimeline = function (res) {
      if (typeof userTimeline === 'function') {
        const custom = userTimeline.call(this, res)
        if (custom) return custom
      }
      return defaultShareTimeline(this)
    }

    options.onLoad = function (query) {
      enableShareMenu()
      if (typeof userLoad === 'function') {
        return userLoad.call(this, query)
      }
    }

    options.onShow = function (opts) {
      enableShareMenu()
      if (typeof userShow === 'function') {
        return userShow.call(this, opts)
      }
    }

    return originPage(options)
  }
}

module.exports = {
  BRAND_TITLE,
  defaultShareAppMessage,
  defaultShareTimeline,
  enableShareMenu,
  installPageShare
}

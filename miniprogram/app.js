const { ensureCloud } = require('./utils/request')
const store = require('./utils/store')
const scan = require('./utils/scan')
const invite = require('./utils/invite')
const location = require('./utils/location')
const homePrefetch = require('./utils/home-prefetch')
const { installPageShare } = require('./utils/share')

// 须在任意 Page() 定义之前安装，使每个页面都可转发
installPageShare()

function captureInviteFromLaunch(opt) {
  const o = opt || {}
  const q = o.query || {}
  let code =
    invite.extractInviteCode(q.ref) ||
    invite.extractInviteCode(q.scene) ||
    invite.extractInviteCode(o.scene)
  if (!code && o.path) {
    code = invite.extractInviteCode(o.path)
  }
  if (code) invite.savePendingRef(code)
}

App({
  globalData: {
    brand: {
      name: '万业互联云',
      slogan: '供货 · 点餐 · 积分额度 · 异业闭环'
    },
    bootPromise: null,
    warmPromise: null,
    homePrefetch: null,
    preferGuest: true
  },
  onLaunch(opt) {
    ensureCloud()
    // 仅在无登录态时默认游客；已有 token 不强制 guest，避免 401 后以为仍登录
    let hasToken = false
    try {
      hasToken = !!wx.getStorageSync('wy_token')
    } catch (_) {}
    if (!hasToken) {
      this.globalData.preferGuest = true
      try {
        wx.setStorageSync('wy_guest_browse', 1)
      } catch (_) {}
    } else {
      this.globalData.preferGuest = false
    }

    captureInviteFromLaunch(opt)

    // 默认沙井：首屏立刻有城市与坐标基准
    location.ensureDefaultLoc()

    // 预热云托管 + 并行预拉首页门店（不等 GPS）
    let warmPromise = Promise.resolve(null)
    try {
      const api = require('./utils/api')
      warmPromise = api.health().catch(() => null)
      this.globalData.warmPromise = warmPromise
    } catch (_) {
      this.globalData.warmPromise = Promise.resolve(null)
    }
    this.globalData.homePrefetchPromise = homePrefetch.start(warmPromise)

    this.globalData.bootPromise = store.bootstrapSession().catch(() => ({ ok: false }))

    const path = String((opt && opt.path) || '').replace(/^\//, '')
    // 仅首页冷启 / 明确收款页才把 query.id 当作摊位收款；异业详情·类目等共用 id 参数，禁止劫持
    const allowPayHijack =
      !path ||
      path === 'pages/index/index' ||
      path.indexOf('pages/scan-pay/scan-pay') === 0
    if (!allowPayHijack) return
    // 必须是扫码类 scene，或 path/query 明确带摊位，才进入收款；避免「最近使用」残留
    const stallId = scan.extractFromLaunch(opt || {})
    const fromScan = scan.isScanLaunchScene(opt && opt.scene) || !!stallId
    if (!stallId || !fromScan) return
    const pending = scan.getPendingPay() || {}
    const same = String(pending.stallId || '') === String(stallId)
    scan.savePendingPay({
      stallId,
      amount: same && pending.resume ? pending.amount : '',
      resume: false
    })
    if (path.indexOf('scan-pay') < 0) {
      this._openScanPay = true
    }
  },
  onShow(opt) {
    captureInviteFromLaunch(opt)
    const showPath = String((opt && opt.path) || '').replace(/^\//, '')
    const stallId = scan.extractFromLaunch(opt || {})
    const fromScan = scan.isScanLaunchScene(opt && opt.scene) || !!stallId

    // 非扫码再次打开却停在收款页（微信会恢复上次页面）→ 回首页
    if (showPath.indexOf('pages/scan-pay/scan-pay') === 0 && !fromScan && !this._openScanPay) {
      const pending = scan.getPendingPay()
      if (!pending || pending.resume !== true) {
        scan.clearPendingPay()
        wx.switchTab({ url: '/pages/index/index' })
        return
      }
    }

    const allowPayHijack =
      !showPath ||
      showPath === 'pages/index/index' ||
      showPath.indexOf('pages/scan-pay/scan-pay') === 0
    if (!allowPayHijack) {
      this._openScanPay = false
      return
    }
    if (!this._openScanPay) return
    this._openScanPay = false
    const pending = scan.getPendingPay()
    if (!pending || !pending.stallId) return
    wx.reLaunch({ url: scan.scanPayUrl(pending.stallId, pending.amount) })
  }
})

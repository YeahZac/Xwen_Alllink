const { ensureCloud } = require('./utils/request')
const store = require('./utils/store')
const scan = require('./utils/scan')
const location = require('./utils/location')
const homePrefetch = require('./utils/home-prefetch')
const { installPageShare } = require('./utils/share')

// 须在任意 Page() 定义之前安装，使每个页面都可转发
installPageShare()

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
    this.globalData.preferGuest = true
    try {
      wx.setStorageSync('wy_guest_browse', 1)
    } catch (_) {}

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

    const stallId = scan.extractFromLaunch(opt || {})
    if (!stallId) return
    const pending = scan.getPendingPay() || {}
    const same = String(pending.stallId || '') === String(stallId)
    scan.savePendingPay({
      stallId,
      amount: same ? pending.amount : '',
      resume: true
    })
    const path = String((opt && opt.path) || '')
    if (path.indexOf('scan-pay') < 0) {
      this._openScanPay = true
    }
  },
  onShow() {
    if (!this._openScanPay) return
    this._openScanPay = false
    const pending = scan.getPendingPay()
    if (!pending || !pending.stallId) return
    wx.reLaunch({ url: scan.scanPayUrl(pending.stallId, pending.amount) })
  }
})

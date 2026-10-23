const { ensureCloud } = require('./utils/request')
const store = require('./utils/store')
const scan = require('./utils/scan')
const { installPageShare } = require('./utils/share')

// 须在任意 Page() 定义之前安装，使每个页面都可转发
installPageShare()

App({
  globalData: {
    brand: {
      name: '万业互联云',
      slogan: '供货 · 点餐 · 积分额度 · 异业闭环'
    },
    bootPromise: null
  },
  onLaunch(opt) {
    ensureCloud()
    // 预热云托管：minNum=0 时缩容后首请求常 15～60s；先 ping 再拉会话，缩短首页白等
    try {
      const api = require('./utils/api')
      this.globalData.warmPromise = api.health().catch(() => null)
    } catch (_) {
      this.globalData.warmPromise = Promise.resolve(null)
    }
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

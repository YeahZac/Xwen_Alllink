const store = require('../../utils/store')
const api = require('../../utils/api')
const { requestWxPay } = require('../../utils/pay')

Page({
  data: {
    store: {},
    items: [],
    points: 0,
    cashRateText: '',
    busy: false
  },
  async onLoad(q) {
    if (!store.ensureConsumerOrRedirect()) return
    if (!q.id) {
      wx.showToast({ title: '缺少门店信息', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/cross/cross' }) }), 500)
      return
    }
    try {
      wx.showLoading({ title: '加载中' })
      const s = await api.crossStore(q.id)
      wx.hideLoading()
      this.setData({
        store: { ...s, initial: s.initial || (s.name || '').slice(0, 1) },
        items: (s.items || []).map((it) => this.withMix(it, store.getConsumerPoints()))
      })
      wx.setNavigationBarTitle({ title: s.name || '异业门店' })
      api.trackVisit({ roleScope: 'consumer', pageKey: 'cross', merchantId: Number(q.id) }).catch(() => {})
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    try {
      const p = await api.myPoints()
      store.setConsumerPoints(p.points)
      this.setData({
        points: p.points,
        cashRateText: `抵现参考：1 积分 = ¥${p.cashRate || store.getCashRate()}`,
        items: (this.data.items || []).map((it) => this.withMix(it, p.points))
      })
    } catch (_) {
      this.setData({
        points: store.getConsumerPoints(),
        cashRateText: `抵现参考：1 积分 = ¥${store.getCashRate()}`
      })
    }
  },
  findItem(id) {
    return this.data.items.find((i) => String(i.id) === String(id))
  },
  withMix(item, points) {
    const ptsNeed = Number(item.pointsNeed) || 0
    const cashPrice = Number(item.cashPrice) || 0
    const max = Math.min(Number(points) || 0, ptsNeed)
    const mixPoints =
      item.mixPoints != null && item.mixPoints !== ''
        ? Math.min(max, Math.max(0, Math.floor(Number(item.mixPoints) || 0)))
        : max
    const mixCash =
      ptsNeed > 0
        ? Math.round(cashPrice * (1 - mixPoints / ptsNeed) * 100) / 100
        : cashPrice
    return {
      ...item,
      mixPoints,
      mixCash: mixCash.toFixed(2)
    }
  },
  onMixInput(e) {
    const id = e.currentTarget.dataset.id
    const items = this.data.items.map((it) => {
      if (String(it.id) !== String(id)) return it
      return this.withMix({ ...it, mixPoints: e.detail.value }, this.data.points)
    })
    this.setData({ items })
  },
  async checkout(item, payMode, pointsUse) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const result = await api.redeemCross({
        merchantId: Number(this.data.store.id),
        goodsId: Number(item.id),
        payMode,
        pointsUse
      })
      await requestWxPay(result)
      const p = await api.myPoints().catch(() => ({ points: this.data.points }))
      store.setConsumerPoints(p.points)
      this.setData({
        points: p.points,
        busy: false,
        items: (this.data.items || []).map((it) => this.withMix(it, p.points))
      })
      if (result && result.autoFallback) {
        this.showOrderSuccess(`积分不足，已按微信价 ¥${result.cashAmount} 成交`)
      } else if (payMode === 'mix') {
        const sim = result.simulated ? '（模拟微信支付）' : ''
        this.showOrderSuccess(
          `组合支付：积分 ${result.pointsSpend || 0} + 微信 ¥${result.cashAmount}${sim}`
        )
      } else if (payMode === 'cash') {
        const sim = result.simulated ? '（模拟微信支付）' : ''
        this.showOrderSuccess(`微信支付 ¥${result.cashAmount || item.cashPrice}${sim}`)
      } else {
        this.showOrderSuccess(`已扣 ${result.pointsSpend || item.pointsNeed} 积分`)
      }
    } catch (err) {
      this.setData({ busy: false })
      wx.showToast({ title: err.message || '支付失败', icon: 'none' })
    }
  },
  async redeem(e) {
    if (this.data.busy) return
    const item = this.findItem(e.currentTarget.dataset.id)
    if (!item) return
    this.checkout(item, 'points')
  },
  async payCash(e) {
    const item = this.findItem(e.currentTarget.dataset.id)
    if (!item) return
    this.checkout(item, 'cash')
  },
  async payMix(e) {
    const item = this.findItem(e.currentTarget.dataset.id)
    if (!item) return
    this.checkout(item, 'mix', Number(item.mixPoints) || 0)
  },
  showOrderSuccess(message) {
    wx.showModal({
      title: '下单成功',
      content: message,
      confirmText: '查看订单',
      cancelText: '继续选购',
      success: (result) => {
        if (result.confirm) wx.navigateTo({ url: '/pages/orders/orders' })
      }
    })
  }
})

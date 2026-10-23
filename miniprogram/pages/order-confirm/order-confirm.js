const store = require('../../utils/store')
const api = require('../../utils/api')
const { requestWxPay } = require('../../utils/pay')

Page({
  data: {
    stall: {},
    items: [],
    summary: { totalPrice: 0, totalPoints: 0, totalQty: 0 },
    cashRateText: '',
    points: 0,
    pointsUse: 0,
    maxPoints: 0,
    offsetCash: '0.00',
    cashDue: '0.00',
    payLabel: '微信支付',
    paying: false,
    loading: true
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    const cart = store.getCart()
    if (!cart.items.length) {
      wx.showToast({ title: '购物车为空', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    try {
      this.setData({ loading: true })
      const data = await api.stallMenu(cart.stallId)
      const rate = store.getCashRate()
      const summary = store.cartSummary(cart)
      let points = store.getConsumerPoints()
      try {
        const p = await api.myPoints()
        points = p.points
        store.setConsumerPoints(p.points)
        if (p.cashRate) store.setCashRate(p.cashRate)
      } catch (_) {}
      this.setData({
        stall: data.stall || {},
        items: cart.items.map((i) => ({
          ...i,
          lineKey: i.lineKey || String(i.id),
          lineTotal: Math.round(Number(i.price) * i.qty * 100) / 100
        })),
        summary,
        points,
        cashRateText: `后台汇率：100 积分 ≈ ¥${(store.getCashRate() * 100).toFixed(0)}`,
        loading: false
      })
      this.recompute(Math.min(points, store.cashToPoints(summary.totalPrice)))
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  recompute(n) {
    const total = Number(this.data.summary.totalPrice) || 0
    const maxPoints = Math.min(Number(this.data.points) || 0, store.cashToPoints(total))
    let pointsUse = Math.max(0, Math.floor(Number(n) || 0))
    if (pointsUse > maxPoints) pointsUse = maxPoints
    const offsetCash = store.pointsToCash(pointsUse)
    const cashDue = Math.round(Math.max(0, total - offsetCash) * 100) / 100
    let payLabel = `微信支付 ¥${cashDue.toFixed(2)}`
    if (pointsUse > 0 && cashDue > 0) {
      payLabel = `积分抵 ¥${offsetCash.toFixed(2)} + 微信 ¥${cashDue.toFixed(2)}`
    } else if (cashDue <= 0) {
      payLabel = `积分全额抵扣 ${pointsUse}`
    }
    this.setData({
      maxPoints,
      pointsUse,
      offsetCash: offsetCash.toFixed(2),
      cashDue: cashDue.toFixed(2),
      payLabel
    })
  },
  onPointsInput(e) {
    this.recompute(e.detail.value)
  },
  useNone() {
    this.recompute(0)
  },
  useHalf() {
    this.recompute(Math.floor(this.data.maxPoints / 2))
  },
  useAll() {
    this.recompute(this.data.maxPoints)
  },
  async onPay() {
    if (this.data.paying) return
    this.setData({ paying: true })
    const cart = store.getCart()
    try {
      const result = await api.payStall({
        merchantId: Number(cart.stallId),
        pointsUse: Number(this.data.pointsUse) || 0,
        items: cart.items.map((i) => ({
          goodsId: Number(i.id),
          qty: i.qty,
          optionIds: i.optionIds || []
        }))
      })
      await requestWxPay(result)
      store.clearCart()
      await store.refreshProfile().catch(() => {})
      this.setData({ paying: false })
      const cash = result.cashPaid != null ? result.cashPaid : result.cashAmount
      const pts = result.pointsSpend || 0
      const sim = result.simulated ? '（模拟微信支付）' : ''
      wx.showModal({
        title: '支付成功',
        content: `积分抵扣 ${pts}，微信收款 ¥${cash}${sim}。摊主出餐完成后积分到账（预计划拨 ${result.pointsWant || 0}）。`,
        showCancel: false,
        confirmText: '查看订单',
        success: () => wx.redirectTo({ url: '/pages/orders/orders' })
      })
    } catch (e) {
      this.setData({ paying: false })
      wx.showToast({ title: e.message || '支付失败', icon: 'none' })
    }
  }
})

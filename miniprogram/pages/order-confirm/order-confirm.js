const store = require('../../utils/store')
const api = require('../../utils/api')
const { requestWxPay, isCancelError } = require('../../utils/pay')

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
    loading: true,
    orderRemark: '',
    pendingOrderNo: ''
  },
  onOrderRemark(e) {
    this.setData({ orderRemark: String((e.detail && e.detail.value) || '').slice(0, 100) })
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    const cart = store.getCart()
    if (!cart.items.length) {
      // 可能刚支付成功清了车；若有待支付单可去订单
      const pending = this.data.pendingOrderNo
      if (pending) {
        wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${encodeURIComponent(pending)}` })
        return
      }
      wx.showToast({ title: '购物车为空', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    try {
      this.setData({ loading: true })
      const data = await api.stallMenu(cart.stallId)
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
  showPaySuccess(result) {
    const cash = result.cashPaid != null ? result.cashPaid : result.cashAmount
    const pts = result.pointsSpend || 0
    const sim = result.simulated ? '（模拟微信支付）' : ''
    const allocated =
      result.pointsAllocated != null ? result.pointsAllocated : result.pointsWant || 0
    wx.showModal({
      title: '支付成功',
      content: `积分抵扣 ${pts}，微信收款 ¥${cash}${sim}。本单预计/已划拨积分 ${allocated}。`,
      showCancel: false,
      confirmText: '查看订单',
      success: () => {
        const ono = result.orderNo || this.data.pendingOrderNo
        if (ono) {
          wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${encodeURIComponent(ono)}` })
        } else {
          wx.redirectTo({ url: '/pages/orders/orders' })
        }
      }
    })
  },
  handlePayInterrupt(err, orderNo) {
    const ono = orderNo || (err && err.orderNo) || this.data.pendingOrderNo || ''
    const cancelled = isCancelError(err) || (err && err.code === 'USER_CANCEL')
    const syncPending = err && err.code === 'SYNC_PENDING'
    if (syncPending && ono) {
      wx.showModal({
        title: '支付结果确认中',
        content: '微信侧可能已扣款，入账稍有延迟。请到订单查看，勿重复支付。',
        confirmText: '查看订单',
        showCancel: false,
        success: () =>
          wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${encodeURIComponent(ono)}` })
      })
      return
    }
    if (!ono) {
      wx.showToast({ title: (err && err.message) || '支付失败', icon: 'none' })
      return
    }
    wx.showModal({
      title: cancelled ? '已取消支付' : '支付未完成',
      content: cancelled
        ? '订单仍保留为待支付。可继续支付，或取消订单后重新选购。'
        : `${(err && err.message) || '支付失败'}。可继续支付或稍后在订单中处理。`,
      confirmText: '继续支付',
      cancelText: '取消订单',
      success: async (r) => {
        if (r.confirm) {
          await this.continuePay(ono)
          return
        }
        try {
          await api.cancelStallOrder({ orderNo: ono })
          this.setData({ pendingOrderNo: '' })
          wx.showToast({ title: '订单已取消', icon: 'none' })
        } catch (e2) {
          wx.showToast({ title: (e2 && e2.message) || '取消失败', icon: 'none' })
        }
      }
    })
  },
  async continuePay(orderNo) {
    if (this.data.paying) return
    this.setData({ paying: true })
    try {
      const result = await api.repayStallOrder({ orderNo })
      if (result.alreadyPaid || result.payStatus === 'paid' || result.simulated) {
        store.clearCart()
        this.setData({ pendingOrderNo: '', paying: false })
        this.showPaySuccess(result)
        return
      }
      this.setData({ pendingOrderNo: result.orderNo || orderNo })
      const paid = await requestWxPay(result)
      store.clearCart()
      await store.refreshProfile().catch(() => {})
      this.setData({ pendingOrderNo: '', paying: false })
      this.showPaySuccess(paid || result)
    } catch (e) {
      this.setData({ paying: false })
      this.handlePayInterrupt(e, orderNo)
    }
  },
  async onPay() {
    if (this.data.paying) return
    // 若已有待支付单，优先继续支付，避免重复建单
    if (this.data.pendingOrderNo) {
      await this.continuePay(this.data.pendingOrderNo)
      return
    }
    this.setData({ paying: true })
    const cart = store.getCart()
    try {
      const result = await api.payStall({
        merchantId: Number(cart.stallId),
        pointsUse: Number(this.data.pointsUse) || 0,
        remark: this.data.orderRemark || '',
        items: cart.items.map((i) => ({
          goodsId: Number(i.id),
          qty: i.qty,
          optionIds: i.optionIds || [],
          remark: i.remark || ''
        }))
      })
      if (result.orderNo) this.setData({ pendingOrderNo: result.orderNo })

      // 模拟/已支付/0 元：直接成功；现金额兼容 cashPaid / cashAmount
      const cashDue =
        result.cashPaid != null
          ? Number(result.cashPaid)
          : result.cashAmount != null
            ? Number(result.cashAmount)
            : 0
      if (result.simulated || result.payStatus === 'paid' || !(cashDue > 0)) {
        const paid = await requestWxPay(result)
        store.clearCart()
        await store.refreshProfile().catch(() => {})
        this.setData({ pendingOrderNo: '', paying: false })
        this.showPaySuccess(paid || result)
        return
      }

      const paid = await requestWxPay(result)
      store.clearCart()
      await store.refreshProfile().catch(() => {})
      this.setData({ pendingOrderNo: '', paying: false })
      this.showPaySuccess(paid || result)
    } catch (e) {
      this.setData({ paying: false })
      this.handlePayInterrupt(e, this.data.pendingOrderNo)
    }
  }
})

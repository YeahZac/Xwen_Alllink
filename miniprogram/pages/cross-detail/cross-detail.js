const store = require('../../utils/store')
const api = require('../../utils/api')
const { requestWxPay, isCancelError } = require('../../utils/pay')
const coverPack = require('../../utils/cover-pack')

Page({
  data: {
    store: {},
    items: [],
    points: 0,
    cashRateText: '',
    busy: false
  },
  async onLoad(q) {
    // 允许游客浏览门店；兑换/支付前再强制登录
    if (!store.ensureConsumerOrRedirect({ allowGuest: true, soft: true })) return
    const scene = require('../../utils/scene')
    const id = scene.merchantIdFromQuery(q)
    if (!id) {
      wx.showToast({ title: '缺少门店信息', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/cross/cross' }) }), 500)
      return
    }
    try {
      wx.showLoading({ title: '加载中' })
      const s = await api.crossStore(id)
      wx.hideLoading()
      this.setData({
        store: {
          ...s,
          initial: s.initial || (s.name || '').slice(0, 1),
          coverImage: coverPack.resolveCover({ ...s, role: s.role || 'cross' })
        },
        items: (s.items || []).map((it) => this.withMix(it, store.getConsumerPoints()))
      })
      wx.setNavigationBarTitle({ title: s.name || '异业门店' })
      api.trackVisit({ roleScope: 'consumer', pageKey: 'cross', merchantId: Number(id) }).catch(() => {})
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect({ allowGuest: true, soft: true })) return
    if (!store.isLoggedIn || !store.isLoggedIn()) {
      this.setData({
        points: store.getConsumerPoints(),
        cashRateText: `抵现参考：1 积分 = ¥${store.getCashRate()}`
      })
      return
    }
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
  async refreshPoints() {
    const p = await api.myPoints().catch(() => ({ points: this.data.points }))
    store.setConsumerPoints(p.points)
    this.setData({
      points: p.points,
      busy: false,
      items: (this.data.items || []).map((it) => this.withMix(it, p.points))
    })
  },
  async checkout(item, payMode, pointsUse) {
    if (this.data.busy) return
    if (!store.ensureConsumerOrRedirect()) return
    this.setData({ busy: true })
    try {
      const result = await api.redeemCross({
        merchantId: Number(this.data.store.id),
        goodsId: Number(item.id),
        payMode,
        pointsUse
      })
      const cash =
        result.cashPaid != null
          ? Number(result.cashPaid)
          : result.cashAmount != null
            ? Number(result.cashAmount)
            : 0
      // 现金单必须有模拟标记或真实预下单参数，禁止「服务端已完成、客户端当成功」
      if (cash > 0 && !result.simulated && result.needConfirm && !(result.payParams && result.payParams.paySign)) {
        throw new Error('缺少微信支付参数，请稍后重试')
      }
      const paid = await requestWxPay(result)
      const mode = (paid && paid.payMode) || result.payMode || payMode
      if (result && result.autoFallback) {
        this.showOrderSuccess(`积分不足，已按微信价 ¥${result.cashAmount} 成交`)
      } else if (mode === 'mix') {
        const sim = (paid && paid.simulated) || result.simulated ? '（模拟微信支付）' : ''
        this.showOrderSuccess(
          `组合支付：积分 ${result.pointsSpend || 0} + 微信 ¥${result.cashAmount}${sim}`
        )
      } else if (mode === 'cash') {
        const sim = (paid && paid.simulated) || result.simulated ? '（模拟微信支付）' : ''
        this.showOrderSuccess(`微信支付 ¥${result.cashAmount || item.cashPrice}${sim}`)
      } else {
        this.showOrderSuccess(`已扣 ${result.pointsSpend || item.pointsNeed} 积分`)
      }
      await this.refreshPoints().catch(() => {})
    } catch (err) {
      if (err && err.code === 'SYNC_PENDING') {
        wx.showModal({
          title: '支付结果确认中',
          content: '请稍后在订单中查看，勿重复支付。',
          showCancel: false,
          success: () => wx.navigateTo({ url: '/pages/orders/orders' })
        })
        return
      }
      if (isCancelError(err) || (err && err.code === 'USER_CANCEL')) {
        wx.showToast({ title: '已取消支付', icon: 'none' })
        return
      }
      wx.showToast({ title: err.message || '支付失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
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

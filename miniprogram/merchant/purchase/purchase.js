const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    role: 'stall',
    title: '向供应链采购',
    desc: '',
    goods: [],
    busy: false,
    loading: true,
    qtyMap: {},
    fulfillType: 'online'
  },
  async onLoad(q) {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    const role = s.role
    const isBuyer = role === 'stall' || role === 'cross'
    this.setData({
      role,
      title: isBuyer ? '向供应链采购' : '供货商品一览',
      desc: isBuyer
        ? '采购成交后，积分额度进入本店额度池，供 C 端消费划拨'
        : '买方采购成交后获得积分额度'
    })
    try {
      const goods = await api.supplyGoods()
      const qtyMap = {}
      ;(goods || []).forEach((g) => {
        qtyMap[g.id] = 1
      })
      this.setData({
        loading: false,
        qtyMap,
        goods: (goods || []).map((g) => ({
          ...g,
          coverImage: g.coverImage || g.imageUrl || ''
        }))
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  changeQty(e) {
    const id = e.currentTarget.dataset.id
    const delta = Number(e.currentTarget.dataset.delta) || 0
    const goods = this.data.goods.find((item) => String(item.id) === String(id))
    if (!goods) return
    const current = Number(this.data.qtyMap[id] || 1)
    const stock = Math.max(1, Number(goods.stock || 9999))
    const next = Math.min(stock, Math.max(1, current + delta))
    this.setData({ [`qtyMap.${id}`]: next })
  },
  selectFulfill(e) {
    const type = e.currentTarget.dataset.type
    if (type === 'online' || type === 'offline') {
      this.setData({ fulfillType: type })
    }
  },
  async onAction(e) {
    if (this.data.busy) return
    const id = e.currentTarget.dataset.id
    const g = this.data.goods.find((x) => String(x.id) === String(id))
    if (!g) return
    if (this.data.role === 'supply') {
      wx.navigateTo({ url: '/merchant/goods/goods?role=supply' })
      return
    }
    this.setData({ busy: true })
    try {
      const qty = Number(this.data.qtyMap[id] || 1)
      const fulfillType = this.data.fulfillType
      const res = await api.merchantPurchase({ goodsId: Number(g.id), qty, fulfillType })
      this.setData({ busy: false })
      const pts = res.pointsGrant != null ? res.pointsGrant : Number(g.pointsGrant || 0) * qty
      if (fulfillType === 'online') {
        wx.showModal({
          title: '采购单已提交',
          content: `线上采购 ${qty} 件已下单（待供应链发货）。发货并由你确认收货后，额度 +${pts} 才会入账。请到「订单中心 → 采购订单」跟踪。`,
          confirmText: '看采购单',
          cancelText: '继续采购',
          success: (r) => {
            if (r.confirm) {
              wx.navigateTo({ url: '/merchant/orders/orders' })
            }
          }
        })
      } else {
        wx.showModal({
          title: '采购成交',
          content: `线下采购 ${qty} 件已确认，积分额度 +${pts} 已入账。`,
          confirmText: '看额度池',
          cancelText: '继续采购',
          success: (r) => {
            if (r.confirm) {
              wx.navigateTo({
                url: `/merchant/points-pool/points-pool?role=${this.data.role}`
              })
            }
          }
        })
      }
    } catch (err) {
      this.setData({ busy: false })
      wx.showToast({ title: err.message || '采购失败', icon: 'none' })
    }
  }
})

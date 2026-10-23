const store = require('../../utils/store')
const api = require('../../utils/api')
const location = require('../../utils/location')

Page({
  data: { list: [], loading: true },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    if (!store.requireRole(['stall', 'cross'])) {
      wx.showToast({ title: '地摊/异业可查看供应链', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    this.setData({ loading: true })
    try {
      const rows = await api.supplyMerchants(location.queryFromSaved())
      this.setData({
        loading: false,
        list: location.decorateList(rows || []).map((m) => ({
          ...m,
          coverImage: m.coverImage || '',
          initial: m.initial || (m.name || '').slice(0, 1),
          tag: [m.distance, m.city].filter(Boolean).join(' · ') || '供应链'
        }))
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  goPurchase() {
    const role = store.getSession().role || 'stall'
    wx.navigateTo({ url: `/merchant/purchase/purchase?role=${role}` })
  }
})

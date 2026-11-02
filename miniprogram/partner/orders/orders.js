const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: { list: [], loading: true },
  async onShow() {
    if (!store.ensurePartnerOrRedirect()) return
    try {
      const rows = await api.partnerMerchantOrders()
      this.setData({ list: rows || [], loading: false })
    } catch (e) {
      this.setData({ loading: false, list: [] })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  }
})

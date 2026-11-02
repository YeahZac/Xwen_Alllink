const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: { stats: {}, records: [], loading: true },
  async onShow() {
    if (!store.ensurePartnerOrRedirect()) return
    try {
      const dash = await api.partnerDashboard()
      this.setData({
        stats: dash.stats || {},
        records: dash.records || [],
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  }
})

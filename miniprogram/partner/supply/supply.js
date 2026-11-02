const store = require('../../utils/store')
const api = require('../../utils/api')
const location = require('../../utils/location')
const coverPack = require('../../utils/cover-pack')

Page({
  data: { list: [], loading: true },
  async onShow() {
    if (!store.ensurePartnerOrRedirect()) return
    try {
      const rows = await api.supplyMerchants(location.queryFromSaved())
      this.setData({
        loading: false,
        list: (rows || []).map((m) => ({
          ...m,
          coverImage: coverPack.resolveCover({ ...m, role: 'supply' })
        }))
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  }
})

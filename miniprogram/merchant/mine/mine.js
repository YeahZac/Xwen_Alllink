const store = require('../../utils/store')
const api = require('../../utils/api')

const ROLE_NAME = { stall: '地摊', cross: '异业', supply: '供应链供货' }

Page({
  data: { shopName: '', userName: '', roleName: '' },
  onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession() || {}
    this.setData({
      shopName: s.shopName || '门店',
      userName: s.name || '',
      roleName: ROLE_NAME[s.role] || '商家'
    })
  },
  go(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  },
  goIdentity() {
    wx.navigateTo({ url: '/pages/identity/identity' })
  },
  async onSwitchConsumer() {
    try {
      wx.showLoading({ title: '切换中', mask: true })
      const data = await api.switchIdentity({ role: 'consumer' })
      store.applyAuthResult(data)
      wx.hideLoading()
      store.routeAfterLogin()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '失败', icon: 'none' })
    }
  },
  onLogout() {
    store.logout()
    store.enterAsGuest()
  }
})

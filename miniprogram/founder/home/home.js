const store = require('../../utils/store')
const api = require('../../utils/api')
const { ensureCloud } = require('../../utils/request')

Page({
  data: {
    name: '',
    metrics: {
      merchants: 0,
      users: 0,
      todayOrders: 0,
      pendingApplies: 0,
      pendingPartners: 0,
      pendingWithdraws: 0
    },
    todoTotal: 0,
    menus: [],
    loadError: ''
  },
  onLoad() {
    ensureCloud()
  },
  async onShow() {
    if (!store.ensureFounderOrRedirect()) return
    const s = store.getSession() || {}
    this.setData({ name: s.name || '创始人' })
    try {
      const dash = await api.founderOverview()
      this.setData({
        metrics: dash.metrics || this.data.metrics,
        todoTotal: dash.todoTotal || 0,
        menus: dash.menus || [],
        loadError: ''
      })
    } catch (e) {
      this.setData({ loadError: e.message || '加载失败' })
    }
  },
  go(e) {
    const url = e.currentTarget.dataset.url
    const title = e.currentTarget.dataset.title || ''
    if (!url) {
      wx.showModal({
        title: title || '完整运营台',
        content: '名单、权限、日志、积分池等完整能力请使用 Web 运营控制台。',
        showCancel: false
      })
      return
    }
    wx.navigateTo({ url })
  },
  async onSwitchConsumer() {
    wx.showLoading({ title: '切换中', mask: true })
    try {
      const data = await api.switchIdentity({ role: 'consumer' })
      store.applyAuthResult(data)
      wx.hideLoading()
      setTimeout(() => store.routeAfterLogin(), 300)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '切换失败', icon: 'none' })
    }
  },
  goIdentity() {
    wx.navigateTo({ url: '/pages/identity/identity' })
  },
  onLogout() {
    store.logout()
    store.enterAsGuest()
  }
})

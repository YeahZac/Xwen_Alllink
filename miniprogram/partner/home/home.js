const store = require('../../utils/store')
const api = require('../../utils/api')
const { ensureCloud } = require('../../utils/request')

Page({
  data: {
    name: '',
    shareCode: '',
    stats: {
      todayPts: 0,
      weekPts: 0,
      monthPts: 0,
      rewardedPoints: 0,
      cashValue: 0,
      withdrawPending: 0
    },
    menus: [],
    loadError: ''
  },
  onLoad() {
    ensureCloud()
  },
  async onShow() {
    if (!store.ensurePartnerOrRedirect()) return
    const s = store.getSession() || {}
    this.setData({ name: s.name || '合伙人' })
    try {
      const dash = await api.partnerDashboard()
      this.setData({
        shareCode: dash.shareCode || dash.personalCode || '',
        stats: dash.stats || this.data.stats,
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
      wx.showToast({ title: `${title || '功能'}暂请切商家身份使用`, icon: 'none' })
      return
    }
    wx.navigateTo({ url })
  },
  onWithdraw() {
    wx.showModal({
      title: '申请提现',
      editable: true,
      placeholderText: '输入提现积分数量',
      success: async (r) => {
        if (!r.confirm) return
        const amountPoints = Math.floor(Number(r.content) || 0)
        if (amountPoints < 1) {
          wx.showToast({ title: '请输入有效积分', icon: 'none' })
          return
        }
        try {
          wx.showLoading({ title: '提交中', mask: true })
          const res = await api.partnerWithdraw({ amountPoints })
          wx.hideLoading()
          wx.showModal({
            title: '已提交',
            content: res.remark || `申请 ${amountPoints} 积分提现，等待创始人审核`,
            showCancel: false
          })
          this.onShow()
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: e.message || '提交失败', icon: 'none' })
        }
      }
    })
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
    wx.reLaunch({ url: '/pages/login/login' })
  }
})

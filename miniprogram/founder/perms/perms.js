const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    summary: { partners: 0, founders: 0, merchants: 0 },
    rules: [],
    userId: '',
    loading: true
  },
  async onShow() {
    if (!store.ensureFounderOrRedirect()) return
    try {
      const res = await api.founderPerms()
      this.setData({
        summary: res.summary || this.data.summary,
        rules: res.rules || [],
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onUserId(e) {
    this.setData({ userId: e.detail.value })
  },
  async setFlag(e) {
    const flag = e.currentTarget.dataset.flag
    const value = Number(e.currentTarget.dataset.value) === 1
    const id = Math.floor(Number(this.data.userId) || 0)
    if (!id) {
      wx.showToast({ title: '请填写用户 ID', icon: 'none' })
      return
    }
    try {
      wx.showLoading({ title: '处理中', mask: true })
      await api.founderSetUserFlag(id, { flag, value })
      wx.hideLoading()
      wx.showToast({ title: '已更新', icon: 'success' })
      this.onShow()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  }
})

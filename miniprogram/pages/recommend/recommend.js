const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    code: '',
    bindCode: '',
    records: [],
    rules: [],
    bound: false,
    referrerName: '',
    referrerCode: '',
    stats: { invited: 0, rewardedPoints: 0 }
  },
  async onShow() {
    if (!store.ensureLoggedIn()) return
    try {
      const home = await api.referralHome()
      this.setData({
        code: home.shareCode || home.personalCode || '',
        records: (home.records || []).map((r, i) => ({
          id: r.id || i,
          name: r.name || '新用户',
          time: r.time ? String(r.time).replace('T', ' ').slice(0, 16) : '',
          triggerName: r.triggerName || '',
          reward: r.reward || 0
        })),
        rules: home.rules || [],
        bound: !!home.bound,
        referrerName: home.referrerName || '',
        referrerCode: home.referrerCode || '',
        stats: home.stats || { invited: 0, rewardedPoints: 0 }
      })
      if (home.shareCode) {
        const s = store.getSession() || {}
        s.inviteCode = home.shareCode
        store.setSession(s)
      }
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onInput(e) {
    this.setData({ bindCode: e.detail.value })
  },
  onCopy() {
    if (!this.data.code) return
    wx.setClipboardData({
      data: this.data.code,
      success: () => wx.showToast({ title: '推荐码已复制', icon: 'none' })
    })
  },
  async onBind() {
    if (!this.data.bindCode.trim()) {
      wx.showToast({ title: '请输入推荐码', icon: 'none' })
      return
    }
    try {
      await api.bindReferral(this.data.bindCode.trim())
      wx.showToast({ title: '已绑定', icon: 'success' })
      this.setData({ bindCode: '' })
      this.onShow()
    } catch (e) {
      wx.showToast({ title: e.message || '绑定失败', icon: 'none' })
    }
  },
  onShareAppMessage() {
    return {
      title: '万业互联云 · 用我的推荐码领积分',
      path: `/pages/login/login?ref=${this.data.code || ''}`
    }
  }
})

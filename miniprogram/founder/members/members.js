const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: { list: [], loading: true, q: '', role: '' },
  onShow() {
    if (!store.ensureFounderOrRedirect()) return
    this.load()
  },
  onQ(e) {
    this.setData({ q: e.detail.value })
  },
  onRole(e) {
    const role = e.currentTarget.dataset.role || ''
    this.setData({ role })
    this.load()
  },
  async load() {
    this.setData({ loading: true })
    try {
      const rows = await api.founderMembers({ q: this.data.q, role: this.data.role })
      this.setData({ list: rows || [], loading: false })
    } catch (e) {
      this.setData({ loading: false, list: [] })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onSearch() {
    this.load()
  }
})

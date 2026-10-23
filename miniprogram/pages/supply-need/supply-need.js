const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    goods: '',
    qty: '',
    when: '',
    note: '',
    submitting: false,
    loading: true,
    records: []
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    await this.loadRecords()
  },
  async loadRecords() {
    this.setData({ loading: true })
    try {
      const rows = await api.mySupplyNeeds()
      const statusLabel = { open: '待报价', quoted: '已报价', closed: '已关闭' }
      this.setData({
        loading: false,
        records: (rows || []).map((item) => ({
          ...item,
          statusText: statusLabel[item.status] || item.status,
          createdText: item.createdAt
            ? String(item.createdAt).replace('T', ' ').slice(0, 16)
            : ''
        }))
      })
    } catch (e) {
      this.setData({ loading: false })
    }
  },
  onGoods(e) {
    this.setData({ goods: e.detail.value })
  },
  onQty(e) {
    this.setData({ qty: e.detail.value })
  },
  onWhen(e) {
    this.setData({ when: e.detail.value })
  },
  onNote(e) {
    this.setData({ note: e.detail.value })
  },
  async submit() {
    if (this.data.submitting) return
    if (!this.data.goods.trim()) {
      wx.showToast({ title: '请填写品类', icon: 'none' })
      return
    }
    if (!this.data.qty.trim()) {
      wx.showToast({ title: '请填写预估数量', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await api.supplyNeed({
        goodsName: this.data.goods,
        qtyText: this.data.qty,
        expectTime: this.data.when,
        note: this.data.note
      })
      wx.showToast({ title: '需求已发布', icon: 'success' })
      this.setData({ goods: '', qty: '', when: '', note: '', submitting: false })
      await this.loadRecords()
    } catch (e) {
      this.setData({ submitting: false })
      wx.showToast({ title: e.message || '提交失败', icon: 'none' })
    }
  }
})

const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: { list: [], loading: true, form: { goodsName: '', qtyText: '', note: '' } },
  async onShow() {
    if (!store.ensurePartnerOrRedirect()) return
    try {
      const rows = await api.partnerPurchaseOrders()
      this.setData({ list: rows || [], loading: false })
    } catch (e) {
      this.setData({ loading: false, list: [] })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onField(e) {
    this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value })
  },
  async submit() {
    const form = this.data.form
    if (!String(form.goodsName || '').trim()) {
      wx.showToast({ title: '请填写采购品名', icon: 'none' })
      return
    }
    try {
      wx.showLoading({ title: '提交中', mask: true })
      await api.partnerSubmitPurchase(form)
      wx.hideLoading()
      wx.showToast({ title: '已提交', icon: 'success' })
      this.setData({ form: { goodsName: '', qtyText: '', note: '' } })
      this.onShow()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '失败', icon: 'none' })
    }
  }
})

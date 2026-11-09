const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    shopName: '',
    stateLabel: '',
    stateDesc: '',
    subMchId: '',
    ratePercent: 0,
    signUrl: '',
    mats: {},
    form: {
      bankName: '',
      bankAccountNo: '',
      bankAccountName: '',
      idCardNumber: '',
      idCardValidBegin: '',
      idCardValidEnd: ''
    }
  },
  onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    this.load()
  },
  async load() {
    this.setData({ loading: true })
    try {
      const d = await api.merchantWxSubStatus()
      const mats = d.materials || {}
      this.setData({
        loading: false,
        shopName: d.name || '',
        stateLabel: d.stateLabel || '未进件',
        stateDesc: d.wxApplyStateDesc || '',
        subMchId: d.wxSubMchId || '',
        ratePercent: d.profitSharePercent ?? 0,
        signUrl: d.wxSignUrl || '',
        mats,
        form: {
          bankName: mats.bankName || '',
          bankAccountNo: '',
          bankAccountName: mats.bankAccountName || '',
          idCardNumber: '',
          idCardValidBegin: mats.idCardValidBegin || '',
          idCardValidEnd: mats.idCardValidEnd || ''
        }
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onField(e) {
    const k = e.currentTarget.dataset.k
    this.setData({ [`form.${k}`]: e.detail.value })
  },
  async onSave() {
    try {
      wx.showLoading({ title: '保存中', mask: true })
      await api.merchantWxSubSettlement(this.data.form)
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      this.load()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    }
  },
  onRefresh() {
    this.load()
  },
  onCopySign() {
    const url = this.data.signUrl
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  }
})

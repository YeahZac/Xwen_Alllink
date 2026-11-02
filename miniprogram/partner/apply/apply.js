const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    form: {
      contactName: '',
      contactPhone: '',
      city: '',
      referrerCode: '',
      remark: ''
    },
    submitting: false
  },
  onLoad() {
    if (!store.ensureLoggedIn()) return
    const s = store.getSession() || {}
    this.setData({
      form: {
        contactName: s.name || '',
        contactPhone: s.phone || '',
        city: '',
        referrerCode: '',
        remark: ''
      }
    })
  },
  onField(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: e.detail.value })
  },
  async submit() {
    if (this.data.submitting) return
    const form = this.data.form
    if (!String(form.contactName || '').trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' })
      return
    }
    if (!/^1\d{10}$/.test(String(form.contactPhone || ''))) {
      wx.showToast({ title: '手机号不正确', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      const res = await api.submitPartnerApply(form)
      this.setData({ submitting: false })
      wx.showModal({
        title: '提交成功',
        content: `${res.applyNo || ''}\n${res.remark || '请等待审核'}`,
        showCancel: false,
        success: () => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) })
      })
    } catch (e) {
      this.setData({ submitting: false })
      wx.showToast({ title: e.message || '提交失败', icon: 'none' })
    }
  }
})

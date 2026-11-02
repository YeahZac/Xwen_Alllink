const store = require('../../utils/store')
const api = require('../../utils/api')

const ROLE_LABEL = {
  founder: '创始人',
  lead: '负责人'
}

Page({
  data: {
    applyRole: 'founder',
    roleLabel: '创始人',
    statusText: '',
    form: {
      contactName: '',
      contactPhone: '',
      city: '',
      remark: ''
    },
    submitting: false
  },
  onLoad(query) {
    if (!store.ensureLoggedIn()) return
    const role = ['founder', 'lead'].includes(query.role) ? query.role : 'founder'
    const s = store.getSession() || {}
    this.setData({
      applyRole: role,
      roleLabel: ROLE_LABEL[role] || role,
      form: {
        contactName: s.name || '',
        contactPhone: s.phone || '',
        city: '',
        remark: ''
      }
    })
    wx.setNavigationBarTitle({ title: `申请${ROLE_LABEL[role] || '身份'}` })
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
      const res = await api.submitIdentityRoleApply({
        applyRole: this.data.applyRole,
        ...form
      })
      this.setData({
        submitting: false,
        statusText: res.statusText || '审核中'
      })
      wx.showModal({
        title: '提交成功',
        content: `${res.applyNo || ''}\n状态：${res.statusText || '审核中'}\n${res.remark || ''}`,
        showCancel: false,
        success: () =>
          wx.navigateBack({
            fail: () => wx.navigateTo({ url: '/pages/identity/identity' })
          })
      })
    } catch (e) {
      this.setData({ submitting: false })
      wx.showToast({ title: e.message || '提交失败', icon: 'none' })
    }
  }
})
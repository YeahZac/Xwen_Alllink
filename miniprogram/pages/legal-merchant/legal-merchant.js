const api = require('../../utils/api')

Page({
  data: {
    title: '商户入驻平台协议',
    loading: true,
    paragraphs: []
  },
  onLoad(query) {
    const vars = {
      shopName: decodeURIComponent(query.shopName || ''),
      legalPerson: decodeURIComponent(query.legalPerson || ''),
      contactName: decodeURIComponent(query.contactName || ''),
      contactPhone: decodeURIComponent(query.contactPhone || ''),
      city: decodeURIComponent(query.city || ''),
      address: decodeURIComponent(query.address || ''),
      role: decodeURIComponent(query.role || ''),
      roleLabel: decodeURIComponent(query.roleLabel || ''),
      date: decodeURIComponent(query.date || '')
    }
    this.loadAgreement(vars)
  },
  async loadAgreement(vars) {
    try {
      wx.showLoading({ title: '加载协议…', mask: true })
      const data = await api.merchantAgreement(vars)
      const content = String((data && data.content) || '').trim()
      const paragraphs = content
        ? content.split(/\n/).map((line) => line)
        : ['协议暂时无法加载，请稍后重试']
      this.setData({
        title: (data && data.title) || '商户入驻平台协议',
        paragraphs,
        loading: false
      })
      wx.setNavigationBarTitle({ title: (data && data.title) || '入驻协议' })
    } catch (e) {
      this.setData({
        paragraphs: [e.message || '协议加载失败'],
        loading: false
      })
    } finally {
      wx.hideLoading()
    }
  }
})

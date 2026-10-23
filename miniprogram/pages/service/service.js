const store = require('../../utils/store')
const mock = require('../../utils/mock-fulfill')

const TONE = {
  red: 'm-row__seal--red',
  teal: 'm-row__seal--teal',
  gold: 'm-row__seal--gold',
  soft: 'm-row__seal--soft'
}

Page({
  data: {
    tip: '',
    hotline: '',
    workTime: '',
    channels: [],
    faqs: [],
    openFaq: -1
  },
  onShow() {
    if (!store.ensureLoggedIn()) return
    const s = mock.SERVICE
    this.setData({
      tip: s.tip,
      hotline: s.hotline,
      workTime: s.workTime,
      channels: (s.channels || []).map((c) => ({
        ...c,
        sealClass: TONE[c.tone] || ''
      })),
      faqs: s.faqs || []
    })
  },
  onChannel(e) {
    const id = e.currentTarget.dataset.id
    const ch = this.data.channels.find((c) => c.id === id)
    if (!ch) return
    if (ch.action === 'phone') {
      wx.makePhoneCall({ phoneNumber: String(this.data.hotline).replace(/\D/g, '') })
      return
    }
    if (ch.action === 'logistics') {
      wx.navigateTo({ url: '/pages/logistics/logistics' })
      return
    }
    if (ch.action === 'orders') {
      wx.navigateTo({ url: '/pages/orders/orders' })
      return
    }
    if (ch.action === 'contact') {
      // 由 wxml 的 open-type=contact 按钮承接；此处作兜底提示
      wx.showToast({ title: '请点「在线客服」按钮', icon: 'none' })
    }
  },
  toggleFaq(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    this.setData({ openFaq: this.data.openFaq === idx ? -1 : idx })
  },
  goConfirm() {
    wx.navigateTo({ url: '/pages/confirm-receipt/confirm-receipt' })
  },
  onFeedback() {
    wx.showModal({
      title: '留言给客服',
      editable: true,
      placeholderText: '描述问题，我们会尽快回复（演示）',
      success: (r) => {
        if (!r.confirm || !r.content) return
        wx.showToast({ title: '已提交，客服将跟进', icon: 'success' })
      }
    })
  }
})

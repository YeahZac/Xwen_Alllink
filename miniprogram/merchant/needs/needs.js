const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    list: [],
    loading: true
  },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    if (!store.requireRole('supply')) {
      wx.showToast({ title: '仅供应链角色可查看需求', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    this.setData({ loading: true })
    try {
      const rows = await api.merchantSupplyNeeds()
      this.setData({
        loading: false,
        list: (rows || []).map((item) => ({
          ...item,
          initial: (item.goodsName || '需').slice(0, 1),
          createdText: item.createdAt
            ? String(item.createdAt).replace('T', ' ').slice(0, 16)
            : '',
          qtyText: item.qtyText || '数量待沟通',
          expectTime: item.expectTime || '到货时间待沟通',
          statusText:
            item.status === 'quoted' ? '已报价' : item.status === 'closed' ? '已关闭' : '待报价',
          canQuote: item.status === 'open'
        }))
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onOpen(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find((row) => String(row.id) === String(id))
    if (!item) return
    const quoted =
      item.status === 'quoted'
        ? `\n报价：¥${item.quotePrice || '—'} ${item.quoteNote || ''}`
        : ''
    wx.showModal({
      title: item.goodsName,
      content: [
        `数量：${item.qtyText}`,
        `期望到货：${item.expectTime}`,
        item.note ? `说明：${item.note}` : '',
        item.createdText ? `发布时间：${item.createdText}` : '',
        quoted
      ]
        .filter(Boolean)
        .join('\n'),
      confirmText: item.canQuote ? '报价' : '知道了',
      cancelText: item.canQuote ? '关闭需求' : '',
      showCancel: !!item.canQuote,
      success: (r) => {
        if (item.canQuote && r.confirm) this.onQuote(id)
        else if (item.canQuote && r.cancel) this.onCloseNeed(id)
      }
    })
  },
  onQuote(id) {
    wx.showModal({
      title: '填写报价',
      editable: true,
      placeholderText: '报价金额（元）',
      confirmText: '提交',
      success: async (r) => {
        if (!r.confirm) return
        const quotePrice = Number(r.content)
        if (!Number.isFinite(quotePrice) || quotePrice < 0) {
          wx.showToast({ title: '请输入正确金额', icon: 'none' })
          return
        }
        try {
          await api.quoteSupplyNeed(id, { status: 'quoted', quotePrice })
          wx.showToast({ title: '已报价', icon: 'success' })
          this.onShow()
        } catch (e) {
          wx.showToast({ title: e.message || '失败', icon: 'none' })
        }
      }
    })
  },
  async onCloseNeed(id) {
    try {
      await api.quoteSupplyNeed(id, { status: 'closed' })
      wx.showToast({ title: '已关闭', icon: 'success' })
      this.onShow()
    } catch (e) {
      wx.showToast({ title: e.message || '失败', icon: 'none' })
    }
  }
})

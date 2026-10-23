const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: { list: [], title: '客户列表' },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    const title =
      s.role === 'supply' ? '客户门店' : s.role === 'cross' ? '客流与客户' : '客户列表'
    try {
      const rows = await api.merchantCustomers()
      this.setData({
        title,
        list: (rows || []).map((c) => {
          const orders = Number(c.orders || 0)
          const spend = Number(c.spend || 0)
          const typeLabel =
            c.type === 'stall' ? '地摊' : c.type === 'cross' ? '异业' : c.typeLabel || c.type || ''
          return {
            ...c,
            name: c.name || '客户',
            sub: [typeLabel, `${orders} 单`, `¥${spend.toFixed(0)}`]
              .filter(Boolean)
              .join(' · '),
            lastText: c.last ? String(c.last).replace('T', ' ').slice(0, 16) : ''
          }
        })
      })
      wx.setNavigationBarTitle({ title })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onOpen(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find((x) => String(x.id) === String(id))
    if (!item) return
    wx.showModal({
      title: item.name,
      content: `${item.sub}\n最近：${item.lastText || '—'}`,
      showCancel: false
    })
  }
})

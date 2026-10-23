const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    balance: 0,
    cashValue: '0.00',
    cashRateText: '',
    shopName: '',
    ledger: []
  },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    if (!store.requireRole(['stall', 'cross'])) {
      wx.showToast({ title: '当前身份没有积分额度池', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    const s = store.getSession()
    this.setData({ shopName: s.shopName || '本店' })
    try {
      const data = await api.merchantPool()
      this.setData({
        balance: data.balance || 0,
        cashValue: Number(data.cashValue || 0).toFixed(2),
        cashRateText: data.cashRate != null ? `1 积分额度 ≈ ¥${data.cashRate}` : '',
        ledger: (data.ledger || []).map((r) => {
          const change = Number(r.change != null ? r.change : 0)
          const up = change >= 0
          return {
            ...r,
            up,
            changeText: `${up ? '+' : ''}${change}`,
            time: r.time ? String(r.time).replace('T', ' ').slice(0, 19) : ''
          }
        })
      })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  goPurchase() {
    const role = store.getSession().role
    wx.navigateTo({ url: `/merchant/purchase/purchase?role=${role}` })
  }
})

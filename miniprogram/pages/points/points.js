const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    points: 0,
    cashValue: '0.00',
    cashRateText: '',
    ledger: [],
    loading: true
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    this.setData({ loading: true })
    try {
      const data = await api.myPoints()
      store.setConsumerPoints(data.points)
      this.setData({
        points: data.points,
        cashValue: Number(data.cashValue || 0).toFixed(2),
        cashRateText: `1 积分 = ¥${data.cashRate || store.getCashRate()}`,
        loading: false,
        ledger: (data.ledger || []).map((r) => {
          const change = Number(r.change != null ? r.change : r.changeAmount || 0)
          const up = change >= 0
          return {
            ...r,
            up,
            changeText: `${up ? '+' : ''}${change}`,
            cashText:
              r.cashValue != null
                ? `≈¥${Number(r.cashValue).toFixed(2)}`
                : '',
            timeText: r.time ? String(r.time).replace('T', ' ').slice(0, 19) : ''
          }
        })
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  goCross() {
    wx.switchTab({ url: '/pages/cross/cross' })
  }
})

const store = require('../../utils/store')
const api = require('../../utils/api')
const dataCache = require('../../utils/data-cache')

const CACHE_KEY = 'points:me'

function mapLedger(rows) {
  return (rows || []).map((r) => {
    const change = Number(r.change != null ? r.change : r.changeAmount || 0)
    const up = change >= 0
    return {
      ...r,
      up,
      changeText: `${up ? '+' : ''}${change}`,
      cashText: r.cashValue != null ? `≈¥${Number(r.cashValue).toFixed(2)}` : '',
      timeText: r.time ? String(r.time).replace('T', ' ').slice(0, 19) : ''
    }
  })
}

Page({
  data: {
    points: 0,
    cashValue: '0.00',
    cashRateText: '',
    ledger: [],
    loading: true,
    needLogin: false
  },
  async onShow() {
    // 未登录不强制弹登录；展示空态，由用户主动去登录
    if (!store.isLoggedIn()) {
      this.setData({
        loading: false,
        points: 0,
        cashValue: '0.00',
        cashRateText: '',
        ledger: [],
        needLogin: true
      })
      return
    }
    if (store.getSession() && store.getSession().role !== 'consumer') {
      store.routeAfterLogin()
      return
    }
    this.setData({ needLogin: false })
    const cached = dataCache.read(CACHE_KEY)
    if (cached && cached.data) {
      this.applyData(cached.data)
      if (cached.fresh) {
        this.fetch({ silent: true })
        return
      }
    } else {
      this.setData({ loading: true })
    }
    await this.fetch({ silent: false })
  },
  applyData(data) {
    store.setConsumerPoints(data.points)
    this.setData({
      points: data.points,
      cashValue: Number(data.cashValue || 0).toFixed(2),
      cashRateText: `1 积分 = ¥${Number(data.cashRate != null ? data.cashRate : store.getCashRate()).toFixed(2)}`,
      loading: false,
      ledger: mapLedger(data.ledger)
    })
  },
  async fetch({ silent }) {
    try {
      const data = await api.myPoints()
      dataCache.write(CACHE_KEY, data, dataCache.TTL.points)
      this.applyData(data)
    } catch (e) {
      this.setData({ loading: false })
      if (!silent && !this.data.ledger.length) {
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      }
    }
  },
  goCross() {
    wx.switchTab({ url: '/pages/cross/cross' })
  },
  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },
  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})

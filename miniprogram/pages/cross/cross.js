const store = require('../../utils/store')
const api = require('../../utils/api')
const location = require('../../utils/location')

Page({
  data: {
    stores: [],
    points: 0,
    cashValue: '0.00',
    loading: true
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    this.setData({ loading: true })
    try {
      const q = location.queryFromSaved()
      const [stores, pointsData] = await Promise.all([
        api.crossStores(q),
        api.myPoints().catch(() => ({ points: store.getConsumerPoints(), cashValue: 0 }))
      ])
      const points = pointsData.points != null ? pointsData.points : 0
      store.setConsumerPoints(points)
      this.setData({
        stores: location.decorateList(stores || []).map((s) => ({
          ...s,
          initial: s.initial || (s.name || '').slice(0, 1),
          coverImage: s.coverImage || '',
          metaText: [s.category, s.distance, s.city]
            .map((v) => String(v || '').trim())
            .filter((v, i, arr) => v && arr.indexOf(v) === i)
            .join(' · ')
        })),
        points,
        cashValue: Number(pointsData.cashValue != null ? pointsData.cashValue : store.pointsToCash(points)).toFixed(2),
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  openStore(e) {
    wx.navigateTo({
      url: `/pages/cross-detail/cross-detail?id=${e.currentTarget.dataset.id}`
    })
  }
})

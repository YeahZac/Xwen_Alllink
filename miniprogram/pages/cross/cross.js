const store = require('../../utils/store')
const api = require('../../utils/api')
const location = require('../../utils/location')
const dataCache = require('../../utils/data-cache')

Page({
  data: {
    stores: [],
    points: 0,
    cashValue: '0.00',
    loading: true
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect({ allowGuest: true })) return
    location.ensureDefaultLoc()
    const q = location.queryFromSaved()
    const cacheKey = `cross:${dataCache.homeKey(q)}`
    const cached = dataCache.read(cacheKey)
    if (cached && cached.data) {
      this.applyPayload(cached.data)
      if (cached.fresh) {
        this.fetchAndApply(q, cacheKey, { silent: true })
        return
      }
    } else {
      this.setData({ loading: true })
    }
    await this.fetchAndApply(q, cacheKey, { silent: false })
  },
  applyPayload(payload) {
    const points = payload.points != null ? payload.points : store.getConsumerPoints()
    store.setConsumerPoints(points)
    this.setData({
      stores: location.decorateList(payload.stores || []).map((s) => ({
        ...s,
        initial: s.initial || (s.name || '').slice(0, 1),
        coverImage: s.coverImage || '',
        metaText: [s.category || '异业', '异业', s.distance || s.city]
          .map((v) => String(v || '').trim())
          .filter((v, i, arr) => v && arr.indexOf(v) === i)
          .join(' · ')
      })),
      points,
      cashValue: Number(
        payload.cashValue != null ? payload.cashValue : store.pointsToCash(points)
      ).toFixed(2),
      loading: false
    })
  },
  async fetchAndApply(q, cacheKey, { silent }) {
    try {
      const loggedIn = store.isLoggedIn()
      const [stores, pointsData] = await Promise.all([
        api.crossStores(q),
        loggedIn
          ? api.myPoints().catch(() => ({ points: store.getConsumerPoints(), cashValue: 0 }))
          : Promise.resolve({ points: 0, cashValue: 0 })
      ])
      const payload = {
        stores: stores || [],
        points: pointsData.points != null ? pointsData.points : 0,
        cashValue: pointsData.cashValue
      }
      dataCache.write(cacheKey, payload, dataCache.TTL.crossStores)
      this.applyPayload(payload)
    } catch (e) {
      if (!silent && !this.data.stores.length) {
        this.setData({ loading: false })
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      } else {
        this.setData({ loading: false })
      }
    }
  },
  openStore(e) {
    wx.navigateTo({
      url: `/pages/cross-detail/cross-detail?id=${e.currentTarget.dataset.id}`
    })
  }
})

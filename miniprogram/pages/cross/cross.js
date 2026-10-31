const store = require('../../utils/store')
const api = require('../../utils/api')
const location = require('../../utils/location')
const dataCache = require('../../utils/data-cache')
const homePrefetch = require('../../utils/home-prefetch')

/** 分类页：合并异业 + 地摊，按 id 去重 */
function mergeRedeemStores(crossRows, stallRows) {
  const map = new Map()
  ;(crossRows || []).forEach((s) => {
    if (!s || s.id == null) return
    map.set(String(s.id), {
      ...s,
      role: s.role || 'cross',
      roleLabel: s.roleLabel || (s.role === 'stall' ? '点餐' : '兑换')
    })
  })
  ;(stallRows || []).forEach((s) => {
    if (!s || s.id == null) return
    const key = String(s.id)
    if (map.has(key)) return
    map.set(key, {
      ...s,
      role: 'stall',
      roleLabel: '点餐',
      category: s.category || s.tag || '餐饮'
    })
  })
  return Array.from(map.values())
}

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
    const cacheKey = `cross:all:${dataCache.homeKey(q)}`

    const cached = dataCache.read(cacheKey)
    if (cached && cached.data) {
      this.applyPayload(cached.data)
      if (cached.fresh) {
        this.fetchAndApply(q, cacheKey, { silent: true })
        return
      }
    } else {
      const home = homePrefetch.getPayload()
      if (home && (home.crossStores || home.stalls)) {
        this.applyPayload({
          stores: mergeRedeemStores(home.crossStores, home.stalls),
          points: home.points,
          cashValue: home.cashValue
        })
      } else {
        this.setData({ loading: true })
      }
    }
    await this.fetchAndApply(q, cacheKey, { silent: false })
  },
  applyPayload(payload) {
    const points = payload.points != null ? payload.points : store.getConsumerPoints()
    store.setConsumerPoints(points)
    const rows = payload.stores || []
    this.setData({
      stores: location.decorateList(rows).map((s) => {
        const role = s.role || 'cross'
        const roleLabel = s.roleLabel || (role === 'stall' ? '点餐' : '兑换')
        return {
          ...s,
          role,
          initial: s.initial || (s.name || '').slice(0, 1),
          coverImage: s.coverImage || '',
          // 文案不用「异业」字样
          metaText: [s.category || s.tag, roleLabel, s.distance || s.city]
            .map((v) => String(v || '').trim())
            .filter((v, i, arr) => v && arr.indexOf(v) === i)
            .join(' · ')
        }
      }),
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
      // 并行拉异业 + 地摊；不依赖后端 includeStall 是否已发布
      const [crossRows, stallRows, pointsData] = await Promise.all([
        api.crossStores({ ...q, includeStall: 1 }).catch(() => api.crossStores(q)),
        api.stalls(q).catch(() => []),
        loggedIn
          ? api.myPoints().catch(() => ({ points: store.getConsumerPoints(), cashValue: 0 }))
          : Promise.resolve({ points: 0, cashValue: 0 })
      ])
      const stores = mergeRedeemStores(crossRows, stallRows)
      const payload = {
        stores,
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
    const id = e.currentTarget.dataset.id
    const role = e.currentTarget.dataset.role
    if (role === 'stall') {
      wx.navigateTo({ url: `/pages/stall-menu/stall-menu?id=${id}` })
      return
    }
    wx.navigateTo({
      url: `/pages/cross-detail/cross-detail?id=${id}`
    })
  }
})

const store = require('../../utils/store')
const api = require('../../utils/api')
const location = require('../../utils/location')
const dataCache = require('../../utils/data-cache')
const coverPack = require('../../utils/cover-pack')

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

function storeCategoryName(s) {
  return String(s.bizType || s.category || s.tag || '').trim()
}

function decorateStore(s) {
  const role = s.role || 'cross'
  const roleLabel = s.roleLabel || (role === 'stall' ? '点餐' : '兑换')
  return {
    ...s,
    role,
    initial: s.initial || (s.name || '').slice(0, 1),
    coverImage: coverPack.resolveCover({
      ...s,
      role,
      bizType: s.bizType || s.category || s.tag
    }),
    metaText: [s.category || s.tag, roleLabel, s.distance || s.city]
      .map((v) => String(v || '').trim())
      .filter((v, i, arr) => v && arr.indexOf(v) === i)
      .join(' · ')
  }
}

Page({
  data: {
    view: 'categories',
    categories: [],
    selectedCategory: '',
    allStores: [],
    stores: [],
    points: 0,
    cashValue: '0.00',
    loading: true
  },
  onLoad() {
    this.setData({ loading: true, view: 'categories', stores: [], categories: [] })
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect({ allowGuest: true })) return
    location.ensureDefaultLoc()
    // 清掉旧演示缓存，避免清库后仍展示 bootstrap 门店
    try {
      const q = location.queryFromSaved()
      dataCache.remove(`cross:all:${dataCache.homeKey(q)}`)
    } catch (_) {
      /* ignore */
    }
    await this.loadPage()
  },
  async loadPage() {
    const q = location.queryFromSaved()
    this.setData({ loading: true })
    try {
      const loggedIn = store.isLoggedIn()
      const [categories, crossRows, stallRows, pointsData] = await Promise.all([
        api.goodsCategories('cross', { timeout: 15000 }).catch(() => []),
        api
          .crossStores({ ...q, includeStall: 1 }, { timeout: 25000 })
          .catch(() => api.crossStores(q, { timeout: 25000 }).catch(() => [])),
        api.stalls(q, { timeout: 25000 }).catch(() => []),
        loggedIn
          ? api.myPoints().catch(() => ({ points: store.getConsumerPoints(), cashValue: 0 }))
          : Promise.resolve({ points: 0, cashValue: 0 })
      ])
      const points = pointsData.points != null ? pointsData.points : 0
      store.setConsumerPoints(points)
      const allStores = location.decorateList(mergeRedeemStores(crossRows, stallRows)).map(decorateStore)
      const cats = (categories || [])
        .filter((c) => Number(c.status) !== 0)
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || Number(a.id) - Number(b.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          imageUrl: c.imageUrl || '',
          sortOrder: c.sortOrder,
          storeCount: allStores.filter((s) => storeCategoryName(s) === String(c.name)).length
        }))
      const patch = {
        categories: cats,
        allStores,
        points,
        cashValue: Number(
          pointsData.cashValue != null ? pointsData.cashValue : store.pointsToCash(points)
        ).toFixed(2),
        loading: false
      }
      if (this.data.view === 'stores' && this.data.selectedCategory) {
        patch.stores = allStores.filter(
          (s) => storeCategoryName(s) === String(this.data.selectedCategory)
        )
      } else {
        patch.view = 'categories'
        patch.selectedCategory = ''
        patch.stores = []
      }
      this.setData(patch)
    } catch (e) {
      this.setData({ loading: false, categories: [], allStores: [], stores: [] })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  openCategory(e) {
    const name = e.currentTarget.dataset.name
    if (!name) return
    const stores = (this.data.allStores || []).filter((s) => storeCategoryName(s) === String(name))
    this.setData({
      view: 'stores',
      selectedCategory: name,
      stores
    })
  },
  backToCategories() {
    this.setData({ view: 'categories', selectedCategory: '', stores: [] })
  },
  openStore(e) {
    const id = e.currentTarget.dataset.id
    const role = e.currentTarget.dataset.role
    if (role === 'stall') {
      wx.navigateTo({ url: `/pages/stall-menu/stall-menu?id=${id}` })
      return
    }
    wx.navigateTo({ url: `/pages/cross-detail/cross-detail?id=${id}` })
  }
})

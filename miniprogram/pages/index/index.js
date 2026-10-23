const store = require('../../utils/store')
const api = require('../../utils/api')
const location = require('../../utils/location')
const scan = require('../../utils/scan')
const navigate = require('../../utils/navigate')

function splitTags(raw, fallback) {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((t) => String(t).trim()).filter(Boolean).slice(0, 3)
  }
  const s = String(raw || '')
    .replace(/[|/、，,]/g, ' ')
    .trim()
  if (!s) return fallback || []
  return s.split(/\s+/).filter(Boolean).slice(0, 3)
}

/** 后端把 city 同时别名成 tag / distance / category，取值需跨槽位去重 */
function firstUnique(candidates, used) {
  for (const raw of candidates) {
    const s = String(raw || '').trim()
    if (!s || used.has(s)) continue
    used.add(s)
    return s
  }
  return ''
}

function uniqueTags(raw, fallback, used) {
  const tags = []
  for (const t of splitTags(raw, [])) {
    if (used.has(t)) continue
    used.add(t)
    tags.push(t)
  }
  if (tags.length) return tags
  return (fallback || []).filter((t) => !used.has(t))
}

function isDistanceText(v) {
  const s = String(v || '')
  return /\d/.test(s) && /(km|m|公里|米)/i.test(s)
}

const RETAIL_CATS = [
  { id: 'all', label: '全部' },
  { id: '餐饮', label: '餐饮' },
  { id: '鲜花', label: '鲜花' },
  { id: '蛋糕', label: '蛋糕' },
  { id: '百货商店', label: '百货' }
]

const CATEGORY_MAP = {
  stall: RETAIL_CATS,
  cross: RETAIL_CATS,
  supply: RETAIL_CATS
}

function cuisineOf(item) {
  const cat = String(item.category || item.tag || '').trim()
  if (['餐饮', '鲜花', '蛋糕', '百货商店'].includes(cat)) return cat
  const blob = `${item.name || ''} ${item.desc || ''} ${item.descLine || ''} ${cat}`
  if (/花|花艺|绿植|玫瑰/.test(blob)) return '鲜花'
  if (/蛋糕|烘焙|甜品|慕斯|芝士/.test(blob)) return '蛋糕'
  if (/百货|超市|便利|日用|洗护|零食/.test(blob)) return '百货商店'
  if (/餐|厨|食|饭|面|炒|套餐/.test(blob)) return '餐饮'
  return '餐饮'
}

Page({
  data: {
    headerTop: 92,
    userName: '',
    stalls: [],
    crossStores: [],
    supplyMerchants: [],
    tab: 'stall',
    points: 0,
    cashValue: '0.00',
    displayList: [],
    keyword: '',
    loading: false,
    loadHint: '',
    locationText: '定位中',
    locating: false,
    category: 'all',
    categories: CATEGORY_MAP.stall,
    sort: 'distance'
  },
  onLoad() {
    const sys = wx.getSystemInfoSync()
    const statusBarHeight = sys.statusBarHeight || 44
    let headerTop = statusBarHeight + 48
    try {
      const capsule = wx.getMenuButtonBoundingClientRect()
      if (capsule && capsule.bottom) headerTop = capsule.bottom + 8
    } catch (_) {}
    this.setData({ headerTop })
  },
  async onShow() {
    // 启动页已改为首页：先等自动登录，未登录再进登录页
    try {
      const app = getApp()
      if (app && app.globalData && app.globalData.bootPromise) {
        const boot = await app.globalData.bootPromise
        app.globalData.bootPromise = null
        if (boot && boot.ok && boot.session && boot.session.role && boot.session.role !== 'consumer') {
          store.routeAfterLogin()
          return
        }
      }
    } catch (_) {}
    if (!store.ensureConsumerOrRedirect()) return

    // 定位不阻塞列表：先出数，定位成功后再刷距离
    this._loadError = ''
    this.syncLocationText()
    this.reload()
    this.ensureLocation()
      .then((changed) => {
        if (changed) this.reload()
      })
      .catch(() => {})
  },
  geoQuery() {
    return location.queryFromSaved()
  },
  syncLocationText() {
    const loc = location.getSaved() || {}
    if (this.data.locating) {
      this.setData({ locationText: '定位中' })
      return
    }
    if (loc.lat == null) {
      this.setData({ locationText: '点击定位' })
      return
    }
    const label = loc.displayCity || loc.city || '当前位置'
    this.setData({ locationText: label })
  },
  async ensureLocation({ force = false } = {}) {
    // 有新鲜缓存：不亮「定位中」，后台也不重复打 GPS
    if (!force && location.isFresh(location.getSaved())) {
      this.setData({ locating: false })
      this.syncLocationText()
      return false
    }
    const hadCache = !!(location.getSaved() && location.getSaved().lat != null)
    // 已有旧坐标时不盖住文案，避免整页像卡住
    if (!hadCache) {
      this.setData({ locating: true })
      this.syncLocationText()
    }
    try {
      await location.locate(api, { force, highAccuracy: !!force })
      this.setData({ locating: false })
      this.syncLocationText()
      const loc = location.getSaved() || {}
      if (force && loc.inService === false) {
        wx.showToast({ title: '当前不在开通城市，已按距离展示附近门店', icon: 'none' })
      }
      return true
    } catch (e) {
      this.setData({ locating: false })
      this.syncLocationText()
      if (!location.getSaved()) {
        wx.showToast({ title: e.message || '定位失败', icon: 'none' })
      }
      throw e
    }
  },
  async reload() {
    const seq = (this._reloadSeq = (this._reloadSeq || 0) + 1)
    this.setData({ loading: true })
    try {
      const session = await store.refreshProfile().catch(() => store.getSession() || {})
      const q = this.geoQuery()
      const [stalls, crossStores, supplyMerchants, pointsData] = await Promise.all([
        api.stalls(q),
        api.crossStores(q),
        api.supplyMerchants(q).catch(() => []),
        api.myPoints().catch(() => ({ points: session.points || 0, cashValue: 0 }))
      ])
      if (seq !== this._reloadSeq) return
      this._loadError = ''
      api.trackVisit({
        roleScope: 'consumer',
        pageKey: 'index',
        city: q.city,
        latitude: q.lat,
        longitude: q.lng
      }).catch(() => {})
      const points = pointsData.points != null ? pointsData.points : store.getConsumerPoints()
      store.setConsumerPoints(points)
      this.syncLocationText()
      const decoratedStalls = location.decorateList(stalls || [])
      const decoratedCross = location.decorateList(crossStores || [])
      const decoratedSupply = location.decorateList(supplyMerchants || [])
      const tab = this.data.tab
      const displayList = this.computeDisplayList(tab, {
        stalls: decoratedStalls,
        crossStores: decoratedCross,
        supplyMerchants: decoratedSupply,
        keyword: this.data.keyword,
        category: this.data.category,
        sort: this.data.sort
      })
      this.setData({
        userName: session.name || '',
        stalls: decoratedStalls,
        crossStores: decoratedCross,
        supplyMerchants: decoratedSupply,
        points,
        cashValue: Number(pointsData.cashValue != null ? pointsData.cashValue : store.pointsToCash(points)).toFixed(2),
        displayList,
        loading: false,
        loadHint: displayList.length
          ? ''
          : this.data.category !== 'all' || this.data.keyword
            ? '当前筛选无结果，可点「全部」或清空搜索'
            : ''
      })
    } catch (e) {
      if (seq !== this._reloadSeq) return
      this._loadError = (e && e.message) || '加载失败'
      this.setData({
        loading: false,
        loadHint: this._loadError
      })
      wx.showToast({ title: this._loadError, icon: 'none' })
    }
  },
  computeDisplayList(tab, ctx) {
    const kw = String((ctx && ctx.keyword != null ? ctx.keyword : this.data.keyword) || '')
      .trim()
      .toLowerCase()
    const category = (ctx && ctx.category != null ? ctx.category : this.data.category) || 'all'
    const sort = (ctx && ctx.sort != null ? ctx.sort : this.data.sort) || 'distance'
    const stalls = (ctx && ctx.stalls) || this.data.stalls || []
    const crossStores = (ctx && ctx.crossStores) || this.data.crossStores || []
    const supplyMerchants = (ctx && ctx.supplyMerchants) || this.data.supplyMerchants || []
    let list = []
    if (tab === 'stall') {
      list = stalls.map((s) => {
        const used = new Set()
        const priceText = `月售 ${s.sales || 0}`
        used.add(priceText)
        const hint = s.address || s.city || ''
        used.add(hint)
        return {
          ...s,
          itemType: 'stall',
          initial: s.initial || (s.name || '摊').slice(0, 1),
          coverImage: s.coverImage || '',
          badge: s.open === false ? '休息中' : cuisineOf(s),
          rating: Number(s.rating || 4.8).toFixed(1),
          descLine: firstUnique([s.desc, s.category, cuisineOf(s)], used),
          distanceText: firstUnique([isDistanceText(s.distance) ? s.distance : ''], used),
          priceText,
          dealLine: '消费得积分 · 可兑鲜花蛋糕百货',
          tags: uniqueTags(s.tags || s.tag, [cuisineOf(s)], used),
          hint,
          cuisine: cuisineOf(s),
          salesNum: Number(s.sales || 0),
          ratingNum: Number(s.rating || 4.8),
          distanceKm: s.distanceKm == null ? null : Number(s.distanceKm),
          cta: '去点餐'
        }
      })
    } else if (tab === 'cross') {
      list = crossStores.map((s) => {
        const used = new Set()
        const priceText = '积分可兑'
        used.add(priceText)
        const hint = s.address || s.city || ''
        used.add(hint)
        return {
          ...s,
          itemType: 'cross',
          initial: s.initial || (s.name || '异').slice(0, 1),
          coverImage: s.coverImage || '',
          badge: cuisineOf(s),
          rating: Number(s.rating || 4.7).toFixed(1),
          descLine: firstUnique([s.category, cuisineOf(s)], used),
          distanceText: firstUnique([isDistanceText(s.distance) ? s.distance : ''], used),
          priceText,
          dealLine: '积分抵现 · 不够可补现金',
          tags: uniqueTags(s.tags || s.category, [cuisineOf(s), '可兑'], used),
          hint,
          cuisine: cuisineOf(s),
          salesNum: Number(s.sales || 0),
          ratingNum: Number(s.rating || 4.7),
          distanceKm: s.distanceKm == null ? null : Number(s.distanceKm),
          cta: '去兑换'
        }
      })
    } else {
      list = supplyMerchants.map((s) => {
        const used = new Set()
        const priceText = `在售 ${s.goodsCount || 0} SKU`
        used.add(priceText)
        const hint = s.address || s.city || ''
        used.add(hint)
        return {
          ...s,
          itemType: 'supply',
          initial: s.initial || (s.name || '供').slice(0, 1),
          coverImage: s.coverImage || '',
          badge: cuisineOf(s),
          rating: '',
          descLine: firstUnique([cuisineOf(s) + '供货', s.city], used),
          distanceText: firstUnique([isDistanceText(s.distance) ? s.distance : ''], used),
          priceText,
          dealLine: '批发配送 · 可提交采购需求',
          tags: uniqueTags(s.tags, [cuisineOf(s), '供货'], used),
          hint,
          cuisine: cuisineOf(s),
          salesNum: Number(s.goodsCount || 0),
          ratingNum: 0,
          distanceKm: s.distanceKm == null ? null : Number(s.distanceKm),
          cta: '提需求'
        }
      })
    }
    if (category && category !== 'all') {
      list = list.filter((s) => s.cuisine === category)
    }
    if (kw) {
      list = list.filter((s) => {
        const blob = `${s.name || ''} ${s.hint || ''} ${s.descLine || ''} ${(s.tags || []).join(' ')}`.toLowerCase()
        return blob.indexOf(kw) >= 0
      })
    }
    list = list.slice().sort((a, b) => {
      if (sort === 'rating') return (b.ratingNum || 0) - (a.ratingNum || 0)
      if (sort === 'sales') return (b.salesNum || 0) - (a.salesNum || 0)
      const da = a.distanceKm == null || Number.isNaN(a.distanceKm) ? Number.POSITIVE_INFINITY : a.distanceKm
      const db = b.distanceKm == null || Number.isNaN(b.distanceKm) ? Number.POSITIVE_INFINITY : b.distanceKm
      return da - db
    })
    return list
  },
  buildDisplayList(tab) {
    this.setData({ displayList: this.computeDisplayList(tab) })
  },
  onSort(e) {
    const sort = e.currentTarget.dataset.sort
    if (!sort || sort === this.data.sort) return
    this.setData({ sort })
    this.buildDisplayList(this.data.tab)
  },
  onTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.tab) return
    this.setData({
      tab,
      category: 'all',
      categories: CATEGORY_MAP[tab] || CATEGORY_MAP.stall
    })
    this.buildDisplayList(tab)
  },
  onCategory(e) {
    const id = e.currentTarget.dataset.id
    if (!id || id === this.data.category) return
    this.setData({ category: id })
    this.buildDisplayList(this.data.tab)
  },
  async onRelocate() {
    if (this.data.locating) return
    wx.showLoading({ title: '定位中' })
    await this.ensureLocation({ force: true })
    wx.hideLoading()
    await this.reload()
  },
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value || '' })
  },
  onSearchConfirm() {
    this.buildDisplayList(this.data.tab)
    if (!this.data.displayList.length) {
      wx.showToast({ title: '未找到相关门店', icon: 'none' })
    }
  },
  onScan() {
    wx.scanCode({
      scanType: ['qrCode'],
      success: (result) => {
        const stallId = scan.extractStallId(result)
        if (!stallId) {
          wx.showToast({ title: '未识别到有效摊位码', icon: 'none' })
          return
        }
        wx.navigateTo({ url: scan.scanPayUrl(stallId) })
      },
      fail: (error) => {
        if (String(error.errMsg || '').indexOf('cancel') < 0) {
          wx.showToast({ title: '扫码失败，请重试', icon: 'none' })
        }
      }
    })
  },
  openItem(e) {
    const { id, type } = e.currentTarget.dataset
    if (type === 'cross') {
      wx.navigateTo({ url: `/pages/cross-detail/cross-detail?id=${id}` })
    } else if (type === 'supply') {
      wx.navigateTo({ url: `/pages/supply-need/supply-need?vendorId=${id}` })
    } else {
      wx.navigateTo({ url: `/pages/stall-menu/stall-menu?id=${id}` })
    }
  },
  onNavigate(e) {
    navigate.openFromDataset(e.currentTarget.dataset, this.data.displayList)
  },
  goPoints() {
    wx.switchTab({ url: '/pages/points/points' })
  },
  goOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' })
  },
  goRecommend() {
    wx.navigateTo({ url: '/pages/recommend/recommend' })
  },
  goApply() {
    wx.navigateTo({ url: '/pages/apply/apply' })
  },
  goSupplyNeed() {
    wx.navigateTo({ url: '/pages/supply-need/supply-need' })
  }
})

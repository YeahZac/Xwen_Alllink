const store = require('../../utils/store')
const api = require('../../utils/api')
const location = require('../../utils/location')
const dataCache = require('../../utils/data-cache')
const homePrefetch = require('../../utils/home-prefetch')
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
    locationText: '深圳市宝安区沙井街道',
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
    // 默认沙井：文案 + 磁盘/内存缓存立刻上屏，绝不卡 GPS
    location.ensureDefaultLoc()
    const pre = homePrefetch.getPayload()
    const patch = {
      headerTop,
      locationText: location.displayDistrictName(location.getEffective()),
      locating: false
    }
    if (!pre) {
      patch.loading = true
      patch.loadHint = '正在加载附近门店…'
    }
    this.setData(patch)
    if (pre) {
      this.applyHomePayload(pre, store.getSession() || {})
    }
  },
  async onShow() {
    // 启动页=首页：游客可逛；仅商户身份才改道工作台
    try {
      const app = getApp()
      const guest = !!(app && app.globalData && app.globalData.preferGuest) ||
        !!(store.preferGuestBrowse && store.preferGuestBrowse())
      if (!guest && app && app.globalData && app.globalData.bootPromise) {
        // 不阻塞门店加载：会话路由与列表并行
        app.globalData.bootPromise
          .then((boot) => {
            app.globalData.bootPromise = null
            if (boot && boot.ok && boot.session && boot.session.role && boot.session.role !== 'consumer') {
              store.routeAfterLogin()
            }
          })
          .catch(() => {
            app.globalData.bootPromise = null
          })
      }
    } catch (_) {}
    if (!store.ensureConsumerOrRedirect({ allowGuest: true })) return
    if (store.isLoggedIn() && store.getSession() && store.getSession().role !== 'consumer') {
      store.routeAfterLogin()
      return
    }

    location.ensureDefaultLoc()
    this._loadError = ''
    this.syncLocationText()

    // 缓存命中立刻灌入；同时实时拉沙井/当前坐标列表（不等待定位）
    if (!this.data.displayList.length) {
      const cached = homePrefetch.getPayload()
      if (cached) {
        this.applyHomePayload(cached, store.getSession() || {})
      } else {
        this.setData({ loading: true, loadHint: '正在加载附近门店…' })
        // 后台等预取，但不串行挡住 reload
        homePrefetch.waitForData(2500).then((pre) => {
          if (pre && !this.data.displayList.length) {
            this.applyHomePayload(pre, store.getSession() || {})
          }
        })
      }
    }

    this.reload({ preferCache: true })
    // 仅已授权时后台校正真实位置；未授权继续用沙井默认
    this.ensureLocationSoft()
      .then((needReload) => {
        if (needReload) {
          homePrefetch.refreshWithQuery(this.geoQuery())
          this.reload({ preferCache: false })
        }
      })
      .catch(() => {})
  },
  /** 首进不强制要定位权限；已授权才静默同步真实位置 */
  async ensureLocationSoft() {
    if (location.isFresh(location.getSaved())) {
      this.setData({ locating: false })
      this.syncLocationText()
      return false
    }
    let auth
    try {
      auth = await location.getUserLocationAuth()
    } catch (_) {
      auth = undefined
    }
    // 未询问 / 已拒绝：保持沙井默认，等用户点「定位」再授权
    if (auth !== true) {
      this.setData({ locating: false })
      this.syncLocationText()
      return false
    }
    return this.ensureLocation({ force: false })
  },
  geoQuery() {
    return location.queryFromSaved()
  },
  syncLocationText() {
    const loc = location.getEffective() || {}
    if (loc.lat == null) {
      this.setData({ locationText: '点击定位' })
      return
    }
    // 顶栏固定区级名（如「深圳市宝安区」），禁止经纬度
    this.setData({ locationText: location.displayDistrictName(loc) })
  },
  _clearLocatingUiSoon(startedAt) {
    const elapsed = Date.now() - (startedAt || Date.now())
    const left = Math.max(0, location.UI_LOCATING_MS - elapsed)
    if (this._locatingUiTimer) clearTimeout(this._locatingUiTimer)
    this._locatingUiTimer = setTimeout(() => {
      if (this.data.locating) {
        this.setData({ locating: false })
        this.syncLocationText()
      }
    }, left)
  },
  _bindPendingLocate(pending, baseline) {
    if (!pending || typeof pending.then !== 'function') return
    const seq = (this._pendingLocSeq = (this._pendingLocSeq || 0) + 1)
    pending
      .then((real) => {
        if (seq !== this._pendingLocSeq) return
        const fin = location.finalizePending(baseline, real)
        this.setData({ locating: false })
        this.syncLocationText()
        if (fin.shouldReload) this.reload({ preferCache: false })
        else {
          // 位移不大：只重算距离文案
          this.applyHomePayload(
            {
              stalls: this.data.stalls,
              crossStores: this.data.crossStores,
              supplyMerchants: this.data.supplyMerchants,
              points: this.data.points,
              cashValue: this.data.cashValue
            },
            store.getSession() || {}
          )
        }
      })
      .catch(() => {
        if (seq !== this._pendingLocSeq) return
        this.setData({ locating: false })
        this.syncLocationText()
      })
  },
  applyHomePayload(payload, session) {
    const stalls = location.decorateList(payload.stalls || [])
    const crossStores = location.decorateList(payload.crossStores || [])
    const supplyMerchants = location.decorateList(payload.supplyMerchants || [])
    const points =
      payload.points != null ? payload.points : store.getConsumerPoints()
    if (payload.points != null) store.setConsumerPoints(points)
    const cashRaw =
      payload.cashValue != null ? payload.cashValue : store.pointsToCash(points)
    const tab = this.data.tab
    const displayList = this.computeDisplayList(tab, {
      stalls,
      crossStores,
      supplyMerchants,
      keyword: this.data.keyword,
      category: this.data.category,
      sort: this.data.sort
    })
    this.setData({
      userName: (session && session.name) || this.data.userName || '',
      stalls,
      crossStores,
      supplyMerchants,
      points,
      cashValue: Number(cashRaw).toFixed(2),
      displayList,
      loading: false,
      loadHint: displayList.length
        ? ''
        : this.data.category !== 'all' || this.data.keyword
          ? '当前筛选无结果，可点「全部」或清空搜索'
          : ''
    })
  },
  async ensureLocation({ force = false } = {}) {
    const cached = location.getSaved()
    if (!force && location.isFresh(cached)) {
      this.setData({ locating: false })
      this.syncLocationText()
      return false
    }

    // 先决定顶部文案：无可用真实点 / 手动刷新 → 短时「正在获取定位」
    const usable = !force && location.isUsable(cached)
    const startedAt = Date.now()
    if (force || !usable) {
      this.setData({ locating: true })
      this.syncLocationText()
      this._clearLocatingUiSoon(startedAt)
    } else {
      this.setData({ locating: false })
      this.syncLocationText()
    }

    try {
      const result = await location.locate(api, { force, highAccuracy: !!force })

      if (result.status === 'denied') {
        this.setData({ locating: false })
        this.syncLocationText()
        if (force) {
          wx.showModal({
            title: '需要定位权限',
            content: '开启定位后才能按你的真实位置展示附近门店',
            confirmText: '去开启',
            success: (r) => {
              if (r.confirm) wx.openSetting({})
            }
          })
        }
        return false
      }

      if (result.status === 'pending') {
        const baseline = result.loc || location.getEffective()
        this._bindPendingLocate(result.pending, baseline)
        return false
      }

      if (result.status === 'ok' || result.status === 'fresh') {
        this.setData({ locating: false })
        this.syncLocationText()
        if (force && result.loc && result.loc.inService === false) {
          wx.showToast({ title: '当前不在开通城市，已按距离展示附近门店', icon: 'none' })
        }
        return !!result.shouldReload
      }

      this.setData({ locating: false })
      this.syncLocationText()
      return false
    } catch (e) {
      this.setData({ locating: false })
      this.syncLocationText()
      if (force) {
        wx.showToast({ title: (e && e.message) || '定位失败', icon: 'none' })
      }
      return false
    }
  },
  async reload({ preferCache = false } = {}) {
    const seq = (this._reloadSeq = (this._reloadSeq || 0) + 1)
    const q = this.geoQuery()
    const cacheKey = dataCache.homeKey(q)
    const cached = dataCache.read(cacheKey)
    const sessionHint = store.getSession() || {}
    const origin = location.getEffective()

    if (preferCache && cached && cached.data) {
      this.applyHomePayload(cached.data, sessionHint)
      this.syncLocationText()
      location.setListOrigin(origin)
      if (cached.fresh) {
        this._silentRefresh(seq, q, cacheKey, sessionHint, origin)
        return
      }
    } else if (!this.data.displayList.length) {
      this.setData({ loading: true })
    }

    try {
      const loggedIn = store.isLoggedIn()
      // 游客不调需登录接口，避免 401 把人踢回登录页
      const session = loggedIn
        ? await store.refreshProfile().catch(() => sessionHint)
        : sessionHint
      const [stalls, crossStores, supplyMerchants, pointsData] = await Promise.all([
        api.stalls(q),
        api.crossStores(q),
        api.supplyMerchants(q).catch(() => []),
        loggedIn
          ? api.myPoints().catch(() => ({ points: session.points || 0, cashValue: 0 }))
          : Promise.resolve({ points: 0, cashValue: 0 })
      ])
      if (seq !== this._reloadSeq) return
      this._loadError = ''
      if (loggedIn) {
        api
          .trackVisit({
            roleScope: 'consumer',
            pageKey: 'index',
            city: q.city,
            latitude: q.lat,
            longitude: q.lng
          })
          .catch(() => {})
      }
      const payload = {
        stalls: stalls || [],
        crossStores: crossStores || [],
        supplyMerchants: supplyMerchants || [],
        points: pointsData.points != null ? pointsData.points : store.getConsumerPoints(),
        cashValue: pointsData.cashValue
      }
      dataCache.write(cacheKey, payload, dataCache.TTL.homeLists)
      location.setListOrigin(origin)
      this.syncLocationText()
      this.applyHomePayload(payload, session)
    } catch (e) {
      if (seq !== this._reloadSeq) return
      if (cached && cached.data && this.data.displayList.length) {
        this.setData({ loading: false })
        return
      }
      this._loadError = (e && e.message) || '加载失败'
      this.setData({
        loading: false,
        loadHint: this._loadError
      })
      wx.showToast({ title: this._loadError, icon: 'none' })
    }
  },
  async _silentRefresh(seq, q, cacheKey, sessionHint, origin) {
    try {
      const loggedIn = store.isLoggedIn()
      const session = loggedIn
        ? await store.refreshProfile().catch(() => sessionHint)
        : sessionHint
      const [stalls, crossStores, supplyMerchants, pointsData] = await Promise.all([
        api.stalls(q),
        api.crossStores(q),
        api.supplyMerchants(q).catch(() => []),
        loggedIn
          ? api.myPoints().catch(() => ({ points: session.points || 0, cashValue: 0 }))
          : Promise.resolve({ points: 0, cashValue: 0 })
      ])
      if (seq !== this._reloadSeq) return
      const payload = {
        stalls: stalls || [],
        crossStores: crossStores || [],
        supplyMerchants: supplyMerchants || [],
        points: pointsData.points != null ? pointsData.points : store.getConsumerPoints(),
        cashValue: pointsData.cashValue
      }
      dataCache.write(cacheKey, payload, dataCache.TTL.homeLists)
      location.setListOrigin(origin || location.getEffective())
      this.applyHomePayload(payload, session)
    } catch (_) {}
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
    wx.showLoading({ title: '正在获取定位' })
    try {
      await this.ensureLocation({ force: true })
      await this.reload({ preferCache: false })
    } finally {
      wx.hideLoading()
    }
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

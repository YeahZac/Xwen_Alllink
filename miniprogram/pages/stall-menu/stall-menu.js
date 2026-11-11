const store = require('../../utils/store')
const api = require('../../utils/api')
const scan = require('../../utils/scan')
const coverPack = require('../../utils/cover-pack')

function toId(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pickSelectedIds(selectedMap, groupId) {
  const raw = (selectedMap && (selectedMap[groupId] || selectedMap[String(groupId)])) || []
  return raw.map(toId).filter(Boolean)
}

function calcUnit(basePrice, basePts, groups, selectedMap) {
  let price = Number(basePrice) || 0
  let points = Number(basePts) || 0
  const names = []
  const optionIds = []
  ;(groups || []).forEach((g) => {
    const ids = pickSelectedIds(selectedMap, g.id)
    ;(g.options || []).forEach((o) => {
      if (ids.indexOf(toId(o.id)) >= 0) {
        const delta = Number(o.priceDelta)
        price += Number.isFinite(delta) && delta > 0 ? delta : 0
        names.push(o.name)
        optionIds.push(toId(o.id))
      }
    })
  })
  return {
    price: Math.round(price * 100) / 100,
    pointsGrant: Math.max(0, Math.floor(points)),
    optionsText: names.join(' / '),
    optionIds: optionIds.sort((a, b) => a - b)
  }
}

function buildFlags(selected) {
  const flags = {}
  Object.keys(selected || {}).forEach((gid) => {
    ;(selected[gid] || []).forEach((oid) => {
      flags[`${toId(gid)}_${toId(oid)}`] = true
    })
  })
  return flags
}

function defaultSelected(groups) {
  const map = {}
  ;(groups || []).forEach((g) => {
    const gid = toId(g.id)
    const defs = (g.options || []).filter((o) => o.isDefault).map((o) => toId(o.id)).filter(Boolean)
    if (defs.length) map[gid] = g.multiSelect ? defs : [defs[0]]
    else if (g.required && g.options && g.options[0]) map[gid] = [toId(g.options[0].id)]
    else map[gid] = []
  })
  return map
}

Page({
  data: {
    stallId: '',
    stall: {},
    categories: [],
    menu: [],
    cartMap: {},
    summary: { totalPrice: 0, totalPoints: 0, totalQty: 0 },
    fromScan: false,
    activeCat: '',
    sheetShow: false,
    sheetGoods: null,
    sheetSelected: {},
    sheetFlags: {},
    sheetUnit: { price: 0, pointsGrant: 0, optionsText: '' },
    sheetQty: 1,
    sheetRemark: '',
    sheetAllowRemark: true,
    sheetAdding: false,
    loading: true
  },
  preventMove() {},
  async onLoad(query) {
    const scene = require('../../utils/scene')
    const stallId = scene.merchantIdFromQuery(query)
    if (query && query.from === 'scan' && stallId) {
      wx.redirectTo({ url: scan.scanPayUrl(stallId) })
      return
    }
    try {
      scan.clearPendingPay()
    } catch (_) {}
    if (!store.ensureConsumerOrRedirect({ allowGuest: true, soft: true })) return
    if (!stallId) {
      wx.showToast({ title: '缺少门店', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 500)
      return
    }
    this.setData({ stallId, fromScan: false })
    await this.loadMenu()
  },
  async loadMenu() {
    try {
      wx.showLoading({ title: '加载中' })
      const data = await api.stallMenu(this.data.stallId)
      wx.hideLoading()
      const stallRaw = data.stall || {}
      const stall = {
        ...stallRaw,
        coverImage: coverPack.resolveCover({
          ...stallRaw,
          role: stallRaw.role || 'stall'
        })
      }
      const menu = data.menu || []
      const map = {}
      menu.forEach((g) => {
        const cat = g.category || '默认'
        if (!map[cat]) map[cat] = []
        map[cat].push(g)
      })
      const categories = Object.keys(map).map((name, index) => ({
        name,
        list: map[name],
        anchorId: `cat-${index}`
      }))
      this.setData({
        stall,
        menu,
        categories,
        activeCat: (categories[0] && categories[0].name) || '',
        loading: false
      })
      wx.setNavigationBarTitle({ title: stall.name || '点餐' })
      this.refreshCart()
      api.trackVisit({ roleScope: 'consumer', pageKey: 'stall-menu', merchantId: Number(this.data.stallId) }).catch(() => {})
    } catch (e) {
      wx.hideLoading()
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onCat(e) {
    const { name, anchor } = e.currentTarget.dataset
    this.setData({ activeCat: name })
    if (anchor && wx.pageScrollTo) {
      wx.pageScrollTo({ selector: `#${anchor}`, duration: 240 })
    }
  },
  onShow() {
    if (!store.ensureConsumerOrRedirect({ allowGuest: true, soft: true })) return
    this.refreshCart()
  },
  requireLoginForCheckout() {
    if (store.isLoggedIn() && store.getSession() && store.getSession().role === 'consumer') {
      return true
    }
    try {
      if (this.data.stallId) wx.setStorageSync('wy_pending_menu_stall', String(this.data.stallId))
    } catch (_) {}
    wx.showToast({ title: '请先登录后再结算', icon: 'none' })
    setTimeout(() => {
      wx.navigateTo({
        url: '/pages/login/login',
        fail: () => wx.reLaunch({ url: '/pages/login/login' })
      })
    }, 400)
    return false
  },
  afterCartChange(msg) {
    this.refreshCart()
    if (msg) wx.showToast({ title: msg, icon: 'success', duration: 800 })
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (_) {}
  },
  refreshCart() {
    const cart = store.getCart()
    const cartMap = {}
    if (String(cart.stallId) === String(this.data.stallId)) {
      cart.items.forEach((i) => {
        const k = i.lineKey || String(i.id)
        cartMap[k] = i.qty
        cartMap[i.id] = (cartMap[i.id] || 0) + Number(i.qty || 0)
      })
    }
    const summary =
      String(cart.stallId) === String(this.data.stallId)
        ? store.cartSummary(cart)
        : { totalPrice: 0, totalPoints: 0, totalQty: 0 }
    this.setData({ cartMap, summary })
  },
  findGoods(id) {
    const hit = (this.data.menu || []).find((g) => String(g.id) === String(id))
    if (hit) return hit
    for (const cat of this.data.categories || []) {
      const g = (cat.list || []).find((row) => String(row.id) === String(id))
      if (g) return g
    }
    return null
  },
  openSheet(goods) {
    const groups = (goods.optionGroups || []).map((g) => {
      const gid = toId(g.id)
      return {
        ...g,
        id: gid,
        required: !!(g.required === true || g.required === 1),
        multiSelect: !!(g.multiSelect === true || g.multiSelect === 1),
        minSelect: Number(g.minSelect) || 0,
        maxSelect: Number(g.maxSelect) || 1,
        options: (g.options || []).map((o) => {
          const oid = toId(o.id)
          const delta = Number(o.priceDelta)
          return {
            ...o,
            id: oid,
            isDefault: !!(o.isDefault === true || o.isDefault === 1),
            priceDelta: Number.isFinite(delta) && delta > 0 ? delta : 0,
            flagKey: `${gid}_${oid}`
          }
        })
      }
    })
    const goodsView = { ...goods, optionGroups: groups }
    const selected = defaultSelected(groups)
    const unit = calcUnit(goods.price, goods.pointsGrant, groups, selected)
    const allowRemark = goods.allowRemark == null ? true : !!goods.allowRemark
    this.setData({
      sheetShow: true,
      sheetGoods: goodsView,
      sheetSelected: selected,
      sheetFlags: buildFlags(selected),
      sheetUnit: unit,
      sheetQty: 1,
      sheetRemark: '',
      sheetAllowRemark: allowRemark,
      sheetAdding: false
    })
  },
  closeSheet() {
    this.setData({ sheetShow: false, sheetGoods: null, sheetRemark: '', sheetAdding: false })
  },
  onPickOpt(e) {
    const { gid, oid, multi } = e.currentTarget.dataset || {}
    const groupId = toId(gid)
    const optionId = toId(oid)
    if (!groupId || !optionId) return
    const selected = { ...(this.data.sheetSelected || {}) }
    let cur = pickSelectedIds(selected, groupId)
    if (Number(multi)) {
      const idx = cur.indexOf(optionId)
      if (idx >= 0) cur.splice(idx, 1)
      else cur.push(optionId)
    } else {
      cur = [optionId]
    }
    selected[groupId] = cur
    const g = this.data.sheetGoods
    if (!g) return
    const unit = calcUnit(g.price, g.pointsGrant, g.optionGroups, selected)
    this.setData({ sheetSelected: selected, sheetFlags: buildFlags(selected), sheetUnit: unit })
  },
  sheetQtyChange(e) {
    const d = Number((e.currentTarget.dataset || {}).d) || 0
    const q = Math.max(1, (this.data.sheetQty || 1) + d)
    this.setData({ sheetQty: q })
  },
  onSheetRemark(e) {
    this.setData({ sheetRemark: String((e.detail && e.detail.value) || '').slice(0, 50) })
  },
  validateSheet() {
    const g = this.data.sheetGoods
    if (!g) {
      wx.showToast({ title: '规格已关闭，请重试', icon: 'none' })
      return false
    }
    const selected = this.data.sheetSelected || {}
    for (const gr of g.optionGroups || []) {
      const n = pickSelectedIds(selected, gr.id).length
      const min = gr.required ? Math.max(1, Number(gr.minSelect) || 1) : Number(gr.minSelect) || 0
      const max = gr.multiSelect ? Number(gr.maxSelect) || 9 : 1
      if (n < min) {
        wx.showToast({ title: `请选择${gr.name || '规格'}`, icon: 'none' })
        return false
      }
      if (n > max) {
        wx.showToast({ title: `${gr.name || '规格'}最多选${max}项`, icon: 'none' })
        return false
      }
    }
    return true
  },
  confirmSheet() {
    if (this.data.sheetAdding) return
    if (!this.validateSheet()) return
    const g = this.data.sheetGoods
    const unit = this.data.sheetUnit || {}
    if (!this.data.stallId || !g || !g.id) {
      wx.showToast({ title: '门店或菜品异常，请返回重进', icon: 'none' })
      return
    }
    this.setData({ sheetAdding: true })
    try {
      store.addToCart(
        this.data.stallId,
        {
          id: g.id,
          name: g.name,
          price: unit.price,
          pointsGrant: unit.pointsGrant,
          pointsUsable: g.pointsUsable,
          mixEnabled: g.mixEnabled,
          optionsText: unit.optionsText || '',
          optionIds: unit.optionIds || [],
          remark: this.data.sheetAllowRemark ? this.data.sheetRemark : ''
        },
        this.data.sheetQty || 1
      )
      this.closeSheet()
      this.afterCartChange('已加入')
    } catch (err) {
      this.setData({ sheetAdding: false })
      wx.showToast({ title: (err && err.message) || '加入失败，请重试', icon: 'none' })
    }
  },
  inc(e) {
    const id = e.currentTarget.dataset.id
    const g = this.findGoods(id)
    if (!g) {
      wx.showToast({ title: '菜品加载异常，请下拉刷新', icon: 'none' })
      return
    }
    if (!this.data.stallId) {
      wx.showToast({ title: '缺少门店', icon: 'none' })
      return
    }
    const groups = g.optionGroups || []
    const allowRemark = g.allowRemark == null ? true : !!g.allowRemark
    // 有规格或允许备注时走弹层，保证口味/分量/数量/备注可配
    if (groups.length > 0 || allowRemark || g.needSheet) {
      this.openSheet(g)
      return
    }
    store.addToCart(this.data.stallId, g, 1)
    this.afterCartChange('已加入')
  },
  dec(e) {
    const id = e.currentTarget.dataset.id
    const cart = store.getCart()
    if (String(cart.stallId) !== String(this.data.stallId)) return
    const lines = cart.items.filter((i) => String(i.id) === String(id))
    if (!lines.length) return
    if (lines.length > 1 || (lines[0].optionIds && lines[0].optionIds.length) || lines[0].remark) {
      const last = lines[lines.length - 1]
      store.updateQty(last.lineKey || last.id, last.qty - 1)
    } else {
      store.updateQty(lines[0].lineKey || lines[0].id, lines[0].qty - 1)
    }
    this.afterCartChange()
  },
  goConfirm() {
    if (!this.data.summary.totalQty) {
      wx.showToast({ title: '请先选择菜品', icon: 'none' })
      return
    }
    if (!this.requireLoginForCheckout()) return
    wx.navigateTo({ url: '/pages/order-confirm/order-confirm' })
  }
})

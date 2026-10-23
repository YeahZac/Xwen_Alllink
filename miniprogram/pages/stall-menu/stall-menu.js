const store = require('../../utils/store')
const api = require('../../utils/api')
const scan = require('../../utils/scan')

function calcUnit(basePrice, basePts, groups, selectedMap) {
  let price = Number(basePrice) || 0
  let points = Number(basePts) || 0
  const names = []
  const optionIds = []
  ;(groups || []).forEach((g) => {
    const ids = selectedMap[g.id] || []
    ;(g.options || []).forEach((o) => {
      if (ids.indexOf(o.id) >= 0) {
        price += Number(o.priceDelta) || 0
        points += Number(o.pointsDelta) || 0
        names.push(o.name)
        optionIds.push(o.id)
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
      flags[`${gid}_${oid}`] = true
    })
  })
  return flags
}

function defaultSelected(groups) {
  const map = {}
  ;(groups || []).forEach((g) => {
    const defs = (g.options || []).filter((o) => o.isDefault).map((o) => o.id)
    if (defs.length) map[g.id] = g.multiSelect ? defs : [defs[0]]
    else if (g.required && g.options && g.options[0]) map[g.id] = [g.options[0].id]
    else map[g.id] = []
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
    loading: true
  },
  async onLoad(query) {
    if (query && query.from === 'scan' && query.id) {
      wx.redirectTo({ url: scan.scanPayUrl(query.id) })
      return
    }
    if (!store.ensureConsumerOrRedirect()) return
    const stallId = query.id
    if (!stallId) {
      wx.showToast({ title: '缺少门店', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 500)
      return
    }
    this.setData({ stallId, fromScan: query.from === 'scan' })
    await this.loadMenu()
  },
  async loadMenu() {
    try {
      wx.showLoading({ title: '加载中' })
      const data = await api.stallMenu(this.data.stallId)
      wx.hideLoading()
      const stall = data.stall || {}
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
    if (!store.ensureConsumerOrRedirect()) return
    this.refreshCart()
  },
  refreshCart() {
    const cart = store.getCart()
    const cartMap = {}
    if (String(cart.stallId) === String(this.data.stallId)) {
      cart.items.forEach((i) => {
        const k = i.lineKey || String(i.id)
        cartMap[k] = i.qty
        cartMap[i.id] = (cartMap[i.id] || 0) + i.qty
      })
    }
    const summary =
      String(cart.stallId) === String(this.data.stallId)
        ? store.cartSummary(cart)
        : { totalPrice: 0, totalPoints: 0, totalQty: 0 }
    this.setData({ cartMap, summary })
  },
  findGoods(id) {
    return (this.data.menu || []).find((g) => String(g.id) === String(id))
  },
  openSheet(goods) {
    const groups = (goods.optionGroups || []).map((g) => ({
      ...g,
      options: (g.options || []).map((o) => ({ ...o, flagKey: `${g.id}_${o.id}` }))
    }))
    const goodsView = { ...goods, optionGroups: groups }
    const selected = defaultSelected(groups)
    const unit = calcUnit(goods.price, goods.pointsGrant, groups, selected)
    this.setData({
      sheetShow: true,
      sheetGoods: goodsView,
      sheetSelected: selected,
      sheetFlags: buildFlags(selected),
      sheetUnit: unit,
      sheetQty: 1
    })
  },
  closeSheet() {
    this.setData({ sheetShow: false, sheetGoods: null })
  },
  onPickOpt(e) {
    const { gid, oid, multi } = e.currentTarget.dataset
    const groupId = Number(gid)
    const optionId = Number(oid)
    const selected = { ...(this.data.sheetSelected || {}) }
    let cur = (selected[groupId] || []).slice()
    if (Number(multi)) {
      const idx = cur.indexOf(optionId)
      if (idx >= 0) cur.splice(idx, 1)
      else cur.push(optionId)
    } else {
      cur = [optionId]
    }
    selected[groupId] = cur
    const g = this.data.sheetGoods
    const unit = calcUnit(g.price, g.pointsGrant, g.optionGroups, selected)
    this.setData({ sheetSelected: selected, sheetFlags: buildFlags(selected), sheetUnit: unit })
  },
  sheetQtyChange(e) {
    const d = Number(e.currentTarget.dataset.d) || 0
    const q = Math.max(1, (this.data.sheetQty || 1) + d)
    this.setData({ sheetQty: q })
  },
  validateSheet() {
    const g = this.data.sheetGoods
    const selected = this.data.sheetSelected || {}
    for (const gr of g.optionGroups || []) {
      const n = (selected[gr.id] || []).length
      const min = gr.required ? Math.max(1, gr.minSelect || 1) : gr.minSelect || 0
      const max = gr.multiSelect ? gr.maxSelect || 9 : 1
      if (n < min) {
        wx.showToast({ title: `请选择${gr.name}`, icon: 'none' })
        return false
      }
      if (n > max) {
        wx.showToast({ title: `${gr.name}最多选${max}项`, icon: 'none' })
        return false
      }
    }
    return true
  },
  confirmSheet() {
    if (!this.validateSheet()) return
    const g = this.data.sheetGoods
    const unit = this.data.sheetUnit
    store.addToCart(
      this.data.stallId,
      {
        id: g.id,
        name: g.name,
        price: unit.price,
        pointsGrant: unit.pointsGrant,
        optionsText: unit.optionsText,
        optionIds: unit.optionIds
      },
      this.data.sheetQty || 1
    )
    this.closeSheet()
    this.refreshCart()
  },
  inc(e) {
    const id = e.currentTarget.dataset.id
    const g = this.findGoods(id)
    if (!g) return
    if (g.hasOptions) {
      this.openSheet(g)
      return
    }
    store.addToCart(this.data.stallId, g, 1)
    this.refreshCart()
  },
  dec(e) {
    const id = e.currentTarget.dataset.id
    const cart = store.getCart()
    if (String(cart.stallId) !== String(this.data.stallId)) return
    const lines = cart.items.filter((i) => String(i.id) === String(id))
    if (!lines.length) return
    if (lines.length > 1 || (lines[0].optionIds && lines[0].optionIds.length)) {
      const last = lines[lines.length - 1]
      store.updateQty(last.lineKey || last.id, last.qty - 1)
    } else {
      store.updateQty(lines[0].lineKey || lines[0].id, lines[0].qty - 1)
    }
    this.refreshCart()
  },
  goConfirm() {
    if (!this.data.summary.totalQty) {
      wx.showToast({ title: '请先选择菜品', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/order-confirm/order-confirm' })
  }
})

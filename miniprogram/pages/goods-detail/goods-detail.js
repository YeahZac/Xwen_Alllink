const store = require('../../utils/store')
const api = require('../../utils/api')
const opts = require('../../utils/stall-options')

Page({
  data: {
    stallId: '',
    goodsId: '',
    stall: {},
    goods: null,
    optionGroups: [],
    selected: {},
    flags: {},
    unit: { price: 0, pointsGrant: 0, optionsText: '', optionIds: [] },
    qty: 1,
    demoSpecs: false,
    loading: true,
    adding: false
  },
  onLoad(query) {
    if (!store.ensureConsumerOrRedirect()) return
    const stallId = String((query && query.stallId) || '').trim()
    const goodsId = String((query && (query.goodsId || query.id)) || '').trim()
    if (!stallId || !goodsId) {
      wx.showToast({ title: '缺少商品信息', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 500)
      return
    }
    this.setData({ stallId, goodsId })
    this.load(stallId, goodsId)
  },
  async load(stallId, goodsId) {
    this.setData({ loading: true })
    try {
      const data = await api.stallMenu(stallId)
      const stall = data.stall || {}
      const menu = data.menu || []
      const goods = menu.find((g) => String(g.id) === String(goodsId))
      if (!goods) {
        this.setData({ loading: false, goods: null })
        wx.showToast({ title: '商品不存在或已下架', icon: 'none' })
        return
      }
      let demoSpecs = false
      let groups = goods.optionGroups || []
      if (!groups.length) {
        groups = opts.demoOptionGroups(goods.id)
        demoSpecs = true
      }
      groups = opts.decorateGroups(groups)
      const selected = opts.defaultSelected(groups)
      // 演示规格：界面可选，但计价与结算均按商品原价（无真实 optionId），避免购物车价 ≠ 实付
      const unit = demoSpecs
        ? {
            price: Number(goods.price) || 0,
            pointsGrant: Number(goods.pointsGrant) || 0,
            optionsText: opts.calcUnit(goods.price, goods.pointsGrant, groups, selected).optionsText,
            optionIds: []
          }
        : opts.calcUnit(goods.price, goods.pointsGrant, groups, selected)
      this.setData({
        loading: false,
        stall: {
          ...stall,
          initial: stall.initial || (stall.name || '摊').slice(0, 1)
        },
        goods,
        optionGroups: groups,
        selected,
        flags: opts.buildFlags(selected),
        unit,
        demoSpecs,
        qty: 1
      })
      wx.setNavigationBarTitle({ title: goods.name || '商品详情' })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },
  onPick(e) {
    const { gid, oid, multi } = e.currentTarget.dataset
    const groupId = Number(gid)
    const optionId = Number(oid)
    const selected = { ...(this.data.selected || {}) }
    let cur = (selected[groupId] || []).slice()
    if (Number(multi)) {
      const idx = cur.indexOf(optionId)
      if (idx >= 0) cur.splice(idx, 1)
      else cur.push(optionId)
    } else {
      cur = [optionId]
    }
    selected[groupId] = cur
    const g = this.data.goods
    const raw = opts.calcUnit(g.price, g.pointsGrant, this.data.optionGroups, selected)
    const unit = this.data.demoSpecs
      ? {
          price: Number(g.price) || 0,
          pointsGrant: Number(g.pointsGrant) || 0,
          optionsText: raw.optionsText,
          optionIds: []
        }
      : raw
    this.setData({
      selected,
      flags: opts.buildFlags(selected),
      unit
    })
  },
  changeQty(e) {
    const d = Number(e.currentTarget.dataset.d) || 0
    const qty = Math.max(1, Math.min(99, (this.data.qty || 1) + d))
    this.setData({ qty })
  },
  addCart() {
    if (this.data.adding || !this.data.goods) return
    const check = opts.validateSelected(this.data.optionGroups, this.data.selected)
    if (!check.ok) {
      wx.showToast({ title: check.message, icon: 'none' })
      return
    }
    const g = this.data.goods
    const unit = this.data.unit
    const demoSpecs = this.data.demoSpecs
    this.setData({ adding: true })
    store.addToCart(
      this.data.stallId,
      {
        id: g.id,
        name: g.name,
        price: unit.price,
        pointsGrant: unit.pointsGrant,
        optionsText: unit.optionsText,
        // 演示规格无真实 optionId，避免后端报「规格无效」
        optionIds: demoSpecs ? [] : unit.optionIds || []
      },
      this.data.qty || 1
    )
    this.setData({ adding: false })
    wx.showToast({
      title: demoSpecs ? '已加入购物车（演示规格）' : '已加入购物车',
      icon: 'success'
    })
    setTimeout(() => {
      wx.showActionSheet({
        itemList: ['继续点餐', '去结算'],
        success: (r) => {
          if (r.tapIndex === 1) {
            wx.navigateTo({ url: '/pages/order-confirm/order-confirm' })
          } else {
            wx.navigateBack({ fail: () => {} })
          }
        },
        fail: () => wx.navigateBack({ fail: () => {} })
      })
    }, 400)
  }
})

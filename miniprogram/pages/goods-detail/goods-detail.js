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
    // 分享进入可游客浏览；加购/结算仍由后续流程要求登录
    if (!store.ensureConsumerOrRedirect({ allowGuest: true, soft: true })) return
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
      // C 端只展示后台真实规格，不再注入演示规格
      const groups = opts.decorateGroups(goods.optionGroups || [])
      const selected = opts.defaultSelected(groups)
      const unit = opts.calcUnit(goods.price, goods.pointsGrant, groups, selected)
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
        demoSpecs: false,
        qty: 1
      })
      wx.setNavigationBarTitle({ title: goods.name || '商品详情' })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },
  onPick(e) {
    const { gid, oid, multi } = e.currentTarget.dataset || {}
    const groupId = Number(gid)
    const optionId = Number(oid)
    if (!groupId || !optionId) return
    const selected = { ...(this.data.selected || {}) }
    const prev = selected[groupId] || selected[String(groupId)] || []
    let cur = prev.map(Number).filter(Boolean)
    if (Number(multi)) {
      const idx = cur.indexOf(optionId)
      if (idx >= 0) cur.splice(idx, 1)
      else cur.push(optionId)
    } else {
      cur = [optionId]
    }
    selected[groupId] = cur
    const g = this.data.goods
    const unit = opts.calcUnit(g.price, g.pointsGrant, this.data.optionGroups, selected)
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
    if (!this.data.stallId) {
      wx.showToast({ title: '缺少门店信息', icon: 'none' })
      return
    }
    const check = opts.validateSelected(this.data.optionGroups, this.data.selected)
    if (!check.ok) {
      wx.showToast({ title: check.message || '请完善规格', icon: 'none' })
      return
    }
    const g = this.data.goods
    const unit = this.data.unit || {}
    this.setData({ adding: true })
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
          optionIds: unit.optionIds || []
        },
        this.data.qty || 1
      )
      wx.showToast({
        title: '已加入购物车',
        icon: 'success'
      })
      setTimeout(() => {
        this.setData({ adding: false })
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
    } catch (err) {
      this.setData({ adding: false })
      wx.showToast({ title: (err && err.message) || '加入失败，请重试', icon: 'none' })
    }
  }
})

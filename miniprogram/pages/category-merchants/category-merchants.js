const store = require('../../utils/store')
const api = require('../../utils/api')
const coverPack = require('../../utils/cover-pack')

Page({
  data: {
    categoryId: '',
    categoryName: '',
    roleLabel: '',
    goods: [],
    loading: true
  },
  onLoad(q) {
    const categoryId = String((q && q.id) || '')
    const categoryName = decodeURIComponent((q && q.name) || '')
    this.setData({ categoryId, categoryName })
    wx.setNavigationBarTitle({ title: categoryName || '类目商品' })
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect({ allowGuest: true })) return
    await this.loadGoods()
  },
  async loadGoods() {
    const id = this.data.categoryId
    if (!id) {
      this.setData({ loading: false, goods: [] })
      return
    }
    this.setData({ loading: true })
    try {
      const data = await api.categoryGoods(id, { limit: 100 }, { timeout: 25000 })
      const cat = (data && data.category) || {}
      const role = cat.role || 'cross'
      const list = ((data && data.list) || []).map((g) => {
        const itemRole = g.role || role
        let priceText = ''
        if (itemRole === 'cross') {
          const pts = g.pointsNeed != null ? `${g.pointsNeed} 积分` : ''
          const cash =
            g.cashPrice != null || g.price != null
              ? `¥${Number(g.cashPrice != null ? g.cashPrice : g.price).toFixed(2)}`
              : ''
          priceText = [pts, cash].filter(Boolean).join(' · ') || '兑换商品'
        } else if (g.price != null) {
          priceText = `¥${Number(g.price).toFixed(2)}`
        } else {
          priceText = '查看详情'
        }
        const coverImage =
          g.coverImage ||
          g.imageUrl ||
          coverPack.resolveCover({
            ...g,
            role: itemRole,
            name: g.shopName || g.name
          })
        return {
          ...g,
          role: itemRole,
          coverImage,
          initial: (g.name || g.shopName || '商').slice(0, 1),
          priceText,
          metaText: [g.shopName, g.city || g.address]
            .map((v) => String(v || '').trim())
            .filter((v, i, arr) => v && arr.indexOf(v) === i)
            .join(' · ')
        }
      })
      this.setData({
        loading: false,
        goods: list,
        categoryName: cat.name || this.data.categoryName,
        roleLabel: cat.roleLabel || ''
      })
      if (cat.name) wx.setNavigationBarTitle({ title: cat.name })
    } catch (e) {
      this.setData({ loading: false, goods: [] })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },
  openGoods(e) {
    const merchantId = e.currentTarget.dataset.merchantId
    const role = e.currentTarget.dataset.role
    if (!merchantId) return
    if (role === 'stall') {
      wx.navigateTo({ url: `/pages/stall-menu/stall-menu?id=${merchantId}` })
      return
    }
    if (role === 'supply') {
      wx.navigateTo({ url: `/pages/supply-need/supply-need?merchantId=${merchantId}` })
      return
    }
    wx.navigateTo({ url: `/pages/cross-detail/cross-detail?id=${merchantId}` })
  }
})

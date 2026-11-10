const store = require('../../utils/store')
const api = require('../../utils/api')
const coverPack = require('../../utils/cover-pack')

Page({
  data: {
    categoryId: '',
    categoryName: '',
    roleLabel: '',
    merchants: [],
    loading: true
  },
  onLoad(q) {
    const categoryId = String((q && q.id) || '')
    const categoryName = decodeURIComponent((q && q.name) || '')
    this.setData({ categoryId, categoryName })
    wx.setNavigationBarTitle({ title: categoryName || '类目商家' })
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect({ allowGuest: true })) return
    await this.loadMerchants()
  },
  async loadMerchants() {
    const id = this.data.categoryId
    if (!id) {
      this.setData({ loading: false, merchants: [] })
      return
    }
    this.setData({ loading: true })
    try {
      const data = await api.categoryMerchants(id, {}, { timeout: 25000 })
      const cat = (data && data.category) || {}
      const role = cat.role || 'cross'
      const seen = Object.create(null)
      const list = []
      for (const m of (data && data.list) || []) {
        const merchantId = Number(m.id || m.merchantId)
        if (!merchantId || seen[merchantId]) continue
        seen[merchantId] = true
        const itemRole = m.role || role
        const coverImage =
          m.coverImage ||
          m.coverUrl ||
          coverPack.resolveCover({
            ...m,
            role: itemRole,
            name: m.name || m.shopName
          })
        const goodsCount = Number(m.goodsCount) || 0
        list.push({
          ...m,
          merchantId,
          role: itemRole,
          coverImage,
          initial: String(m.name || m.shopName || m.initial || '商').slice(0, 1),
          name: m.name || m.shopName || '门店',
          countText: goodsCount > 0 ? `${goodsCount} 件在售` : '查看门店',
          metaText: [m.city, m.address || m.distanceText]
            .map((v) => String(v || '').trim())
            .filter((v, i, arr) => v && arr.indexOf(v) === i)
            .join(' · ')
        })
      }
      this.setData({
        loading: false,
        merchants: list,
        categoryName: cat.name || this.data.categoryName,
        roleLabel: cat.roleLabel || ''
      })
      if (cat.name) wx.setNavigationBarTitle({ title: cat.name })
    } catch (e) {
      this.setData({ loading: false, merchants: [] })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },
  openMerchant(e) {
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

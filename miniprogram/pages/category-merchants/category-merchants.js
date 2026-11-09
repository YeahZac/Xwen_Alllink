const store = require('../../utils/store')
const api = require('../../utils/api')
const location = require('../../utils/location')
const coverPack = require('../../utils/cover-pack')

Page({
  data: {
    categoryId: '',
    categoryName: '',
    roleLabel: '',
    stores: [],
    loading: true
  },
  onLoad(q) {
    const categoryId = String((q && q.id) || '')
    const categoryName = decodeURIComponent((q && q.name) || '')
    this.setData({ categoryId, categoryName })
    wx.setNavigationBarTitle({ title: categoryName || '关联商家' })
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect({ allowGuest: true })) return
    location.ensureDefaultLoc()
    await this.loadMerchants()
  },
  async loadMerchants() {
    const id = this.data.categoryId
    if (!id) {
      this.setData({ loading: false, stores: [] })
      return
    }
    this.setData({ loading: true })
    try {
      const q = location.queryFromSaved()
      const data = await api.categoryMerchants(id, q, { timeout: 25000 })
      const cat = (data && data.category) || {}
      const list = location.decorateList((data && data.list) || []).map((s) => {
        const role = s.role || cat.role || 'cross'
        const roleLabel = s.roleLabel || (role === 'stall' ? '点餐' : role === 'supply' ? '供货' : '兑换')
        return {
          ...s,
          role,
          initial: s.initial || (s.name || '').slice(0, 1),
          coverImage: coverPack.resolveCover({
            ...s,
            role,
            bizType: s.bizType || s.category || s.tag
          }),
          metaText: [s.category || s.tag || cat.name, roleLabel, s.distance || s.city]
            .map((v) => String(v || '').trim())
            .filter((v, i, arr) => v && arr.indexOf(v) === i)
            .join(' · ')
        }
      })
      this.setData({
        loading: false,
        stores: list,
        categoryName: cat.name || this.data.categoryName,
        roleLabel: cat.roleLabel || ''
      })
      if (cat.name) wx.setNavigationBarTitle({ title: cat.name })
    } catch (e) {
      this.setData({ loading: false, stores: [] })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },
  openStore(e) {
    const id = e.currentTarget.dataset.id
    const role = e.currentTarget.dataset.role
    if (!id) return
    if (role === 'stall') {
      wx.navigateTo({ url: `/pages/stall-menu/stall-menu?id=${id}` })
      return
    }
    if (role === 'supply') {
      wx.navigateTo({ url: `/pages/supply-need/supply-need?merchantId=${id}` })
      return
    }
    wx.navigateTo({ url: `/pages/cross-detail/cross-detail?id=${id}` })
  }
})

const store = require('../../utils/store')
const api = require('../../utils/api')

const ROLE_LABEL = {
  stall: '地摊',
  cross: '异业',
  supply: '供应链'
}

Page({
  data: {
    categories: [],
    points: 0,
    cashValue: '0.00',
    loading: true
  },
  onLoad() {
    this.setData({ loading: true, categories: [] })
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect({ allowGuest: true })) return
    await this.loadCategories()
  },
  async loadCategories() {
    this.setData({ loading: true })
    try {
      const loggedIn = store.isLoggedIn()
      const [categories, pointsData] = await Promise.all([
        api.goodsCategories('all', { timeout: 15000 }),
        loggedIn
          ? api.myPoints().catch(() => ({ points: store.getConsumerPoints(), cashValue: 0 }))
          : Promise.resolve({ points: 0, cashValue: 0 })
      ])
      const points = pointsData.points != null ? pointsData.points : 0
      store.setConsumerPoints(points)
      const cats = (Array.isArray(categories) ? categories : [])
        .filter((c) => Number(c.status) !== 0)
        .sort(
          (a, b) =>
            Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || Number(a.id) - Number(b.id)
        )
        .map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          roleLabel: c.roleLabel || ROLE_LABEL[c.role] || c.role,
          imageUrl: c.imageUrl || '',
          sortOrder: c.sortOrder
        }))
      this.setData({
        categories: cats,
        points,
        cashValue: Number(
          pointsData.cashValue != null ? pointsData.cashValue : store.pointsToCash(points)
        ).toFixed(2),
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false, categories: [] })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },
  openCategory(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || ''
    if (!id) return
    wx.navigateTo({
      url: `/pages/category-merchants/category-merchants?id=${id}&name=${encodeURIComponent(name)}`
    })
  }
})

const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    role: '',
    title: '',
    list: [],
    loading: true
  },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    this.setData({ loading: true })
    try {
      const rows = await api.merchantGoods()
      let list = []
      let title = '商品管理'
      if (s.role === 'stall') {
        title = '销售商品管理'
        list = (rows || []).map((g) => ({
          ...g,
          coverImage: g.imageUrl || '',
          line: `¥${g.price} · 划拨 ${g.pointsGrant} 积分 · 销量 ${g.sales || 0}`,
          status: g.onSale ? '在售' : '下架'
        }))
      } else if (s.role === 'cross') {
        title = '门店商品 / 积分价'
        list = (rows || []).map((g) => ({
          ...g,
          coverImage: g.imageUrl || '',
          line: `${g.pointsNeed} 积分 或 ¥${g.cashPrice} · ${g.allowMix === 0 ? '不支持组合' : '可组合支付'} · 销量 ${g.sales || 0}`,
          status: g.onSale ? '在售' : '下架'
        }))
      } else {
        title = '供货商品管理'
        list = (rows || []).map((g) => ({
          ...g,
          coverImage: g.imageUrl || '',
          line: `¥${g.price} · 买方获额 +${g.pointsGrant}`,
          status: `库存 ${g.stock}`
        }))
      }
      this.setData({ role: s.role, title, list, loading: false })
      wx.setNavigationBarTitle({ title })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onAdd() {
    wx.navigateTo({ url: '/merchant/goods-edit/goods-edit' })
  },
  onFullEdit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/merchant/goods-edit/goods-edit?id=${id}` })
  },
  async onEdit(e) {
    const id = e.currentTarget.dataset.id
    const g = this.data.list.find((x) => String(x.id) === String(id))
    if (!g) return
    const next = g.onSale ? 0 : 1
    try {
      await this.saveGoods(g, { onSale: next, status: next })
      wx.showToast({ title: next ? '已上架' : '已下架', icon: 'success' })
      this.onShow()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },
  onPrice(e) {
    const id = e.currentTarget.dataset.id
    const g = this.data.list.find((x) => String(x.id) === String(id))
    if (!g) return
    const role = this.data.role
    const field = role === 'cross' ? 'cashPrice' : 'price'
    const label = role === 'cross' ? '现金价' : role === 'supply' ? '供货价' : '销售价'
    wx.showModal({
      title: `修改${label}`,
      editable: true,
      placeholderText: `当前 ¥${Number(g[field] || 0).toFixed(2)}`,
      confirmText: '保存',
      success: async (result) => {
        if (!result.confirm) return
        const price = Number(result.content)
        if (!Number.isFinite(price) || price < 0) {
          wx.showToast({ title: '请输入正确的价格', icon: 'none' })
          return
        }
        try {
          await this.saveGoods(g, { [field]: price })
          wx.showToast({ title: '价格已更新', icon: 'success' })
          this.onShow()
        } catch (err) {
          wx.showToast({ title: err.message || '保存失败', icon: 'none' })
        }
      }
    })
  },
  onPoints(e) {
    const id = e.currentTarget.dataset.id
    const g = this.data.list.find((x) => String(x.id) === String(id))
    if (!g) return
    wx.showModal({
      title: '修改所需积分',
      editable: true,
      placeholderText: `当前 ${g.pointsNeed || 0} 积分`,
      confirmText: '保存',
      success: async (result) => {
        if (!result.confirm) return
        const pointsNeed = Number(result.content)
        if (!Number.isFinite(pointsNeed) || pointsNeed < 0) {
          wx.showToast({ title: '请输入正确的积分', icon: 'none' })
          return
        }
        try {
          await this.saveGoods(g, { pointsNeed })
          wx.showToast({ title: '积分价已更新', icon: 'success' })
          this.onShow()
        } catch (err) {
          wx.showToast({ title: err.message || '保存失败', icon: 'none' })
        }
      }
    })
  },
  async onOptions(e) {
    const id = e.currentTarget.dataset.id
    const g = this.data.list.find((x) => String(x.id) === String(id))
    if (!g) return
    try {
      wx.showLoading({ title: '加载规格' })
      const groups = await api.merchantGoodsOptions(id)
      wx.hideLoading()
      const summary = (groups || [])
        .map((gr) => `${gr.name}：${(gr.options || []).map((o) => o.name).join(' / ') || '空'}`)
        .join('\n')
      wx.showModal({
        title: `${g.name} · 规格`,
        content: summary || '尚未配置规格。可一键写入默认「口味」组（微辣/中辣/特辣）。',
        confirmText: groups && groups.length ? '知道了' : '写入默认',
        cancelText: '关闭',
        success: async (r) => {
          if (!r.confirm || (groups && groups.length)) return
          try {
            await api.saveMerchantGoodsOptions(id, [
              {
                name: '口味',
                type: 'flavor',
                required: true,
                multiSelect: false,
                minSelect: 1,
                maxSelect: 1,
                options: [
                  { name: '微辣', priceDelta: 0, isDefault: 1 },
                  { name: '中辣', priceDelta: 0 },
                  { name: '特辣', priceDelta: 1 }
                ]
              }
            ])
            wx.showToast({ title: '规格已写入', icon: 'success' })
          } catch (err) {
            wx.showToast({ title: err.message || '保存失败', icon: 'none' })
          }
        }
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },
  saveGoods(g, patch) {
    return api.saveMerchantGoods({
      id: g.id,
      merchantId: store.getSession().merchantId,
      name: g.name,
      price: g.price,
      cashPrice: g.cashPrice,
      pointsNeed: g.pointsNeed,
      pointsGrant: g.pointsGrant,
      stock: g.stock,
      onSale: g.onSale,
      status: g.status,
      imageUrl: g.imageUrl,
      category: g.category,
      description: g.description,
      pointsRatio: g.pointsRatio,
      ...patch
    })
  }
})

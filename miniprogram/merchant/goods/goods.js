const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    role: '',
    title: '',
    shopName: '',
    shopHint: '',
    list: [],
    loading: true
  },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    const shopName = s.shopName || s.merchantName || ''
    this.setData({ loading: true, shopName })
    try {
      const rows = await api.merchantGoods()
      let list = []
      let title = '本店商品'
      let shopHint = shopName
        ? `当前门店：${shopName}（ID ${s.merchantId || '-'}）· 仅管理本店商品`
        : `当前门店 ID ${s.merchantId || '-'} · 仅管理本店商品`
      if (s.role === 'stall') {
        title = '本店点餐商品'
        list = (rows || []).map((g) => {
          const optN = Number(g.optionGroupCount || 0)
          return {
            ...g,
            onSale: g.onSale ? 1 : 0,
            coverImage: g.imageUrl || '',
            line: `SKU ${g.sku || '—'} · ¥${g.price} · 可用${g.pointsUsable || 0}积分 · 分出 ${
              g.pointsGrant || 0
            } · ${optN > 0 ? `规格${optN}组` : '未配规格'} · 销量 ${g.sales || 0}`,
            statusLabel: g.onSale ? '在售' : '下架'
          }
        })
      } else if (s.role === 'cross') {
        title = '本店兑换商品'
        list = (rows || []).map((g) => ({
          ...g,
          onSale: g.onSale ? 1 : 0,
          coverImage: g.imageUrl || '',
          line: `SKU ${g.sku || '—'} · ${g.pointsNeed} 积分 或 ¥${g.cashPrice} · ${
            g.allowMix === 0 ? '不支持组合' : '可组合支付'
          } · 销量 ${g.sales || 0}`,
          statusLabel: g.onSale ? '在售' : '下架'
        }))
      } else {
        title = '本店供货商品'
        list = (rows || []).map((g) => ({
          ...g,
          onSale: g.onSale ? 1 : 0,
          coverImage: g.imageUrl || '',
          line: `SKU ${g.sku || '—'} · ¥${g.price} · 买方获额 +${g.pointsGrant} · 库存 ${g.stock}`,
          statusLabel: g.onSale ? '在售' : '下架'
        }))
      }
      this.setData({ role: s.role, title, shopHint, list, loading: false })
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
  onPointsGrant(e) {
    const id = e.currentTarget.dataset.id
    const g = this.data.list.find((x) => String(x.id) === String(id))
    if (!g) return
    wx.showModal({
      title: '修改消费赠积分',
      editable: true,
      placeholderText: `当前赠 ${g.pointsGrant || 0} 积分`,
      confirmText: '保存',
      success: async (result) => {
        if (!result.confirm) return
        const pointsGrant = Number(result.content)
        if (!Number.isFinite(pointsGrant) || pointsGrant < 0) {
          wx.showToast({ title: '请输入正确的积分', icon: 'none' })
          return
        }
        try {
          await this.saveGoods(g, { pointsGrant: Math.floor(pointsGrant) })
          wx.showToast({ title: '赠分已更新', icon: 'success' })
          this.onShow()
        } catch (err) {
          wx.showToast({ title: err.message || '保存失败', icon: 'none' })
        }
      }
    })
  },
  onPointsUsable(e) {
    const id = e.currentTarget.dataset.id
    const g = this.data.list.find((x) => String(x.id) === String(id))
    if (!g) return
    wx.showModal({
      title: '修改可用积分',
      editable: true,
      placeholderText: `当前可用 ${g.pointsUsable || 0}（抵现上限/件）`,
      confirmText: '保存',
      success: async (result) => {
        if (!result.confirm) return
        const pointsUsable = Number(result.content)
        if (!Number.isFinite(pointsUsable) || pointsUsable < 0) {
          wx.showToast({ title: '请输入正确的积分', icon: 'none' })
          return
        }
        try {
          await this.saveGoods(g, { pointsUsable: Math.floor(pointsUsable) })
          wx.showToast({ title: '可用积分已更新', icon: 'success' })
          this.onShow()
        } catch (err) {
          wx.showToast({ title: err.message || '保存失败', icon: 'none' })
        }
      }
    })
  },
  onDelete(e) {
    const id = e.currentTarget.dataset.id
    const g = this.data.list.find((x) => String(x.id) === String(id))
    if (!g) return
    wx.showModal({
      title: '删除商品',
      content: `确认删除「${g.name}」？删除后不可恢复。`,
      confirmColor: '#ff4d4f',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.deleteMerchantGoods(id)
          wx.showToast({ title: '已删除', icon: 'success' })
          this.onShow()
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      }
    })
  },
  onOptions(e) {
    const id = e.currentTarget.dataset.id
    const g = this.data.list.find((x) => String(x.id) === String(id))
    if (!g) return
    wx.navigateTo({
      url: `/merchant/goods-options/goods-options?id=${id}&name=${encodeURIComponent(g.name || '')}`
    })
  },
  saveGoods(g, patch) {
    // 快捷改积分/价格/上下架：走 PATCH，只改字段，绝不整单重提（避免丢 id 后误新建、品名被污染）
    const body = { ...patch }
    if (body.onSale != null && body.status == null) body.status = body.onSale
    return api.patchMerchantGoods(g.id, body)
  }
})

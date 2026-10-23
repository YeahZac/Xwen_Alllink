const store = require('../../utils/store')
const api = require('../../utils/api')

const CATS = {
  stall: ['餐饮', '鲜花', '蛋糕', '百货商店'],
  cross: ['餐饮', '鲜花', '蛋糕', '百货商店'],
  supply: ['餐饮', '鲜花', '蛋糕', '百货商店']
}
const UNITS = ['份', '件', '束', '盒', '袋', '箱']

Page({
  data: {
    role: '',
    goodsId: '',
    saving: false,
    catOptions: [],
    unitOptions: UNITS,
    form: {
      name: '',
      sku: '',
      category: '',
      unit: '份',
      description: '',
      imageUrl: '',
      price: '',
      cashPrice: '',
      pointsNeed: '',
      pointsGrant: '',
      pointsRatio: '',
      stock: '9999',
      onSale: 1,
      mixEnabled: 1,
      allowMix: 1
    }
  },
  async onLoad(q) {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    const role = s.role
    const cats = CATS[role] || CATS.stall
    const form = {
      ...this.data.form,
      category: cats[0],
      unit: '份',
      stock: role === 'supply' ? '0' : '9999'
    }
    this.setData({ role, catOptions: cats, form })
    wx.setNavigationBarTitle({ title: q.id ? '编辑商品' : '添加商品' })
    if (!q.id) return
    this.setData({ goodsId: String(q.id) })
    try {
      wx.showLoading({ title: '加载中' })
      const g = await api.merchantGoodsDetail(q.id)
      wx.hideLoading()
      this.setData({
        form: {
          name: g.name || '',
          sku: g.sku || '',
          category: g.category || cats[0],
          unit: g.unit || '份',
          description: g.description || g.desc || '',
          imageUrl: g.imageUrl || '',
          price: g.price != null ? String(g.price) : '',
          cashPrice: g.cashPrice != null ? String(g.cashPrice) : '',
          pointsNeed: g.pointsNeed != null ? String(g.pointsNeed) : '',
          pointsGrant: g.pointsGrant != null ? String(g.pointsGrant) : '',
          pointsRatio: g.pointsRatio || '',
          stock: g.stock != null ? String(g.stock) : form.stock,
          onSale: g.onSale === 0 ? 0 : 1,
          mixEnabled: g.mixEnabled === 0 ? 0 : 1,
          allowMix: g.allowMix === 0 ? 0 : 1
        }
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onField(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: e.detail.value })
  },
  onCat(e) {
    const idx = Number(e.detail.value)
    this.setData({ 'form.category': this.data.catOptions[idx] || this.data.form.category })
  },
  onUnit(e) {
    const idx = Number(e.detail.value)
    this.setData({ 'form.unit': this.data.unitOptions[idx] || this.data.form.unit })
  },
  toggle(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: this.data.form[key] ? 0 : 1 })
  },
  async onPickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        try {
          wx.showLoading({ title: '压缩上传中' })
          const up = await api.uploadFile(path, 'goods')
          wx.hideLoading()
          this.setData({ 'form.imageUrl': up.fileUrl || path })
        } catch (err) {
          wx.hideLoading()
          this.setData({ 'form.imageUrl': path })
          wx.showToast({ title: err.message || '已选图，稍后可再传', icon: 'none' })
        }
      }
    })
  },
  async onSave() {
    if (this.data.saving) return
    const f = this.data.form
    if (!String(f.name || '').trim()) {
      wx.showToast({ title: '请填写商品名称', icon: 'none' })
      return
    }
    const role = this.data.role
    const body = {
      id: this.data.goodsId || undefined,
      merchantId: store.getSession().merchantId,
      name: String(f.name).trim(),
      sku: f.sku,
      category: f.category,
      unit: f.unit,
      description: f.description,
      imageUrl: /^https?:\/\//.test(f.imageUrl) ? f.imageUrl : '',
      stock: Number(f.stock),
      onSale: f.onSale ? 1 : 0,
      status: f.onSale ? 1 : 0,
      mixEnabled: f.mixEnabled ? 1 : 0,
      allowMix: f.allowMix ? 1 : 0
    }
    if (role === 'stall') {
      body.price = Number(f.price)
      body.pointsGrant = Number(f.pointsGrant) || 0
      if (!Number.isFinite(body.price) || body.price < 0) {
        wx.showToast({ title: '请填写售价', icon: 'none' })
        return
      }
    } else if (role === 'cross') {
      body.pointsNeed = Number(f.pointsNeed) || 0
      body.cashPrice = Number(f.cashPrice)
      if (!Number.isFinite(body.cashPrice) || body.cashPrice < 0) {
        wx.showToast({ title: '请填写现金价', icon: 'none' })
        return
      }
    } else {
      body.price = Number(f.price)
      body.pointsGrant = Number(f.pointsGrant) || 0
      body.pointsRatio = f.pointsRatio
      if (!Number.isFinite(body.price) || body.price < 0) {
        wx.showToast({ title: '请填写供货价', icon: 'none' })
        return
      }
    }
    this.setData({ saving: true })
    try {
      await api.saveMerchantGoods(body)
      this.setData({ saving: false })
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 400)
    } catch (e) {
      this.setData({ saving: false })
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    }
  }
})

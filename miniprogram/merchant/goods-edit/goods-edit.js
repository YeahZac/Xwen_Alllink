const store = require('../../utils/store')
const api = require('../../utils/api')

const UNITS = ['份', '件', '束', '盒', '袋', '箱']

Page({
  data: {
    role: '',
    goodsId: '',
    saving: false,
    catalogReady: true,
    readyHint: '',
    catOptions: [],
    catIndex: 0,
    unitOptions: UNITS,
    form: {
      name: '',
      sku: '',
      category: '',
      categoryId: '',
      unit: '份',
      description: '',
      imageUrl: '',
      price: '',
      cashPrice: '',
      pointsNeed: '',
      pointsGrant: '',
      pointsUsable: '',
      pointsRatio: '',
      stock: '9999',
      onSale: 1,
      mixEnabled: 1,
      allowMix: 1,
      allowRemark: 1
    }
  },
  async onLoad(q) {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    const role = s.role
    let catalogReady = true
    let readyHint = ''
    try {
      const dash = await api.merchantDashboard()
      catalogReady = dash.catalogReady === true
      if (!catalogReady) {
        readyHint = '进件未完成或支付未就绪：可先保存为下架草稿；上架会被拦截'
      }
    } catch (_) {}

    let catOptions = []
    try {
      const cats = await api.goodsCategories(role, { timeout: 15000 })
      catOptions = (Array.isArray(cats) ? cats : [])
        .filter((c) => Number(c.status) !== 0)
        .map((c) => ({ id: Number(c.id), name: c.name }))
    } catch (_) {
      catOptions = []
    }
    if (!catOptions.length) {
      readyHint = (readyHint ? readyHint + '；' : '') + '暂无启用类目，请联系运营在后台配置'
    }

    const first = catOptions[0] || { id: '', name: '' }
    const form = {
      ...this.data.form,
      category: first.name || '',
      categoryId: first.id ? String(first.id) : '',
      unit: '份',
      stock: role === 'supply' ? '0' : '9999',
      onSale: catalogReady ? 1 : 0
    }
    this.setData({
      role,
      catOptions,
      catIndex: 0,
      form,
      catalogReady,
      readyHint
    })
    wx.setNavigationBarTitle({ title: q.id ? '编辑商品' : '添加商品' })
    if (!q.id) return
    this.setData({ goodsId: String(q.id) })
    try {
      wx.showLoading({ title: '加载中' })
      const g = await api.merchantGoodsDetail(q.id)
      wx.hideLoading()
      let catIndex = 0
      if (g.categoryId) {
        const idx = catOptions.findIndex((c) => Number(c.id) === Number(g.categoryId))
        if (idx >= 0) catIndex = idx
      } else if (g.category) {
        const idx = catOptions.findIndex((c) => c.name === g.category)
        if (idx >= 0) catIndex = idx
      }
      const picked = catOptions[catIndex] || first
      this.setData({
        catIndex,
        form: {
          name: g.name || '',
          sku: g.sku || '',
          category: picked.name || g.category || '',
          categoryId: picked.id ? String(picked.id) : g.categoryId ? String(g.categoryId) : '',
          unit: g.unit || '份',
          description: g.description || g.desc || '',
          imageUrl: g.imageUrl || '',
          price: g.price != null ? String(g.price) : '',
          cashPrice: g.cashPrice != null ? String(g.cashPrice) : '',
          pointsNeed: g.pointsNeed != null ? String(g.pointsNeed) : '',
          pointsGrant: g.pointsGrant != null ? String(g.pointsGrant) : '',
          pointsUsable: g.pointsUsable != null ? String(g.pointsUsable) : '',
          pointsRatio: g.pointsRatio || '',
          stock: g.stock != null ? String(g.stock) : form.stock,
          onSale: g.onSale === 0 ? 0 : 1,
          mixEnabled: g.mixEnabled === 0 ? 0 : 1,
          allowMix: g.allowMix === 0 ? 0 : 1,
          allowRemark: g.allowRemark === 0 ? 0 : 1
        }
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onEditOptions() {
    const id = this.data.goodsId
    if (!id) {
      wx.showToast({ title: '请先保存商品', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/merchant/goods-options/goods-options?id=${id}&name=${encodeURIComponent(this.data.form.name || '')}`
    })
  },
  onField(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: e.detail.value })
  },
  onCat(e) {
    const idx = Number(e.detail.value)
    const picked = this.data.catOptions[idx]
    if (!picked) return
    this.setData({
      catIndex: idx,
      'form.category': picked.name,
      'form.categoryId': String(picked.id)
    })
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
          const url = up && up.fileUrl
          if (!url || !/^https?:\/\//.test(url)) {
            wx.showToast({ title: '上传未返回可用地址，请重试', icon: 'none' })
            return
          }
          this.setData({ 'form.imageUrl': url })
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: err.message || '图片上传失败，请重试', icon: 'none' })
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
    if (!f.categoryId) {
      wx.showToast({ title: '请选择启用中的商品类目', icon: 'none' })
      return
    }
    if (f.imageUrl && !/^https?:\/\//.test(f.imageUrl)) {
      wx.showToast({ title: '主图未上传成功，请重新选择图片', icon: 'none' })
      return
    }
    const role = this.data.role
    const body = {
      id: this.data.goodsId || undefined,
      merchantId: store.getSession().merchantId,
      name: String(f.name).trim(),
      sku: f.sku,
      categoryId: Number(f.categoryId),
      category: f.category,
      unit: f.unit,
      description: f.description,
      imageUrl: /^https?:\/\//.test(f.imageUrl) ? f.imageUrl : '',
      stock: Number(f.stock),
      onSale: f.onSale ? 1 : 0,
      status: f.onSale ? 1 : 0,
      mixEnabled: f.mixEnabled ? 1 : 0,
      allowMix: f.allowMix ? 1 : 0,
      allowRemark: f.allowRemark ? 1 : 0
    }
    if (role === 'stall') {
      body.price = Number(f.price)
      body.pointsGrant = Number(f.pointsGrant) || 0
      body.pointsUsable = Math.max(0, Math.floor(Number(f.pointsUsable) || 0))
      if (!Number.isFinite(body.price) || body.price < 0) {
        wx.showToast({ title: '请填写售价', icon: 'none' })
        return
      }
      if (body.onSale && body.price < 0.01) {
        wx.showToast({ title: '上架售价须≥0.01元', icon: 'none' })
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
      body.pointsRatio = f.pointsRatio || ''
      if (!Number.isFinite(body.price) || body.price < 0) {
        wx.showToast({ title: '请填写采购价', icon: 'none' })
        return
      }
    }
    this.setData({ saving: true })
    try {
      wx.showLoading({ title: '保存中' })
      const res = await api.saveMerchantGoods(body)
      wx.hideLoading()
      if (res && res.id && !this.data.goodsId) this.setData({ goodsId: String(res.id) })
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})

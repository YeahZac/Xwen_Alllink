const store = require('../../utils/store')
const api = require('../../utils/api')
const { cloneTemplate } = require('../../utils/stall-option-templates')

const TYPE_OPTIONS = [
  { value: 'flavor', label: '口味' },
  { value: 'portion', label: '分量' },
  { value: 'topping', label: '配料' },
  { value: 'custom', label: '自定义' }
]

function clampPriceDelta(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100) / 100
}

function normalizeGroups(raw) {
  return (raw || []).map((g, gi) => ({
    _key: `g${gi}_${Date.now()}`,
    name: g.name || '',
    type: g.type || 'custom',
    typeIndex: Math.max(
      0,
      TYPE_OPTIONS.findIndex((t) => t.value === (g.type || 'custom'))
    ),
    required: !!(g.required === true || g.required === 1),
    multiSelect: !!(g.multiSelect === true || g.multiSelect === 1),
    minSelect: Number(g.minSelect) || 0,
    maxSelect: Number(g.maxSelect) || 1,
    options: (g.options || []).map((o, oi) => ({
      _key: `o${gi}_${oi}_${Date.now()}`,
      name: o.name || '',
      priceDelta: String(clampPriceDelta(o.priceDelta)),
      isDefault: !!(o.isDefault === true || o.isDefault === 1)
    }))
  }))
}

function toPayload(groups) {
  return (groups || []).map((g, i) => {
    const multi = !!g.multiSelect
    const required = !!g.required
    return {
      name: String(g.name || '').trim() || '规格',
      type: g.type || 'custom',
      required,
      multiSelect: multi,
      minSelect: required ? Math.max(1, Number(g.minSelect) || 1) : Number(g.minSelect) || 0,
      maxSelect: multi ? Math.max(1, Number(g.maxSelect) || 5) : 1,
      sortOrder: (i + 1) * 10,
      options: (g.options || [])
        .filter((o) => String(o.name || '').trim())
        .map((o, j) => ({
          name: String(o.name).trim(),
          priceDelta: clampPriceDelta(o.priceDelta),
          pointsDelta: 0,
          isDefault: !!o.isDefault,
          sortOrder: j + 1
        }))
    }
  })
}

Page({
  data: {
    goodsId: '',
    goodsName: '',
    loading: true,
    saving: false,
    groups: [],
    typeLabels: TYPE_OPTIONS.map((t) => t.label)
  },
  onLoad(q) {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    if (s.role !== 'stall') {
      wx.showToast({ title: '仅地摊可配点餐规格', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    const goodsId = String((q && q.id) || '')
    const goodsName = decodeURIComponent((q && q.name) || '')
    this.setData({ goodsId, goodsName: goodsName || '商品' })
    wx.setNavigationBarTitle({ title: goodsName ? `规格 · ${goodsName}` : '点餐规格' })
    this.load()
  },
  async load() {
    if (!this.data.goodsId) return
    this.setData({ loading: true })
    try {
      const groups = await api.merchantGoodsOptions(this.data.goodsId)
      this.setData({
        loading: false,
        groups: normalizeGroups(groups && groups.length ? groups : [])
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },
  applyTemplate(kind) {
    const has = this.data.groups.length
    const go = () => this.setData({ groups: normalizeGroups(cloneTemplate(kind)) })
    if (!has) {
      go()
      return
    }
    wx.showModal({
      title: '套用模板',
      content: kind === 'drink' ? '将覆盖为饮品规格模板，继续？' : '将覆盖为正餐规格模板，继续？',
      success: (r) => {
        if (r.confirm) go()
      }
    })
  },
  onTplMeal() {
    this.applyTemplate('meal')
  },
  onTplDrink() {
    this.applyTemplate('drink')
  },
  onClear() {
    if (!this.data.groups.length) return
    wx.showModal({
      title: '清空规格',
      content: '确认清空全部规格组？保存后消费者将看不到口味/分量弹层选项。',
      confirmColor: '#ff4d4f',
      success: (r) => {
        if (r.confirm) this.setData({ groups: [] })
      }
    })
  },
  onAddGroup() {
    const groups = this.data.groups.slice()
    groups.push(
      normalizeGroups([
        {
          name: '新规格',
          type: 'custom',
          required: false,
          multiSelect: false,
          options: [{ name: '选项1', priceDelta: 0, isDefault: true }]
        }
      ])[0]
    )
    this.setData({ groups })
  },
  onDelGroup(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const groups = this.data.groups.slice()
    groups.splice(gi, 1)
    this.setData({ groups })
  },
  onGroupName(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    this.setData({ [`groups[${gi}].name`]: e.detail.value })
  },
  onGroupType(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const idx = Number(e.detail.value)
    const t = TYPE_OPTIONS[idx] || TYPE_OPTIONS[3]
    this.setData({
      [`groups[${gi}].typeIndex`]: idx,
      [`groups[${gi}].type`]: t.value,
      [`groups[${gi}].name`]: this.data.groups[gi].name || t.label
    })
  },
  onToggleRequired(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const next = !this.data.groups[gi].required
    this.setData({
      [`groups[${gi}].required`]: next,
      [`groups[${gi}].minSelect`]: next ? 1 : 0
    })
  },
  onToggleMulti(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const next = !this.data.groups[gi].multiSelect
    this.setData({
      [`groups[${gi}].multiSelect`]: next,
      [`groups[${gi}].maxSelect`]: next ? 5 : 1
    })
  },
  onAddOption(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const groups = this.data.groups.slice()
    const opts = (groups[gi].options || []).slice()
    opts.push({
      _key: `o${gi}_${Date.now()}`,
      name: '',
      priceDelta: '0',
      isDefault: false
    })
    groups[gi].options = opts
    this.setData({ groups })
  },
  onDelOption(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const oi = Number(e.currentTarget.dataset.oi)
    const groups = this.data.groups.slice()
    groups[gi].options.splice(oi, 1)
    this.setData({ groups })
  },
  onOptName(e) {
    const { gi, oi } = e.currentTarget.dataset
    this.setData({ [`groups[${gi}].options[${oi}].name`]: e.detail.value })
  },
  onOptPrice(e) {
    const { gi, oi } = e.currentTarget.dataset
    this.setData({ [`groups[${gi}].options[${oi}].priceDelta`]: e.detail.value })
  },
  onOptPriceBlur(e) {
    const { gi, oi } = e.currentTarget.dataset
    this.setData({
      [`groups[${gi}].options[${oi}].priceDelta`]: String(clampPriceDelta(e.detail.value))
    })
  },
  onOptDefault(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const oi = Number(e.currentTarget.dataset.oi)
    const groups = this.data.groups.slice()
    const multi = groups[gi].multiSelect
    groups[gi].options = (groups[gi].options || []).map((o, idx) => ({
      ...o,
      isDefault: multi ? (idx === oi ? !o.isDefault : o.isDefault) : idx === oi
    }))
    this.setData({ groups })
  },
  async onSave() {
    if (this.data.saving) return
    const payload = toPayload(this.data.groups)
    for (const g of payload) {
      if (!g.options.length) {
        wx.showToast({ title: `「${g.name}」请至少填一个选项`, icon: 'none' })
        return
      }
    }
    this.setData({ saving: true })
    try {
      await api.saveMerchantGoodsOptions(this.data.goodsId, payload)
      this.setData({ saving: false })
      wx.showToast({ title: '规格已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 400)
    } catch (e) {
      this.setData({ saving: false })
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
    }
  }
})

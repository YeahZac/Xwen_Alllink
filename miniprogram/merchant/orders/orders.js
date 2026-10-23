const store = require('../../utils/store')
const api = require('../../utils/api')

const STATUS_LABEL = {
  pending: '待处理',
  paid: '已支付',
  preparing: '制作中',
  ready: '待取餐',
  shipped: '已发货',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消',
  refunded: '已冲正'
}

function mapOrder(o, role) {
  const time = o.time ? String(o.time).replace('T', ' ').slice(0, 19) : ''
  const amount =
    o.totalAmount != null
      ? `¥${Number(o.totalAmount).toFixed(2)}`
      : o.cashAmount != null
        ? `¥${Number(o.cashAmount).toFixed(2)}`
        : o.pointsSpend
          ? `${o.pointsSpend}积分`
          : ''
  let sub = o.userName || o.peerName || o.goodsName || ''
  if (o.fulfillType) sub = [sub, o.fulfillType === 'offline' ? '线下' : '线上'].filter(Boolean).join(' · ')
  if (o.pointsGrant) sub = [sub, `额度+${o.pointsGrant}`].filter(Boolean).join(' · ')
  const status = o.status || o.payStatus || ''
  const canShip = role === 'supply' && status === 'pending'
  // 线上采购：仅「已发货」可确认收货（与后端 confirmPurchaseOrder 对齐）
  const canConfirm =
    (role === 'stall' || role === 'cross') &&
    o.type === 'purchase_buy' &&
    status === 'shipped'
  const canComplete =
    role === 'stall' &&
    o.type === 'stall' &&
    (status === 'preparing' || status === 'ready' || status === 'pending')
  const canCancel =
    (o.type === 'purchase_buy' || o.type === 'purchase_sell') &&
    (status === 'pending' || status === 'shipped' || status === 'confirmed')
  return {
    ...o,
    title: o.orderNo || o.goodsName || `#${o.id}`,
    sub: sub || '—',
    time,
    amount,
    status,
    statusText: STATUS_LABEL[status] || status || '处理中',
    canShip,
    canConfirm,
    canComplete,
    canCancel
  }
}

Page({
  data: {
    role: '',
    desc: '',
    tab: '',
    tabs: [],
    list: [],
    raw: [],
    loading: true,
    busyId: ''
  },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    let tabs = []
    let tab = ''
    let desc = ''
    if (s.role === 'stall') {
      tabs = ['点餐订单', '采购订单']
      tab = '点餐订单'
      desc = '顾客点餐履约 · 向供应链采购'
    } else if (s.role === 'cross') {
      tabs = ['兑换订单', '采购订单']
      tab = '兑换订单'
      desc = '积分/现金核销 · 向供应链采购'
    } else {
      tabs = ['销售订单']
      tab = '销售订单'
      desc = '买方采购 · 发货确认'
    }
    this.setData({ role: s.role, tabs, tab, desc })
    await this.loadList()
  },
  orderTypeForTab(tab, role) {
    if (role === 'supply') return 'sell'
    if (tab === '采购订单') return 'buy'
    if (role === 'cross') return 'cross'
    return 'consumer'
  },
  async loadList() {
    const { role, tab } = this.data
    this.setData({ loading: true })
    try {
      const type = this.orderTypeForTab(tab, role)
      const list = await api.merchantOrders(type)
      const mapped = (list || []).map((o) => mapOrder(o, role))
      this.setData({ list: mapped, raw: list || [], loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  switchTab(e) {
    const tab = e.currentTarget.dataset.t
    if (!tab || tab === this.data.tab) return
    this.setData({ tab })
    this.loadList()
  },
  async onShip(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.busyId) return
    this.setData({ busyId: id })
    try {
      await api.purchaseShip(id)
      wx.showToast({ title: '已发货', icon: 'success' })
      await this.loadList()
    } catch (err) {
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    } finally {
      this.setData({ busyId: '' })
    }
  },
  async onConfirm(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.busyId) return
    this.setData({ busyId: id })
    try {
      await api.purchaseConfirm(id)
      wx.showToast({ title: '已确认收货', icon: 'success' })
      await this.loadList()
    } catch (err) {
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    } finally {
      this.setData({ busyId: '' })
    }
  },
  async onComplete(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.busyId) return
    this.setData({ busyId: id })
    try {
      const result = await api.completeStallOrder(id)
      wx.showToast({
        title: result && result.pointsAllocated ? `已划拨 ${result.pointsAllocated} 积分` : '已完成',
        icon: 'success'
      })
      await this.loadList()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ busyId: '' })
    }
  },
  onCancel(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.busyId) return
    wx.showModal({
      title: '取消 / 冲正采购单',
      editable: true,
      placeholderText: this.data.role === 'supply' ? '缺货原因' : '拒收原因',
      confirmText: '确认',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ busyId: id })
        try {
          await api.purchaseCancel(id, r.content || '')
          wx.showToast({ title: '已终止', icon: 'success' })
          await this.loadList()
        } catch (err) {
          wx.showToast({ title: err.message || '失败', icon: 'none' })
        } finally {
          this.setData({ busyId: '' })
        }
      }
    })
  },
  onOpen(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find((x) => String(x.id) === String(id))
    if (!item) return
    wx.showModal({
      title: item.title,
      content: `${item.sub}\n状态：${item.statusText}\n金额：${item.amount || '—'}\n时间：${item.time}`,
      showCancel: false
    })
  }
})

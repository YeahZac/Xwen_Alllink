const store = require('../../utils/store')
const api = require('../../utils/api')
const { requestWxPay, isCancelError } = require('../../utils/pay')

const STATUS_LABEL = {
  unpaid: '待支付',
  pending: '待处理',
  paid: '已支付',
  preparing: '制作中',
  ready: '待取餐',
  completed: '已完成',
  cancelled: '已取消'
}

Page({
  data: {
    loading: true,
    order: null,
    statusText: '',
    timeText: '',
    paidAtText: '',
    acting: false
  },
  onLoad(query) {
    this.orderNo = decodeURIComponent((query && (query.id || query.orderNo)) || '')
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    await this.loadDetail()
  },
  async onPullDownRefresh() {
    try {
      await this.loadDetail()
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  async loadDetail() {
    if (!this.orderNo) {
      this.setData({ loading: false, order: null })
      wx.showToast({ title: '缺少订单号', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const order = await api.orderDetail(this.orderNo)
      const unpaid = order.unpaid || (order.payStatus === 'unpaid' && order.status !== 'cancelled')
      const statusKey = unpaid ? 'unpaid' : order.status || order.payStatus
      this.setData({
        loading: false,
        order: {
          ...order,
          unpaid,
          items: (order.items || []).map((it, idx) => ({
            ...it,
            _key: `${it.goodsId || idx}-${idx}`,
            lineTotal: Math.round(Number(it.price || 0) * Number(it.qty || 0) * 100) / 100
          }))
        },
        statusText: STATUS_LABEL[statusKey] || statusKey || '处理中',
        timeText: order.time ? String(order.time).replace('T', ' ').slice(0, 19) : '',
        paidAtText: order.paidAt ? String(order.paidAt).replace('T', ' ').slice(0, 19) : ''
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },
  goOrders() {
    wx.redirectTo({ url: '/pages/orders/orders' })
  },
  async onRepay() {
    if (this.data.acting || !this.orderNo) return
    this.setData({ acting: true })
    try {
      const result = await api.repayStallOrder({ orderNo: this.orderNo })
      if (result.alreadyPaid || result.payStatus === 'paid' || result.simulated) {
        this.setData({ acting: false })
        wx.showToast({ title: '已支付', icon: 'success' })
        await this.loadDetail()
        return
      }
      const paid = await requestWxPay(result)
      this.setData({ acting: false })
      wx.showModal({
        title: '支付成功',
        content: `本单积分划拨 ${paid.pointsAllocated != null ? paid.pointsAllocated : paid.pointsWant || 0}`,
        showCancel: false,
        success: () => this.loadDetail()
      })
      await store.refreshProfile().catch(() => {})
    } catch (e) {
      this.setData({ acting: false })
      if (e && e.code === 'SYNC_PENDING') {
        wx.showModal({
          title: '支付结果确认中',
          content: '请稍后下拉刷新本页查看入账状态。',
          showCancel: false,
          success: () => this.loadDetail()
        })
        return
      }
      if (isCancelError(e) || (e && e.code === 'USER_CANCEL')) {
        wx.showToast({ title: '已取消支付', icon: 'none' })
        return
      }
      wx.showToast({ title: (e && e.message) || '支付失败', icon: 'none' })
    }
  },
  onCancel() {
    if (this.data.acting || !this.orderNo) return
    wx.showModal({
      title: '取消订单',
      content: '取消后不可继续支付，需重新选购下单。确认取消？',
      confirmText: '确认取消',
      confirmColor: '#FF4D4F',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ acting: true })
        try {
          await api.cancelStallOrder({ orderNo: this.orderNo })
          this.setData({ acting: false })
          wx.showToast({ title: '已取消', icon: 'none' })
          await this.loadDetail()
        } catch (e) {
          this.setData({ acting: false })
          wx.showToast({ title: (e && e.message) || '取消失败', icon: 'none' })
        }
      }
    })
  }
})

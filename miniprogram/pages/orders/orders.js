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
  cancelled: '已取消',
  shipped: '已发货',
  confirmed: '已确认'
}

Page({
  data: { orders: [], loading: true, actingId: '' },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    await this.reload()
  },
  async reload() {
    this.setData({ loading: true })
    try {
      const orders = await api.myOrders()
      this.setData({
        loading: false,
        orders: (orders || []).map((o) => {
          const unpaid =
            !!o.unpaid ||
            (o.payStatus === 'unpaid' && o.status !== 'cancelled') ||
            (o.type === 'cross' &&
              o.payStatus === 'unpaid' &&
              o.status === 'pending')
          const statusKey = unpaid ? 'unpaid' : o.status || o.payStatus
          return {
            ...o,
            unpaid,
            statusText: STATUS_LABEL[statusKey] || statusKey || '处理中',
            timeText: o.time ? String(o.time).replace('T', ' ').slice(0, 19) : '',
            payModeText:
              o.type === 'cross'
                ? unpaid
                  ? '待付款'
                  : o.payMode === 'points' || Number(o.pointsSpend) > 0
                    ? '积分兑'
                    : '全现金'
                : unpaid
                  ? '待付款'
                  : o.status === 'preparing' || o.status === 'ready'
                    ? '待出餐'
                    : '',
            merchantId: o.merchantId
          }
        })
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const order = this.data.orders.find((o) => String(o.id) === String(id))
    // 异业单暂走本地摘要（后端 detail 目前仅覆盖地摊 consumer_orders）
    if (order && order.type === 'cross') {
      wx.showModal({
        title: order.orderNo || order.id || '异业兑换单',
        content: [
          `状态：${order.statusText || '-'}`,
          order.payModeText ? `支付：${order.payModeText}` : '',
          order.pointsSpend ? `积分：${order.pointsSpend}` : '',
          order.cashPaid != null || order.cashAmount != null
            ? `现金：¥${Number(order.cashPaid != null ? order.cashPaid : order.cashAmount).toFixed(2)}`
            : '',
          order.timeText ? `时间：${order.timeText}` : ''
        ]
          .filter(Boolean)
          .join('\n'),
        showCancel: false
      })
      return
    }
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${encodeURIComponent(id)}` })
  },
  async onRepay(e) {
    const id = e.currentTarget.dataset.id
    if (!id || this.data.actingId) return
    this.setData({ actingId: String(id) })
    try {
      const result = await api.repayStallOrder({ orderNo: id })
      if (result.alreadyPaid || result.payStatus === 'paid' || result.simulated) {
        wx.showToast({ title: '已支付', icon: 'success' })
        this.setData({ actingId: '' })
        await this.reload()
        return
      }
      await requestWxPay(result)
      await store.refreshProfile().catch(() => {})
      wx.showToast({ title: '支付成功', icon: 'success' })
      this.setData({ actingId: '' })
      await this.reload()
    } catch (err) {
      this.setData({ actingId: '' })
      if (err && err.code === 'SYNC_PENDING') {
        wx.showModal({
          title: '支付结果确认中',
          content: '请稍后刷新订单查看入账状态。',
          showCancel: false,
          success: () => this.reload()
        })
        return
      }
      if (isCancelError(err) || (err && err.code === 'USER_CANCEL')) {
        wx.showToast({ title: '已取消支付', icon: 'none' })
        return
      }
      wx.showToast({ title: (err && err.message) || '支付失败', icon: 'none' })
    }
  },
  onCancel(e) {
    const id = e.currentTarget.dataset.id
    if (!id || this.data.actingId) return
    wx.showModal({
      title: '取消订单',
      content: '取消后不可继续支付。确认取消？',
      confirmText: '确认取消',
      confirmColor: '#FF4D4F',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ actingId: String(id) })
        try {
          await api.cancelStallOrder({ orderNo: id })
          wx.showToast({ title: '已取消', icon: 'none' })
          this.setData({ actingId: '' })
          await this.reload()
        } catch (err) {
          this.setData({ actingId: '' })
          wx.showToast({ title: (err && err.message) || '取消失败', icon: 'none' })
        }
      }
    })
  },
  onComplaint(e) {
    const id = e.currentTarget.dataset.id
    const order = this.data.orders.find((o) => String(o.id) === String(id))
    wx.showModal({
      title: '投诉此单',
      editable: true,
      placeholderText: '请描述问题',
      success: async (r) => {
        if (!r.confirm || !r.content) return
        try {
          await api.complaint({
            targetType: 'order',
            targetId: order && (order.orderNo || order.id),
            content: r.content
          })
          wx.showToast({ title: '已提交', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: err.message || '提交失败', icon: 'none' })
        }
      }
    })
  }
})

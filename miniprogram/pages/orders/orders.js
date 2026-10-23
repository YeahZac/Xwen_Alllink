const store = require('../../utils/store')
const api = require('../../utils/api')

const STATUS_LABEL = {
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
  data: { orders: [], loading: true },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    this.setData({ loading: true })
    try {
      const orders = await api.myOrders()
      this.setData({
        loading: false,
        orders: (orders || []).map((o) => ({
          ...o,
          statusText: STATUS_LABEL[o.status || o.payStatus] || o.status || o.payStatus || '处理中',
          timeText: o.time ? String(o.time).replace('T', ' ').slice(0, 19) : '',
          payModeText:
            o.type === 'cross'
              ? o.payMode === 'points' || Number(o.pointsSpend) > 0
                ? '积分兑'
                : '全现金'
              : o.status === 'preparing' || o.status === 'ready'
                ? '待出餐'
                : '',
          merchantId: o.merchantId
        }))
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
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
            targetId: order && order.merchantId,
            content: `${order ? order.id : ''} ${r.content}`
          })
          wx.showToast({ title: '已提交', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: err.message || '提交失败', icon: 'none' })
        }
      }
    })
  }
})

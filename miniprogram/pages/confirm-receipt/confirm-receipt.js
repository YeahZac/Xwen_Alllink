const store = require('../../utils/store')
const mock = require('../../utils/mock-fulfill')

Page({
  data: {
    orderNo: '',
    shipment: null,
    checked: {},
    allChecked: false,
    submitting: false,
    done: false
  },
  onLoad(query) {
    const orderNo = String((query && (query.orderNo || query.id)) || '').trim()
    this.setData({ orderNo })
  },
  onShow() {
    if (!store.ensureLoggedIn()) return
    let orderNo = this.data.orderNo
    if (!orderNo) {
      const pending = mock.listPendingReceipt()
      orderNo = pending[0] ? pending[0].orderNo : (mock.listShipments()[0] || {}).orderNo
      this.setData({ orderNo: orderNo || '' })
    }
    if (!orderNo) {
      wx.showToast({ title: '暂无待确认订单', icon: 'none' })
      return
    }
    const shipment = mock.getShipment(orderNo)
    const checked = {}
    ;(shipment.goods || []).forEach((g, i) => {
      checked[g.sku || i] = !!shipment.confirmed
    })
    const keys = Object.keys(checked)
    this.setData({
      shipment,
      checked,
      allChecked: keys.length > 0 && keys.every((k) => checked[k]),
      done: !!shipment.confirmed
    })
  },
  toggleItem(e) {
    if (this.data.done) return
    const key = e.currentTarget.dataset.key
    const checked = { ...this.data.checked, [key]: !this.data.checked[key] }
    const keys = Object.keys(checked)
    this.setData({
      checked,
      allChecked: keys.length > 0 && keys.every((k) => checked[k])
    })
  },
  toggleAll() {
    if (this.data.done) return
    const next = !this.data.allChecked
    const checked = {}
    Object.keys(this.data.checked).forEach((k) => {
      checked[k] = next
    })
    this.setData({ checked, allChecked: next })
  },
  goLogistics() {
    const no = this.data.orderNo
    wx.navigateTo({ url: `/pages/logistics/logistics?orderNo=${encodeURIComponent(no)}` })
  },
  goService() {
    wx.navigateTo({ url: '/pages/service/service' })
  },
  async onConfirm() {
    if (this.data.done || this.data.submitting) return
    if (!this.data.allChecked) {
      wx.showToast({ title: '请先勾选核对全部货物', icon: 'none' })
      return
    }
    const shipment = this.data.shipment
    wx.showModal({
      title: '确认收货',
      content: `确认已收到「${shipment.title}」全部货物？确认后不可撤销（演示）。`,
      confirmText: '确认收货',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ submitting: true })
        mock.markConfirmed(shipment.orderNo)
        setTimeout(() => {
          this.setData({
            submitting: false,
            done: true,
            shipment: mock.getShipment(shipment.orderNo)
          })
          wx.showToast({ title: '已确认收货', icon: 'success' })
        }, 400)
      }
    })
  }
})

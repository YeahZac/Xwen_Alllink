const store = require('../../utils/store')
const mock = require('../../utils/mock-fulfill')

Page({
  data: {
    orderNo: '',
    shipment: null,
    listMode: false,
    list: []
  },
  onLoad(query) {
    const orderNo = String((query && (query.orderNo || query.id)) || '').trim()
    this.setData({ orderNo })
  },
  onShow() {
    if (!store.ensureLoggedIn()) return
    const orderNo = this.data.orderNo
    if (orderNo) {
      const shipment = mock.getShipment(orderNo)
      this.setData({ listMode: false, shipment })
      wx.setNavigationBarTitle({ title: '物流详情' })
      return
    }
    const list = mock.listShipments()
    this.setData({ listMode: true, list, shipment: null })
    wx.setNavigationBarTitle({ title: '物流中心' })
  },
  openItem(e) {
    const no = e.currentTarget.dataset.no
    if (!no) return
    wx.navigateTo({ url: `/pages/logistics/logistics?orderNo=${encodeURIComponent(no)}` })
  },
  copyTracking() {
    const s = this.data.shipment
    if (!s || !s.trackingNo) return
    wx.setClipboardData({
      data: s.trackingNo,
      success: () => wx.showToast({ title: '运单号已复制', icon: 'none' })
    })
  },
  callCourier() {
    const s = this.data.shipment
    if (!s || !s.courierPhone) return
    wx.makePhoneCall({ phoneNumber: String(s.courierPhone).replace(/\D/g, '') })
  },
  goConfirm() {
    const s = this.data.shipment
    if (!s) return
    wx.navigateTo({
      url: `/pages/confirm-receipt/confirm-receipt?orderNo=${encodeURIComponent(s.orderNo)}`
    })
  },
  goService() {
    wx.navigateTo({ url: '/pages/service/service' })
  }
})

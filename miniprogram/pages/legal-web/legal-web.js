const legal = require('../../utils/legal')

Page({
  data: {
    src: '',
    loading: true,
    title: '平台协议'
  },
  onLoad(q) {
    const key = (q && q.key) || 'user'
    const doc = legal.docByKey(key)
    if (!doc) {
      wx.showToast({ title: '协议不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400)
      return
    }
    const title = doc.title || '平台协议'
    wx.setNavigationBarTitle({ title })
    this.setData({ title, loading: true })

    // 有本地 PDF：先用微信内置阅读器（仍在小程序内）；失败再 web-view
    if (doc.packagePath) {
      legal.openNativePdf(doc).then((ok) => {
        if (ok) {
          // 阅读器已盖在上层；返回列表/登录页
          setTimeout(() => {
            wx.navigateBack({
              fail: () => this.setData({ src: legal.webViewUrl(doc), loading: false })
            })
          }, 80)
          return
        }
        this.setData({ src: legal.webViewUrl(doc), loading: false })
      })
      return
    }
    this.setData({ src: legal.webViewUrl(doc), loading: false })
  }
})

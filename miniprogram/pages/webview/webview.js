Page({
  data: { url: '' },
  onLoad(q) {
    let url = ''
    try {
      url = decodeURIComponent((q && q.url) || '')
    } catch (_) {
      url = (q && q.url) || ''
    }
    if (!/^https?:\/\//i.test(url)) {
      wx.showToast({ title: '链接无效', icon: 'none' })
      this.setData({ url: '' })
      return
    }
    this.setData({ url })
    if (q && q.title) {
      wx.setNavigationBarTitle({ title: decodeURIComponent(q.title) })
    }
  }
})

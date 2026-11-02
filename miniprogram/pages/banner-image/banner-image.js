Page({
  data: { src: '', title: '' },
  onLoad(q) {
    let src = ''
    let title = ''
    try {
      src = decodeURIComponent((q && q.src) || '')
      title = decodeURIComponent((q && q.title) || '')
    } catch (_) {
      src = (q && q.src) || ''
      title = (q && q.title) || ''
    }
    this.setData({ src, title })
    if (title) wx.setNavigationBarTitle({ title })
  },
  onPreview() {
    if (!this.data.src) return
    wx.previewImage({ urls: [this.data.src], current: this.data.src })
  }
})

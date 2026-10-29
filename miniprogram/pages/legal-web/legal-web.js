const legal = require('../../utils/legal')

/** 兼容旧入口：不再使用 web-view，改为小程序内打开后返回 */
Page({
  onLoad(q) {
    const key = (q && q.key) || 'user'
    legal.openDoc(key).finally(() => {
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) })
      }, 300)
    })
  }
})

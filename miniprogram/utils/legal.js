/**
 * 平台协议（与 public/legal 及线上 HTTPS 路径一致）
 * 审核补充资料可填写：https://admin.wanye.cloud/legal/
 */
const LEGAL_BASE = 'https://admin.wanye.cloud/legal'

const DOCS = [
  {
    key: 'user',
    title: '用户服务协议',
    short: '《用户服务协议》',
    file: 'user-service-agreement.pdf',
    zhFile: '万业互联云平台用户服务协议.pdf',
    desc: '万业互联云平台用户服务协议'
  },
  {
    key: 'merchant',
    title: '商户入驻平台协议',
    short: '《商户入驻平台协议》',
    file: 'merchant-onboarding-agreement.pdf',
    zhFile: '万业互联云商户入驻服务协议.pdf',
    desc: '万业互联云商户入驻服务协议'
  },
  {
    key: 'dispute',
    title: '消费者权益保障措施说明',
    short: '《消费者权益保障措施说明》',
    file: 'transaction-dispute-resolution.pdf',
    zhFile: '万业互联云平台交易纠纷处理机制说明.pdf',
    desc: '万业互联云平台交易纠纷处理机制说明'
  }
]

function docByKey(key) {
  return DOCS.find((d) => d.key === key) || null
}

function docUrl(doc) {
  const file = (doc && doc.file) || ''
  return `${LEGAL_BASE}/${file}`
}

function openDoc(keyOrDoc) {
  const doc = typeof keyOrDoc === 'string' ? docByKey(keyOrDoc) : keyOrDoc
  if (!doc) {
    wx.showToast({ title: '协议不存在', icon: 'none' })
    return Promise.resolve(false)
  }
  const url = docUrl(doc)
  wx.showLoading({ title: '打开协议…', mask: true })
  return new Promise((resolve) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          wx.hideLoading()
          wx.showToast({ title: '协议下载失败', icon: 'none' })
          resolve(false)
          return
        }
        wx.openDocument({
          filePath: res.tempFilePath,
          fileType: 'pdf',
          showMenu: true,
          success: () => {
            wx.hideLoading()
            resolve(true)
          },
          fail: () => {
            wx.hideLoading()
            wx.setClipboardData({
              data: url,
              success: () =>
                wx.showToast({ title: '已复制协议链接，可在浏览器打开', icon: 'none' })
            })
            resolve(false)
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.setClipboardData({
          data: url,
          success: () =>
            wx.showToast({ title: '已复制协议链接，可在浏览器打开', icon: 'none' })
        })
        resolve(false)
      }
    })
  })
}

module.exports = {
  LEGAL_BASE,
  DOCS,
  docByKey,
  docUrl,
  openDoc
}

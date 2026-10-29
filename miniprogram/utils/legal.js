/**
 * 平台协议：小程序内直接打开（优先原生 PDF 阅读器，其次 web-view）
 * 线上审核路径：https://admin.wanye.cloud/legal/
 */
const LEGAL_BASE = 'https://admin.wanye.cloud/legal'

const DOCS = [
  {
    key: 'user',
    title: '用户服务协议',
    short: '《用户服务协议》',
    file: 'user-service-agreement.pdf',
    packagePath: 'assets/legal/user-service-agreement.pdf',
    webPath: 'user.html',
    desc: '万业互联云平台用户服务协议'
  },
  {
    key: 'merchant',
    title: '商户入驻平台协议',
    short: '《商户入驻平台协议》',
    file: 'merchant-onboarding-agreement.pdf',
    packagePath: 'assets/legal/merchant-onboarding-agreement.pdf',
    webPath: 'merchant.html',
    desc: '万业互联云商户入驻服务协议'
  },
  {
    key: 'dispute',
    title: '消费者权益保障措施说明',
    short: '《消费者权益保障措施说明》',
    file: 'transaction-dispute-resolution.pdf',
    packagePath: 'assets/legal/transaction-dispute-resolution.pdf',
    webPath: 'dispute.html',
    desc: '万业互联云平台交易纠纷处理机制说明'
  },
  {
    key: 'privacy',
    title: '平台隐私政策',
    short: '《平台隐私政策》',
    file: '',
    packagePath: '',
    webPath: 'privacy.html',
    desc: '万业互联云平台隐私政策'
  }
]

function docByKey(key) {
  return DOCS.find((d) => d.key === key) || null
}

function docUrl(doc) {
  if (!doc) return LEGAL_BASE + '/'
  if (doc.webPath) return `${LEGAL_BASE}/${doc.webPath}`
  if (doc.file) return `${LEGAL_BASE}/${doc.file}`
  return `${LEGAL_BASE}/`
}

function webViewUrl(doc) {
  return docUrl(doc)
}

/** 代码包 PDF → 用户目录 → 微信内置阅读器（不跳出小程序） */
function openNativePdf(doc) {
  return new Promise((resolve) => {
    if (!doc || !doc.packagePath) {
      resolve(false)
      return
    }
    const fsm = wx.getFileSystemManager()
    const dest = `${wx.env.USER_DATA_PATH}/wy_legal_${doc.key}.pdf`
    const open = (filePath) => {
      wx.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true,
        success: () => resolve(true),
        fail: () => resolve(false)
      })
    }
    const writeAndOpen = (data) => {
      fsm.writeFile({
        filePath: dest,
        data,
        success: () => open(dest),
        fail: () => resolve(false)
      })
    }
    fsm.readFile({
      filePath: doc.packagePath,
      success: (res) => writeAndOpen(res.data),
      fail: () => {
        fsm.copyFile({
          srcPath: doc.packagePath,
          destPath: dest,
          success: () => open(dest),
          fail: () => {
            fsm.copyFile({
              srcPath: `/${doc.packagePath}`,
              destPath: dest,
              success: () => open(dest),
              fail: () => resolve(false)
            })
          }
        })
      }
    })
  })
}

/** 跳转 web-view 页，在小程序内打开协议页（需配置业务域名 admin.wanye.cloud） */
function openInWebView(keyOrDoc) {
  const doc = typeof keyOrDoc === 'string' ? docByKey(keyOrDoc) : keyOrDoc
  if (!doc) {
    wx.showToast({ title: '协议不存在', icon: 'none' })
    return
  }
  const key = doc.key
  wx.navigateTo({
    url: `/pages/legal-web/legal-web?key=${encodeURIComponent(key)}`,
    fail: () => {
      wx.navigateTo({ url: `/pages/legal/legal` })
    }
  })
}

/**
 * 打开协议：进入协议页（原生 PDF 阅读器 / web-view）
 * 全程留在小程序内，不再复制浏览器链接
 */
function openDoc(keyOrDoc) {
  openInWebView(keyOrDoc)
  return Promise.resolve(true)
}

module.exports = {
  LEGAL_BASE,
  DOCS,
  docByKey,
  docUrl,
  webViewUrl,
  openDoc,
  openInWebView,
  openNativePdf
}

/**
 * 平台协议：全程在小程序内用微信 PDF 阅读器打开（不用 web-view，避免业务域名拦截）
 * 1) 代码包 assets/legal/*.pdf → 复制到用户目录 → openDocument
 * 2) 失败则经云托管 callContainer 拉取 /legal/*.pdf 再打开
 */
const config = require('./config')

const LEGAL_BASE = 'https://admin.wanye.cloud/legal'

const DOCS = [
  {
    key: 'user',
    title: '用户服务协议',
    short: '《用户服务协议》',
    file: 'user-service-agreement.pdf',
    packagePath: 'assets/legal/user-service-agreement.pdf',
    desc: '万业互联云平台用户服务协议'
  },
  {
    key: 'merchant',
    title: '商户入驻平台协议',
    short: '《商户入驻平台协议》',
    file: 'merchant-onboarding-agreement.pdf',
    packagePath: 'assets/legal/merchant-onboarding-agreement.pdf',
    desc: '万业互联云商户入驻服务协议'
  },
  {
    key: 'dispute',
    title: '消费者权益保障措施说明',
    short: '《消费者权益保障措施说明》',
    file: 'transaction-dispute-resolution.pdf',
    packagePath: 'assets/legal/transaction-dispute-resolution.pdf',
    desc: '万业互联云平台交易纠纷处理机制说明'
  },
  {
    key: 'privacy',
    title: '平台隐私政策',
    short: '《平台隐私政策》',
    file: '',
    packagePath: '',
    page: '/pages/legal-privacy/legal-privacy',
    desc: '万业互联云平台隐私政策'
  }
]

function docByKey(key) {
  return DOCS.find((d) => d.key === key) || null
}

function docUrl(doc) {
  if (!doc) return `${LEGAL_BASE}/`
  if (doc.file) return `${LEGAL_BASE}/${doc.file}`
  return `${LEGAL_BASE}/`
}

function destPath(doc) {
  return `${wx.env.USER_DATA_PATH}/wy_legal_${doc.key}.pdf`
}

function openFile(filePath) {
  return new Promise((resolve) => {
    wx.openDocument({
      filePath,
      fileType: 'pdf',
      showMenu: true,
      success: () => resolve(true),
      fail: (err) => {
        console.warn('[legal] openDocument fail', err)
        resolve(false)
      }
    })
  })
}

function writeAndOpen(doc, data) {
  return new Promise((resolve) => {
    const fsm = wx.getFileSystemManager()
    const dest = destPath(doc)
    try {
      fsm.writeFileSync(dest, data)
      openFile(dest).then(resolve)
    } catch (e) {
      fsm.writeFile({
        filePath: dest,
        data,
        success: () => openFile(dest).then(resolve),
        fail: (err) => {
          console.warn('[legal] writeFile fail', err)
          resolve(false)
        }
      })
    }
  })
}

/** 从代码包打开 */
function openFromPackage(doc) {
  return new Promise((resolve) => {
    if (!doc || !doc.packagePath) {
      resolve(false)
      return
    }
    const fsm = wx.getFileSystemManager()
    const dest = destPath(doc)
    const srcs = [
      doc.packagePath,
      `/${String(doc.packagePath).replace(/^\//, '')}`
    ]

    try {
      fsm.accessSync(dest)
      openFile(dest).then((ok) => {
        if (ok) resolve(true)
        else tryCopy(0)
      })
      return
    } catch (_) {
      /* need copy */
    }

    function tryCopy(i) {
      if (i >= srcs.length) {
        resolve(false)
        return
      }
      const src = srcs[i]
      try {
        fsm.copyFileSync(src, dest)
        openFile(dest).then((ok) => (ok ? resolve(true) : tryCopy(i + 1)))
        return
      } catch (_) {}
      try {
        const data = fsm.readFileSync(src)
        writeAndOpen(doc, data).then((ok) => (ok ? resolve(true) : tryCopy(i + 1)))
      } catch (e) {
        console.warn('[legal] package read fail', src, e)
        tryCopy(i + 1)
      }
    }

    tryCopy(0)
  })
}

/** 经云托管拉取 PDF（不依赖 downloadFile / web-view 业务域名） */
function openFromCloud(doc) {
  return new Promise((resolve) => {
    if (!doc || !doc.file) {
      resolve(false)
      return
    }
    if (!wx.cloud || !wx.cloud.callContainer) {
      resolve(false)
      return
    }
    try {
      wx.cloud.init({ env: config.envId, traceUser: true })
    } catch (_) {}

    wx.cloud.callContainer({
      config: { env: config.envId },
      path: `/legal/${doc.file}`,
      method: 'GET',
      timeout: 20000,
      responseType: 'arraybuffer',
      header: {
        'X-WX-SERVICE': config.serviceName,
        'content-type': 'application/pdf'
      },
      success: (res) => {
        const code = res.statusCode || 0
        const data = res.data
        if (code !== 200 || !data) {
          console.warn('[legal] cloud pdf status', code)
          resolve(false)
          return
        }
        // 若网关误返回 JSON 字符串，则失败
        if (typeof data === 'string' && data.trim().charAt(0) === '{') {
          resolve(false)
          return
        }
        writeAndOpen(doc, data).then(resolve)
      },
      fail: (err) => {
        console.warn('[legal] cloud pdf fail', err)
        resolve(false)
      }
    })
  })
}

function openPrivacy() {
  return new Promise((resolve) => {
    wx.navigateTo({
      url: '/pages/legal-privacy/legal-privacy',
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

/**
 * 打开协议（小程序内，不跳浏览器、不用 web-view）
 */
function openDoc(keyOrDoc) {
  const doc = typeof keyOrDoc === 'string' ? docByKey(keyOrDoc) : keyOrDoc
  if (!doc) {
    wx.showToast({ title: '协议不存在', icon: 'none' })
    return Promise.resolve(false)
  }
  if (doc.key === 'privacy' || doc.page) {
    return openPrivacy()
  }

  wx.showLoading({ title: '打开协议…', mask: true })
  return openFromPackage(doc)
    .then((ok) => (ok ? true : openFromCloud(doc)))
    .then((ok) => {
      wx.hideLoading()
      if (!ok) {
        wx.showToast({ title: '协议暂时无法打开，请稍后重试', icon: 'none' })
      }
      return ok
    })
    .catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '协议暂时无法打开，请稍后重试', icon: 'none' })
      return false
    })
}

function openInWebView(keyOrDoc) {
  // 兼容旧调用：改为小程序内打开，不再走 web-view
  return openDoc(keyOrDoc)
}

module.exports = {
  LEGAL_BASE,
  DOCS,
  docByKey,
  docUrl,
  openDoc,
  openInWebView,
  openFromPackage,
  openFromCloud
}

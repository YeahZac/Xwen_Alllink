const store = require('../../utils/store')
const api = require('../../utils/api')
const scan = require('../../utils/scan')
const legal = require('../../utils/legal')
const { ensureCloud } = require('../../utils/request')

const AGREE_KEY = 'wy_agreed'

function wxLoginCode() {
  return new Promise((resolve) => {
    wx.login({
      success: (r) => resolve((r && r.code) || ''),
      fail: () => resolve('')
    })
  })
}

function readAgreed() {
  try {
    return !!wx.getStorageSync(AGREE_KEY)
  } catch (_) {
    return false
  }
}

function writeAgreed(v) {
  try {
    wx.setStorageSync(AGREE_KEY, !!v)
  } catch (_) {}
}

Page({
  data: {
    headerTop: 92,
    loading: false,
    resuming: false,
    pendingHint: '',
    canReturnPay: false,
    canSkip: false,
    agreed: false,
    showAgreeTip: false
  },
  onLoad(q) {
    ensureCloud()
    const sys = wx.getSystemInfoSync()
    const statusBarHeight = sys.statusBarHeight || 44
    let headerTop = statusBarHeight + 48
    try {
      const capsule = wx.getMenuButtonBoundingClientRect()
      if (capsule && capsule.bottom) headerTop = capsule.bottom + 8
    } catch (_) {}
    const session = store.getSession() || {}
    const tokenOk = !!store.getToken()
    const isConsumer = session.role === 'consumer' && !!session.userId && tokenOk
    const pending = scan.getPendingPay()
    const fromScan = (q && q.from === 'scanpay') || !!(pending && pending.stallId)
    const pages = getCurrentPages() || []
    let pendingHint = ''
    if (pending && pending.stallId) {
      pendingHint = pending.amount
        ? `金额 ¥${pending.amount} 已保留。登录后回到支付页，需再点一次「支付」才会扣款。`
        : '登录后将返回支付页，需再点一次「支付」才会扣款。'
    } else if (fromScan) {
      pendingHint = '登录后将返回支付页，需再点一次「支付」才会扣款。'
    }
    this.setData({
      headerTop,
      pendingHint,
      canReturnPay: fromScan && isConsumer,
      canSkip: fromScan || pages.length > 1,
      agreed: readAgreed()
    })
    if (q && q.ref) {
      wx.setStorageSync('wy_pending_ref', String(q.ref))
    }
    this.resumeIfPossible(fromScan)
  },
  async resumeIfPossible(fromScan) {
    if (this._resuming) return
    if (store.isManualLogout && store.isManualLogout()) {
      this.setData({ resuming: false })
      return
    }
    this._resuming = true
    this.setData({ resuming: true })
    try {
      const app = getApp()
      let boot = null
      if (app && app.globalData && app.globalData.bootPromise) {
        boot = await app.globalData.bootPromise
        app.globalData.bootPromise = null
      } else {
        boot = await store.bootstrapSession()
      }
      if (boot && boot.manualLogout) return
      if (!boot || !boot.ok) {
        if (store.isLoggedIn() && !fromScan && !(store.isManualLogout && store.isManualLogout())) {
          store.routeAfterLogin()
          return
        }
        return
      }
      if (boot.session && boot.session.needPhone) return
      store.routeAfterLogin()
    } catch (_) {
      /* 留在登录页 */
    } finally {
      this._resuming = false
      this.setData({ resuming: false })
    }
  },
  returnPay() {
    store.routeAfterLogin()
  },
  skipLogin() {
    if (this.data.canReturnPay) {
      store.routeAfterLogin()
      return
    }
    const pending = scan.getPendingPay()
    if (pending && pending.stallId) {
      wx.navigateBack({
        fail: () => wx.reLaunch({ url: scan.scanPayUrl(pending.stallId, pending.amount) })
      })
      return
    }
    wx.navigateBack({
      fail: () => wx.showToast({ title: '请先登录', icon: 'none' })
    })
  },
  toggleAgree() {
    const agreed = !this.data.agreed
    writeAgreed(agreed)
    this.setData({ agreed, showAgreeTip: agreed ? false : this.data.showAgreeTip })
  },
  onNeedAgree() {
    this.setData({ showAgreeTip: true })
    wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
  },
  openLegal(e) {
    const key = e.currentTarget.dataset.key
    // 小程序内打开：原生 PDF 阅读器或 web-view，不跳浏览器
    legal.openDoc(key)
  },
  goApply() {
    wx.navigateTo({ url: '/pages/apply/apply' })
  },
  queryApply() {
    if (!store.isLoggedIn()) {
      wx.showToast({ title: '请先登录后再查询', icon: 'none' })
      return
    }
    ;(async () => {
      try {
        wx.showLoading({ title: '查询中' })
        const item = await api.applyStatusMine()
        wx.hideLoading()
        if (!item) {
          wx.showToast({ title: '未找到申请记录', icon: 'none' })
          return
        }
        wx.showModal({
          title: item.statusText || item.status,
          content: `单号：${item.applyNo || item.id}\n身份：${item.roleLabel || item.role}\n${item.remark || ''}`,
          showCancel: false
        })
      } catch (e) {
        wx.hideLoading()
        wx.showToast({ title: e.message || '查询失败', icon: 'none' })
      }
    })()
  },
  async onPhoneLogin(e) {
    if (this.data.loading || this.data.resuming) return
    if (!this.data.agreed) {
      this.onNeedAgree()
      return
    }
    const detail = (e && e.detail) || {}
    if (detail.errMsg && String(detail.errMsg).indexOf('ok') < 0) {
      if (store.isLoggedIn()) {
        store.routeAfterLogin()
        return
      }
      wx.showToast({ title: '未授权手机号', icon: 'none' })
      return
    }
    const phoneCode = detail.code
    this.setData({ loading: true })
    try {
      if (!phoneCode) {
        const silent = await store.silentWeChatLogin()
        if (silent.ok) {
          this.setData({ loading: false })
          wx.showToast({ title: '登录成功', icon: 'success' })
          setTimeout(() => store.routeAfterLogin(), 400)
          return
        }
        this.setData({ loading: false })
        wx.showToast({ title: '请在真机完成手机号授权', icon: 'none' })
        return
      }
      const jsCode = await wxLoginCode()
      const res = await store.loginWithWeChat({ jsCode })
      if (!res.ok) {
        this.setData({ loading: false })
        wx.showToast({ title: res.message, icon: 'none' })
        return
      }
      if (res.session && !res.session.needPhone && res.session.phone) {
        this.setData({ loading: false })
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => store.routeAfterLogin(), 400)
        return
      }
      const data = await api.bindPhone(phoneCode)
      store.applyAuthResult(data)
      this.setData({ loading: false })
      wx.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(() => store.routeAfterLogin(), 400)
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || '登录失败', icon: 'none' })
    }
  }
})

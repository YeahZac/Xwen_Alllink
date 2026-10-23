const store = require('../../utils/store')
const api = require('../../utils/api')
const scan = require('../../utils/scan')
const { ensureCloud } = require('../../utils/request')

const LEGAL = {
  privacy: {
    title: '平台隐私政策',
    content:
      '万业互联云会使用你的手机号用于登录、订单通知和账号保护。头像、昵称、性别由你在「我的」中自行填写，可随时修改。我们不会把你的个人信息出售给第三方。'
  },
  minor: {
    title: '未成年人保护须知',
    content:
      '未满 18 周岁应在监护人同意下使用本平台。请勿进行大额消费或代付。如发现异常订单，可通过「我的 · 投诉与反馈」联系平台。'
  },
  member: {
    title: '用户服务协议',
    content:
      '使用万业互联云即表示你同意按实际订单完成支付。餐饮等门店消费产生的积分以到账为准，可在附近鲜花、蛋糕、百货门店兑换。演示身份仅供联调，不代表正式开户。'
  }
}

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
    code: '',
    showTest: false,
    headerTop: 92,
    loading: false,
    resuming: false,
    pendingHint: '',
    canReturnPay: false,
    canSkip: false,
    agreed: false,
    showAgreeTip: false,
    heroImage: 'https://7072-prod-d3g1vkrj3290d085e-1467541248.tcb.qcloud.la/admin/banner/20260918/295311cfb0213203.webp'
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
      if (!boot || !boot.ok) {
        // 已有本地会话但静默失败时仍可先进入（仅扫码支付页需要登录）
        if (store.isLoggedIn() && !fromScan) {
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
    const item = LEGAL[key]
    if (!item) return
    wx.showModal({
      title: item.title,
      content: item.content,
      showCancel: false,
      confirmText: '知道了'
    })
  },
  onInput(e) {
    this.setData({ code: e.detail.value })
  },
  toggleTest() {
    this.setData({ showTest: !this.data.showTest })
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
  async onLoginCode(e) {
    if (this.data.loading || this.data.resuming) return
    const fromRow = e && e.currentTarget && e.currentTarget.dataset
      ? String(e.currentTarget.dataset.code || '').trim()
      : ''
    const code = fromRow || String(this.data.code || '').trim()
    if (!code) {
      wx.showToast({ title: '请选择演示身份或输入邀请码', icon: 'none' })
      return
    }
    this.setData({ code, loading: true })
    try {
      const res = await store.loginWithCode(code)
      this.setData({ loading: false })
      if (!res.ok) {
        wx.showToast({ title: res.message, icon: 'none' })
        return
      }
      wx.showToast({ title: store.ROLE_LABEL[res.session.role] || '登录成功', icon: 'success' })
      setTimeout(() => store.routeAfterLogin(), 400)
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || '登录失败', icon: 'none' })
    }
  },
  async onPhoneLogin(e) {
    if (this.data.loading || this.data.resuming) return
    if (!this.data.agreed) {
      this.onNeedAgree()
      return
    }
    const detail = (e && e.detail) || {}
    if (detail.errMsg && String(detail.errMsg).indexOf('ok') < 0) {
      // 用户取消授权时，若本地已有可恢复会话则直接进入
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
      // 已绑定过手机号：静默微信登录即可，不必再绑
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

const store = require('../../utils/store')
const api = require('../../utils/api')
const scan = require('../../utils/scan')
const legal = require('../../utils/legal')
const { ensureCloud } = require('../../utils/request')

const AGREE_KEY = 'wy_agreed'
/** 手机号授权冷却，避免微信「操作太频繁」反复弹窗 */
const PHONE_COOL_MS = 45 * 1000
const PHONE_COOL_KEY = 'wy_phone_cool_until'

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

function readCoolUntil() {
  try {
    return Number(wx.getStorageSync(PHONE_COOL_KEY) || 0) || 0
  } catch (_) {
    return 0
  }
}

function writeCoolUntil(ts) {
  try {
    wx.setStorageSync(PHONE_COOL_KEY, Number(ts) || 0)
  } catch (_) {}
}

function isFrequentError(msg) {
  const s = String(msg || '')
  return /频繁|too many|frequency|45011|限流/i.test(s)
}

function isUserCancelPhone(detail) {
  const msg = String((detail && detail.errMsg) || '')
  const errno = detail && (detail.errno != null ? detail.errno : detail.errCode)
  if (errno === 104 || errno === 103) return true
  return /deny|cancel|拒绝|取消|fail/i.test(msg) && !/ok/i.test(msg)
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
    showAgreeTip: false,
    phoneCooling: false,
    phoneCoolSec: 0,
    cancelHint: ''
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
    this.syncPhoneCool()
    if (q && q.ref) {
      wx.setStorageSync('wy_pending_ref', String(q.ref))
    }
    // 仅在「非主动退出」时尝试恢复；不自动拉起手机号授权弹窗
    // 用户点「先逛逛」会走 enterGuest，不在此处自动跳（避免从「我的」进登录又被踢走）
    this.resumeIfPossible(fromScan)
  },
  onUnload() {
    this.clearCoolTimer()
  },
  onHide() {
    this.clearCoolTimer()
  },
  clearCoolTimer() {
    if (this._coolTimer) {
      clearInterval(this._coolTimer)
      this._coolTimer = null
    }
  },
  syncPhoneCool() {
    const until = readCoolUntil()
    const left = Math.max(0, until - Date.now())
    if (left <= 0) {
      this.clearCoolTimer()
      writeCoolUntil(0)
      this.setData({ phoneCooling: false, phoneCoolSec: 0 })
      return
    }
    this.setData({
      phoneCooling: true,
      phoneCoolSec: Math.ceil(left / 1000)
    })
    this.clearCoolTimer()
    this._coolTimer = setInterval(() => {
      const remain = Math.max(0, readCoolUntil() - Date.now())
      if (remain <= 0) {
        this.clearCoolTimer()
        writeCoolUntil(0)
        this.setData({ phoneCooling: false, phoneCoolSec: 0 })
        return
      }
      this.setData({ phoneCoolSec: Math.ceil(remain / 1000) })
    }, 500)
  },
  startPhoneCool(ms) {
    const until = Date.now() + (ms || PHONE_COOL_MS)
    writeCoolUntil(until)
    this.syncPhoneCool()
  },
  async resumeIfPossible(fromScan) {
    if (this._resuming || this._guestLeaving) return
    if (store.isManualLogout && store.isManualLogout()) {
      this.setData({ resuming: false })
      return
    }
    if (store.preferGuestBrowse && store.preferGuestBrowse()) {
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
      // 用户已点「先逛逛」：禁止再路由回登录/首页登录流
      if (this._guestLeaving || (store.preferGuestBrowse && store.preferGuestBrowse())) return
      if (boot && boot.manualLogout) return
      if (!boot || !boot.ok) return
      // 需要手机号：留在本页，由用户主动点登录；绝不自动弹授权
      if (boot.session && boot.session.needPhone) return
      store.routeAfterLogin()
    } catch (_) {
      /* 留在登录页，可点先逛逛 */
    } finally {
      this._resuming = false
      this.setData({ resuming: false })
    }
  },
  returnPay() {
    store.routeAfterLogin()
  },
  /** 显著出口：不登录也能逛首页 */
  enterGuest() {
    this._guestLeaving = true
    this._resuming = false
    try {
      const app = getApp()
      if (app && app.globalData) {
        app.globalData.bootPromise = null
        app.globalData.preferGuest = true
      }
    } catch (_) {}
    store.enterAsGuest()
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
      fail: () => this.enterGuest()
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
    if (this.data.loading || this.data.resuming || this.data.phoneCooling) return
    if (!this.data.agreed) {
      this.onNeedAgree()
      return
    }

    const detail = (e && e.detail) || {}
    const errMsg = String(detail.errMsg || '')

    // 用户取消 / 拒绝：不反复打扰，提示可先逛逛
    if (isUserCancelPhone(detail) || (errMsg && errMsg.indexOf('ok') < 0 && !detail.code)) {
      this.setData({
        cancelHint: '已取消手机号授权。可点「暂不登录，先逛逛」继续浏览，稍后再登录。'
      })
      // 取消后短暂冷却，避免连点再次触发系统弹窗
      this.startPhoneCool(8 * 1000)
      return
    }

    if (isFrequentError(errMsg) || isFrequentError(detail.errno)) {
      this.setData({
        cancelHint: '手机号授权操作较频繁，请稍后再试，或先逛逛门店。'
      })
      this.startPhoneCool(PHONE_COOL_MS)
      return
    }

    const phoneCode = detail.code
    this.setData({ loading: true, cancelHint: '' })
    try {
      if (!phoneCode) {
        // 无 code 时不连环重试静默登录，避免触发限流
        this.setData({ loading: false })
        this.setData({
          cancelHint: '未取得手机号授权。可改用「暂不登录，先逛逛」，或稍后再试。'
        })
        this.startPhoneCool(12 * 1000)
        return
      }

      const jsCode = await wxLoginCode()
      const res = await store.loginWithWeChat({ jsCode })
      if (!res.ok) {
        this.setData({ loading: false })
        const msg = res.message || '登录失败'
        if (isFrequentError(msg)) {
          this.setData({ cancelHint: '操作较频繁，请稍后再试或先逛逛。' })
          this.startPhoneCool(PHONE_COOL_MS)
        } else {
          wx.showToast({ title: msg, icon: 'none' })
        }
        return
      }
      if (res.session && !res.session.needPhone && res.session.phone) {
        this.setData({ loading: false })
        writeCoolUntil(0)
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => store.routeAfterLogin(), 400)
        return
      }
      const data = await api.bindPhone(phoneCode)
      store.applyAuthResult(data)
      this.setData({ loading: false })
      writeCoolUntil(0)
      wx.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(() => store.routeAfterLogin(), 400)
    } catch (err) {
      this.setData({ loading: false })
      const msg = (err && err.message) || '登录失败'
      if (isFrequentError(msg)) {
        this.setData({ cancelHint: '操作较频繁，请稍后再试，或点「暂不登录，先逛逛」。' })
        this.startPhoneCool(PHONE_COOL_MS)
      } else {
        wx.showToast({ title: msg, icon: 'none' })
        this.startPhoneCool(8 * 1000)
      }
    }
  }
})

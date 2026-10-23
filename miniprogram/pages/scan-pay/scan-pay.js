const store = require('../../utils/store')
const api = require('../../utils/api')
const scan = require('../../utils/scan')
const { requestWxPay } = require('../../utils/pay')

const KEYS = [
  { k: '1', label: '1' },
  { k: '2', label: '2' },
  { k: '3', label: '3' },
  { k: '4', label: '4' },
  { k: '5', label: '5' },
  { k: '6', label: '6' },
  { k: '7', label: '7' },
  { k: '8', label: '8' },
  { k: '9', label: '9' },
  { k: '.', label: '.' },
  { k: '0', label: '0' },
  { k: 'del', label: '删除' }
]

function parseAmount(text) {
  const s = String(text || '').trim()
  if (!s || s === '.') return 0
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100) / 100
}

function formatDisplay(text) {
  const s = String(text || '')
  if (!s) return '0.00'
  if (s.endsWith('.')) return `${s}00`.slice(0, s.length + 2)
  if (s.indexOf('.') < 0) return `${s}.00`
  const parts = s.split('.')
  return `${parts[0]}.${(parts[1] || '').padEnd(2, '0').slice(0, 2)}`
}

function headerOffset() {
  const sys = wx.getSystemInfoSync()
  const statusBarHeight = sys.statusBarHeight || 44
  try {
    const capsule = wx.getMenuButtonBoundingClientRect()
    if (capsule && capsule.bottom) return capsule.bottom + 8
  } catch (_) {}
  return statusBarHeight + 48
}

Page({
  data: {
    keys: KEYS,
    headerTop: 92,
    stallId: '',
    stall: {},
    amountText: '',
    displayAmount: '0.00',
    pointsHint: '输入金额后显示预计积分',
    authWarn: '',
    userName: '',
    payPrimary: false,
    payDisabled: true,
    payText: '支付',
    isConsumer: false,
    loggedIn: false,
    loading: true,
    loadError: '',
    paying: false,
    phase: 'input',
    paidCash: '0.00',
    paidPoints: 0,
    shortageText: ''
  },
  onLoad(query) {
    this._payLock = false
    this.setData({ headerTop: headerOffset() })
    const qid = String((query && (query.id || query.stallId || query.mid)) || '').trim()
    const pending = scan.getPendingPay()
    const stallId = qid || (pending && pending.stallId) || ''
    let amountText = String((query && query.amount) || '').trim()
    if (!amountText && pending && String(pending.stallId) === String(stallId)) {
      amountText = String(pending.amount || '')
    }
    if (!stallId) {
      this.setData({ loading: false, loadError: '未识别到摊位，请重新扫码' })
      return
    }
    this.setData({ stallId, amountText })
    this.syncAuth()
    this.loadStall(stallId)
  },
  onShow() {
    if (this.data.phase === 'success') return
    const pending = scan.getPendingPay()
    if (pending && String(pending.stallId) === String(this.data.stallId) && pending.amount) {
      if (String(this.data.amountText || '') !== String(pending.amount)) {
        this.setData({ amountText: String(pending.amount) })
      }
    }
    this.syncAuth()
  },
  onBack() {
    if (this.data.paying) return
    const pages = getCurrentPages() || []
    if (pages.length > 1) {
      wx.navigateBack({ fail: () => this.goHome() })
      return
    }
    this.goHome()
  },
  syncAuth() {
    const s = store.getSession() || {}
    const loggedIn = !!(s.role && store.getToken())
    const isConsumer = loggedIn && s.role === 'consumer'
    let authWarn = ''
    if (loggedIn && !isConsumer) {
      authWarn = '当前是商户账号，请点「登录并支付」换成消费者后再付款'
    }
    this.setData({
      loggedIn,
      isConsumer,
      authWarn,
      userName: s.name || s.shopName || '消费者'
    })
    this.refreshAmount()
  },
  async loadStall(stallId) {
    this.setData({ loading: true, loadError: '' })
    try {
      const data = await api.stallMenu(stallId)
      const stall = data.stall || {}
      try {
        const rate = await api.cashRate()
        if (rate && rate.rate) store.setCashRate(rate.rate)
      } catch (_) {}
      this.setData({
        loading: false,
        stall: {
          ...stall,
          initial: stall.initial || String(stall.name || '摊').slice(0, 1)
        }
      })
      this.refreshAmount()
      this.persist()
    } catch (e) {
      this.setData({
        loading: false,
        loadError: e.message || '摊位不存在或已歇业'
      })
    }
  },
  persist() {
    if (!this.data.stallId || this.data.phase === 'success') return
    scan.savePendingPay({ stallId: this.data.stallId, amount: this.data.amountText, resume: true })
  },
  refreshAmount() {
    const amountText = this.data.amountText
    const cash = parseAmount(amountText)
    const pts = cash > 0 ? store.cashToPoints(cash) : 0
    const hasAmount = cash >= 0.01
    const payPrimary = this.data.isConsumer
    const payDisabled =
      this.data.paying ||
      !hasAmount ||
      !this.data.isConsumer ||
      this.data.phase === 'success' ||
      !!this.data.loadError
    this.setData({
      displayAmount: formatDisplay(amountText),
      pointsHint: hasAmount ? `预计到账 ${pts} 积分（按当前汇率，以到账为准）` : '输入金额后显示预计积分',
      payPrimary,
      payDisabled,
      payText: payPrimary && hasAmount ? `支付 ¥${cash.toFixed(2)}` : '支付'
    })
  },
  onKey(e) {
    if (this.data.paying || this.data.phase === 'success') return
    const k = e.currentTarget.dataset.k
    let s = String(this.data.amountText || '')
    if (k === 'del') {
      s = s.slice(0, -1)
    } else if (k === '.') {
      if (!s) s = '0.'
      else if (s.indexOf('.') < 0) s += '.'
    } else {
      if (s === '0' && k !== '.') s = String(k)
      else {
        const dot = s.indexOf('.')
        if (dot >= 0 && s.length - dot > 2) return
        const intPart = dot >= 0 ? s.slice(0, dot) : s
        if (dot < 0 && intPart.replace(/^0+/, '').length >= 5) return
        s += k
      }
    }
    if (parseAmount(s) > 99999.99) {
      wx.showToast({ title: '单笔不超过 99999.99 元', icon: 'none' })
      return
    }
    this.setData({ amountText: s })
    this.refreshAmount()
    this.persist()
  },
  onLoginPay() {
    if (this.data.paying || this._payLock || this._confirming) return
    if (this.data.isConsumer) {
      this._confirming = true
      wx.showModal({
        title: '更换账号',
        content: '将前往登录页。登录成功后会回到本页，金额会保留，不会自动扣款。',
        confirmText: '去登录',
        complete: () => {
          this._confirming = false
        },
        success: (r) => {
          if (r.confirm) this.goLogin()
        }
      })
      return
    }
    this.goLogin()
  },
  goLogin() {
    this.persist()
    wx.navigateTo({ url: '/pages/login/login?from=scanpay' })
  },
  onPay() {
    if (this._payLock || this._confirming || this.data.paying || this.data.phase === 'success') return
    const cash = parseAmount(this.data.amountText)
    if (cash < 0.01) {
      wx.showToast({ title: '请输入消费金额', icon: 'none' })
      return
    }
    if (!this.data.isConsumer) {
      this.onLoginPay()
      return
    }
    const shop = this.data.stall.name || '本店'
    this._confirming = true
    wx.showModal({
      title: '确认支付',
      content: `向「${shop}」支付 ¥${cash.toFixed(2)}。支付成功后积分立即到账。`,
      confirmText: '确认支付',
      complete: () => {
        this._confirming = false
      },
      success: (r) => {
        if (r.confirm) this.submitPay(cash)
      }
    })
  },
  async submitPay(cash) {
    if (this._payLock || this.data.paying) return
    this._payLock = true
    this.setData({ paying: true })
    this.persist()
    try {
      const result = await api.scanPay({
        merchantId: Number(this.data.stallId),
        amount: cash
      })
      await requestWxPay(result)
      scan.clearPendingPay()
      const pts = Number(result.pointsAllocated != null ? result.pointsAllocated : result.pointsWant) || 0
      if (result.pointsBalance != null) store.setConsumerPoints(result.pointsBalance)
      await store.refreshProfile().catch(() => {})
      let shortageText = ''
      if (result.shortage && pts < Number(result.pointsWant || 0)) {
        shortageText = `本店额度不足，实际到账 ${pts} 积分（应到 ${result.pointsWant}）。`
      } else if (pts === 0) {
        shortageText = '本店暂无积分额度，消费已记账，积分为 0。'
      }
      this.setData({
        paying: false,
        phase: 'success',
        paidCash: cash.toFixed(2),
        paidPoints: pts,
        shortageText
      })
    } catch (e) {
      this._payLock = false
      this.setData({ paying: false })
      const msg = (e && e.message) || '支付失败'
      if (msg.indexOf('登录已失效') >= 0 || msg.indexOf('未登录') >= 0) {
        return
      }
      if (msg.indexOf('无权限') >= 0) {
        wx.showToast({ title: '请用消费者账号支付', icon: 'none' })
        return
      }
      if (msg.indexOf('登录') >= 0) {
        this.goLogin()
        return
      }
      if (msg.indexOf('接口不存在') >= 0) {
        wx.showToast({ title: '收款通道尚未开通，请稍后重试', icon: 'none' })
        return
      }
      wx.showToast({ title: msg, icon: 'none' })
    }
  },
  goRedeem() {
    wx.switchTab({ url: '/pages/cross/cross' })
  },
  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})

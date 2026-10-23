const store = require('../../utils/store')
const api = require('../../utils/api')

const FALLBACK_CARDS = [
  {
    role: 'consumer',
    label: 'C端用户',
    seal: 'C',
    desc: '逛市集、点餐、积分兑换',
    opened: true,
    active: true,
    pending: false,
    merchantId: null,
    shopName: '',
    badge: '已开通',
    applyTitle: '',
    applyPath: ''
  },
  {
    role: 'stall',
    label: '地摊商户',
    seal: '摊',
    desc: '摆摊点餐与收款经营',
    opened: false,
    active: false,
    pending: false,
    merchantId: null,
    shopName: '',
    badge: '未开通',
    applyTitle: '立即申请入驻地摊',
    applyPath: '/pages/apply/apply?role=stall'
  },
  {
    role: 'cross',
    label: '异业门店',
    seal: '店',
    desc: '异业核销与积分收银',
    opened: false,
    active: false,
    pending: false,
    merchantId: null,
    shopName: '',
    badge: '未开通',
    applyTitle: '立即申请入驻异业门店',
    applyPath: '/pages/apply/apply?role=cross'
  },
  {
    role: 'supply',
    label: '供应链',
    seal: '供',
    desc: '供货、报价与货款结算',
    opened: false,
    active: false,
    pending: false,
    merchantId: null,
    shopName: '',
    badge: '未开通',
    applyTitle: '立即申请入驻供应链',
    applyPath: '/pages/apply/apply?role=supply'
  }
]

Page({
  data: {
    identityCards: FALLBACK_CARDS
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    try {
      const identities = await api.listIdentities()
      if (identities && identities.cards) {
        this.setData({ identityCards: identities.cards })
      }
    } catch (_) {}
  },
  onIdentityTap(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const role = ds.role
    const opened = ds.opened === true || ds.opened === 'true'
    const pending = ds.pending === true || ds.pending === 'true'
    const active = ds.active === true || ds.active === 'true'
    const label = ds.label || store.ROLE_LABEL[role] || '该身份'
    const applyPath = ds.applyPath || `/pages/apply/apply?role=${role}`
    const applyTitle = ds.applyTitle || `立即申请入驻${label}`

    if (active) {
      wx.showToast({ title: '当前已是该身份', icon: 'none' })
      return
    }
    if (pending) {
      wx.showToast({ title: '入驻申请审核中，请稍候', icon: 'none' })
      return
    }
    if (!opened) {
      wx.showModal({
        title: '当前暂未开通',
        content: `${label}尚未开通。${applyTitle}？`,
        confirmText: '确定',
        cancelText: '取消',
        success: (r) => {
          if (r.confirm) wx.navigateTo({ url: applyPath })
        }
      })
      return
    }
    this.doSwitchIdentity(role, ds.merchantId)
  },
  async doSwitchIdentity(role, merchantId) {
    wx.showLoading({ title: '切换中', mask: true })
    try {
      const data = await api.switchIdentity({
        role,
        merchantId: merchantId || undefined
      })
      store.applyAuthResult(data)
      wx.hideLoading()
      wx.showToast({ title: '已切换', icon: 'success' })
      setTimeout(() => store.routeAfterLogin(), 400)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '切换失败', icon: 'none' })
    }
  }
})

const store = require('../../utils/store')
const api = require('../../utils/api')

/** 说明书五身份；地摊/异业/供应链仅为商家经营类型，禁止作为顶层身份卡 */
const ALLOWED_ROLES = ['consumer', 'merchant', 'partner', 'founder', 'lead']
const LEGACY_SHOP_ROLES = ['stall', 'cross', 'supply']

const FALLBACK_CARDS = [
  {
    role: 'consumer',
    label: '消费者',
    seal: '顾',
    desc: '点餐、下单、饭票/积分、逛市集',
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
    role: 'merchant',
    label: '商家',
    seal: '店',
    desc: '门店经营：地摊 / 异业 / 供应链供货',
    opened: false,
    active: false,
    pending: false,
    merchantId: null,
    shopName: '',
    badge: '未开通',
    applyTitle: '立即申请成为商家',
    applyPath: '/pages/apply/apply'
  },
  {
    role: 'partner',
    label: '合伙人',
    seal: '合',
    desc: '区域推广佣金、商家订单与供应链采购',
    opened: false,
    active: false,
    pending: false,
    merchantId: null,
    shopName: '',
    badge: '未开通',
    applyTitle: '立即申请成为合伙人',
    applyPath: '/partner/apply/apply'
  },
  {
    role: 'founder',
    label: '创始人',
    seal: '创',
    desc: '平台总控：审核、名单与经营监控',
    opened: false,
    active: false,
    pending: false,
    merchantId: null,
    shopName: '',
    badge: '未开通',
    applyTitle: '立即申请成为创始人',
    applyPath: '/pages/identity-apply/identity-apply?role=founder'
  },
  {
    role: 'lead',
    label: '负责人',
    seal: '负',
    desc: '创始人权限子集：审核与经营监控',
    opened: false,
    active: false,
    pending: false,
    merchantId: null,
    shopName: '',
    badge: '未开通',
    applyTitle: '立即申请成为负责人',
    applyPath: '/pages/identity-apply/identity-apply?role=lead'
  }
]

function normalizeIdentityCards(rawCards) {
  const list = Array.isArray(rawCards) ? rawCards : []
  const byRole = {}
  list.forEach((c) => {
    if (!c || !c.role) return
    if (ALLOWED_ROLES.includes(c.role)) {
      byRole[c.role] = c
      return
    }
    // 旧接口把 stall|cross|supply 拆成顶层卡 → 聚合进「商家」
    if (LEGACY_SHOP_ROLES.includes(c.role)) {
      const prev = byRole.merchant || {}
      const opened = !!(prev.opened || c.opened)
      const active = !!(prev.active || c.active)
      const pending = !opened && !!(prev.pending || c.pending)
      byRole.merchant = {
        ...prev,
        role: 'merchant',
        opened,
        active,
        pending,
        merchantId: opened ? c.merchantId || prev.merchantId || null : null,
        shopName: opened
          ? c.shopName || prev.shopName || ''
          : prev.shopName || '',
        badge: opened ? '已开通' : pending ? '审核中' : prev.badge || '未开通',
        shopType: c.role,
        applyPath: prev.applyPath || '/pages/apply/apply',
        applyTitle: prev.applyTitle || '立即申请成为商家'
      }
    }
  })

  return FALLBACK_CARDS.map((fb) => {
    const hit = byRole[fb.role]
    if (!hit) return { ...fb }
    return {
      ...fb,
      ...hit,
      role: fb.role,
      label: fb.label,
      seal: fb.seal,
      desc: fb.desc,
      applyPath: hit.applyPath || fb.applyPath,
      applyTitle: hit.applyTitle || fb.applyTitle
    }
  })
}

Page({
  data: {
    identityCards: FALLBACK_CARDS
  },
  async onShow() {
    if (!store.ensureIdentityAccess()) return
    try {
      const identities = await api.listIdentities()
      if (identities && identities.cards) {
        this.setData({ identityCards: normalizeIdentityCards(identities.cards) })
      }
    } catch (_) {
      this.setData({ identityCards: FALLBACK_CARDS })
    }
  },
  onIdentityTap(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const role = ds.role
    const opened = ds.opened === true || ds.opened === 'true'
    const pending = ds.pending === true || ds.pending === 'true'
    const active = ds.active === true || ds.active === 'true'
    const label = ds.label || store.ROLE_LABEL[role] || '该身份'
    const applyPath = ds.applyPath || ''
    const applyTitle = ds.applyTitle || `立即申请开通${label}`
    if (active) {
      wx.showToast({ title: '当前已是该身份', icon: 'none' })
      return
    }
    if (pending) {
      wx.showToast({ title: '申请审核中，请稍候', icon: 'none' })
      return
    }
    if (!opened) {
      if (!applyPath) {
        wx.showToast({ title: `${label}暂未开通`, icon: 'none' })
        return
      }
      const badgeText = String(ds.badge || '')
      const reapply =
        String(applyTitle || '').indexOf('重新') >= 0 || badgeText.indexOf('可重申') >= 0
      wx.showModal({
        title: reapply ? '可重新申请' : '当前暂未开通',
        content: reapply
          ? `${label}已停用或删除，可重新提交申请。是否去申请？`
          : `${label}尚未开通。${applyTitle}？审核需填写联系手机号。`,
        confirmText: '去申请',
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

const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    tab: 'merchant',
    list: [],
    loading: true
  },
  onLoad(query) {
    const tab = ['merchant', 'partner', 'withdraw'].includes(query.tab) ? query.tab : 'merchant'
    this.setData({ tab })
  },
  onShow() {
    if (!store.ensureFounderOrRedirect()) return
    this.load()
  },
  onTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    this.load()
  },
  async load() {
    this.setData({ loading: true, list: [] })
    try {
      const tab = this.data.tab
      let list = []
      if (tab === 'merchant') {
        const res = await api.founderApplies('pending')
        const rows = (res && res.list) || res || []
        list = (Array.isArray(rows) ? rows : []).map((r) => ({
          id: r.id,
          title: `${r.roleLabel || r.role || '商家'} · ${r.shopName || ''}`,
          meta: `${r.contactName || ''} ${r.contactPhone || ''} · ${r.city || ''} · ${r.applyNo || ''}`
        }))
      } else if (tab === 'partner') {
        const rows = await api.founderPartnerApplies('pending')
        list = (rows || []).map((r) => ({
          id: r.id,
          title: `合伙人 · ${r.contactName || ''}`,
          meta: `${r.contactPhone || ''} · ${r.city || ''} · ${r.applyNo || ''}`
        }))
      } else {
        const rows = await api.founderPartnerWithdraws('pending')
        list = (rows || []).map((r) => ({
          id: r.id,
          title: `提现 ${r.amountPoints || 0} 积分`,
          meta: `约 ¥${r.amountCash || 0} · 用户#${r.userId || ''} · ${r.accountName || ''}`
        }))
      }
      this.setData({ list, loading: false })
    } catch (e) {
      this.setData({ loading: false, list: [] })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  async onApprove(e) {
    const id = e.currentTarget.dataset.id
    const tab = this.data.tab
    try {
      wx.showLoading({ title: '处理中', mask: true })
      if (tab === 'merchant') await api.founderApproveApply(id, '')
      else if (tab === 'partner') await api.founderApprovePartner(id)
      else await api.founderReviewWithdraw(id, { action: 'approve' })
      wx.hideLoading()
      wx.showToast({ title: '已通过', icon: 'success' })
      this.load()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },
  onReject(e) {
    const id = e.currentTarget.dataset.id
    const tab = this.data.tab
    wx.showModal({
      title: '驳回原因',
      editable: true,
      placeholderText: '请填写原因',
      success: async (r) => {
        if (!r.confirm) return
        const reason = String(r.content || '').trim() || '资料不完整'
        try {
          wx.showLoading({ title: '处理中', mask: true })
          if (tab === 'merchant') await api.founderRejectApply(id, reason)
          else if (tab === 'partner') await api.founderRejectPartner(id, reason)
          else await api.founderReviewWithdraw(id, { action: 'reject', reason })
          wx.hideLoading()
          wx.showToast({ title: '已驳回', icon: 'none' })
          this.load()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: err.message || '失败', icon: 'none' })
        }
      }
    })
  }
})

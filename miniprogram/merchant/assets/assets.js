const store = require('../../utils/store')
const api = require('../../utils/api')

const ROLE_COPY = {
  stall: {
    desc: '区分微信直结与平台台账提现'
  },
  cross: {
    desc: '区分微信直结与平台台账提现'
  },
  supply: {
    desc: '货款台账与提现进度'
  }
}

function unwrapAccounts(data) {
  if (Array.isArray(data)) return { accounts: data, policy: null }
  return {
    accounts: (data && (data.accounts || data.list)) || [],
    policy: (data && data.policy) || null
  }
}

function unwrapWithdraws(data) {
  if (Array.isArray(data)) return { list: data, policy: null }
  return {
    list: (data && (data.list || data.withdraws)) || [],
    policy: (data && data.policy) || null
  }
}

Page({
  data: {
    accounts: [],
    withdraws: [],
    role: '',
    desc: '',
    notes: [],
    settlementHint: '',
    arriveHint: '',
    hasSubMerchant: false,
    minAmount: 10,
    loading: true
  },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    const copy = ROLE_COPY[s.role] || ROLE_COPY.stall
    this.setData({ role: s.role, desc: copy.desc, loading: true })
    try {
      const [accRaw, wdRaw] = await Promise.all([
        api.merchantAccounts(),
        api.merchantWithdraws().catch(() => [])
      ])
      const { accounts, policy: p1 } = unwrapAccounts(accRaw)
      const { list: withdraws, policy: p2 } = unwrapWithdraws(wdRaw)
      const policy = p1 || p2 || {}
      const minAmount = Number(policy.minAmount) > 0 ? Number(policy.minAmount) : 10
      const hasSub = !!policy.hasSubMerchant
      const notes = [
        policy.settlementHint ||
          '二级商户收款由微信结算到入驻银行卡；平台提现仅针对台账余额。',
        policy.withdrawableHint || '可提现仅含平台台账，不含微信直结实收',
        `平台台账提现：单笔须满 ¥${minAmount}`,
        policy.arriveHint || '台账提现申请通过后将在 1-3 个工作日内打到入驻银行卡'
      ]
      this.setData({
        loading: false,
        minAmount,
        hasSubMerchant: hasSub,
        settlementHint: policy.settlementHint || '',
        arriveHint: policy.arriveHint || '申请通过后将在 1-3 个工作日内提现到入驻时提交的银行卡',
        notes,
        accounts: (accounts || []).map((a) => {
          const balance = Math.max(0, Number(a.balance || 0))
          const canApply = balance >= minAmount
          const type = a.accountType || a.type
          return {
            ...a,
            accountType: type,
            label:
              type === 'cash_goods'
                ? '货款现金（平台台账）'
                : type === 'cash_settlement'
                  ? '可提现余额（平台台账）'
                  : '积分折现权益（平台台账）',
            balance,
            balanceText: `¥${balance.toFixed(2)}`,
            frozenText: Number(a.frozen || 0) > 0 ? `冻结 ¥${Number(a.frozen).toFixed(2)}` : '',
            canApply,
            btnText: canApply ? '申请台账提现' : balance > 0 ? `满¥${minAmount}可提` : '暂无台账可提余额'
          }
        }),
        withdraws: (withdraws || []).map((w) => ({
          ...w,
          amountText: `¥${Number(w.amount || 0).toFixed(2)}`,
          statusText:
            w.status === 'paid'
              ? '已打款'
              : w.status === 'approved'
                ? '已审核'
                : w.status === 'rejected'
                  ? '已驳回'
                  : '审核中',
          timeText: w.createdAt ? String(w.createdAt).replace('T', ' ').slice(0, 16) : ''
        }))
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  onWithdraw(e) {
    const type = e.currentTarget.dataset.type
    const acc = this.data.accounts.find((a) => a.accountType === type)
    if (!acc) return
    const minAmount = Number(this.data.minAmount) || 10
    if (Number(acc.balance || 0) < minAmount) {
      wx.showToast({ title: `可提余额须满 ¥${minAmount}`, icon: 'none' })
      return
    }
    const arriveHint =
      this.data.arriveHint || '申请通过后将在 1-3 个工作日内提现到入驻时提交的银行卡'
    wx.showModal({
      title: '申请提现',
      content: `${arriveHint}\n\n可提余额 ¥${Number(acc.balance).toFixed(2)}，单笔须满 ¥${minAmount}。请输入提现金额：`,
      editable: true,
      placeholderText: `不少于 ${minAmount}`,
      confirmText: '提交申请',
      success: async (r) => {
        if (!r.confirm || !r.content) return
        const amount = Number(r.content)
        if (!Number.isFinite(amount) || amount <= 0) {
          wx.showToast({ title: '请输入正确的提现金额', icon: 'none' })
          return
        }
        if (amount < minAmount) {
          wx.showToast({ title: `单笔提现须满 ¥${minAmount}`, icon: 'none' })
          return
        }
        if (amount > Number(acc.balance || 0)) {
          wx.showToast({ title: '提现金额超过可用余额', icon: 'none' })
          return
        }
        try {
          const res = await api.merchantWithdraw({ accountType: type, amount })
          wx.showModal({
            title: '已提交提现申请',
            content: (res && res.arriveHint) || arriveHint,
            showCancel: false
          })
          this.onShow()
        } catch (err) {
          wx.showToast({ title: err.message || '失败', icon: 'none' })
        }
      }
    })
  }
})

const store = require('../../utils/store')
const api = require('../../utils/api')

const ROLE_COPY = {
  stall: {
    desc: '营业额结算与积分折现权益',
    notes: ['货款与积分权益分账户展示', '提现申请提交后由平台审核']
  },
  cross: {
    desc: '兑换应收结算与积分权益',
    notes: ['积分兑换与现金交易分别记账', '可提现金额以平台结算结果为准']
  },
  supply: {
    desc: '供货回款与积分折现权益',
    notes: ['采购订单确认后计入货款账户', '提现申请提交后由平台审核']
  }
}

Page({
  data: {
    accounts: [],
    withdraws: [],
    role: '',
    desc: '',
    notes: [],
    loading: true
  },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    const copy = ROLE_COPY[s.role] || ROLE_COPY.stall
    this.setData({ role: s.role, desc: copy.desc, notes: copy.notes, loading: true })
    try {
      const [rows, withdraws] = await Promise.all([
        api.merchantAccounts(),
        api.merchantWithdraws().catch(() => [])
      ])
      this.setData({
        loading: false,
        accounts: (rows || []).map((a) => ({
          ...a,
          accountType: a.accountType || a.type,
          label:
            (a.accountType || a.type) === 'cash_goods'
              ? '货款现金'
              : (a.accountType || a.type) === 'cash_settlement'
                ? '应收结算'
                : '积分折现权益',
          balance: Number(a.balance || 0),
          balanceText: `¥${Number(a.balance || 0).toFixed(2)}`,
          frozenText: Number(a.frozen || 0) > 0 ? `冻结 ¥${Number(a.frozen).toFixed(2)}` : '可申请提现'
        })),
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
    wx.showModal({
      title: '申请提现',
      editable: true,
      placeholderText: `可提 ${acc.balance}`,
      success: async (r) => {
        if (!r.confirm || !r.content) return
        const amount = Number(r.content)
        if (!Number.isFinite(amount) || amount <= 0) {
          wx.showToast({ title: '请输入正确的提现金额', icon: 'none' })
          return
        }
        if (amount > Number(acc.balance || 0)) {
          wx.showToast({ title: '提现金额超过可用余额', icon: 'none' })
          return
        }
        try {
          await api.merchantWithdraw({ accountType: type, amount })
          wx.showToast({ title: '已提交', icon: 'success' })
          this.onShow()
        } catch (err) {
          wx.showToast({ title: err.message || '失败', icon: 'none' })
        }
      }
    })
  }
})

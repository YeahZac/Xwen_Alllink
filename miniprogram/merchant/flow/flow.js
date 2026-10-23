const store = require('../../utils/store')
const api = require('../../utils/api')

/** 账户口径是闭集；biz_type 是开放集且对商户无意义，不外显 */
const ACCOUNT_LABEL = {
  cash_goods: '货款账户',
  cash_settlement: '应收账户',
  points_redeem: '积分折现权益',
  pool: '积分额度池'
}

Page({
  data: { list: [], loading: true },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    this.setData({ loading: true })
    try {
      const rows = await api.merchantFlow()
      this.setData({
        loading: false,
        list: (rows || []).map((r) => ({
          id: r.id,
          title: r.title,
          amount:
            r.unit === 'points'
              ? `${Number(r.amount || 0) >= 0 ? '+' : '−'}${Math.abs(Number(r.amount || 0))} 积分`
              : `${Number(r.amount || 0) >= 0 ? '+' : '−'}¥${Math.abs(Number(r.amount || 0)).toFixed(2)}`,
          up: Number(r.amount || 0) >= 0,
          sub: [
            r.time ? String(r.time).replace('T', ' ').slice(0, 19) : '',
            ACCOUNT_LABEL[r.accountType] || ''
          ]
            .filter(Boolean)
            .join(' · ')
        }))
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  }
})

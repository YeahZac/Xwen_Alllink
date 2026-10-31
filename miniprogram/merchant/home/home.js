const store = require('../../utils/store')
const api = require('../../utils/api')
const legal = require('../../utils/legal')
const { ensureCloud } = require('../../utils/request')

const META = {
  stall: {
    name: '地摊',
    assetsHint: '积分额度池 · 营业额结算'
  },
  supply: {
    name: '供应链',
    assetsHint: '货款账户 · 积分折现权益'
  },
  cross: {
    name: '异业',
    assetsHint: '应收结算 · 积分额度池'
  }
}

const SEAL_BY_TONE = {
  seal: 'm-row__seal--red',
  ink: '',
  gold: 'm-row__seal--gold',
  teal: 'm-row__seal--teal',
  soft: 'm-row__seal--soft'
}

function withSeal(rows) {
  return rows.map((row) => ({
    ...row,
    sealClass: SEAL_BY_TONE[row.tone] || ''
  }))
}

/** 对齐 ok-merchant：2×3 功能宫格，不堆协议与次要入口 */
function menusFor(role) {
  if (role === 'stall') {
    return withSeal([
      { id: 'goods', icon: '品', tone: 'seal', title: '销售商品', sub: '菜单上架与售价', url: '/merchant/goods/goods' },
      { id: 'customers', icon: '客', tone: 'gold', title: '客户列表', sub: '到店消费者', url: '/merchant/customers/customers' },
      { id: 'flow', icon: '流', tone: 'teal', title: '交易流水', sub: '收款与采购', url: '/merchant/flow/flow' },
      { id: 'purchase', icon: '采', tone: 'seal', title: '向供应链采购', sub: '成交获积分额度', url: '/merchant/purchase/purchase' },
      { id: 'pool', icon: '池', tone: 'soft', title: '积分额度管理', sub: '池余额与划拨', url: '/merchant/points-pool/points-pool' },
      { id: 'orders', icon: '单', tone: 'ink', title: '订单中心', sub: '点餐履约与出餐', url: '/merchant/orders/orders' }
    ])
  }
  if (role === 'cross') {
    return withSeal([
      { id: 'goods', icon: '品', tone: 'seal', title: '门店商品', sub: '积分价 / 现金价', url: '/merchant/goods/goods' },
      { id: 'customers', icon: '客', tone: 'gold', title: '客流与客户', sub: '积分客 / 现金客', url: '/merchant/customers/customers' },
      { id: 'flow', icon: '流', tone: 'teal', title: '成交流水', sub: '核销与收银', url: '/merchant/flow/flow' },
      { id: 'purchase', icon: '采', tone: 'seal', title: '采购获额度', sub: '向供应链进货', url: '/merchant/purchase/purchase' },
      { id: 'pool', icon: '池', tone: 'soft', title: '积分额度管理', sub: '池余额查询', url: '/merchant/points-pool/points-pool' },
      { id: 'orders', icon: '单', tone: 'ink', title: '兑换订单', sub: '积分 / 现金核销', url: '/merchant/orders/orders' }
    ])
  }
  return withSeal([
    { id: 'needs', icon: '需', tone: 'seal', title: '采购需求大厅', sub: '查看待报价原料需求', url: '/merchant/needs/needs' },
    { id: 'goods', icon: '货', tone: 'seal', title: '供货商品', sub: '库存与积分比例', url: '/merchant/goods/goods' },
    { id: 'orders', icon: '单', tone: 'ink', title: '采购订单', sub: '发货 / 确认', url: '/merchant/orders/orders' },
    { id: 'customers', icon: '店', tone: 'gold', title: '客户门店', sub: '地摊 / 异业客户', url: '/merchant/customers/customers' },
    { id: 'flow', icon: '流', tone: 'teal', title: '交易流水', sub: '出货与提现', url: '/merchant/flow/flow' },
    { id: 'assets', icon: '资', tone: 'soft', title: '资产账户', sub: '货款与积分折现', url: '/merchant/assets/assets' }
  ])
}

Page({
  data: {
    role: 'stall',
    roleName: '',
    navTitle: '商户工作台',
    shopName: '',
    userName: '',
    heroMeta: '',
    coverUrl: '',
    assetsHint: '',
    kpi: {},
    menus: [],
    loading: true,
    loadError: '',
    shopOpen: true,
    feeHint: ''
  },
  onLoad() {
    ensureCloud()
  },
  async onShow() {
    if (!store.ensureMerchantOrRedirect()) return
    const s = store.getSession()
    await this.applyRole(s)
  },
  async applyRole(session) {
    const role = session.role
    const m = META[role] || META.stall
    let dash = {}
    try {
      dash = await api.merchantDashboard()
    } catch (e) {
      this.setData({ loadError: e.message || '经营数据加载失败' })
    }
    const fee = dash.fee || {}
    const shopOpen = dash.merchant ? Number(dash.merchant.status) === 1 : true
    const kpi =
      role === 'supply'
        ? {
            a: `¥${Number(dash.monthAmount || 0).toFixed(0)}`,
            aLabel: '本月出货',
            b: String(dash.monthOrders || 0),
            bLabel: '本月订单',
            c: String(dash.goodsCount || 0),
            cLabel: '在售SKU'
          }
        : role === 'cross'
          ? {
              a: `¥${Number(dash.todayAmount || 0).toFixed(0)}`,
              aLabel: '今日现金',
              b: `${dash.todayPointsOrders || 0}/${dash.todayCashOrders || 0}`,
              bLabel: '积分单/现金单',
              c: String(dash.poolBalance != null ? dash.poolBalance : session.poolBalance || 0),
              cLabel: '积分额度池'
            }
          : {
              a: `¥${Number(dash.todayAmount || 0).toFixed(0)}`,
              aLabel: '今日营业额',
              b: String(dash.todayOrders || 0),
              bLabel: '今日单量',
              c: String(dash.todayPointsAllocated != null ? dash.todayPointsAllocated : dash.poolBalance || 0),
              cLabel: dash.todayPointsAllocated != null ? '今日划拨积分' : '积分额度池'
            }

    let feeHint = ''
    if (fee.inTrial) feeHint = `体验期剩余 ${fee.trialDaysLeft || 0} 天`
    else if (fee.dueAmount > 0) feeHint = `待缴服务费 ¥${Number(fee.dueAmount).toFixed(0)}`
    else if (fee.serviceStatus === 'overdue') feeHint = '服务费已逾期，请联系平台'

    const shopName = session.shopName || '未命名门店'
    const userName = session.name || session.contactName || '老板'
    const featureTags =
      role === 'supply'
        ? '需求大厅 · 供货商品 · 发货 · 客户门店 · 资产账户'
        : role === 'cross'
          ? '门店商品 · 兑换订单 · 客户 · 流水 · 采购获额度'
          : '销售商品 · 客户 · 流水 · 采购获额度 · 划拨给顾客'
    this.setData({
      role,
      roleName: m.name,
      navTitle: `${m.name}工作台`,
      shopName,
      userName,
      heroMeta: featureTags,
      coverUrl: (dash.merchant && dash.merchant.coverUrl) || session.coverUrl || '',
      assetsHint: role === 'supply' ? '资产账户' : `资产账户 · ${m.assetsHint}`,
      kpi,
      shopOpen,
      feeHint,
      menus: menusFor(role),
      loading: false
    })
  },
  go(e) {
    const url = e.currentTarget.dataset.url
    wx.navigateTo({ url: `${url}?role=${this.data.role}` })
  },
  goAssets() {
    wx.navigateTo({ url: `/merchant/assets/assets?role=${this.data.role}` })
  },
  async onToggleOpen() {
    const next = !this.data.shopOpen
    try {
      await api.setMerchantOpen(next)
      this.setData({ shopOpen: next })
      wx.showToast({ title: next ? '已开业' : '已歇业', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    }
  },
  onQr() {
    this.onOrderQr()
  },
  onOrderQr() {
    const merchantId = store.getSession().merchantId
    const role = this.data.role
    const pagePath =
      role === 'cross'
        ? `/pages/cross-detail/cross-detail?id=${merchantId}`
        : `/pages/stall-menu/stall-menu?id=${merchantId}`
    wx.showModal({
      title: '点餐码',
      content: `顾客用微信扫码后直接进入本店下单支付。\n路径：${pagePath}\n\n正式码需调用微信 getwxacodeunlimit 生成小程序码图片（可后续在商户端一键下载）。`,
      confirmText: '复制路径',
      cancelText: '关闭',
      success: (result) => {
        if (result.confirm) wx.setClipboardData({ data: pagePath })
      }
    })
  },
  onPayQr() {
    const merchantId = store.getSession().merchantId
    const pagePath = `/pages/scan-pay/scan-pay?id=${merchantId}`
    wx.showModal({
      title: '支付码 · 待服务商开通',
      content: `顾客扫码后输入金额付款到本店。\n路径：${pagePath}\n\n当前：业务路径已通，但真实微信支付（进店主钱包 + 平台抽成）需完成服务商入驻与二级商户号绑定后才能上线；现阶段为模拟入账。`,
      confirmText: '复制路径',
      cancelText: '关闭',
      success: (result) => {
        if (result.confirm) wx.setClipboardData({ data: pagePath })
      }
    })
  },
  async onSwitchConsumer() {
    wx.showLoading({ title: '切换中', mask: true })
    try {
      const data = await api.switchIdentity({ role: 'consumer' })
      store.applyAuthResult(data)
      wx.hideLoading()
      wx.showToast({ title: '已切回 C 端', icon: 'success' })
      setTimeout(() => store.routeAfterLogin(), 400)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '切换失败', icon: 'none' })
    }
  },
  openLegalDoc(e) {
    const key = e.currentTarget.dataset.key
    legal.openDoc(key)
  },
  onLogout() {
    store.logout()
    wx.reLaunch({ url: '/pages/login/login' })
  }
})

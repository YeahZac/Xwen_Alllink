const store = require('../../utils/store')
const api = require('../../utils/api')
const legal = require('../../utils/legal')
const { ensureCloud } = require('../../utils/request')

const META = {
  stall: {
    name: '商家·地摊',
    assetsHint: '积分额度池 · 营业额结算'
  },
  supply: {
    name: '商家·供应链供货',
    assetsHint: '货款账户 · 积分折现权益'
  },
  cross: {
    name: '商家·异业',
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

/** 对齐说明书商家端：工作台 / 订单 / 物料·财务·供应链（落在现有能力上） */
function menusFor(role) {
  if (role === 'stall') {
    return withSeal([
      { id: 'orders', icon: '单', tone: 'ink', title: '订单', sub: '待出单 / 出餐履约', url: '/merchant/orders/orders' },
      { id: 'goods', icon: '品', tone: 'seal', title: '菜品物料', sub: '菜单上架与售价', url: '/merchant/goods/goods' },
      { id: 'flow', icon: '财', tone: 'teal', title: '财务', sub: '收款与流水', url: '/merchant/flow/flow' },
      { id: 'purchase', icon: '供', tone: 'seal', title: '供应链', sub: '向平台采购获额度', url: '/merchant/purchase/purchase' },
      { id: 'pool', icon: '票', tone: 'soft', title: '饭票/积分池', sub: '额度与划拨', url: '/merchant/points-pool/points-pool' },
      { id: 'customers', icon: '客', tone: 'gold', title: '我的客户', sub: '到店消费者', url: '/merchant/customers/customers' }
    ])
  }
  if (role === 'cross') {
    return withSeal([
      { id: 'orders', icon: '单', tone: 'ink', title: '订单', sub: '兑换核销履约', url: '/merchant/orders/orders' },
      { id: 'goods', icon: '品', tone: 'seal', title: '门店商品', sub: '积分价 / 现金价', url: '/merchant/goods/goods' },
      { id: 'flow', icon: '财', tone: 'teal', title: '财务', sub: '核销与收银流水', url: '/merchant/flow/flow' },
      { id: 'purchase', icon: '供', tone: 'seal', title: '供应链', sub: '采购获积分额度', url: '/merchant/purchase/purchase' },
      { id: 'pool', icon: '票', tone: 'soft', title: '饭票/积分池', sub: '池余额查询', url: '/merchant/points-pool/points-pool' },
      { id: 'customers', icon: '客', tone: 'gold', title: '我的客户', sub: '积分客 / 现金客', url: '/merchant/customers/customers' }
    ])
  }
  return withSeal([
    { id: 'orders', icon: '单', tone: 'ink', title: '订单', sub: '采购单发货确认', url: '/merchant/orders/orders' },
    { id: 'needs', icon: '需', tone: 'seal', title: '需求大厅', sub: '待报价原料需求', url: '/merchant/needs/needs' },
    { id: 'goods', icon: '货', tone: 'seal', title: '供货商品', sub: '库存与报价', url: '/merchant/goods/goods' },
    { id: 'flow', icon: '财', tone: 'teal', title: '财务', sub: '出货与提现流水', url: '/merchant/flow/flow' },
    { id: 'customers', icon: '店', tone: 'gold', title: '客户门店', sub: '地摊 / 异业客户', url: '/merchant/customers/customers' },
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
    feeHint: '',
    readyHint: '',
    catalogReady: false
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
    if (fee.inTrial) feeHint = `试用期剩余 ${fee.trialDaysLeft || 0} 天`
    else if (fee.dueAmount > 0) feeHint = `待缴服务费 ¥${Number(fee.dueAmount).toFixed(0)}`
    else if (fee.serviceStatus === 'overdue') feeHint = '服务费已逾期，请联系平台'

    const catalogReady = dash.catalogReady === true
    let readyHint = ''
    if (!catalogReady) {
      const st = dash.wxApplyState || ''
      if (!dash.wxSubMchId) {
        readyHint = '尚未完成二级商户进件：商品可先存草稿，进件完成并支付就绪后才能上架进首页'
      } else if (st && st !== 'FINISH') {
        readyHint = `进件状态「${st}」：完成签约并同步为已完成后，才能上架商品`
      } else if (dash.platformPayReady === false) {
        readyHint = '平台支付配置未就绪，暂不能上架收款商品'
      } else {
        readyHint = '上架条件未满足：请先完成二级商户进件'
      }
    }

    const shopName = session.shopName || '未命名门店'
    const userName = session.name || session.contactName || '老板'
    const featureTags =
      role === 'supply'
        ? '商家工作台 · 订单 · 需求 · 财务 · 客户'
        : role === 'cross'
          ? '商家工作台 · 订单 · 财务 · 供应链 · 饭票/积分'
          : '商家工作台 · 订单 · 菜品 · 财务 · 供应链'
    this.setData({
      role,
      roleName: m.name,
      navTitle: '商家工作台',
      shopName,
      userName,
      heroMeta: featureTags,
      coverUrl: (dash.merchant && dash.merchant.coverUrl) || session.coverUrl || '',
      assetsHint: role === 'supply' ? '资产账户' : `资产账户 · ${m.assetsHint}`,
      kpi,
      shopOpen,
      feeHint,
      readyHint,
      catalogReady,
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
  async previewAndSaveQr(kind) {
    try {
      wx.showLoading({ title: '生成小程序码', mask: true })
      const data = await api.merchantStoreQrcode(kind, false)
      wx.hideLoading()
      const url = data.qrcodeUrl
      if (!url) throw new Error('未返回二维码')
      wx.previewImage({ urls: [url], current: url })
      wx.showActionSheet({
        itemList: ['保存到相册', '复制页面路径'],
        success: async (r) => {
          if (r.tapIndex === 1) {
            wx.setClipboardData({ data: data.path || '' })
            return
          }
          try {
            const dl = await new Promise((resolve, reject) => {
              wx.downloadFile({
                url,
                success: resolve,
                fail: reject
              })
            })
            await new Promise((resolve, reject) => {
              wx.saveImageToPhotosAlbum({
                filePath: dl.tempFilePath,
                success: resolve,
                fail: reject
              })
            })
            wx.showToast({ title: '已保存相册', icon: 'success' })
          } catch (e) {
            wx.showToast({
              title: e.errMsg && /auth deny|authorize/i.test(e.errMsg) ? '请允许保存到相册' : e.message || '保存失败',
              icon: 'none'
            })
          }
        }
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '生成失败', icon: 'none' })
    }
  },
  onOrderQr() {
    this.previewAndSaveQr('menu')
  },
  onPayQr() {
    this.previewAndSaveQr('pay')
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
  goIdentity() {
    wx.navigateTo({ url: '/pages/identity/identity' })
  },
  openLegalDoc(e) {
    const key = e.currentTarget.dataset.key
    legal.openDoc(key)
  },
  onLogout() {
    store.logout()
    store.enterAsGuest()
  }
})

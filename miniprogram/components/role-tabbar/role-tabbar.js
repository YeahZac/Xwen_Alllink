Component({
  properties: {
    role: { type: String, value: 'merchant' },
    active: { type: String, value: 'home' }
  },
  data: {
    tabs: []
  },
  lifetimes: {
    attached() {
      this.rebuild()
    }
  },
  observers: {
    role() {
      this.rebuild()
    }
  },
  methods: {
    rebuild() {
      const role = this.properties.role || 'merchant'
      const map = {
        merchant: [
          { id: 'home', title: '工作台', url: '/merchant/home/home' },
          { id: 'orders', title: '订单', url: '/merchant/orders/orders' },
          { id: 'goods', title: '物料', url: '/merchant/goods/goods' },
          { id: 'finance', title: '财务', url: '/merchant/flow/flow' },
          { id: 'supply', title: '供应链', url: '/merchant/purchase/purchase' },
          { id: 'mine', title: '我的', url: '/merchant/mine/mine' }
        ],
        partner: [
          { id: 'home', title: '首页', url: '/partner/home/home' },
          { id: 'books', title: '内部账目', url: '/partner/books/books' },
          { id: 'orders', title: '商家订单', url: '/partner/orders/orders' },
          { id: 'supply', title: '供应链', url: '/partner/supply/supply' },
          { id: 'purchase', title: '采购', url: '/partner/purchase/purchase' }
        ],
        founder: [
          { id: 'home', title: '总览', url: '/founder/home/home' },
          { id: 'audit', title: '审核', url: '/founder/applies/applies' },
          { id: 'members', title: '名单', url: '/founder/members/members' },
          { id: 'logs', title: '日志', url: '/founder/logs/logs' },
          { id: 'perms', title: '权限', url: '/founder/perms/perms' }
        ]
      }
      this.setData({ tabs: map[role] || map.merchant })
    },
    onTap(e) {
      const url = e.currentTarget.dataset.url
      const id = e.currentTarget.dataset.id
      if (!url || id === this.properties.active) return
      wx.redirectTo({
        url,
        fail: () => wx.reLaunch({ url })
      })
    }
  }
})

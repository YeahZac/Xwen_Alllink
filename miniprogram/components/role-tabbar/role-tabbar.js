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
      // 文案控制在 2～4 字，配合图标对齐 C 端 tabBar 规格，避免底部文字被裁切
      const map = {
        merchant: [
          {
            id: 'home',
            title: '工作台',
            url: '/merchant/home/home',
            icon: '/assets/icons/tab-home.png',
            iconOn: '/assets/icons/tab-home-active.png'
          },
          {
            id: 'orders',
            title: '订单',
            url: '/merchant/orders/orders',
            icon: '/assets/icons/home-entry/entry-order.png',
            iconOn: '/assets/icons/home-entry/entry-order.png'
          },
          {
            id: 'goods',
            title: '物料',
            url: '/merchant/goods/goods',
            icon: '/assets/icons/home-entry/entry-shop.png',
            iconOn: '/assets/icons/home-entry/entry-shop.png'
          },
          {
            id: 'finance',
            title: '财务',
            url: '/merchant/flow/flow',
            icon: '/assets/icons/tab-points.png',
            iconOn: '/assets/icons/tab-points-active.png'
          },
          {
            id: 'supply',
            title: '供应',
            url: '/merchant/purchase/purchase',
            icon: '/assets/icons/home-entry/entry-need.png',
            iconOn: '/assets/icons/home-entry/entry-need.png'
          },
          {
            id: 'mine',
            title: '我的',
            url: '/merchant/mine/mine',
            icon: '/assets/icons/tab-mine.png',
            iconOn: '/assets/icons/tab-mine-active.png'
          }
        ],
        partner: [
          {
            id: 'home',
            title: '首页',
            url: '/partner/home/home',
            icon: '/assets/icons/tab-home.png',
            iconOn: '/assets/icons/tab-home-active.png'
          },
          {
            id: 'books',
            title: '账目',
            url: '/partner/books/books',
            icon: '/assets/icons/tab-points.png',
            iconOn: '/assets/icons/tab-points-active.png'
          },
          {
            id: 'orders',
            title: '订单',
            url: '/partner/orders/orders',
            icon: '/assets/icons/home-entry/entry-order.png',
            iconOn: '/assets/icons/home-entry/entry-order.png'
          },
          {
            id: 'supply',
            title: '供应',
            url: '/partner/supply/supply',
            icon: '/assets/icons/home-entry/entry-need.png',
            iconOn: '/assets/icons/home-entry/entry-need.png'
          },
          {
            id: 'purchase',
            title: '采购',
            url: '/partner/purchase/purchase',
            icon: '/assets/icons/home-entry/entry-shop.png',
            iconOn: '/assets/icons/home-entry/entry-shop.png'
          }
        ],
        founder: [
          {
            id: 'home',
            title: '总览',
            url: '/founder/home/home',
            icon: '/assets/icons/tab-home.png',
            iconOn: '/assets/icons/tab-home-active.png'
          },
          {
            id: 'audit',
            title: '审核',
            url: '/founder/applies/applies',
            icon: '/assets/icons/home-entry/entry-order.png',
            iconOn: '/assets/icons/home-entry/entry-order.png'
          },
          {
            id: 'members',
            title: '名单',
            url: '/founder/members/members',
            icon: '/assets/icons/tab-mine.png',
            iconOn: '/assets/icons/tab-mine-active.png'
          },
          {
            id: 'logs',
            title: '日志',
            url: '/founder/logs/logs',
            icon: '/assets/icons/tab-points.png',
            iconOn: '/assets/icons/tab-points-active.png'
          },
          {
            id: 'perms',
            title: '权限',
            url: '/founder/perms/perms',
            icon: '/assets/icons/tab-cross.png',
            iconOn: '/assets/icons/tab-cross-active.png'
          }
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

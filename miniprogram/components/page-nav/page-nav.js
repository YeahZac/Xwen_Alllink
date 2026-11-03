const { getNavMetrics } = require('../../utils/nav-metrics')

Component({
  properties: {
    title: { type: String, value: '' },
    tone: { type: String, value: 'solid' }, // solid | gradient | flush
    showHome: { type: Boolean, value: false },
    showBack: { type: Boolean, value: false },
    homeUrl: { type: String, value: '/pages/index/index' },
    /** B 端工作台：先切消费者身份再进 C 端，避免被 ensureConsumer 踢回 */
    homeSwitchConsumer: { type: Boolean, value: false },
    flush: { type: Boolean, value: false }
  },
  data: {
    padTop: 20,
    barHeight: 44,
    capsuleRight: 96
  },
  lifetimes: {
    attached() {
      const m = getNavMetrics()
      this.setData({
        padTop: m.statusBarHeight,
        barHeight: m.navBarHeight,
        capsuleRight: m.capsuleRight
      })
    }
  },
  methods: {
    async onHome() {
      if (this.properties.homeSwitchConsumer) {
        try {
          const store = require('../../utils/store')
          await store.switchToConsumerHome()
        } catch (_) {
          wx.reLaunch({ url: '/pages/index/index' })
        }
        return
      }
      const url = this.data.homeUrl || '/pages/index/index'
      wx.switchTab({
        url,
        fail: () => wx.reLaunch({ url })
      })
    },
    onBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) wx.navigateBack({ delta: 1 })
      else this.onHome()
    }
  }
})

const api = require('../../utils/api')
const { mergeBanners } = require('../../utils/banner-pack')

Component({
  properties: {
    role: {
      type: String,
      value: 'consumer'
    },
    height: {
      type: Number,
      value: 280
    }
  },
  data: {
    list: [],
    current: 0
  },
  observers: {
    role(r) {
      this.load(r)
    }
  },
  lifetimes: {
    attached() {
      this.load(this.properties.role)
    }
  },
  methods: {
    async load(role) {
      const scope = role || 'consumer'
      let rows = []
      try {
        rows = await api.banners(scope)
      } catch (_) {
        rows = []
      }
      this.setData({ list: mergeBanners(scope, rows), current: 0 })
    },
    onImgError(e) {
      const idx = e.currentTarget.dataset.index
      this.setData({ [`list[${idx}].imgError`]: true })
    },
    onChange(e) {
      this.setData({ current: e.detail.current })
    },
    onTap(e) {
      const idx = e.currentTarget.dataset.index
      const item = this.data.list[idx]
      if (!item || !item.link || item.linkType === 'none') {
        return
      }
      const link = String(item.link)
      if (
        item.linkType === 'switchTab' ||
        link.indexOf('/pages/index/') === 0 ||
        link.indexOf('/pages/cross/') === 0 ||
        link.indexOf('/pages/points/') === 0 ||
        link.indexOf('/pages/mine/') === 0
      ) {
        wx.switchTab({ url: link.split('?')[0] })
      } else if (item.linkType === 'navigate' || link.charAt(0) === '/') {
        wx.navigateTo({
          url: link,
          fail: () => wx.switchTab({ url: link.split('?')[0], fail: () => {} })
        })
      }
    }
  }
})

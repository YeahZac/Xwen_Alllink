const api = require('../../utils/api')
const { mergeBanners } = require('../../utils/banner-pack')
const mediaCache = require('../../utils/media-cache')

Component({
  properties: {
    role: {
      type: String,
      value: 'consumer'
    },
    height: {
      type: Number,
      value: 280
    },
    force: {
      type: Boolean,
      value: false
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
      // 先塞兜底，避免接口慢时整块空白
      const scope = this.properties.role || 'consumer'
      this.setData({ list: mergeBanners(scope, []) })
      this.load(scope)
    }
  },
  methods: {
    async hydrateCache(list) {
      const next = list.slice()
      for (let i = 0; i < next.length; i++) {
        const item = next[i]
        if (!item || !item.image || item.image.indexOf('/assets/') === 0) continue
        try {
          const local = await mediaCache.resolve(item.image)
          if (local && local !== item.image) next[i] = { ...item, image: local }
        } catch (_) {}
      }
      return next
    },
    async load(role) {
      const scope = role || 'consumer'
      let rows = []
      try {
        rows = await api.banners(scope)
      } catch (_) {
        rows = []
      }
      let list = mergeBanners(scope, rows)
      if (!list.length) list = mergeBanners(scope, [])
      this.setData({ list, current: 0 })
      try {
        const cached = await this.hydrateCache(list)
        this.setData({ list: cached })
      } catch (_) {}
    },
    onImgError(e) {
      const idx = Number(e.currentTarget.dataset.index)
      if (Number.isNaN(idx) || idx < 0) return
      const item = this.data.list[idx]
      if (!item) return
      const pack = mergeBanners(this.properties.role || 'consumer', [])
      const fallback = pack[idx % pack.length]
      const cloud = fallback && fallback.image
      // 云端失败时保留本地占位，避免整块空白
      if (cloud && cloud !== item.image) {
        this.setData({
          [`list[${idx}].image`]: cloud,
          [`list[${idx}].imgError`]: false
        })
        return
      }
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

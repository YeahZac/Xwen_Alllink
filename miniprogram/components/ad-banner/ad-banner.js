const api = require('../../utils/api')
const { mergeBanners } = require('../../utils/banner-pack')
const mediaCache = require('../../utils/media-cache')

const TAB_PREFIXES = [
  '/pages/index/',
  '/pages/cross/',
  '/pages/points/',
  '/pages/mine/'
]

Component({
  properties: {
    role: {
      type: String,
      value: 'consumer'
    },
    pageKey: {
      type: String,
      value: ''
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
    'role, pageKey'() {
      this.load()
    }
  },
  lifetimes: {
    attached() {
      const scope = this.properties.role || 'consumer'
      this.setData({ list: mergeBanners(scope, []) })
      this.load()
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
    async load() {
      const scope = this.properties.role || 'consumer'
      const pageKey = this.properties.pageKey || ''
      let rows = []
      try {
        rows = await api.banners(scope, pageKey)
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
      if (!item) return
      const linkType = String(item.linkType || 'none')
      const title = encodeURIComponent(item.title || item.jumpName || '')
      if (linkType === 'none' || linkType === '') return

      if (linkType === 'image_detail') {
        const src = String(item.linkImageUrl || item.image || '').trim()
        if (!src) {
          wx.showToast({ title: '暂无图片', icon: 'none' })
          return
        }
        wx.navigateTo({
          url: `/pages/banner-image/banner-image?src=${encodeURIComponent(src)}&title=${title}`,
          fail: () => wx.showToast({ title: '无法打开图片页', icon: 'none' })
        })
        return
      }

      if (linkType === 'miniprogram') {
        const appId = String(item.linkAppid || '').trim()
        const path = String(item.link || '').trim()
        if (!appId) {
          wx.showToast({ title: '未配置小程序', icon: 'none' })
          return
        }
        wx.navigateToMiniProgram({
          appId,
          path: path || '',
          fail: () => wx.showToast({ title: '无法打开该小程序', icon: 'none' })
        })
        return
      }

      if (linkType === 'url') {
        const url = String(item.link || '').trim()
        if (!/^https?:\/\//i.test(url)) {
          wx.showToast({ title: '链接无效', icon: 'none' })
          return
        }
        wx.navigateTo({
          url: `/pages/webview/webview?url=${encodeURIComponent(url)}&title=${title}`,
          fail: () =>
            wx.showModal({
              title: '无法打开网页',
              content: '请在小程序后台将业务域名加入白名单后再试',
              showCancel: false
            })
        })
        return
      }

      // page / 兼容旧 navigate、switchTab
      const link = String(item.link || '').trim()
      if (!link) return
      const pathOnly = link.split('?')[0]
      const isTab = TAB_PREFIXES.some((p) => pathOnly.indexOf(p) === 0)
      if (isTab || linkType === 'switchTab') {
        wx.switchTab({ url: pathOnly, fail: () => {} })
        return
      }
      wx.navigateTo({
        url: link.charAt(0) === '/' ? link : `/${link}`,
        fail: () => wx.switchTab({ url: pathOnly, fail: () => {} })
      })
    }
  }
})

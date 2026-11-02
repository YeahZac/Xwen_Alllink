/**
 * 云端静态资源（Banner / 店卡封面）。
 * 大图走 COS；本地仅保留 placeholders 与 Tab/入口小图标。
 */
const manifest = require('./cdn-manifest')

const CDN_HOST = String((manifest && manifest.cdnHost) || '').replace(/\/+$/, '')
const PLACEHOLDER_BANNER = '/assets/placeholders/banner-loading.jpg'
const PLACEHOLDER_COVER = '/assets/placeholders/cover-loading.jpg'

function isOurCdn(url) {
  const s = String(url || '')
  if (!s) return false
  if (CDN_HOST && s.indexOf(CDN_HOST) === 0) return true
  return /tcb\.qcloud\.la\/admin\/mp-static\//i.test(s)
}

function bannerUrl(fileName) {
  const key = String(fileName || '').replace(/^.*\//, '')
  return (manifest.banners && manifest.banners[key]) || PLACEHOLDER_BANNER
}

function coverUrl(fileName) {
  const key = String(fileName || '').replace(/^.*\//, '')
  return (manifest.covers && manifest.covers[key]) || PLACEHOLDER_COVER
}

module.exports = {
  CDN_HOST,
  PLACEHOLDER_BANNER,
  PLACEHOLDER_COVER,
  isOurCdn,
  bannerUrl,
  coverUrl,
  manifest
}

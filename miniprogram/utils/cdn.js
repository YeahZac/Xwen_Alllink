/**
 * 云端静态资源（Banner / 店卡封面）。
 * 大图走 COS；本地仅保留 placeholders 与 Tab/入口小图标。
 */
const manifest = require('./cdn-manifest')

const CDN_HOST = String((manifest && manifest.cdnHost) || '').replace(/\/+$/, '')
const PLACEHOLDER_BANNER = '/assets/placeholders/banner-loading.jpg'
const PLACEHOLDER_COVER = '/assets/placeholders/cover-loading.jpg'

/** 平台静态素材或业务上传 CDN（不含旧 admin/cover 模拟图） */
function isOurCdn(url) {
  const s = String(url || '')
  if (!s) return false
  if (/tcb\.qcloud\.la\/admin\/(cover|banner)\//i.test(s)) return false
  return /tcb\.qcloud\.la\/admin\/mp-static\/|tcb\.qcloud\.la\/|myqcloud\.com|\.cos\./i.test(s)
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

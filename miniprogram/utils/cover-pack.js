/**
 * 门店封面：云端实景图；无图/旧模拟图时按店名关键词匹配。
 * 本地仅留 cover-loading 占位。
 */
const cdn = require('./cdn')

const COVERS = {
  supermarket: cdn.coverUrl('cover-supermarket.jpg'),
  noodles: cdn.coverUrl('cover-noodles.jpg'),
  bbq: cdn.coverUrl('cover-bbq.jpg'),
  flower: cdn.coverUrl('cover-flower.jpg'),
  fruit: cdn.coverUrl('cover-fruit.jpg'),
  milktea: cdn.coverUrl('cover-milktea.jpg'),
  warehouse: cdn.coverUrl('cover-warehouse.jpg'),
  malatang: cdn.coverUrl('cover-malatang.jpg'),
  jianbing: cdn.coverUrl('cover-jianbing.jpg'),
  cake: cdn.coverUrl('cover-cake.jpg'),
  tofu: cdn.coverUrl('cover-tofu.jpg'),
  carwash: cdn.coverUrl('cover-carwash.jpg')
}

const ROLE_DEFAULT = {
  stall: COVERS.noodles,
  cross: COVERS.supermarket,
  supply: COVERS.warehouse
}

const REMOTE_MOCK = /placehold|picsum|unsplash|dummyimage|via\.placeholder/i

function isLegacyCloudCover(url) {
  // 旧批 admin/cover、admin/banner，需换成本轮 mp-static 实景
  return /tcb\.qcloud\.la\/admin\/(cover|banner)\//i.test(String(url || ''))
}

function pickByName(name, role, bizType) {
  const n = String(name || '') + ' ' + String(bizType || '')
  if (/超市|百货|便利|日用|邻里/.test(n)) return COVERS.supermarket
  if (/花|花艺|鲜花/.test(n)) return COVERS.flower
  if (/蛋糕|烘焙|甜品/.test(n)) return COVERS.cake
  if (/果|果切|鲜果/.test(n)) return COVERS.fruit
  if (/奶茶|茶饮|咖啡/.test(n)) return COVERS.milktea
  if (/洗车/.test(n)) return COVERS.carwash
  if (/烤串|烧烤|串/.test(n)) return COVERS.bbq
  if (/麻辣烫|冒菜|火锅/.test(n)) return COVERS.malatang
  if (/煎饼|灌饼|豆浆/.test(n)) return COVERS.jianbing
  if (/臭豆腐|豆腐/.test(n)) return COVERS.tofu
  if (/炒面|面|粉|餐饮|小吃|夜市|档/.test(n)) return COVERS.noodles
  if (/仓|供货|粮油|冻品|调味|包装|集配|供应链/.test(n)) return COVERS.warehouse
  if (role === 'supply') return COVERS.warehouse
  if (role === 'cross') return COVERS.supermarket
  return ROLE_DEFAULT[role] || COVERS.noodles
}

function needsCoverReplace(url) {
  const s = String(url || '').trim()
  if (!s) return true
  if (s.indexOf('/assets/placeholders/') === 0) return false
  if (cdn.isOurCdn(s)) return false
  if (isLegacyCloudCover(s)) return true
  if (s.indexOf('/uploads/') === 0) return false
  if (/^cloud:\/\//i.test(s)) return false
  if (REMOTE_MOCK.test(s)) return true
  if (/license|idCard|businessLicense|foodLicense/i.test(s)) return true
  if (/\/assets\/covers\//i.test(s)) return true
  if (/^https?:\/\//i.test(s)) return true
  return false
}

function resolveCover(item) {
  const cur = item && (item.coverImage || item.coverUrl || item.imageUrl || '')
  if (!needsCoverReplace(cur)) return cur
  return pickByName(
    (item && (item.name || item.shopName || item.title)) || '',
    (item && (item.role || item.itemType || item.type)) || '',
    (item && (item.bizType || item.bizTypeLabel || item.category || item.typeLabel)) || ''
  )
}

function withCover(item) {
  if (!item || typeof item !== 'object') return item
  const coverImage = resolveCover(item)
  return { ...item, coverImage, coverUrl: coverImage }
}

function withCoverList(list) {
  return (list || []).map(withCover)
}

module.exports = {
  COVERS,
  PLACEHOLDER: cdn.PLACEHOLDER_COVER,
  resolveCover,
  withCover,
  withCoverList,
  needsCoverReplace
}

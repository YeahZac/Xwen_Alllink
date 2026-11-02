/**
 * 将库内 Banner / 门店封面 / 商品图统一切到本轮 mp-static 实景素材。
 * 不删除旧 COS 对象（可后台手工清）；只改数据库 URL。
 */
const { query } = require('../utils/db')

const MP_STATIC =
  'https://7072-prod-d3g1vkrj3290d085e-1467541248.tcb.qcloud.la/admin/mp-static/20261102'

const COVERS = {
  supermarket: `${MP_STATIC}/b348459d6195838b.webp`,
  noodles: `${MP_STATIC}/26ff62910b5f2547.webp`,
  bbq: `${MP_STATIC}/26d02cda44689532.webp`,
  flower: `${MP_STATIC}/0168ba78d752f002.webp`,
  fruit: `${MP_STATIC}/673e6599ea9a8f70.webp`,
  milktea: `${MP_STATIC}/727fdce69c23d17a.webp`,
  warehouse: `${MP_STATIC}/8904b797e9dc2b41.webp`,
  malatang: `${MP_STATIC}/6f0506640cd043cc.webp`,
  jianbing: `${MP_STATIC}/8534668a3d421afb.webp`,
  cake: `${MP_STATIC}/e85759a7147886c8.webp`,
  tofu: `${MP_STATIC}/768037b9e15b0223.webp`,
  carwash: `${MP_STATIC}/4c20198e1c0cf66a.webp`
}

const BANNERS = {
  scan: `${MP_STATIC}/3cdd06ea70c160cb.webp`,
  points: `${MP_STATIC}/bcf4837bfb8f2347.webp`,
  mall: COVERS.supermarket,
  stall: `${MP_STATIC}/809fc9e17ef933b6.webp`,
  cross: `${MP_STATIC}/742baf46d2be8680.webp`,
  supply: `${MP_STATIC}/821f8b62aeaa627a.webp`,
  login: `${MP_STATIC}/8f773fae68a0ba0e.webp`
}

function isLegacyUrl(url) {
  const s = String(url || '')
  if (!s) return true
  if (/\/admin\/mp-static\//i.test(s)) return false
  if (/\/assets\//i.test(s)) return true
  if (/placehold|picsum|unsplash/i.test(s)) return true
  if (/\/admin\/(banner|cover)\//i.test(s)) return true
  if (/^https?:\/\//i.test(s)) return true
  return true
}

function pickCoverByName(name, role) {
  const n = String(name || '')
  if (/超市|百货|便利|日用|邻里/.test(n)) return COVERS.supermarket
  if (/花|花艺|鲜花/.test(n)) return COVERS.flower
  if (/蛋糕|烘焙|甜品|奶油/.test(n)) return COVERS.cake
  if (/果|果切|鲜果/.test(n)) return COVERS.fruit
  if (/奶茶|茶饮|咖啡/.test(n)) return COVERS.milktea
  if (/洗车/.test(n)) return COVERS.carwash
  if (/烤串|烧烤|串/.test(n)) return COVERS.bbq
  if (/麻辣烫|冒菜|火锅/.test(n)) return COVERS.malatang
  if (/煎饼|灌饼|豆浆/.test(n)) return COVERS.jianbing
  if (/臭豆腐|豆腐/.test(n)) return COVERS.tofu
  if (/仓|供货|粮油|冻品|调味|包装|集配|供应链/.test(n)) return COVERS.warehouse
  if (role === 'supply') return COVERS.warehouse
  if (role === 'cross') return COVERS.supermarket
  if (/厨|餐|面|粉|小吃|轻食|餐厅|食堂/.test(n)) return COVERS.noodles
  return COVERS.noodles
}

function pickBanner(row) {
  const title = String(row.title || '')
  const role = String(row.role_scope || row.roleScope || '')
  if (/扫码|点餐/.test(title)) return BANNERS.scan
  if (/积分|鲜花|蛋糕/.test(title)) return BANNERS.points
  if (/商场|好店|百货|附近可兑/.test(title)) return BANNERS.mall
  if (/采购|地摊|额度/.test(title)) return BANNERS.stall
  if (/核销|承接|积分客/.test(title) || role === 'cross') return BANNERS.cross
  if (/仓|供货|需求/.test(title) || role === 'supply') return BANNERS.supply
  if (/入驻/.test(title) || role === 'login') return BANNERS.login
  if (role === 'stall') return BANNERS.stall
  return BANNERS.mall
}

async function syncBanners() {
  const rows = await query(
    `SELECT id, role_scope, title, image_url AS imageUrl FROM banners`
  )
  let updated = 0
  for (const row of rows) {
    if (!isLegacyUrl(row.imageUrl)) continue
    const img = pickBanner(row)
    await query(`UPDATE banners SET image_url=:img WHERE id=:id`, { id: row.id, img })
    updated += 1
  }
  return { total: rows.length, updated }
}

async function syncMerchantCovers() {
  const rows = await query(
    `SELECT id, role, name, cover_url AS coverUrl FROM merchants WHERE deleted_at IS NULL`
  )
  let updated = 0
  for (const row of rows) {
    if (!isLegacyUrl(row.coverUrl)) continue
    const img = pickCoverByName(row.name, row.role)
    await query(`UPDATE merchants SET cover_url=:img WHERE id=:id`, { id: row.id, img })
    updated += 1
  }
  return { total: rows.length, updated }
}

async function syncGoodsImages(table) {
  const rows = await query(`SELECT id, name, image_url AS imageUrl FROM \`${table}\``)
  let updated = 0
  for (const row of rows) {
    if (!isLegacyUrl(row.imageUrl)) continue
    const img = pickCoverByName(row.name, '')
    await query(`UPDATE \`${table}\` SET image_url=:img WHERE id=:id`, { id: row.id, img })
    updated += 1
  }
  return { total: rows.length, updated }
}

async function syncAllMpStaticMedia() {
  const banners = await syncBanners()
  const merchants = await syncMerchantCovers()
  const stallGoods = await syncGoodsImages('stall_goods').catch(() => ({ total: 0, updated: 0 }))
  const crossGoods = await syncGoodsImages('cross_goods').catch(() => ({ total: 0, updated: 0 }))
  const supplyGoods = await syncGoodsImages('supply_goods').catch(() => ({ total: 0, updated: 0 }))
  return {
    cdnHost: MP_STATIC,
    banners,
    merchants,
    stallGoods,
    crossGoods,
    supplyGoods
  }
}

module.exports = {
  MP_STATIC,
  COVERS,
  BANNERS,
  isLegacyUrl,
  pickCoverByName,
  pickBanner,
  syncAllMpStaticMedia
}

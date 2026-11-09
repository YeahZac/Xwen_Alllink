/**
 * C 端目录/交易链路冒烟：列表 → 菜单 → 支付入参 → 身份一致性
 */
require('dotenv').config()
const assert = require('assert')
const orderService = require('../src/services/orderService')
const { query } = require('../src/utils/db')

async function main() {
  const stalls = await orderService.listNearbyStalls({ lat: 22.73585, lng: 113.8068 })
  assert.ok(stalls.length > 0, '地摊列表不应为空')

  const haichuan = stalls.find((s) => String(s.name).includes('海川'))
  assert.ok(haichuan, `地摊列表应包含「海川众核科技」，当前: ${stalls.map((s) => s.name).join(',')}`)
  assert.ok(haichuan.coverImage, '海川应有封面')
  assert.ok(
    !/\/admin\/mp-static\//i.test(haichuan.coverImage),
    `海川封面不应是演示素材: ${haichuan.coverImage}`
  )

  const menu = await orderService.getStallMenu(haichuan.id)
  assert.strictEqual(menu.stall.name, haichuan.name)
  assert.ok(Array.isArray(menu.menu), '菜单应为数组')
  assert.ok(menu.menu.length > 0, '营业地摊应至少有一个在售商品')

  for (const g of menu.menu) {
    assert.ok(g.name, '商品名不能为空')
    assert.ok(Number(g.price) >= 0, '商品价格非法')
  }

  // 仅营业未删除
  for (const s of stalls) {
    assert.ok(Number(s.open) === 1 || s.open === true || s.open == null)
  }

  // 申请名一致性抽检
  const bad = await query(`
    SELECT m.id, m.name, a.shop_name
    FROM merchants m
    JOIN merchant_applications a ON a.merchant_id=m.id AND a.status='approved'
    WHERE m.deleted_at IS NULL AND m.status=1 AND a.shop_name<>m.name
    LIMIT 5
  `)
  assert.strictEqual(bad.length, 0, `仍有店名与申请不一致: ${JSON.stringify(bad)}`)

  // 异业门店列表
  const stores = await orderService.listCrossStores({ lat: 22.73585, lng: 113.8068 })
  assert.ok(stores.every((s) => (s.role || 'cross') === 'cross' || s.role === 'stall'))

  console.log('c-end-catalog-smoke ok', {
    stalls: stalls.length,
    haichuan: { id: haichuan.id, name: haichuan.name, goods: menu.menu.length },
    stores: stores.length
  })
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

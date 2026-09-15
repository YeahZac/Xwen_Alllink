/**
 * 种子数据规模校验 + 关键列表/下单冒烟。
 * 用法：在 backend/ 下 node scripts/smoke-seed.js
 */
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })

const { query, pool } = require('../src/utils/db')
const orderService = require('../src/services/orderService')
const catalogService = require('../src/services/catalogService')
const applyService = require('../src/services/applyService')
const adminService = require('../src/services/adminService')
const authService = require('../src/services/authService')

async function count(sql) {
  const rows = await query(sql)
  return Number(Object.values(rows[0])[0])
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`)
}

async function main() {
  const checks = [
    ['users', await count('SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL'), 5],
    ['stall merchants', await count("SELECT COUNT(*) c FROM merchants WHERE role='stall' AND deleted_at IS NULL"), 5],
    ['cross merchants', await count("SELECT COUNT(*) c FROM merchants WHERE role='cross' AND deleted_at IS NULL"), 5],
    ['supply merchants', await count("SELECT COUNT(*) c FROM merchants WHERE role='supply' AND deleted_at IS NULL"), 5],
    ['stall_goods', await count('SELECT COUNT(*) c FROM stall_goods WHERE deleted_at IS NULL'), 5],
    ['cross_goods', await count('SELECT COUNT(*) c FROM cross_goods WHERE deleted_at IS NULL'), 5],
    ['supply_goods', await count('SELECT COUNT(*) c FROM supply_goods WHERE deleted_at IS NULL'), 5],
    ['consumer_orders', await count('SELECT COUNT(*) c FROM consumer_orders'), 5],
    ['cross_orders', await count('SELECT COUNT(*) c FROM cross_orders'), 5],
    ['purchase_orders', await count('SELECT COUNT(*) c FROM purchase_orders'), 5]
  ]

  console.log('--- counts ---')
  for (const [name, n, min] of checks) {
    console.log(`${name}: ${n} (min ${min})`)
    assert(n >= min, `${name} need >= ${min}, got ${n}`)
  }

  const wing = await query('SELECT merchant_id AS mid FROM stall_goods WHERE id=8')
  assert(wing[0] && Number(wing[0].mid) === 2, `stall goods#8 merchant expect 2 got ${wing[0] && wing[0].mid}`)

  console.log('--- service smoke ---')
  const stalls = await orderService.listNearbyStalls()
  assert(stalls.length >= 5, `listNearbyStalls ${stalls.length}`)
  console.log('listNearbyStalls', stalls.length)

  const crosses = await orderService.listCrossStores()
  assert(crosses.length >= 5, `listCrossStores ${crosses.length}`)
  assert(crosses.every((s) => Array.isArray(s.items)), 'cross items array')
  console.log('listCrossStores', crosses.length, 'items', crosses.reduce((a, s) => a + s.items.length, 0))

  const menu = await orderService.getStallMenu(1)
  assert(menu.menu && menu.menu.length === 5, `stall1 menu expect 5 got ${menu.menu.length}`)
  console.log('getStallMenu(1)', menu.menu.length)

  const menu2 = await orderService.getStallMenu(2)
  assert(menu2.menu.some((g) => String(g.name).includes('烤翅')), 'stall2 has 烤翅')
  console.log('getStallMenu(2)', menu2.menu.length)

  const supply = await catalogService.listSupplyGoods()
  assert(supply.length >= 5, `listSupplyGoods ${supply.length}`)
  console.log('listSupplyGoods', supply.length)

  const merchants = await applyService.listMerchants({})
  assert(merchants.length >= 15, `listMerchants ${merchants.length}`)
  console.log('listMerchants', merchants.length)

  const stallGoods = await adminService.listStallGoods({})
  const crossGoods = await adminService.listCrossGoods({})
  const supplyGoods = await adminService.listSupplyGoodsAdmin({})
  assert(stallGoods.length >= 5 && crossGoods.length >= 5 && supplyGoods.length >= 5, 'admin goods')
  console.log('admin goods', stallGoods.length, crossGoods.length, supplyGoods.length)

  const co = await adminService.listConsumerOrders({})
  const xo = await adminService.listCrossOrders({})
  const po = await adminService.listPurchaseOrders({})
  assert(co.length >= 5 && xo.length >= 5 && po.length >= 5, 'admin orders')
  console.log('admin orders', co.length, xo.length, po.length)

  const pay = await orderService.createAndPayStallOrder({
    userId: 1,
    merchantId: 8,
    items: [{ goodsId: 13, qty: 1, optionIds: [] }]
  })
  assert(pay && (pay.orderNo || pay.order_no || pay.id), 'stall pay')
  console.log('createAndPayStallOrder', pay.orderNo || pay.order_no || pay.id, 'allocated', pay.pointsAllocated)
  if (pay.orderId) {
    const done = await orderService.completeStallOrder({ merchantId: 8, orderId: pay.orderId })
    assert(done.status === 'completed', 'complete stall')
    console.log('completeStallOrder', done.pointsAllocated)
  }

  const redeem = await orderService.redeemCross({
    userId: 2,
    merchantId: 5,
    goodsId: 3,
    payMode: 'cash'
  })
  assert(redeem && (redeem.orderNo || redeem.order_no || redeem.id), 'cross redeem')
  console.log('redeemCross', redeem.orderNo || redeem.order_no || redeem.id)

  for (const code of ['C001', 'D001', 'D003', 'Y003', 'G002', 'G005']) {
    const session = await authService.loginByInviteCode(code)
    assert(session && session.token, `login ${code}`)
    console.log('login ok', code, session.role || '')
  }

  console.log('\nSMOKE PASS')
}

main()
  .catch((e) => {
    console.error('\nSMOKE FAIL', e.message || e)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await pool.end()
    } catch (_) {}
  })

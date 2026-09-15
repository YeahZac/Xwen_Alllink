/**
 * 支付以外主链路冒烟：点餐→出餐划拨→异业兑/全现金→采购发货确认→冲正→需求报价
 * 用法：cd backend && node scripts/smoke-loop.js
 */
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })

const { query, pool } = require('../src/utils/db')
const orderService = require('../src/services/orderService')
const catalogService = require('../src/services/catalogService')
const merchantPortalService = require('../src/services/merchantPortalService')
const referralService = require('../src/services/referralService')

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`)
}

async function main() {
  const user = (await query("SELECT id, points_balance AS pts FROM users WHERE invite_code='C001' LIMIT 1"))[0]
  const stall = (await query("SELECT id FROM merchants WHERE invite_code='D001' LIMIT 1"))[0]
  const cross = (await query("SELECT id FROM merchants WHERE invite_code='Y001' LIMIT 1"))[0]
  const supplyGoods = (await query('SELECT id, merchant_id AS seller FROM supply_goods WHERE status=1 AND stock>2 LIMIT 1'))[0]
  const crossGoods = (await query(
    'SELECT id, points_need AS need, cash_price AS cash FROM cross_goods WHERE merchant_id=:id AND on_sale=1 LIMIT 1',
    { id: cross.id }
  ))[0]
  const stallGoods = (await query(
    'SELECT id FROM stall_goods WHERE merchant_id=:id AND on_sale=1 LIMIT 1',
    { id: stall.id }
  ))[0]
  assert(user && stall && cross && supplyGoods && crossGoods && stallGoods, '缺少演示主体')

  console.log('--- 点餐支付（不划拨）---')
  const beforePts = Number(user.pts)
  const pay = await orderService.createAndPayStallOrder({
    userId: user.id,
    merchantId: stall.id,
    items: [{ goodsId: stallGoods.id, qty: 1, optionIds: [] }]
  })
  assert(pay.orderId && pay.orderNo, 'pay 未返回订单')
  assert(Number(pay.pointsAllocated) === 0, `支付即划拨了 ${pay.pointsAllocated}`)
  const midPts = (await query('SELECT points_balance AS pts FROM users WHERE id=:id', { id: user.id }))[0]
  assert(Number(midPts.pts) === beforePts, `支付后积分变了 ${beforePts}->${midPts.pts}`)
  console.log('pay', pay.orderNo, 'want', pay.pointsWant)

  console.log('--- 出餐完成（划拨 + 首单奖幂等）---')
  const done = await orderService.completeStallOrder({ merchantId: stall.id, orderId: pay.orderId })
  assert(done.status === 'completed', '完单失败')
  const afterPts = (await query('SELECT points_balance AS pts FROM users WHERE id=:id', { id: user.id }))[0]
  assert(Number(afterPts.pts) >= beforePts + Number(done.pointsAllocated), '完单后积分未增加')
  console.log('complete', done.orderNo, 'allocated', done.pointsAllocated, 'pts', afterPts.pts)

  console.log('--- 异业积分不足自动全现金 ---')
  await query('UPDATE users SET points_balance=0 WHERE id=:id', { id: user.id })
  const cash = await orderService.redeemCross({
    userId: user.id,
    merchantId: cross.id,
    goodsId: crossGoods.id,
    payMode: 'points'
  })
  assert(cash.payMode === 'cash' && cash.autoFallback === true, '未走全现金兜底')
  console.log('fallback cash', cash.orderNo, cash.cashAmount)

  console.log('--- 异业积分足够 ---')
  await query('UPDATE users SET points_balance=99999 WHERE id=:id', { id: user.id })
  const pts = await orderService.redeemCross({
    userId: user.id,
    merchantId: cross.id,
    goodsId: crossGoods.id,
    payMode: 'points'
  })
  assert(pts.payMode === 'points', '积分兑失败')
  console.log('redeem points', pts.orderNo, pts.pointsSpend)

  console.log('--- 采购 online 发货确认 ---')
  const po = await orderService.createPurchaseOrder({
    buyerMerchantId: stall.id,
    goodsId: supplyGoods.id,
    qty: 1,
    fulfillType: 'online'
  })
  assert(po.status === 'pending', `采购状态 ${po.status}`)
  const poRow = (await query('SELECT id FROM purchase_orders WHERE order_no=:n', { n: po.orderNo }))[0]
  await orderService.shipPurchaseOrder({ sellerMerchantId: supplyGoods.seller, orderId: poRow.id })
  const confirmed = await orderService.confirmPurchaseOrder({
    buyerMerchantId: stall.id,
    orderId: poRow.id
  })
  assert(confirmed.status === 'confirmed', '确认收货失败')
  console.log('purchase', po.orderNo, 'pool', confirmed.poolBalance)

  console.log('--- 采购冲正 ---')
  const cancelled = await orderService.cancelPurchaseOrder({
    merchantId: stall.id,
    orderId: poRow.id,
    reason: '冒烟拒收冲正'
  })
  assert(cancelled.status === 'refunded', `冲正状态 ${cancelled.status}`)
  console.log('cancel', cancelled.orderNo)

  console.log('--- 需求报价 ---')
  const need = await catalogService.submitSupplyNeed({
    userId: user.id,
    goodsName: `冒烟原料-${Date.now()}`,
    qtyText: '1 箱',
    expectTime: '本周',
    note: 'smoke'
  })
  const quoted = await catalogService.quoteSupplyNeed(need.id, {
    merchantId: supplyGoods.seller,
    status: 'quoted',
    quotePrice: 28
  })
  assert(quoted.status === 'quoted', '报价失败')
  console.log('quote', quoted.id)

  console.log('--- 看板字段 ---')
  const dash = await merchantPortalService.dashboard(stall.id, 'stall')
  assert(dash.todayPointsAllocated != null, 'dashboard 缺 todayPointsAllocated')
  console.log('kpi pointsAllocated', dash.todayPointsAllocated)

  console.log('--- 推荐发奖（注册 + 首单 + 商户码）---')
  const settings = await referralService.getSettings()
  const firstRule = (settings.triggers || []).find((t) => t.triggerKey === 'first_order')
  assert(firstRule, '缺少 first_order 触发点，请执行 sql/12_referral_settings.sql')
  const code = `T${Date.now().toString().slice(-8)}`
  const ins = await query(
    "INSERT INTO users (invite_code, nickname, points_balance, status) VALUES (:c, '冒烟被邀', 0, 1)",
    { c: code }
  )
  const inviteeId = ins.insertId
  const pts0 = Number((await query("SELECT points_balance AS p FROM users WHERE invite_code='C001'"))[0].p)
  const bind = await referralService.bindReferrer({ userId: inviteeId, inviteCode: 'C001' })
  const pts1 = Number((await query("SELECT points_balance AS p FROM users WHERE invite_code='C001'"))[0].p)
  assert(pts1 >= pts0, '注册绑定后邀请人积分不应减少')
  const pay2 = await orderService.createAndPayStallOrder({
    userId: inviteeId,
    merchantId: stall.id,
    items: [{ goodsId: stallGoods.id, qty: 1, optionIds: [] }]
  })
  await orderService.completeStallOrder({ merchantId: stall.id, orderId: pay2.orderId })
  const pts2 = Number((await query("SELECT points_balance AS p FROM users WHERE invite_code='C001'"))[0].p)
  if (firstRule && Number(firstRule.enabled) && Number(firstRule.rewardPoints) > 0) {
    assert(pts2 >= pts1 + Number(firstRule.rewardPoints), `首单奖未入账 ${pts1}->${pts2}`)
  }
  const home = await referralService.getHome(user.id)
  assert(home.shareCode, '推广员没有推荐码')
  const codeM = `M${Date.now().toString().slice(-8)}`
  const insM = await query(
    "INSERT INTO users (invite_code, nickname, points_balance, status) VALUES (:c, '冒烟绑摊主', 0, 1)",
    { c: codeM }
  )
  await referralService.bindReferrer({ userId: insM.insertId, inviteCode: 'D001' })
  console.log('referral register', bind.rewardPoints, 'firstDelta', pts2 - pts1, 'home', home.shareCode)

  await query('UPDATE users SET points_balance=:p WHERE id=:id', { p: beforePts, id: user.id })
  console.log('\nLOOP PASS')
}

main()
  .catch((e) => {
    console.error('\nLOOP FAIL', e.message || e)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await pool.end()
    } catch (_) {}
  })

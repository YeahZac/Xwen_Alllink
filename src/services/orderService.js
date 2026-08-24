const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { orderNo } = require('../utils/id')
const pointsService = require('./pointsService')
const { getCashRate, pointsToCash } = require('./configService')

async function listNearbyStalls() {
  return query(
    `SELECT id, name, city, address, cover_hue AS coverHue, status
     FROM merchants WHERE role='stall' AND status=1 ORDER BY id`
  )
}

async function listCrossStores() {
  const stores = await query(
    `SELECT id, name, city, address, cover_hue AS coverHue
     FROM merchants WHERE role='cross' AND status=1 ORDER BY id`
  )
  for (const s of stores) {
    s.items = await query(
      `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice, desc_text AS \`desc\`
       FROM cross_goods WHERE merchant_id=:id AND on_sale=1`,
      { id: s.id }
    )
  }
  return stores
}

async function getStallMenu(merchantId) {
  const merchants = await query(
    `SELECT id, name, address, cover_hue AS coverHue FROM merchants
     WHERE id=:id AND role='stall' AND status=1`,
    { id: merchantId }
  )
  if (!merchants.length) throw new HttpError(404, '摊位不存在')
  const goods = await query(
    `SELECT id, name, price, points_grant AS pointsGrant, category, desc_text AS \`desc\`
     FROM stall_goods WHERE merchant_id=:id AND on_sale=1`,
    { id: merchantId }
  )
  return { stall: merchants[0], menu: goods }
}

/** 创建点餐订单并模拟支付成功 → 划拨积分 */
async function createAndPayStallOrder({ userId, merchantId, items }) {
  if (!items || !items.length) throw new HttpError(400, '购物车为空')
  return withTransaction(async (conn) => {
    let totalAmount = 0
    let pointsWant = 0
    const lines = []
    for (const it of items) {
      const [grows] = await conn.execute(
        `SELECT id, name, price, points_grant FROM stall_goods
         WHERE id=? AND merchant_id=? AND on_sale=1`,
        [it.goodsId, merchantId]
      )
      if (!grows.length) throw new HttpError(400, '商品无效')
      const g = grows[0]
      const qty = Number(it.qty) || 1
      totalAmount += Number(g.price) * qty
      pointsWant += Number(g.points_grant) * qty
      lines.push({
        goodsId: g.id,
        name: g.name,
        price: g.price,
        pointsGrant: g.points_grant,
        qty
      })
    }
    const ono = orderNo('O')
    const [ins] = await conn.execute(
      `INSERT INTO consumer_orders
        (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
         pay_status, order_status, paid_at)
       VALUES (?, ?, ?, ?, ?, 0, 'paid', 'completed', NOW())`,
      [ono, userId, merchantId, totalAmount, pointsWant]
    )
    const orderId = ins.insertId
    for (const l of lines) {
      await conn.execute(
        `INSERT INTO consumer_order_items
          (order_id, goods_id, goods_name, price, points_grant, qty)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, l.goodsId, l.name, l.price, l.pointsGrant, l.qty]
      )
    }
    const [mrows] = await conn.execute(
      'SELECT name FROM merchants WHERE id=?',
      [merchantId]
    )
    const alloc = await pointsService.allocateToConsumer(conn, {
      merchantId,
      userId,
      wantPoints: pointsWant,
      shopName: mrows[0] ? mrows[0].name : '',
      orderNo: ono
    })
    await conn.execute(
      'UPDATE consumer_orders SET points_allocated=? WHERE id=?',
      [alloc.allocated, orderId]
    )
    return {
      orderNo: ono,
      totalAmount,
      pointsWant,
      pointsAllocated: alloc.allocated,
      shortage: alloc.shortage,
      poolLeft: alloc.poolLeft
    }
  })
}

async function redeemCross({ userId, merchantId, goodsId, payMode }) {
  return withTransaction(async (conn) => {
    const [grows] = await conn.execute(
      `SELECT id, name, points_need, cash_price FROM cross_goods
       WHERE id=? AND merchant_id=? AND on_sale=1`,
      [goodsId, merchantId]
    )
    if (!grows.length) throw new HttpError(404, '商品不存在')
    const g = grows[0]
    const ono = orderNo('C')
    if (payMode === 'points') {
      await pointsService.spendConsumerPoints(conn, {
        userId,
        points: g.points_need,
        title: `${g.name} · 兑换扣减`,
        bizId: ono
      })
      await conn.execute(
        `INSERT INTO cross_orders
          (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
         VALUES (?, ?, ?, ?, ?, 'points', ?, 0, 'completed')`,
        [ono, userId, merchantId, g.id, g.name, g.points_need]
      )
      const rate = await getCashRate()
      return {
        orderNo: ono,
        payMode: 'points',
        pointsSpend: g.points_need,
        cashValue: pointsToCash(g.points_need, rate)
      }
    }
    await conn.execute(
      `INSERT INTO cross_orders
        (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
       VALUES (?, ?, ?, ?, ?, 'cash', 0, ?, 'completed')`,
      [ono, userId, merchantId, g.id, g.name, g.cash_price]
    )
    return { orderNo: ono, payMode: 'cash', cashAmount: Number(g.cash_price) }
  })
}

/** 采购成交：买方获积分额度 */
async function createPurchaseOrder({ buyerMerchantId, goodsId, qty = 1, fulfillType = 'online' }) {
  return withTransaction(async (conn) => {
    const [grows] = await conn.execute(
      `SELECT id, merchant_id, name, price, points_grant, stock FROM supply_goods
       WHERE id=? AND status=1 FOR UPDATE`,
      [goodsId]
    )
    if (!grows.length) throw new HttpError(404, '供货商品不存在')
    const g = grows[0]
    if (g.stock < qty) throw new HttpError(400, '库存不足')
    const total = Number(g.price) * qty
    const pointsGrant = Number(g.points_grant) * qty
    const ono = orderNo('P')
    const [ins] = await conn.execute(
      `INSERT INTO purchase_orders
        (order_no, buyer_merchant_id, seller_merchant_id, fulfill_type, total_amount, points_grant,
         status, paid_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', NOW(), NOW())`,
      [ono, buyerMerchantId, g.merchant_id, fulfillType, total, pointsGrant]
    )
    await conn.execute(
      `INSERT INTO purchase_order_items
        (order_id, goods_id, goods_name, price, qty, points_grant)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ins.insertId, g.id, g.name, g.price, qty, g.points_grant]
    )
    await conn.execute('UPDATE supply_goods SET stock = stock - ? WHERE id=?', [qty, g.id])
    const bal = await pointsService.grantPool(conn, {
      merchantId: buyerMerchantId,
      points: pointsGrant,
      bizType: 'purchase',
      bizId: ono,
      title: `采购成交 · ${g.name} · 获额度 +${pointsGrant}`
    })
    return { orderNo: ono, totalAmount: total, pointsGrant, poolBalance: bal }
  })
}

async function adminGrantPool({ merchantId, points, title }) {
  return withTransaction(async (conn) => {
    const bal = await pointsService.grantPool(conn, {
      merchantId,
      points,
      bizType: 'admin_grant',
      bizId: orderNo('AG'),
      title: title || `平台后台发放积分额度 +${points}`
    })
    return { poolBalance: bal }
  })
}

module.exports = {
  listNearbyStalls,
  listCrossStores,
  getStallMenu,
  createAndPayStallOrder,
  redeemCross,
  createPurchaseOrder,
  adminGrantPool
}

const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { orderNo } = require('../utils/id')
const pointsService = require('./pointsService')
const accountService = require('./accountService')
const referralService = require('./referralService')
const { getCashRate, pointsToCash, getConfig } = require('./configService')

async function getCommissionRate() {
  const v = await getConfig('commission_rate_default', '0.001')
  return Number(v) || 0.001
}

async function recordCommission(conn, { bizType, bizId, payerMerchantId, amountGross, rate }) {
  const gross = Number(amountGross) || 0
  const commission = Math.round(gross * rate * 100) / 100
  await conn.execute(
    `INSERT INTO commission_ledger
      (biz_type, biz_id, payer_merchant_id, amount_gross, rate, commission, rule_version)
     VALUES (?, ?, ?, ?, ?, ?, 'default')`,
    [bizType, bizId, payerMerchantId || null, gross, rate, commission]
  )
  return commission
}

async function listNearbyStalls() {
  return query(
    `SELECT id, name, city, address, latitude, longitude,
            cover_hue AS coverHue, status
     FROM merchants WHERE role='stall' AND status=1 ORDER BY id`
  )
}

async function listCrossStores() {
  const stores = await query(
    `SELECT id, name, city, address, latitude, longitude, cover_hue AS coverHue
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

/** 创建点餐订单并模拟支付成功 → 划拨积分 + 地摊货款入账 */
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
    totalAmount = Math.round(totalAmount * 100) / 100
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
      await conn.execute(
        `UPDATE stall_goods SET sales_count = IFNULL(sales_count,0) + ? WHERE id=?`,
        [l.qty, l.goodsId]
      )
    }
    const [mrows] = await conn.execute('SELECT name FROM merchants WHERE id=?', [merchantId])
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

    const rate = await getCommissionRate()
    const commission = await recordCommission(conn, {
      bizType: 'stall',
      bizId: ono,
      payerMerchantId: merchantId,
      amountGross: totalAmount,
      rate
    })
    const net = Math.round((totalAmount - commission) * 100) / 100
    await accountService.creditAccount(conn, {
      merchantId,
      accountType: 'cash_settlement',
      amount: net,
      bizType: 'stall_settle',
      bizId: ono,
      title: `点餐货款入账 · ${ono}`
    })

    await referralService.rewardFirstOrder(conn, { inviteeUserId: userId, orderNo: ono })

    return {
      orderNo: ono,
      totalAmount,
      pointsWant,
      pointsAllocated: alloc.allocated,
      shortage: alloc.shortage,
      poolLeft: alloc.poolLeft,
      commission,
      merchantNet: net
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
    const rate = await getCashRate()
    const [urows] = await conn.execute(
      'SELECT points_balance FROM users WHERE id=? FOR UPDATE',
      [userId]
    )
    if (!urows.length) throw new HttpError(404, '用户不存在')
    let mode = payMode || 'points'
    // 积分不足时自动全额现金兜底
    if (mode === 'points' && Number(urows[0].points_balance) < Number(g.points_need)) {
      mode = 'cash'
    }

    const commissionRate = await getCommissionRate()

    if (mode === 'points') {
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
      await conn.execute(`UPDATE cross_goods SET sales_count = IFNULL(sales_count,0) + 1 WHERE id=?`, [g.id])
      const cashValue = pointsToCash(g.points_need, rate)
      const commission = await recordCommission(conn, {
        bizType: 'cross',
        bizId: ono,
        payerMerchantId: merchantId,
        amountGross: cashValue,
        rate: commissionRate
      })
      const net = Math.round((cashValue - commission) * 100) / 100
      await accountService.creditAccount(conn, {
        merchantId,
        accountType: 'cash_settlement',
        amount: net,
        bizType: 'cross_points_settle',
        bizId: ono,
        title: `积分兑换结算 · ${ono}`
      })
      return {
        orderNo: ono,
        payMode: 'points',
        pointsSpend: g.points_need,
        cashValue,
        commission,
        merchantNet: net
      }
    }

    await conn.execute(
      `INSERT INTO cross_orders
        (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
       VALUES (?, ?, ?, ?, ?, 'cash', 0, ?, 'completed')`,
      [ono, userId, merchantId, g.id, g.name, g.cash_price]
    )
    await conn.execute(`UPDATE cross_goods SET sales_count = IFNULL(sales_count,0) + 1 WHERE id=?`, [g.id])
    const cashAmount = Number(g.cash_price)
    const commission = await recordCommission(conn, {
      bizType: 'cross',
      bizId: ono,
      payerMerchantId: merchantId,
      amountGross: cashAmount,
      rate: commissionRate
    })
    const net = Math.round((cashAmount - commission) * 100) / 100
    await accountService.creditAccount(conn, {
      merchantId,
      accountType: 'cash_settlement',
      amount: net,
      bizType: 'cross_cash_settle',
      bizId: ono,
      title: `全现金兑换结算 · ${ono}`
    })
    return {
      orderNo: ono,
      payMode: 'cash',
      cashAmount,
      autoFallback: payMode === 'points',
      commission,
      merchantNet: net
    }
  })
}

/**
 * 采购成交：买方获积分额度；卖方货款入账 + 积分折现权益；平台抽成
 * online：先 pending，需发货/确认；offline：直接 confirmed
 */
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
    const total = Math.round(Number(g.price) * qty * 100) / 100
    const pointsGrant = Number(g.points_grant) * qty
    const ono = orderNo('P')
    const type = fulfillType === 'offline' ? 'offline' : 'online'
    const status = type === 'offline' ? 'confirmed' : 'pending'
    const [ins] = await conn.execute(
      `INSERT INTO purchase_orders
        (order_no, buyer_merchant_id, seller_merchant_id, fulfill_type, total_amount, points_grant,
         status, paid_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        ono,
        buyerMerchantId,
        g.merchant_id,
        type,
        total,
        pointsGrant,
        status,
        status === 'confirmed' ? new Date() : null
      ]
    )
    await conn.execute(
      `INSERT INTO purchase_order_items
        (order_id, goods_id, goods_name, price, qty, points_grant)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ins.insertId, g.id, g.name, g.price, qty, g.points_grant]
    )
    await conn.execute('UPDATE supply_goods SET stock = stock - ?, sales_count = IFNULL(sales_count,0) + ? WHERE id=?', [
      qty,
      qty,
      g.id
    ])

    let poolBalance = null
    if (status === 'confirmed') {
      poolBalance = await settlePurchase(conn, {
        orderNo: ono,
        buyerMerchantId,
        sellerMerchantId: g.merchant_id,
        total,
        pointsGrant,
        goodsName: g.name
      })
    }

    return {
      orderNo: ono,
      totalAmount: total,
      pointsGrant,
      status,
      fulfillType: type,
      poolBalance
    }
  })
}

async function settlePurchase(conn, { orderNo: ono, buyerMerchantId, sellerMerchantId, total, pointsGrant, goodsName }) {
  const poolBalance = await pointsService.grantPool(conn, {
    merchantId: buyerMerchantId,
    points: pointsGrant,
    bizType: 'purchase',
    bizId: ono,
    title: `采购成交 · ${goodsName} · 获额度 +${pointsGrant}`
  })
  const rate = await getCommissionRate()
  const commission = await recordCommission(conn, {
    bizType: 'purchase',
    bizId: ono,
    payerMerchantId: sellerMerchantId,
    amountGross: total,
    rate
  })
  const netCash = Math.round((total - commission) * 100) / 100
  await accountService.creditAccount(conn, {
    merchantId: sellerMerchantId,
    accountType: 'cash_goods',
    amount: netCash,
    bizType: 'purchase_cash',
    bizId: ono,
    title: `采购货款入账 · ${ono}`
  })
  const cashRate = await getCashRate()
  const pointsEquity = pointsToCash(pointsGrant, cashRate)
  await accountService.creditAccount(conn, {
    merchantId: sellerMerchantId,
    accountType: 'points_redeem',
    amount: pointsEquity,
    bizType: 'purchase_points_equity',
    bizId: ono,
    title: `买方获额对应折现权益 · ${ono}`
  })
  return poolBalance
}

async function shipPurchaseOrder({ sellerMerchantId, orderId }) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT * FROM purchase_orders WHERE id=? FOR UPDATE`,
      [orderId]
    )
    if (!rows.length) throw new HttpError(404, '采购单不存在')
    const o = rows[0]
    if (o.seller_merchant_id !== sellerMerchantId) throw new HttpError(403, '无权操作')
    if (o.status !== 'pending') throw new HttpError(400, '当前状态不可发货')
    await conn.execute(`UPDATE purchase_orders SET status='shipped' WHERE id=?`, [orderId])
    return { id: orderId, status: 'shipped' }
  })
}

async function confirmPurchaseOrder({ buyerMerchantId, orderId }) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT * FROM purchase_orders WHERE id=? FOR UPDATE`,
      [orderId]
    )
    if (!rows.length) throw new HttpError(404, '采购单不存在')
    const o = rows[0]
    if (o.buyer_merchant_id !== buyerMerchantId) throw new HttpError(403, '无权操作')
    if (!['pending', 'shipped'].includes(o.status)) throw new HttpError(400, '当前状态不可确认')
    const [items] = await conn.execute(
      `SELECT goods_name FROM purchase_order_items WHERE order_id=? LIMIT 1`,
      [orderId]
    )
    await conn.execute(
      `UPDATE purchase_orders SET status='confirmed', confirmed_at=NOW() WHERE id=?`,
      [orderId]
    )
    const poolBalance = await settlePurchase(conn, {
      orderNo: o.order_no,
      buyerMerchantId: o.buyer_merchant_id,
      sellerMerchantId: o.seller_merchant_id,
      total: Number(o.total_amount),
      pointsGrant: Number(o.points_grant),
      goodsName: items[0] ? items[0].goods_name : '采购商品'
    })
    return { id: orderId, status: 'confirmed', poolBalance }
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

async function applyWithdraw({ merchantId, accountType, amount }) {
  const type = accountType
  if (!['cash_goods', 'cash_settlement', 'points_redeem'].includes(type)) {
    throw new HttpError(400, '账户类型无效')
  }
  const amt = Math.round(Number(amount) * 100) / 100
  if (!amt || amt <= 0) throw new HttpError(400, '提现金额无效')
  return withTransaction(async (conn) => {
    const no = orderNo('WD')
    await accountService.freezeForWithdraw(conn, {
      merchantId,
      accountType: type,
      amount: amt,
      bizId: no,
      title: `提现申请冻结 · ${no}`
    })
    await conn.execute(
      `INSERT INTO withdraw_requests (request_no, merchant_id, account_type, amount, status, remark)
       VALUES (?, ?, ?, ?, 'pending', '商户申请')`,
      [no, merchantId, type, amt]
    )
    return { requestNo: no, amount: amt, accountType: type, status: 'pending' }
  })
}

async function getMerchantAccounts(merchantId) {
  const rows = await query(
    `SELECT account_type AS type, balance, frozen, updated_at AS updatedAt
     FROM merchant_accounts WHERE merchant_id=:id`,
    { id: merchantId }
  )
  return rows
}

module.exports = {
  listNearbyStalls,
  listCrossStores,
  getStallMenu,
  createAndPayStallOrder,
  redeemCross,
  createPurchaseOrder,
  shipPurchaseOrder,
  confirmPurchaseOrder,
  adminGrantPool,
  applyWithdraw,
  getMerchantAccounts
}

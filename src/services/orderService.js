const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { orderNo } = require('../utils/id')
const pointsService = require('./pointsService')
const accountService = require('./accountService')
const referralService = require('./referralService')
const stallOptionsService = require('./stallOptionsService')
const commissionService = require('./commissionService')
const feeService = require('./feeService')

const { getCashRate, pointsToCash } = require('./configService')
const wxService = require('./wxService')
const { applyGeo } = require('../utils/geo')

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100
}

function cashToPoints(cash, rate) {
  const r = Number(rate) || 0.01
  if (r <= 0) return 0
  return Math.max(0, Math.floor(Number(cash || 0) / r))
}

/**
 * 抽成落到 commissionService（角色 × 价格区间 × 规则版本）
 * bizType 同时是计费角色口径：stall / cross / purchase(=supply 出货)
 */
const COMMISSION_ROLE = { stall: 'stall', cross: 'cross', purchase: 'supply' }

async function recordCommission(conn, { bizType, bizId, payerMerchantId, amountGross }) {
  const res = await commissionService.charge(conn, {
    bizType,
    bizId,
    role: COMMISSION_ROLE[bizType] || 'stall',
    payerMerchantId,
    amountGross
  })
  return res.commission
}

async function listNearbyStalls(opts = {}) {
  const rows = await query(
    `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude,
            m.cover_hue AS coverHue, m.cover_url AS coverImage, m.status,
            LEFT(m.name,1) AS initial,
            IFNULL((SELECT SUM(sales_count) FROM stall_goods g WHERE g.merchant_id=m.id AND g.deleted_at IS NULL),0) AS sales,
            CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
            '夜市' AS tag,
            4.8 AS rating,
            m.address AS \`desc\`,
            '美食' AS category
     FROM merchants m
     WHERE m.role='stall' AND m.status=1 AND m.deleted_at IS NULL
     ORDER BY m.id`
  )
  return applyGeo(rows, opts)
}

async function listCrossStores(opts = {}) {
  const stores = await query(
    `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude,
            m.cover_hue AS coverHue, m.cover_url AS coverImage,
            LEFT(m.name,1) AS initial, '异业' AS category
     FROM merchants m
     WHERE m.role='cross' AND m.status=1 AND m.deleted_at IS NULL
     ORDER BY m.id`
  )
  const located = applyGeo(stores, opts)
  for (const s of located) {
    try {
      s.items = await query(
        `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice,
                desc_text AS \`desc\`, image_url AS coverImage, sku_code AS sku,
                IFNULL(allow_mix,1) AS allowMix
         FROM cross_goods WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL`,
        { id: s.id }
      )
    } catch (e) {
      s.items = await query(
        `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice,
                desc_text AS \`desc\`, image_url AS coverImage, sku_code AS sku, 1 AS allowMix
         FROM cross_goods WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL`,
        { id: s.id }
      )
    }
  }
  return located
}

async function getStallMenu(merchantId) {
  const merchants = await query(
    `SELECT id, name, address, city, latitude, longitude,
            cover_hue AS coverHue, cover_url AS coverImage,
            LEFT(name,1) AS initial, status
     FROM merchants
     WHERE id=:id AND role='stall' AND deleted_at IS NULL`,
    { id: merchantId }
  )
  if (!merchants.length) throw new HttpError(404, '摊位不存在')
  if (Number(merchants[0].status) !== 1) throw new HttpError(400, '本店已歇业，暂不能收款')
  const goods = await query(
    `SELECT id, name, price, points_grant AS pointsGrant, category, desc_text AS \`desc\`,
            image_url AS coverImage, image_url AS imageUrl, stock, sku_code AS sku
     FROM stall_goods WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL`,
    { id: merchantId }
  )
  const menu = await stallOptionsService.attachMenuOptions(goods)
  return { stall: merchants[0], menu }
}

/** 创建点餐订单：积分抵现 + 剩余微信（未配商户号则模拟成功）；积分划拨推迟到出餐完成 */
async function createAndPayStallOrder({ userId, merchantId, items, pointsUse = 0 }) {
  if (!items || !items.length) throw new HttpError(400, '购物车为空')
  await feeService.assertCanTransact(merchantId, { action: '接单' })
  return withTransaction(async (conn) => {
    let totalAmount = 0
    let pointsWant = 0
    const lines = []
    for (const it of items) {
      const line = await stallOptionsService.resolveStallLine(conn, {
        merchantId,
        goodsId: Number(it.goodsId),
        optionIds: it.optionIds || [],
        qty: it.qty
      })
      totalAmount += Number(line.price) * line.qty
      pointsWant += Number(line.pointsGrant) * line.qty
      lines.push(line)
    }
    totalAmount = round2(totalAmount)
    const rate = await getCashRate()
    const [urows] = await conn.execute(
      'SELECT points_balance FROM users WHERE id=? FOR UPDATE',
      [userId]
    )
    if (!urows.length) throw new HttpError(404, '用户不存在')
    const balance = Number(urows[0].points_balance) || 0
    const cap = Math.min(balance, cashToPoints(totalAmount, rate))
    let pointsSpend = Math.max(0, Math.floor(Number(pointsUse) || 0))
    if (pointsSpend > cap) pointsSpend = cap
    const offset = round2(pointsToCash(pointsSpend, rate))
    const cashPaid = round2(Math.max(0, totalAmount - offset))
    const ono = orderNo('O')
    if (pointsSpend > 0) {
      await pointsService.spendConsumerPoints(conn, {
        userId,
        points: pointsSpend,
        title: '点餐积分抵现',
        bizId: ono
      })
    }
    const payMeta = wxService.buildPayResult({
      orderNo: ono,
      cashAmount: cashPaid
    })
    let ins
    try {
      ;[ins] = await conn.execute(
        `INSERT INTO consumer_orders
          (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
           points_spend, cash_paid, pay_channel, pay_status, order_status, paid_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'paid', 'preparing', NOW())`,
        [ono, userId, merchantId, totalAmount, pointsWant, pointsSpend, cashPaid, payMeta.payChannel]
      )
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('points_spend'))) {
        ;[ins] = await conn.execute(
          `INSERT INTO consumer_orders
            (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
             pay_status, order_status, paid_at)
           VALUES (?, ?, ?, ?, ?, 0, 'paid', 'preparing', NOW())`,
          [ono, userId, merchantId, totalAmount, pointsWant]
        )
      } else {
        throw e
      }
    }
    const orderId = ins.insertId
    for (const l of lines) {
      const displayName = l.optionsText ? `${l.name}（${l.optionsText}）` : l.name
      try {
        await conn.execute(
          `INSERT INTO consumer_order_items
            (order_id, goods_id, goods_name, price, points_grant, qty, options_json, options_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            l.goodsId,
            displayName,
            l.price,
            l.pointsGrant,
            l.qty,
            JSON.stringify(l.optionsJson || []),
            l.optionsText || null
          ]
        )
      } catch (e) {
        // 未跑 08_stall_options.sql 时回退旧列
        if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('options_'))) {
          await conn.execute(
            `INSERT INTO consumer_order_items
              (order_id, goods_id, goods_name, price, points_grant, qty)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [orderId, l.goodsId, displayName, l.price, l.pointsGrant, l.qty]
          )
        } else {
          throw e
        }
      }
      await conn.execute(
        `UPDATE stall_goods SET sales_count = IFNULL(sales_count,0) + ? WHERE id=?`,
        [l.qty, l.goodsId]
      )
    }
    const commission = await recordCommission(conn, {
      bizType: 'stall',
      bizId: ono,
      payerMerchantId: merchantId,
      amountGross: totalAmount
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

    return {
      orderId,
      orderNo: ono,
      totalAmount,
      cashPaid,
      pointsSpend,
      offsetCash: offset,
      pointsWant,
      pointsAllocated: 0,
      status: 'preparing',
      commission,
      merchantNet: net,
      ...payMeta
    }
  })
}

async function createScanPayOrder({ userId, merchantId, amount }) {
  const cash = round2(amount)
  if (!Number.isFinite(cash) || cash < 0.01) throw new HttpError(400, '请输入消费金额')
  if (cash > 99999.99) throw new HttpError(400, '单笔金额不能超过 99999.99 元')
  const uid = Number(userId)
  const mid = Number(merchantId)
  if (!uid) throw new HttpError(401, '请先登录')
  if (!mid) throw new HttpError(400, '缺少摊位')

  const merchants = await query(
    `SELECT id, name, role, status FROM merchants
     WHERE id=:id AND deleted_at IS NULL`,
    { id: mid }
  )
  if (!merchants.length) throw new HttpError(404, '摊位不存在')
  const m = merchants[0]
  if (m.role !== 'stall') throw new HttpError(400, '请扫描地摊收款码')
  if (Number(m.status) !== 1) throw new HttpError(400, '本店已歇业，暂不能收款')

  await feeService.assertCanTransact(mid, { action: '接单' })

  return withTransaction(async (conn) => {
    const rate = await getCashRate()
    const pointsWant = cashToPoints(cash, rate)
    const ono = orderNo('S')
    const payMeta = wxService.buildPayResult({
      orderNo: ono,
      cashAmount: cash
    })

    let ins
    try {
      ;[ins] = await conn.execute(
        `INSERT INTO consumer_orders
          (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
           points_spend, cash_paid, pay_channel, pay_status, order_status, paid_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'paid', 'completed', NOW())`,
        [ono, uid, mid, cash, pointsWant, cash, payMeta.payChannel]
      )
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('points_spend'))) {
        ;[ins] = await conn.execute(
          `INSERT INTO consumer_orders
            (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
             pay_status, order_status, paid_at)
           VALUES (?, ?, ?, ?, ?, 0, 'paid', 'completed', NOW())`,
          [ono, uid, mid, cash, pointsWant]
        )
      } else if (e && String(e.message || '').includes("Invalid data for column 'order_status'")) {
        ;[ins] = await conn.execute(
          `INSERT INTO consumer_orders
            (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
             pay_status, order_status, paid_at)
           VALUES (?, ?, ?, ?, ?, 0, 'paid', 'pending', NOW())`,
          [ono, uid, mid, cash, pointsWant]
        )
        await conn.execute(`UPDATE consumer_orders SET order_status='completed' WHERE id=?`, [ins.insertId])
      } else {
        throw e
      }
    }
    const orderId = ins.insertId
    try {
      await conn.execute(
        `INSERT INTO consumer_order_items
          (order_id, goods_id, goods_name, price, points_grant, qty)
         VALUES (?, 0, '到店消费', ?, ?, 1)`,
        [orderId, cash, pointsWant]
      )
    } catch (e) {
      if (!(e && (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_NO_REFERENCED_ROW'))) throw e
      const [grows] = await conn.execute(
        `SELECT id FROM stall_goods WHERE merchant_id=? AND deleted_at IS NULL LIMIT 1`,
        [mid]
      )
      const gid = grows.length ? grows[0].id : 0
      if (!gid) throw new HttpError(400, '该摊位暂未上架商品，无法完成收款')
      await conn.execute(
        `INSERT INTO consumer_order_items
          (order_id, goods_id, goods_name, price, points_grant, qty)
         VALUES (?, ?, '到店消费', ?, ?, 1)`,
        [orderId, gid, cash, pointsWant]
      )
    }

    const alloc = await pointsService.allocateToConsumer(conn, {
      merchantId: mid,
      userId: uid,
      wantPoints: pointsWant,
      shopName: m.name,
      orderNo: ono
    })
    try {
      await conn.execute(
        'UPDATE consumer_orders SET points_allocated=?, points_allocated_at=NOW() WHERE id=?',
        [alloc.allocated, orderId]
      )
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('points_allocated_at'))) {
        await conn.execute('UPDATE consumer_orders SET points_allocated=? WHERE id=?', [
          alloc.allocated,
          orderId
        ])
      } else {
        throw e
      }
    }

    const commission = await recordCommission(conn, {
      bizType: 'stall',
      bizId: ono,
      payerMerchantId: mid,
      amountGross: cash
    })
    const net = Math.round((cash - commission) * 100) / 100
    await accountService.creditAccount(conn, {
      merchantId: mid,
      accountType: 'cash_settlement',
      amount: net,
      bizType: 'stall_settle',
      bizId: ono,
      title: `到店消费入账 · ${ono}`
    })
    await referralService.onConsumerOrderDone(conn, {
      inviteeUserId: uid,
      orderNo: ono,
      kind: 'stall'
    })

    const [urows] = await conn.execute('SELECT points_balance FROM users WHERE id=?', [uid])
    return {
      orderId,
      orderNo: ono,
      totalAmount: cash,
      cashPaid: cash,
      pointsSpend: 0,
      pointsWant,
      pointsAllocated: alloc.allocated,
      pointsBalance: urows.length ? Number(urows[0].points_balance) : alloc.allocated,
      shortage: alloc.shortage,
      shopName: m.name,
      status: 'completed',
      commission,
      merchantNet: net,
      ...payMeta
    }
  })
}

/** 出餐完成：划拨积分 + 触发首单推荐奖（BRD §4.3 / §4.5） */
async function completeStallOrder({ merchantId, orderId }) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT * FROM consumer_orders WHERE id=? AND merchant_id=? FOR UPDATE',
      [orderId, merchantId]
    )
    if (!rows.length) throw new HttpError(404, '订单不存在')
    const o = rows[0]
    if (o.pay_status !== 'paid') throw new HttpError(400, '订单未支付')
    if (['completed', 'cancelled'].includes(o.order_status)) {
      throw new HttpError(400, '当前状态不可完成')
    }

    const [mrows] = await conn.execute('SELECT name FROM merchants WHERE id=?', [merchantId])
    let allocated = Number(o.points_allocated) || 0
    let shortage = 0
    let poolLeft = null
    if (allocated === 0 && Number(o.points_want) > 0) {
      const alloc = await pointsService.allocateToConsumer(conn, {
        merchantId,
        userId: o.user_id,
        wantPoints: Number(o.points_want),
        shopName: mrows[0] ? mrows[0].name : '',
        orderNo: o.order_no
      })
      allocated = alloc.allocated
      shortage = alloc.shortage
      poolLeft = alloc.poolLeft
      try {
        await conn.execute(
          'UPDATE consumer_orders SET points_allocated=?, points_allocated_at=NOW() WHERE id=?',
          [allocated, orderId]
        )
      } catch (e) {
        if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('points_allocated_at'))) {
          await conn.execute('UPDATE consumer_orders SET points_allocated=? WHERE id=?', [
            allocated,
            orderId
          ])
        } else {
          throw e
        }
      }
    }

    await conn.execute(`UPDATE consumer_orders SET order_status='completed' WHERE id=?`, [orderId])
    await referralService.onConsumerOrderDone(conn, {
      inviteeUserId: o.user_id,
      orderNo: o.order_no,
      kind: 'stall'
    })
    return {
      id: Number(orderId),
      orderNo: o.order_no,
      status: 'completed',
      pointsAllocated: allocated,
      shortage,
      poolLeft
    }
  })
}

async function redeemCross({ userId, merchantId, goodsId, payMode, pointsUse = 0 }) {
  await feeService.assertCanTransact(merchantId, { action: '核销' })
  return withTransaction(async (conn) => {
    let grows
    try {
      ;[grows] = await conn.execute(
        `SELECT id, name, points_need, cash_price, IFNULL(allow_mix,1) AS allow_mix, IFNULL(stock,9999) AS stock
         FROM cross_goods
         WHERE id=? AND merchant_id=? AND on_sale=1 AND deleted_at IS NULL`,
        [goodsId, merchantId]
      )
    } catch (e) {
      if (e && e.code === 'ER_BAD_FIELD_ERROR') {
        ;[grows] = await conn.execute(
          `SELECT id, name, points_need, cash_price, 1 AS allow_mix, 9999 AS stock FROM cross_goods
           WHERE id=? AND merchant_id=? AND on_sale=1`,
          [goodsId, merchantId]
        )
      } else {
        throw e
      }
    }
    if (!grows.length) throw new HttpError(404, '商品不存在')
    const g = grows[0]
    if (Number(g.stock) <= 0) throw new HttpError(400, '库存不足')
    const ono = orderNo('C')
    const rate = await getCashRate()
    const [urows] = await conn.execute(
      'SELECT points_balance FROM users WHERE id=? FOR UPDATE',
      [userId]
    )
    if (!urows.length) throw new HttpError(404, '用户不存在')
    let mode = payMode || 'points'
    const ptsNeed = Number(g.points_need) || 0
    const cashPrice = round2(g.cash_price)
    const balance = Number(urows[0].points_balance) || 0
    // 积分不足时自动全额现金兜底
    if (mode === 'points' && balance < ptsNeed) {
      mode = 'cash'
    }
    if (mode === 'mix') {
      if (Number(g.allow_mix) === 0) throw new HttpError(400, '该商品未开放组合支付')
      let spend = Math.max(0, Math.floor(Number(pointsUse) || 0))
      spend = Math.min(spend, balance, ptsNeed)
      const cashDue =
        ptsNeed > 0 ? round2(cashPrice * (1 - spend / ptsNeed)) : cashPrice
      if (spend <= 0 && cashDue > 0) mode = 'cash'
      else if (cashDue <= 0 && spend > 0) {
        mode = 'points'
        g._mixSpend = spend
      } else {
        g._mixSpend = spend
        g._mixCash = cashDue
      }
    }

    if (mode === 'points') {
      const ptsSpend = Number(g._mixSpend || g.points_need)
      await pointsService.spendConsumerPoints(conn, {
        userId,
        points: ptsSpend,
        title: `${g.name} · 兑换扣减`,
        bizId: ono
      })
      await conn.execute(
        `INSERT INTO cross_orders
          (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
         VALUES (?, ?, ?, ?, ?, 'points', ?, 0, 'completed')`,
        [ono, userId, merchantId, g.id, g.name, ptsSpend]
      )
      await conn.execute(`UPDATE cross_goods SET sales_count = IFNULL(sales_count,0) + 1 WHERE id=?`, [g.id])
      try {
        await conn.execute(
          `UPDATE cross_goods SET stock = GREATEST(IFNULL(stock,1)-1,0) WHERE id=?`,
          [g.id]
        )
      } catch (_) {}
      const cashValue = pointsToCash(ptsSpend, rate)
      const commission = await recordCommission(conn, {
        bizType: 'cross',
        bizId: ono,
        payerMerchantId: merchantId,
        amountGross: cashValue
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
      await referralService.onConsumerOrderDone(conn, {
        inviteeUserId: userId,
        orderNo: ono,
        kind: 'cross'
      })
      return {
        orderNo: ono,
        payMode: 'points',
        pointsSpend: ptsSpend,
        cashValue,
        commission,
        merchantNet: net,
        simulated: true,
        payChannel: 'points'
      }
    }

    if (mode === 'mix') {
      const spend = Number(g._mixSpend) || 0
      const cashDue = round2(g._mixCash)
      if (spend > 0) {
        await pointsService.spendConsumerPoints(conn, {
          userId,
          points: spend,
          title: `${g.name} · 组合支付扣积分`,
          bizId: ono
        })
      }
      const payMeta = wxService.buildPayResult({ orderNo: ono, cashAmount: cashDue })
      try {
        await conn.execute(
          `INSERT INTO cross_orders
            (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
           VALUES (?, ?, ?, ?, ?, 'mix', ?, ?, 'completed')`,
          [ono, userId, merchantId, g.id, g.name, spend, cashDue]
        )
      } catch (e) {
        await conn.execute(
          `INSERT INTO cross_orders
            (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
           VALUES (?, ?, ?, ?, ?, 'cash', ?, ?, 'completed')`,
          [ono, userId, merchantId, g.id, g.name, spend, cashDue]
        )
      }
      await conn.execute(`UPDATE cross_goods SET sales_count = IFNULL(sales_count,0) + 1 WHERE id=?`, [g.id])
      try {
        await conn.execute(
          `UPDATE cross_goods SET stock = GREATEST(IFNULL(stock,1)-1,0) WHERE id=?`,
          [g.id]
        )
      } catch (_) {}
      const amountGross = cashPrice
      const commission = await recordCommission(conn, {
        bizType: 'cross',
        bizId: ono,
        payerMerchantId: merchantId,
        amountGross
      })
      const net = Math.round((amountGross - commission) * 100) / 100
      await accountService.creditAccount(conn, {
        merchantId,
        accountType: 'cash_settlement',
        amount: net,
        bizType: 'cross_mix_settle',
        bizId: ono,
        title: `组合支付结算 · ${ono}`
      })
      await referralService.onConsumerOrderDone(conn, {
        inviteeUserId: userId,
        orderNo: ono,
        kind: 'cross'
      })
      return {
        orderNo: ono,
        payMode: 'mix',
        pointsSpend: spend,
        cashAmount: cashDue,
        commission,
        merchantNet: net,
        ...payMeta
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
      amountGross: cashAmount
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
    await referralService.onConsumerOrderDone(conn, {
      inviteeUserId: userId,
      orderNo: ono,
      kind: 'cross'
    })
    return {
      orderNo: ono,
      payMode: 'cash',
      cashAmount,
      autoFallback: payMode === 'points',
      commission,
      merchantNet: net,
      ...wxService.buildPayResult({ orderNo: ono, cashAmount })
    }
  })
}

/**
 * 采购成交：买方获积分额度；卖方货款入账 + 积分折现权益；平台抽成
 * online：先 pending，需发货/确认；offline：直接 confirmed
 */
async function createPurchaseOrder({ buyerMerchantId, goodsId, qty = 1, fulfillType = 'online' }) {
  await feeService.assertCanTransact(buyerMerchantId, { action: '采购' })
  return withTransaction(async (conn) => {
    const [grows] = await conn.execute(
      `SELECT id, merchant_id, name, price, points_grant, stock FROM supply_goods
       WHERE id=? AND status=1 FOR UPDATE`,
      [goodsId]
    )
    if (!grows.length) throw new HttpError(404, '供货商品不存在')
    const g = grows[0]
    await feeService.assertCanTransact(g.merchant_id, { action: '接单' })
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
  const commission = await recordCommission(conn, {
    bizType: 'purchase',
    bizId: ono,
    payerMerchantId: sellerMerchantId,
    amountGross: total
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

/**
 * 采购异常：缺货（卖方）/ 拒收退款（买方）→ 货款与积分同步回滚（BRD §4.2 第 5 步）
 * 未结算单直接作废；已结算单做冲正：回收买方额度池、扣回卖方货款与折现权益、抽成冲正、库存回补。
 */
async function cancelPurchaseOrder({ merchantId, orderId, reason, role }) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM purchase_orders WHERE id=? FOR UPDATE', [
      orderId
    ])
    if (!rows.length) throw new HttpError(404, '采购单不存在')
    const o = rows[0]
    const isBuyer = Number(o.buyer_merchant_id) === Number(merchantId)
    const isSeller = Number(o.seller_merchant_id) === Number(merchantId)
    if (!isBuyer && !isSeller) throw new HttpError(403, '无权操作')
    if (['cancelled', 'refunded'].includes(o.status)) throw new HttpError(400, '该单已终止')

    const settled = o.status === 'confirmed'
    const ono = o.order_no
    const why = String(reason || (isSeller ? '卖方缺货' : '买方拒收')).slice(0, 100)

    // 库存回补
    const [items] = await conn.execute(
      'SELECT goods_id, qty, goods_name FROM purchase_order_items WHERE order_id=?',
      [orderId]
    )
    for (const it of items) {
      await conn.execute(
        `UPDATE supply_goods
         SET stock = stock + ?, sales_count = GREATEST(IFNULL(sales_count,0) - ?, 0)
         WHERE id=?`,
        [it.qty, it.qty, it.goods_id]
      )
    }

    const rollback = { pool: null, sellerCash: null, sellerEquity: null, commission: null }
    if (settled) {
      // 1) 收回买方额度池（已划拨给消费者的部分可能已花掉，池可为负，如实记账）
      const pointsGrant = Number(o.points_grant) || 0
      if (pointsGrant > 0) {
        rollback.pool = await pointsService.grantPool(conn, {
          merchantId: o.buyer_merchant_id,
          points: -pointsGrant,
          bizType: 'purchase_reverse',
          bizId: ono,
          title: `采购冲正 · 回收额度 -${pointsGrant} · ${why}`
        })
      }

      // 2) 抽成冲正（先算，卖方实退 = 货款 - 已计抽成）
      rollback.commission = await commissionService.reverse(conn, {
        bizType: 'purchase',
        bizId: ono,
        reason: why
      })
      const netCash =
        Math.round((Number(o.total_amount) - rollback.commission.reversed) * 100) / 100

      // 3) 扣回卖方货款
      rollback.sellerCash = await accountService.debitAccount(conn, {
        merchantId: o.seller_merchant_id,
        accountType: 'cash_goods',
        amount: netCash,
        bizType: 'purchase_cash_reverse',
        bizId: ono,
        title: `采购冲正 · 货款退回 · ${why}`
      })

      // 4) 扣回卖方积分折现权益
      const cashRate = await getCashRate()
      rollback.sellerEquity = await accountService.debitAccount(conn, {
        merchantId: o.seller_merchant_id,
        accountType: 'points_redeem',
        amount: pointsToCash(pointsGrant, cashRate),
        bizType: 'purchase_equity_rev',
        bizId: ono,
        title: `采购冲正 · 折现权益回滚 · ${why}`
      })
    }

    await conn.execute(
      `UPDATE purchase_orders SET status=?, cancel_reason=?, cancelled_at=NOW() WHERE id=?`,
      [settled ? 'refunded' : 'cancelled', why, orderId]
    )

    return {
      orderNo: ono,
      status: settled ? 'refunded' : 'cancelled',
      settledBefore: settled,
      operator: isSeller ? 'seller' : 'buyer',
      role: role || null,
      reason: why,
      rollback
    }
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

async function listMerchantWithdraws(merchantId, { limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 100)
  return query(
    `SELECT id, request_no AS requestNo, account_type AS accountType, amount, status, remark,
            created_at AS createdAt, updated_at AS updatedAt
     FROM withdraw_requests WHERE merchant_id=:id
     ORDER BY id DESC LIMIT ${lim}`,
    { id: merchantId }
  )
}

module.exports = {
  listNearbyStalls,
  listCrossStores,
  getStallMenu,
  createAndPayStallOrder,
  createScanPayOrder,
  completeStallOrder,
  redeemCross,
  createPurchaseOrder,
  shipPurchaseOrder,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
  adminGrantPool,
  applyWithdraw,
  getMerchantAccounts,
  listMerchantWithdraws
}

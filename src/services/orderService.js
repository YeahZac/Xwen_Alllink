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
const config = require('../config')
const { applyGeo } = require('../utils/geo')
const { enrichCoverRow } = require('../utils/mediaPick')
const { HOME_VISIBLE_SQL: HOME_PAY_READY_SQL } = require('./merchantReady')

function assertPaySimulateAllowed(cashAmount) {
  if (!(Number(cashAmount) > 0)) return
  if (wxService.wxPayConfigured()) return
  if (config.allowPaySimulate) return
  throw new HttpError(503, '微信支付未配置，无法收款。联调请设置 ALLOW_PAY_SIMULATE=1')
}

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

/** 首页可见：二级商户进件完成 + 至少 1 个上架 SKU（见 merchantReady.HOME_VISIBLE_SQL） */

async function listNearbyStalls(opts = {}) {
  let rows
  try {
    rows = await query(
      `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude,
              m.cover_hue AS coverHue, m.cover_url AS coverImage, m.materials_json AS materialsJson,
              m.status,
              LEFT(m.name,1) AS initial,
              CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
              IFNULL(NULLIF(m.biz_type,''), '餐饮') AS tag,
              m.address AS \`desc\`,
              IFNULL(NULLIF(m.biz_type,''), '餐饮') AS category
       FROM merchants m
       WHERE m.role='stall' AND m.status=1 AND m.deleted_at IS NULL
         AND ${HOME_PAY_READY_SQL}
       ORDER BY m.id DESC`
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column.*wx_sub_mch/i.test(String(e.message || ''))))) {
      throw e
    }
    rows = await query(
      `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude,
              m.cover_hue AS coverHue, m.cover_url AS coverImage, m.materials_json AS materialsJson,
              m.status,
              LEFT(m.name,1) AS initial,
              CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
              IFNULL(NULLIF(m.biz_type,''), '餐饮') AS tag,
              m.address AS \`desc\`,
              IFNULL(NULLIF(m.biz_type,''), '餐饮') AS category
       FROM merchants m
       WHERE m.role='stall' AND m.status=1 AND m.deleted_at IS NULL
       ORDER BY m.id DESC`
    )
  }
  return applyGeo(rows.map((r) => enrichCoverRow(r)), opts)
}

/**
 * 可兑门店列表。
 * - 默认仅异业（首页「兑换」分栏）
 * - opts.allRedeemable / opts.includeStall：分类页展示全部可参与门店（异业+地摊）
 */
async function listCrossStores(opts = {}) {
  const includeStall =
    opts.allRedeemable === true ||
    opts.allRedeemable === '1' ||
    opts.allRedeemable === 1 ||
    opts.includeStall === true ||
    opts.includeStall === '1' ||
    opts.includeStall === 1
  const roleSql = includeStall ? `m.role IN ('cross', 'stall')` : `m.role='cross'`
  let stores
  try {
    stores = await query(
      `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude, m.role, m.status,
              m.cover_hue AS coverHue, m.cover_url AS coverImage, m.materials_json AS materialsJson,
              LEFT(m.name,1) AS initial,
              CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
              IFNULL(
                NULLIF(m.biz_type,''),
                CASE WHEN m.role='stall' THEN '餐饮' ELSE '百货商店' END
              ) AS category
       FROM merchants m
       WHERE ${roleSql} AND m.status=1 AND m.deleted_at IS NULL
         AND ${HOME_PAY_READY_SQL}
       ORDER BY m.id DESC`
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column.*wx_sub_mch/i.test(String(e.message || ''))))) {
      throw e
    }
    stores = await query(
      `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude, m.role, m.status,
              m.cover_hue AS coverHue, m.cover_url AS coverImage, m.materials_json AS materialsJson,
              LEFT(m.name,1) AS initial,
              CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
              IFNULL(
                NULLIF(m.biz_type,''),
                CASE WHEN m.role='stall' THEN '餐饮' ELSE '百货商店' END
              ) AS category
       FROM merchants m
       WHERE ${roleSql} AND m.status=1 AND m.deleted_at IS NULL
       ORDER BY m.id DESC`
    )
  }
  const located = applyGeo(stores.map((r) => enrichCoverRow(r)), opts)
  const withItems =
    opts.withItems === true || opts.withItems === '1' || opts.withItems === 1
  // 列表页不需要商品明细；避免 N+1 拖慢首屏（详情页走 /cross-stores/:id）
  if (!withItems) {
    for (const s of located) {
      s.role = s.role || 'cross'
      s.roleLabel = s.role === 'stall' ? '点餐' : '兑换'
      s.items = []
    }
    return located
  }
  const crossIds = located.filter((s) => (s.role || 'cross') === 'cross').map((s) => Number(s.id))
  let goodsByMid = {}
  if (crossIds.length) {
    const idList = crossIds.filter((n) => Number.isFinite(n) && n > 0)
    if (idList.length) {
      let goodsRows = []
      try {
        goodsRows = await query(
          `SELECT merchant_id AS merchantId, id, name, points_need AS pointsNeed, cash_price AS cashPrice,
                  desc_text AS \`desc\`, image_url AS coverImage, sku_code AS sku,
                  IFNULL(allow_mix,1) AS allowMix
           FROM cross_goods
           WHERE merchant_id IN (${idList.join(',')}) AND on_sale=1 AND deleted_at IS NULL`
        )
      } catch (e) {
        goodsRows = await query(
          `SELECT merchant_id AS merchantId, id, name, points_need AS pointsNeed, cash_price AS cashPrice,
                  desc_text AS \`desc\`, image_url AS coverImage, sku_code AS sku, 1 AS allowMix
           FROM cross_goods
           WHERE merchant_id IN (${idList.join(',')}) AND on_sale=1 AND deleted_at IS NULL`
        )
      }
      goodsByMid = goodsRows.reduce((acc, g) => {
        const mid = String(g.merchantId)
        if (!acc[mid]) acc[mid] = []
        acc[mid].push(g)
        return acc
      }, {})
    }
  }
  for (const s of located) {
    s.role = s.role || 'cross'
    s.roleLabel = s.role === 'stall' ? '点餐' : '兑换'
    s.items = s.role === 'cross' ? goodsByMid[String(s.id)] || [] : []
  }
  return located
}

async function getStallMenu(merchantId) {
  const merchants = await query(
    `SELECT id, name, address, city, latitude, longitude,
            cover_hue AS coverHue, cover_url AS coverImage, materials_json AS materialsJson,
            LEFT(name,1) AS initial, status
     FROM merchants
     WHERE id=:id AND role='stall' AND deleted_at IS NULL`,
    { id: merchantId }
  )
  if (!merchants.length) throw new HttpError(404, '摊位不存在')
  enrichCoverRow(merchants[0])
  if (Number(merchants[0].status) !== 1) throw new HttpError(400, '本店已歇业，暂不能收款')
  const { C_END_EXCLUDE_TEST_NAME_SQL, isTestGoodsName } = require('../utils/goodsName')
  let goods
  try {
    goods = await query(
      `SELECT id, name, price, points_grant AS pointsGrant, category, desc_text AS \`desc\`,
              image_url AS coverImage, image_url AS imageUrl, stock, sku_code AS sku,
              IFNULL(allow_remark, 1) AS allowRemark
       FROM stall_goods
       WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL
         AND ${C_END_EXCLUDE_TEST_NAME_SQL}`,
      { id: merchantId }
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('allow_remark')))) {
      throw e
    }
    goods = await query(
      `SELECT id, name, price, points_grant AS pointsGrant, category, desc_text AS \`desc\`,
              image_url AS coverImage, image_url AS imageUrl, stock, sku_code AS sku, 1 AS allowRemark
       FROM stall_goods WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL`,
      { id: merchantId }
    )
    goods = goods.filter((g) => !isTestGoodsName(g.name))
  }
  const menu = await stallOptionsService.attachMenuOptions(goods)
  return { stall: merchants[0], menu }
}

async function insertStallOrderItems(conn, orderId, lines) {
  for (const l of lines) {
    const displayName = l.optionsText ? `${l.name}（${l.optionsText}）` : l.name
    const itemRemark = l.itemRemark ? String(l.itemRemark).slice(0, 128) : null
    try {
      await conn.execute(
        `INSERT INTO consumer_order_items
          (order_id, goods_id, goods_name, price, points_grant, qty, options_json, options_text, item_remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          l.goodsId,
          displayName,
          l.price,
          l.pointsGrant,
          l.qty,
          JSON.stringify(l.optionsJson || []),
          l.optionsText || null,
          itemRemark
        ]
      )
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('item_remark'))) {
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
        } catch (e2) {
          if (e2 && (e2.code === 'ER_BAD_FIELD_ERROR' || String(e2.message || '').includes('options_'))) {
            await conn.execute(
              `INSERT INTO consumer_order_items
                (order_id, goods_id, goods_name, price, points_grant, qty)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [orderId, l.goodsId, displayName, l.price, l.pointsGrant, l.qty]
            )
          } else {
            throw e2
          }
        }
      } else if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('options_'))) {
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
    await conn.execute(`UPDATE stall_goods SET sales_count = IFNULL(sales_count,0) + ? WHERE id=?`, [
      l.qty,
      l.goodsId
    ])
  }
}

/** 创建点餐订单：积分抵现 + 剩余微信（未配商户号则模拟成功）；真实支付待回调入账 */
async function createAndPayStallOrder({ userId, merchantId, items, pointsUse = 0, remark = '' }) {
  if (!items || !items.length) throw new HttpError(400, '购物车为空')
  await feeService.assertCanTransact(merchantId, { action: '接单' })
  const buyerRemark = String(remark || '').trim().slice(0, 255)

  const preview = await withTransaction(async (conn) => {
    let totalAmount = 0
    let pointsWant = 0
    const lines = []
    for (const it of items) {
      const line = await stallOptionsService.resolveStallLine(conn, {
        merchantId,
        goodsId: Number(it.goodsId),
        optionIds: it.optionIds || [],
        qty: it.qty,
        itemRemark: it.remark || it.itemRemark || ''
      })
      totalAmount += Number(line.price) * line.qty
      pointsWant += Number(line.pointsGrant) * line.qty
      lines.push(line)
    }
    totalAmount = round2(totalAmount)
    const rate = await getCashRate()
    const [urows] = await conn.execute('SELECT points_balance FROM users WHERE id=? FOR UPDATE', [
      userId
    ])
    if (!urows.length) throw new HttpError(404, '用户不存在')
    const balance = Number(urows[0].points_balance) || 0
    const cap = Math.min(balance, cashToPoints(totalAmount, rate))
    let pointsSpend = Math.max(0, Math.floor(Number(pointsUse) || 0))
    if (pointsSpend > cap) pointsSpend = cap
    const offset = round2(pointsToCash(pointsSpend, rate))
    const cashPaid = round2(Math.max(0, totalAmount - offset))
    // SKU 未配赠积分时，按实付现金汇率回落（与扫码收款一致，满足验收 D5）
    if (!pointsWant && cashPaid > 0) {
      pointsWant = cashToPoints(cashPaid, rate)
    }
    return { totalAmount, pointsWant, pointsSpend, offset, cashPaid, lines, rate }
  })

  const { totalAmount, pointsWant, pointsSpend, offset, cashPaid, lines } = preview
  const ono = orderNo('O')
  assertPaySimulateAllowed(cashPaid)
  const realPay = wxService.wxPayConfigured() && cashPaid > 0

  async function insertConsumerOrder(conn, extra = {}) {
    const payChannel = extra.payChannel || 'simulate'
    let ins
    try {
      ;[ins] = await conn.execute(
        `INSERT INTO consumer_orders
          (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
           points_spend, cash_paid, pay_channel, pay_status, order_status, buyer_remark)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'unpaid', 'pending', ?)`,
        [
          ono,
          userId,
          merchantId,
          totalAmount,
          pointsWant,
          pointsSpend,
          cashPaid,
          payChannel,
          buyerRemark || null
        ]
      )
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('buyer_remark'))) {
        try {
          ;[ins] = await conn.execute(
            `INSERT INTO consumer_orders
              (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
               points_spend, cash_paid, pay_channel, pay_status, order_status)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'unpaid', 'pending')`,
            [ono, userId, merchantId, totalAmount, pointsWant, pointsSpend, cashPaid, payChannel]
          )
        } catch (e2) {
          if (e2 && (e2.code === 'ER_BAD_FIELD_ERROR' || String(e2.message || '').includes('points_spend'))) {
            ;[ins] = await conn.execute(
              `INSERT INTO consumer_orders
                (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
                 pay_status, order_status)
               VALUES (?, ?, ?, ?, ?, 0, 'unpaid', 'pending')`,
              [ono, userId, merchantId, totalAmount, pointsWant]
            )
          } else throw e2
        }
      } else if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('points_spend'))) {
        ;[ins] = await conn.execute(
          `INSERT INTO consumer_orders
            (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
             pay_status, order_status)
           VALUES (?, ?, ?, ?, ?, 0, 'unpaid', 'pending')`,
          [ono, userId, merchantId, totalAmount, pointsWant]
        )
      } else throw e
    }
    return ins.insertId
  }

  if (!realPay) {
    return withTransaction(async (conn) => {
      const payMeta = wxService.buildPayResult({
        orderNo: ono,
        cashAmount: cashPaid,
        simulated: true
      })
      const orderId = await insertConsumerOrder(conn, { payChannel: payMeta.payChannel })
      await insertStallOrderItems(conn, orderId, lines)
      const [orows] = await conn.execute('SELECT * FROM consumer_orders WHERE id=? FOR UPDATE', [orderId])
      const fin = await finalizePaidConsumerOrder(conn, orows[0], {})
      try {
        await conn.execute(`UPDATE consumer_orders SET order_status='preparing' WHERE id=?`, [orderId])
      } catch (_) {}
      return {
        orderId,
        orderNo: ono,
        totalAmount,
        cashPaid,
        pointsSpend,
        offsetCash: offset,
        pointsWant,
        pointsAllocated: Number(fin.pointsAllocated) || Number(pointsWant) || 0,
        pointsBalance: fin.pointsBalance,
        status: 'preparing',
        payStatus: 'paid',
        commission: fin.commission,
        merchantNet: fin.merchantNet,
        ...payMeta
      }
    })
  }

  const merchants = await query('SELECT name FROM merchants WHERE id=:id', { id: merchantId })
  const shopName = merchants[0] ? merchants[0].name : '地摊点餐'
  const openid = await getUserOpenid(userId)
  const subMchId = await getMerchantSubMchId(merchantId)

  async function finalizeAsSimulated(reason) {
    return withTransaction(async (conn) => {
      const payMeta = wxService.buildPayResult({
        orderNo: ono,
        cashAmount: cashPaid,
        simulated: true,
        message: reason || '微信支付暂不可用，已按模拟支付入账'
      })
      const orderId = await insertConsumerOrder(conn, { payChannel: payMeta.payChannel })
      await insertStallOrderItems(conn, orderId, lines)
      const [orows] = await conn.execute('SELECT * FROM consumer_orders WHERE id=? FOR UPDATE', [orderId])
      const fin = await finalizePaidConsumerOrder(conn, orows[0], {})
      try {
        await conn.execute(`UPDATE consumer_orders SET order_status='preparing' WHERE id=?`, [orderId])
      } catch (_) {}
      return {
        orderId,
        orderNo: ono,
        totalAmount,
        cashPaid,
        pointsSpend,
        offsetCash: offset,
        pointsWant,
        pointsAllocated: Number(fin.pointsAllocated) || Number(pointsWant) || 0,
        pointsBalance: fin.pointsBalance,
        status: 'preparing',
        payStatus: 'paid',
        commission: fin.commission,
        merchantNet: fin.merchantNet,
        ...payMeta
      }
    })
  }

  // 无二级商户时交给 resolvePayMode：WX_PAY_ALLOW_DIRECT=1 走平台直收；否则再模拟/报错
  const created = await withTransaction(async (conn) => {
    const orderId = await insertConsumerOrder(conn, { payChannel: 'wxpay' })
    await insertStallOrderItems(conn, orderId, lines)
    // 真实支付前预扣抵现积分，防止并发超扣；取消时退回
    if (pointsSpend > 0) {
      await pointsService.spendConsumerPoints(conn, {
        userId,
        points: pointsSpend,
        title: '点餐积分抵现（预扣）',
        bizId: ono
      })
    }
    return { orderId }
  })

  let prepay
  try {
    prepay = await wxService.createJsapiPayForOrder({
      orderNo: ono,
      description: `${shopName}·点餐`,
      amountYuan: cashPaid,
      openid,
      subMchId,
      attach: `menu:${merchantId}`
    })
  } catch (e) {
    const msg = String((e && e.message) || '')
    const needSub = /sub_mch|二级商户|受理机构|WX_PAY_ALLOW_DIRECT|未开启平台直收/i.test(msg)
    await withTransaction(async (conn) => {
      const [rows] = await conn.execute(
        `SELECT * FROM consumer_orders WHERE order_no=? AND pay_status='unpaid' FOR UPDATE`,
        [ono]
      )
      if (!rows.length) return
      const o = rows[0]
      await conn.execute(
        `UPDATE consumer_orders SET order_status='cancelled' WHERE id=? AND pay_status='unpaid'`,
        [o.id]
      )
      const pts = Number(o.points_spend) || 0
      if (pts > 0) {
        await pointsService.refundConsumerPoints(conn, {
          userId: o.user_id,
          points: pts,
          title: '点餐取消退回积分',
          bizId: `${ono}:cancel`
        })
      }
    }).catch((err) => console.warn('[order] rollback prepay fail', err.message))

    if (needSub && config.allowPaySimulate) {
      return finalizeAsSimulated(
        String(subMchId || '').trim()
          ? '微信支付需二级商户号，已按模拟支付入账'
          : '门店未进件二级商户且直收不可用，已按模拟微信支付入账'
      )
    }
    if (needSub && !String(subMchId || '').trim()) {
      throw new HttpError(
        400,
        '门店尚未完成微信收款进件（缺少二级商户号）。请完成进件，或联调开启 WX_PAY_ALLOW_DIRECT=1 / ALLOW_PAY_SIMULATE=1'
      )
    }
    throw e
  }

  // 积分抵现延后到支付成功；先把待扣积分记在订单上
  const payMeta = wxService.buildPayResult({
    orderNo: ono,
    cashAmount: cashPaid,
    simulated: false,
    payParams: prepay.payParams,
    payChannel: 'wxpay',
    message: prepay.mode === 'direct' ? '平台直收测试支付，请完成微信支付' : '请完成微信支付'
  })

  return {
    orderId: created.orderId,
    orderNo: ono,
    totalAmount,
    cashPaid,
    pointsSpend,
    offsetCash: offset,
    pointsWant,
    pointsAllocated: 0,
    status: 'unpaid',
    payStatus: 'unpaid',
    needConfirm: true,
    payMode: prepay.mode,
    subMchId: prepay.subMchId,
    ...payMeta
  }
}

async function getUserOpenid(userId) {
  const rows = await query('SELECT openid FROM users WHERE id=:id LIMIT 1', { id: Number(userId) })
  return rows.length ? String(rows[0].openid || '').trim() : ''
}

async function getMerchantSubMchId(merchantId) {
  try {
    const rows = await query(
      'SELECT wx_sub_mch_id AS sub FROM merchants WHERE id=:id LIMIT 1',
      { id: Number(merchantId) }
    )
    return rows.length ? String(rows[0].sub || '').trim() : ''
  } catch (_) {
    return ''
  }
}

/** 支付成功后入账：积分划拨 + 抽成 + 货款 + 推荐（幂等） */
async function finalizePaidConsumerOrder(conn, orderRow, { transactionId } = {}) {
  const o = orderRow
  if (o.pay_status === 'paid') {
    return { alreadyPaid: true, orderId: o.id, orderNo: o.order_no }
  }
  // 用户已取消：微信若仍成功，不入账结算，交由退款/人工处理
  if (String(o.order_status) === 'cancelled') {
    return {
      alreadyPaid: false,
      cancelled: true,
      needRefund: true,
      orderId: o.id,
      orderNo: o.order_no
    }
  }
  const mid = Number(o.merchant_id)
  const uid = Number(o.user_id)
  const cash = round2(o.cash_paid != null ? o.cash_paid : o.total_amount)
  const pointsWant = Number(o.points_want) || 0
  const [mrows] = await conn.execute('SELECT name FROM merchants WHERE id=?', [mid])
  const shopName = mrows[0] ? mrows[0].name : ''

  const orderStatus =
    String(o.order_no || '').startsWith('S') || String(o.order_status) === 'completed'
      ? 'completed'
      : o.order_status === 'preparing'
        ? 'preparing'
        : 'preparing'

  // 先扣积分（幂等），不足则整单失败，避免「已标已付却未扣积分」
  const pointsSpend = Number(o.points_spend) || 0
  if (pointsSpend > 0) {
    await pointsService.spendConsumerPoints(conn, {
      userId: uid,
      points: pointsSpend,
      title: '点餐积分抵现',
      bizId: o.order_no
    })
  }

  try {
    await conn.execute(
      `UPDATE consumer_orders
       SET pay_status='paid', order_status=?, paid_at=NOW(),
           wx_transaction_id=IFNULL(?, wx_transaction_id),
           pay_channel=IFNULL(pay_channel, 'wxpay')
       WHERE id=? AND pay_status='unpaid' AND order_status<>'cancelled'`,
      [orderStatus === 'completed' ? 'completed' : orderStatus, transactionId || null, o.id]
    )
  } catch (e) {
    if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('pay_channel'))) {
      await conn.execute(
        `UPDATE consumer_orders
         SET pay_status='paid', order_status=?, paid_at=NOW(),
             wx_transaction_id=IFNULL(?, wx_transaction_id)
         WHERE id=? AND pay_status='unpaid' AND order_status<>'cancelled'`,
        [orderStatus === 'completed' ? 'completed' : 'pending', transactionId || null, o.id]
      )
      if (orderStatus === 'completed') {
        try {
          await conn.execute(`UPDATE consumer_orders SET order_status='completed' WHERE id=?`, [o.id])
        } catch (_) {}
      }
    } else if (e && String(e.message || '').includes("Invalid data for column 'order_status'")) {
      await conn.execute(
        `UPDATE consumer_orders
         SET pay_status='paid', paid_at=NOW(), wx_transaction_id=IFNULL(?, wx_transaction_id)
         WHERE id=? AND pay_status='unpaid'`,
        [transactionId || null, o.id]
      )
    } else {
      throw e
    }
  }

  let allocated = Number(o.points_allocated) || 0
  let shortage = 0
  if (allocated === 0 && pointsWant > 0) {
    try {
      const alloc = await pointsService.allocateToConsumer(conn, {
        merchantId: mid,
        userId: uid,
        wantPoints: pointsWant,
        shopName,
        orderNo: o.order_no,
        allowDegrade: true
      })
      allocated = alloc.allocated
      shortage = alloc.shortage
    } catch (e) {
      console.warn('[order] finalize points allocate', o.order_no, e.message)
      allocated = 0
      shortage = pointsWant
    }
    try {
      await conn.execute(
        'UPDATE consumer_orders SET points_allocated=?, points_allocated_at=NOW() WHERE id=?',
        [allocated, o.id]
      )
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('points_allocated_at'))) {
        await conn.execute('UPDATE consumer_orders SET points_allocated=? WHERE id=?', [allocated, o.id])
      } else throw e
    }
  }

  // 仅按实收现金结算，禁止用积分抵现部分虚增可提现余额
  const settleBase = cash
  const commission = await recordCommission(conn, {
    bizType: 'stall',
    bizId: o.order_no,
    payerMerchantId: mid,
    amountGross: settleBase
  })
  const net = Math.round((settleBase - commission) * 100) / 100
  await accountService.creditAccount(conn, {
    merchantId: mid,
    accountType: 'cash_settlement',
    amount: net,
    bizType: String(o.order_no || '').startsWith('S') ? 'stall_settle' : 'stall_settle',
    bizId: o.order_no,
    title: `${String(o.order_no || '').startsWith('S') ? '到店消费' : '点餐'}入账 · ${o.order_no}`
  })
  await referralService.onConsumerOrderDone(conn, {
    inviteeUserId: uid,
    orderNo: o.order_no,
    kind: 'stall'
  })

  const [urows] = await conn.execute('SELECT points_balance FROM users WHERE id=?', [uid])
  return {
    alreadyPaid: false,
    orderId: o.id,
    orderNo: o.order_no,
    pointsAllocated: allocated,
    shortage,
    pointsBalance: urows.length ? Number(urows[0].points_balance) : allocated,
    commission,
    merchantNet: net,
    shopName,
    status: orderStatus === 'completed' ? 'completed' : 'preparing'
  }
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

  /** 仅复用已有人工商品；禁止扫码收款时自动新建占位 SKU（删除后也不再复活） */
  async function resolveScanGoodsId(conn) {
    try {
      const [onSale] = await conn.execute(
        `SELECT id FROM stall_goods
         WHERE merchant_id=? AND deleted_at IS NULL AND IFNULL(on_sale,0)=1
         ORDER BY id ASC LIMIT 1`,
        [mid]
      )
      if (onSale.length) return Number(onSale[0].id)
      const [any] = await conn.execute(
        `SELECT id FROM stall_goods WHERE merchant_id=? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
        [mid]
      )
      if (any.length) return Number(any[0].id)
    } catch (e) {
      console.warn('[scan-pay] resolve goods', e.message)
    }
    return 0
  }

  assertPaySimulateAllowed(cash)
  const realPay = wxService.wxPayConfigured() && cash > 0
  const rate = await getCashRate()
  const pointsWant = cashToPoints(cash, rate)
  const ono = orderNo('S')

  if (!realPay) {
    return withTransaction(async (conn) => {
      const payMeta = wxService.buildPayResult({ orderNo: ono, cashAmount: cash, simulated: true })
      let ins
      try {
        ;[ins] = await conn.execute(
          `INSERT INTO consumer_orders
            (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
             points_spend, cash_paid, pay_channel, pay_status, order_status)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'unpaid', 'pending')`,
          [ono, uid, mid, cash, pointsWant, cash, payMeta.payChannel]
        )
      } catch (e) {
        if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('points_spend'))) {
          ;[ins] = await conn.execute(
            `INSERT INTO consumer_orders
              (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
               pay_status, order_status)
             VALUES (?, ?, ?, ?, ?, 0, 'unpaid', 'pending')`,
            [ono, uid, mid, cash, pointsWant]
          )
        } else {
          throw e
        }
      }
      const orderId = ins.insertId
      const gid = await resolveScanGoodsId(conn)
      try {
        await conn.execute(
          `INSERT INTO consumer_order_items
            (order_id, goods_id, goods_name, price, points_grant, qty)
           VALUES (?, ?, '到店消费', ?, ?, 1)`,
          [orderId, gid || 0, cash, pointsWant]
        )
      } catch (e) {
        if (!(e && (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_NO_REFERENCED_ROW'))) throw e
        if (!gid) throw new HttpError(400, '该摊位暂未上架商品，无法完成收款')
        await conn.execute(
          `INSERT INTO consumer_order_items
            (order_id, goods_id, goods_name, price, points_grant, qty)
           VALUES (?, ?, '到店消费', ?, ?, 1)`,
          [orderId, gid, cash, pointsWant]
        )
      }
      const [orows] = await conn.execute('SELECT * FROM consumer_orders WHERE id=? FOR UPDATE', [orderId])
      const fin = await finalizePaidConsumerOrder(conn, orows[0], {})
      return {
        orderId,
        orderNo: ono,
        totalAmount: cash,
        cashPaid: cash,
        pointsSpend: 0,
        pointsWant,
        pointsAllocated: fin.pointsAllocated,
        pointsBalance: fin.pointsBalance,
        shortage: fin.shortage,
        shopName: m.name,
        status: 'completed',
        commission: fin.commission,
        merchantNet: fin.merchantNet,
        ...payMeta
      }
    })
  }

  // 真实支付：先落 unpaid，拉起 JSAPI，回调后再入账
  const created = await withTransaction(async (conn) => {
    let ins
    try {
      ;[ins] = await conn.execute(
        `INSERT INTO consumer_orders
          (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
           points_spend, cash_paid, pay_channel, pay_status, order_status)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'wxpay', 'unpaid', 'pending')`,
        [ono, uid, mid, cash, pointsWant, cash]
      )
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('points_spend'))) {
        ;[ins] = await conn.execute(
          `INSERT INTO consumer_orders
            (order_no, user_id, merchant_id, total_amount, points_want, points_allocated,
             pay_status, order_status)
           VALUES (?, ?, ?, ?, ?, 0, 'unpaid', 'pending')`,
          [ono, uid, mid, cash, pointsWant]
        )
      } else {
        throw e
      }
    }
    const orderId = ins.insertId
    const gid = await resolveScanGoodsId(conn)
    try {
      await conn.execute(
        `INSERT INTO consumer_order_items
          (order_id, goods_id, goods_name, price, points_grant, qty)
         VALUES (?, ?, '到店消费', ?, ?, 1)`,
        [orderId, gid || 0, cash, pointsWant]
      )
    } catch (e) {
      if (!(e && (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_NO_REFERENCED_ROW'))) throw e
      if (!gid) throw new HttpError(400, '该摊位暂未上架商品，无法完成收款')
      await conn.execute(
        `INSERT INTO consumer_order_items
          (order_id, goods_id, goods_name, price, points_grant, qty)
         VALUES (?, ?, '到店消费', ?, ?, 1)`,
        [orderId, gid, cash, pointsWant]
      )
    }
    return { orderId }
  })

  const openid = await getUserOpenid(uid)
  const subMchId = await getMerchantSubMchId(mid)
  let prepay
  try {
    prepay = await wxService.createJsapiPayForOrder({
      orderNo: ono,
      description: `${m.name || '地摊'}·到店消费`,
      amountYuan: cash,
      openid,
      subMchId,
      attach: `scan:${mid}`
    })
  } catch (e) {
    await query(`UPDATE consumer_orders SET order_status='cancelled' WHERE order_no=:ono AND pay_status='unpaid'`, {
      ono
    }).catch(() => {})
    throw e
  }

  const payMeta = wxService.buildPayResult({
    orderNo: ono,
    cashAmount: cash,
    simulated: false,
    payParams: prepay.payParams,
    payChannel: 'wxpay',
    message: prepay.mode === 'direct' ? '平台直收测试支付，请完成微信支付' : '请完成微信支付'
  })

  return {
    orderId: created.orderId,
    orderNo: ono,
    totalAmount: cash,
    cashPaid: cash,
    pointsSpend: 0,
    pointsWant,
    pointsAllocated: 0,
    shopName: m.name,
    status: 'unpaid',
    payMode: prepay.mode,
    subMchId: prepay.subMchId,
    needConfirm: true,
    ...payMeta
  }
}

function scheduleProfitShare(orderRow, transactionId, fin) {
  if (!orderRow || !transactionId || (fin && fin.alreadyPaid)) return
  const amountYuan =
    orderRow.cash_paid != null
      ? orderRow.cash_paid
      : orderRow.cash_amount != null
        ? orderRow.cash_amount
        : orderRow.total_amount
  if (!(Number(amountYuan) > 0)) return
  setImmediate(() => {
    const subMerchantService = require('./subMerchantService')
    subMerchantService
      .maybeAutoProfitShare({
        merchantId: orderRow.merchant_id,
        orderNo: orderRow.order_no,
        transactionId,
        amountYuan
      })
      .catch((e) => console.warn('[wxpay] auto profit share', e.message))
  })
}

async function handleWxPayNotify(headers, rawBody) {
  const parsed = await wxService.parsePayNotify({ headers, rawBody })
  if (parsed.tradeState && parsed.tradeState !== 'SUCCESS') {
    return { ignored: true, tradeState: parsed.tradeState }
  }
  const ono = parsed.outTradeNo
  if (!ono) throw new HttpError(400, '回调缺少商户订单号')

  // 异业现金/组合单
  if (String(ono).startsWith('C')) {
    const crossResult = await withTransaction(async (conn) => {
      const [rows] = await conn.execute('SELECT * FROM cross_orders WHERE order_no=? FOR UPDATE', [ono])
      if (!rows.length) return { ignored: true, reason: 'cross_order_not_found', orderNo: ono }
      const fin = await finalizeCrossPaidOrder(conn, rows[0], {
        transactionId: parsed.transactionId
      })
      return { ok: true, ...fin, transactionId: parsed.transactionId, _order: rows[0] }
    })
    if (crossResult && crossResult.ok && crossResult._order) {
      scheduleProfitShare(crossResult._order, parsed.transactionId, crossResult)
      delete crossResult._order
    }
    return crossResult
  }

  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM consumer_orders WHERE order_no=? FOR UPDATE', [ono])
    if (!rows.length) {
      return { ignored: true, reason: 'order_not_found', orderNo: ono }
    }
    const fin = await finalizePaidConsumerOrder(conn, rows[0], {
      transactionId: parsed.transactionId
    })
    if (fin.cancelled || fin.needRefund) {
      console.warn('[wxpay/notify] paid after cancel, need refund', ono)
      return { ok: true, ...fin, transactionId: parsed.transactionId }
    }
    return { ok: true, ...fin, transactionId: parsed.transactionId, _order: rows[0] }
  })
  if (result && result.ok && result._order && !result.needRefund) {
    scheduleProfitShare(result._order, parsed.transactionId, result)
    delete result._order
  } else if (result && result._order) {
    delete result._order
  }
  return result
}

/** 取消未支付点餐单（用户取消微信支付后主动关单） */
async function cancelUnpaidConsumerOrder(orderNo, userId) {
  const ono = String(orderNo || '').trim()
  if (!ono) throw new HttpError(400, '缺少订单号')
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT * FROM consumer_orders WHERE order_no=? FOR UPDATE',
      [ono]
    )
    if (!rows.length) throw new HttpError(404, '订单不存在')
    const o = rows[0]
    if (Number(o.user_id) !== Number(userId)) throw new HttpError(403, '无权操作该订单')
    if (o.pay_status === 'paid') throw new HttpError(400, '订单已支付，无法取消')
    if (o.order_status === 'cancelled') {
      return { orderNo: ono, status: 'cancelled', payStatus: o.pay_status, alreadyCancelled: true }
    }
    if (o.pay_status !== 'unpaid') throw new HttpError(400, '当前状态不可取消')
    await conn.execute(
      `UPDATE consumer_orders SET order_status='cancelled'
       WHERE id=? AND pay_status='unpaid' AND order_status<>'cancelled'`,
      [o.id]
    )
    const pts = Number(o.points_spend) || 0
    if (pts > 0) {
      await pointsService.refundConsumerPoints(conn, {
        userId: o.user_id,
        points: pts,
        title: '点餐取消退回积分',
        bizId: `${ono}:cancel`
      })
    }
    return { orderNo: ono, status: 'cancelled', payStatus: 'unpaid' }
  })
}

/** 未支付订单重新拉起微信支付参数 */
async function repayConsumerOrder(orderNo, userId) {
  const ono = String(orderNo || '').trim()
  if (!ono) throw new HttpError(400, '缺少订单号')
  const rows = await query('SELECT * FROM consumer_orders WHERE order_no=:ono LIMIT 1', { ono })
  if (!rows.length) throw new HttpError(404, '订单不存在')
  const o = rows[0]
  if (Number(o.user_id) !== Number(userId)) throw new HttpError(403, '无权操作该订单')
  if (o.pay_status === 'paid') {
    return {
      orderNo: ono,
      status: o.order_status,
      payStatus: 'paid',
      alreadyPaid: true,
      cashPaid: Number(o.cash_paid) || 0,
      simulated: false
    }
  }
  if (o.order_status === 'cancelled') throw new HttpError(400, '订单已取消，请重新下单')
  if (o.pay_status !== 'unpaid') throw new HttpError(400, '当前状态不可继续支付')

  const cashPaid = round2(o.cash_paid != null ? o.cash_paid : o.total_amount)
  if (!(cashPaid > 0)) {
    // 全积分抵扣单理论上不会走到 unpaid；兜底直接入账
    return withTransaction(async (conn) => {
      const [locked] = await conn.execute('SELECT * FROM consumer_orders WHERE order_no=? FOR UPDATE', [ono])
      const fin = await finalizePaidConsumerOrder(conn, locked[0], {})
      try {
        await conn.execute(`UPDATE consumer_orders SET order_status='preparing' WHERE id=?`, [locked[0].id])
      } catch (_) {}
      return {
        orderId: locked[0].id,
        orderNo: ono,
        cashPaid: 0,
        pointsSpend: Number(locked[0].points_spend) || 0,
        pointsAllocated: fin.pointsAllocated,
        status: 'preparing',
        payStatus: 'paid',
        simulated: true,
        ...wxService.buildPayResult({ orderNo: ono, cashAmount: 0, simulated: true })
      }
    })
  }

  if (!wxService.wxPayConfigured()) {
    throw new HttpError(400, '微信支付未配置，无法继续支付')
  }

  const merchants = await query('SELECT name FROM merchants WHERE id=:id', { id: o.merchant_id })
  const shopName = merchants[0] ? merchants[0].name : '地摊点餐'
  const openid = await getUserOpenid(userId)
  const subMchId = await getMerchantSubMchId(o.merchant_id)
  const prepay = await wxService.createJsapiPayForOrder({
    orderNo: ono,
    description: `${shopName}·点餐`,
    amountYuan: cashPaid,
    openid,
    subMchId,
    attach: `menu:${o.merchant_id}`
  })
  const payMeta = wxService.buildPayResult({
    orderNo: ono,
    cashAmount: cashPaid,
    simulated: false,
    payParams: prepay.payParams,
    payChannel: 'wxpay',
    message: '请完成微信支付'
  })
  return {
    orderId: o.id,
    orderNo: ono,
    totalAmount: Number(o.total_amount) || cashPaid,
    cashPaid,
    pointsSpend: Number(o.points_spend) || 0,
    pointsWant: Number(o.points_want) || 0,
    pointsAllocated: 0,
    status: 'unpaid',
    payStatus: 'unpaid',
    needConfirm: true,
    payMode: prepay.mode,
    subMchId: prepay.subMchId,
    ...payMeta
  }
}

/** 消费者订单详情 */
async function getConsumerOrderDetail(orderNo, userId) {
  const ono = String(orderNo || '').trim()
  if (!ono) throw new HttpError(400, '缺少订单号')
  let rows
  try {
    rows = await query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_want AS pointsWant,
              o.points_allocated AS pointsAllocated, o.points_spend AS pointsSpend, o.cash_paid AS cashPaid,
              o.pay_status AS payStatus, o.order_status AS status, o.buyer_remark AS buyerRemark,
              o.created_at AS time, o.paid_at AS paidAt, o.merchant_id AS merchantId,
              m.name AS stallName, m.cover_url AS stallCover, m.address AS stallAddress
       FROM consumer_orders o
       JOIN merchants m ON m.id=o.merchant_id
       WHERE o.order_no=:ono LIMIT 1`,
      { ono }
    )
  } catch (e) {
    if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
    rows = await query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_want AS pointsWant,
              o.points_allocated AS pointsAllocated, o.pay_status AS payStatus, o.order_status AS status,
              o.created_at AS time, o.merchant_id AS merchantId, m.name AS stallName
       FROM consumer_orders o
       JOIN merchants m ON m.id=o.merchant_id
       WHERE o.order_no=:ono LIMIT 1`,
      { ono }
    )
  }
  if (!rows.length) throw new HttpError(404, '订单不存在')
  const o = rows[0]
  // 校验归属：通过 order id 再查 user（上面 select 未带 user_id 时）
  const owner = await query('SELECT user_id AS userId FROM consumer_orders WHERE order_no=:ono LIMIT 1', { ono })
  if (!owner.length || Number(owner[0].userId) !== Number(userId)) {
    throw new HttpError(403, '无权查看该订单')
  }
  let items
  try {
    items = await query(
      `SELECT goods_id AS goodsId, goods_name AS name, price, points_grant AS pointsGrant, qty,
              options_text AS optionsText, item_remark AS remark
       FROM consumer_order_items WHERE order_id=:id ORDER BY id ASC`,
      { id: o.id }
    )
  } catch (e) {
    if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
    items = await query(
      `SELECT goods_id AS goodsId, goods_name AS name, price, points_grant AS pointsGrant, qty
       FROM consumer_order_items WHERE order_id=:id ORDER BY id ASC`,
      { id: o.id }
    )
  }
  return {
    ...o,
    type: 'stall',
    items: items || [],
    unpaid: o.payStatus === 'unpaid' && o.status !== 'cancelled'
  }
}

async function assertWxTradeSuccess(ono, merchantId) {
  const subMchId = await getMerchantSubMchId(merchantId)
  let wxOrder = null
  try {
    wxOrder = await wxService.queryWxOrder(ono, { subMchId })
  } catch (e) {
    console.warn('[wxpay] query order', e.message)
  }
  const tradeState = wxOrder && (wxOrder.trade_state || wxOrder.tradeState)
  const transactionId = wxOrder && (wxOrder.transaction_id || wxOrder.transactionId)
  if (tradeState && tradeState !== 'SUCCESS') {
    throw new HttpError(400, `微信支付未完成（${tradeState}）`)
  }
  if (!tradeState && !transactionId) {
    throw new HttpError(400, '暂未查到支付成功，请稍后再试或等待支付回调')
  }
  return transactionId
}

/** 小程序支付成功后主动对账入账（防回调延迟） */
async function syncConsumerPay(orderNo, userId) {
  const ono = String(orderNo || '').trim()
  if (!ono) throw new HttpError(400, '缺少订单号')

  if (ono.startsWith('C')) {
    const rows = await query('SELECT * FROM cross_orders WHERE order_no=:ono LIMIT 1', { ono })
    if (!rows.length) throw new HttpError(404, '订单不存在')
    const o = rows[0]
    if (userId && Number(o.user_id) !== Number(userId)) throw new HttpError(403, '无权操作该订单')
    if (o.status === 'completed') {
      return { orderNo: ono, status: 'completed', payStatus: 'paid', alreadyPaid: true }
    }
    if (o.status === 'cancelled') throw new HttpError(400, '订单已取消')
    const transactionId = await assertWxTradeSuccess(ono, o.merchant_id)
    const paid = await withTransaction(async (conn) => {
      const [locked] = await conn.execute('SELECT * FROM cross_orders WHERE order_no=? FOR UPDATE', [ono])
      const fin = await finalizeCrossPaidOrder(conn, locked[0], { transactionId })
      return {
        orderNo: ono,
        status: fin.status || 'completed',
        payStatus: 'paid',
        ...fin,
        _order: locked[0]
      }
    })
    scheduleProfitShare(paid._order, transactionId, paid)
    delete paid._order
    return paid
  }

  const rows = await query('SELECT * FROM consumer_orders WHERE order_no=:ono LIMIT 1', { ono })
  if (!rows.length) throw new HttpError(404, '订单不存在')
  const o = rows[0]
  if (userId && Number(o.user_id) !== Number(userId)) throw new HttpError(403, '无权操作该订单')
  if (o.order_status === 'cancelled') {
    throw new HttpError(409, '订单已取消，如已扣款请联系客服退款')
  }
  if (o.pay_status === 'paid') {
    const [urows] = await query('SELECT points_balance FROM users WHERE id=:id', { id: o.user_id })
    return {
      orderNo: ono,
      status: o.order_status,
      payStatus: 'paid',
      pointsAllocated: Number(o.points_allocated) || 0,
      pointsBalance: urows.length ? Number(urows[0].points_balance) : 0,
      alreadyPaid: true
    }
  }
  const transactionId = await assertWxTradeSuccess(ono, o.merchant_id)
  const paid = await withTransaction(async (conn) => {
    const [locked] = await conn.execute('SELECT * FROM consumer_orders WHERE order_no=? FOR UPDATE', [ono])
    const fin = await finalizePaidConsumerOrder(conn, locked[0], { transactionId })
    if (fin.cancelled || fin.needRefund) {
      throw new HttpError(409, '订单已取消，如已扣款请联系客服退款')
    }
    return {
      orderNo: ono,
      status: fin.status,
      payStatus: 'paid',
      pointsAllocated: fin.pointsAllocated,
      pointsBalance: fin.pointsBalance,
      shortage: fin.shortage,
      alreadyPaid: fin.alreadyPaid,
      _order: locked[0]
    }
  })
  scheduleProfitShare(paid._order, transactionId, paid)
  delete paid._order
  return paid
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
      // 本单承诺划拨但额度池为 0：禁止「空完成」，避免消费者无积分却触发推荐奖
      if (allocated === 0) {
        throw new HttpError(
          400,
          '积分额度池不足，无法划拨给消费者。请先向供应链采购或后台发放额度后再出餐'
        )
      }
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
           WHERE id=? AND merchant_id=? AND on_sale=1 AND deleted_at IS NULL`,
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

    // 现金 / 组合：未支付前不得完成、扣库存、结算
    const spend = mode === 'mix' ? Number(g._mixSpend) || 0 : 0
    const cashDue = mode === 'mix' ? round2(g._mixCash) : cashPrice
    assertPaySimulateAllowed(cashDue)

    const payModeDb = mode === 'mix' ? 'mix' : 'cash'
    const realPay = wxService.wxPayConfigured() && cashDue > 0

    if (!realPay) {
      // 模拟支付：仅 allowPaySimulate / 零元时走完成态
      if (spend > 0) {
        await pointsService.spendConsumerPoints(conn, {
          userId,
          points: spend,
          title: `${g.name} · 组合支付扣积分`,
          bizId: ono
        })
      }
      try {
        await conn.execute(
          `INSERT INTO cross_orders
            (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
          [ono, userId, merchantId, g.id, g.name, payModeDb, spend, cashDue]
        )
      } catch (e) {
        await conn.execute(
          `INSERT INTO cross_orders
            (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
           VALUES (?, ?, ?, ?, ?, 'cash', ?, ?, 'completed')`,
          [ono, userId, merchantId, g.id, g.name, spend, cashDue]
        )
      }
      const fin = await settleCompletedCrossOrder(conn, {
        orderNo: ono,
        userId,
        merchantId,
        goodsId: g.id,
        goodsName: g.name,
        payMode: payModeDb,
        pointsSpend: spend,
        cashAmount: cashDue,
        cashPrice
      })
      return {
        orderNo: ono,
        payMode: payModeDb,
        pointsSpend: spend,
        cashAmount: cashDue,
        cashPaid: cashDue,
        autoFallback: payMode === 'points',
        payStatus: 'paid',
        status: 'completed',
        ...fin,
        ...wxService.buildPayResult({ orderNo: ono, cashAmount: cashDue, simulated: true })
      }
    }

    // 真实微信支付：先挂 pending，积分预扣；支付成功后再结算
    if (spend > 0) {
      await pointsService.spendConsumerPoints(conn, {
        userId,
        points: spend,
        title: `${g.name} · 组合支付预扣积分`,
        bizId: ono
      })
    }
    try {
      await conn.execute(
        `INSERT INTO cross_orders
          (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [ono, userId, merchantId, g.id, g.name, payModeDb, spend, cashDue]
      )
    } catch (e) {
      await conn.execute(
        `INSERT INTO cross_orders
          (order_no, user_id, merchant_id, goods_id, goods_name, pay_mode, points_spend, cash_amount, status)
         VALUES (?, ?, ?, ?, ?, 'cash', ?, ?, 'pending')`,
        [ono, userId, merchantId, g.id, g.name, spend, cashDue]
      )
    }
    return {
      _needPrepay: true,
      orderNo: ono,
      payMode: payModeDb,
      pointsSpend: spend,
      cashAmount: cashDue,
      cashPaid: cashDue,
      merchantId,
      goodsName: g.name,
      autoFallback: payMode === 'points',
      payStatus: 'unpaid',
      status: 'pending',
      needConfirm: true
    }
  }).then(async (result) => {
    if (!result || !result._needPrepay) return result
    const shopRows = await query('SELECT name FROM merchants WHERE id=:id', { id: result.merchantId })
    const shopName = shopRows[0] ? shopRows[0].name : '异业兑换'
    const openid = await getUserOpenid(userId)
    const subMchId = await getMerchantSubMchId(result.merchantId)
    let prepay
    try {
      prepay = await wxService.createJsapiPayForOrder({
        orderNo: result.orderNo,
        description: `${shopName}·${result.goodsName || '兑换'}`,
        amountYuan: result.cashPaid,
        openid,
        subMchId,
        attach: `cross:${result.merchantId}`
      })
    } catch (e) {
      await withTransaction(async (conn) => {
        const [rows] = await conn.execute(
          `SELECT * FROM cross_orders WHERE order_no=? AND status='pending' FOR UPDATE`,
          [result.orderNo]
        )
        if (!rows.length) return
        await conn.execute(`UPDATE cross_orders SET status='cancelled' WHERE id=?`, [rows[0].id])
        const pts = Number(rows[0].points_spend) || 0
        if (pts > 0) {
          await pointsService.refundConsumerPoints(conn, {
            userId: rows[0].user_id,
            points: pts,
            title: '异业兑换取消退回积分',
            bizId: `${result.orderNo}:cancel`
          })
        }
      }).catch((err) => console.warn('[cross] prepay rollback', err.message))
      throw e
    }
    const payMeta = wxService.buildPayResult({
      orderNo: result.orderNo,
      cashAmount: result.cashPaid,
      simulated: false,
      payParams: prepay.payParams,
      payChannel: 'wxpay',
      message: '请完成微信支付'
    })
    delete result._needPrepay
    delete result.merchantId
    delete result.goodsName
    return { ...result, payMode: result.payMode, ...payMeta }
  })
}

/** 异业已完成单：库存 + 结算 + 推荐（幂等） */
async function settleCompletedCrossOrder(
  conn,
  { orderNo: ono, userId, merchantId, goodsId, payMode, pointsSpend, cashAmount, cashPrice }
) {
  await conn.execute(`UPDATE cross_goods SET sales_count = IFNULL(sales_count,0) + 1 WHERE id=?`, [
    goodsId
  ])
  try {
    await conn.execute(
      `UPDATE cross_goods SET stock = GREATEST(IFNULL(stock,1)-1,0) WHERE id=?`,
      [goodsId]
    )
  } catch (_) {}

  // 实收现金结算；积分部分按折现另计（与纯积分兑换一致）
  const cashPart = round2(cashAmount)
  const pointsPart = pointsSpend > 0 ? pointsToCash(pointsSpend, await getCashRate()) : 0
  const amountGross = round2(cashPart + pointsPart) || round2(cashPrice) || cashPart
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
    bizType: payMode === 'mix' ? 'cross_mix_settle' : 'cross_cash_settle',
    bizId: ono,
    title: `${payMode === 'mix' ? '组合支付' : '全现金兑换'}结算 · ${ono}`
  })
  await referralService.onConsumerOrderDone(conn, {
    inviteeUserId: userId,
    orderNo: ono,
    kind: 'cross'
  })
  return { commission, merchantNet: net }
}

/** 异业微信支付成功入账 */
async function finalizeCrossPaidOrder(conn, orderRow, { transactionId } = {}) {
  const o = orderRow
  if (o.status === 'completed') {
    return { alreadyPaid: true, orderNo: o.order_no, status: 'completed' }
  }
  if (o.status === 'cancelled') {
    return { cancelled: true, needRefund: true, orderNo: o.order_no }
  }
  await conn.execute(`UPDATE cross_orders SET status='completed' WHERE id=? AND status='pending'`, [
    o.id
  ])
  const fin = await settleCompletedCrossOrder(conn, {
    orderNo: o.order_no,
    userId: o.user_id,
    merchantId: o.merchant_id,
    goodsId: o.goods_id,
    payMode: o.pay_mode,
    pointsSpend: Number(o.points_spend) || 0,
    cashAmount: Number(o.cash_amount) || 0,
    cashPrice: Number(o.cash_amount) || 0
  })
  return {
    alreadyPaid: false,
    orderNo: o.order_no,
    status: 'completed',
    payStatus: 'paid',
    transactionId: transactionId || null,
    ...fin
  }
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
       WHERE id=? AND status=1 AND deleted_at IS NULL FOR UPDATE`,
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
    const settledAt = status === 'confirmed' ? new Date() : null
    const [ins] = await conn.execute(
      `INSERT INTO purchase_orders
        (order_no, buyer_merchant_id, seller_merchant_id, fulfill_type, total_amount, points_grant,
         status, paid_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ono,
        buyerMerchantId,
        g.merchant_id,
        type,
        total,
        pointsGrant,
        status,
        settledAt,
        settledAt
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
    // 线上采购必须先发货再确认；线下单创建时已 confirmed，不应再走此接口
    if (String(o.fulfill_type || 'online') === 'online') {
      if (o.status !== 'shipped') {
        throw new HttpError(400, '请等待供应链发货后再确认收货')
      }
    } else if (o.status !== 'pending' && o.status !== 'shipped') {
      throw new HttpError(400, '当前状态不可确认')
    }
    const [items] = await conn.execute(
      `SELECT goods_name FROM purchase_order_items WHERE order_id=? LIMIT 1`,
      [orderId]
    )
    await conn.execute(
      `UPDATE purchase_orders
       SET status='confirmed', confirmed_at=NOW(), paid_at=IFNULL(paid_at, NOW())
       WHERE id=?`,
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

/** 平台台账提现最低金额（元）；二级商户真实收款由微信结算，不走此门槛 */
const WITHDRAW_MIN_AMOUNT = 10

function maskBankNo(no) {
  const s = String(no || '').replace(/\s/g, '')
  if (s.length < 8) return s ? '****' : ''
  return `${s.slice(0, 4)}****${s.slice(-4)}`
}

async function getWithdrawPolicy(merchantId) {
  const mid = Number(merchantId)
  let hasSubMch = false
  let bankName = ''
  let bankAccountName = ''
  let bankAccountNo = ''
  try {
    const rows = await query(
      `SELECT wx_sub_mch_id AS sub, materials_json AS materials, wx_settlement_json AS settlement, legal_person AS legalPerson
       FROM merchants WHERE id=:id AND deleted_at IS NULL LIMIT 1`,
      { id: mid }
    )
    if (rows.length) {
      hasSubMch = !!String(rows[0].sub || '').trim()
      let materials = rows[0].materials
      let settlement = rows[0].settlement
      if (typeof materials === 'string') {
        try {
          materials = JSON.parse(materials)
        } catch (_) {
          materials = {}
        }
      }
      if (typeof settlement === 'string') {
        try {
          settlement = JSON.parse(settlement)
        } catch (_) {
          settlement = {}
        }
      }
      materials = materials || {}
      settlement = settlement || {}
      bankName = String(materials.bankName || settlement.bankName || '').trim()
      bankAccountName = String(
        materials.bankAccountName || settlement.bankAccountName || rows[0].legalPerson || ''
      ).trim()
      bankAccountNo = String(materials.bankAccountNo || settlement.bankAccountNo || '').replace(/\s/g, '')
    }
  } catch (_) {
    /* ignore */
  }
  const bankMasked = maskBankNo(bankAccountNo)
  const bankLabel = [bankName, bankAccountName, bankMasked].filter(Boolean).join(' · ') || '入驻时提交的银行卡'
  return {
    minAmount: WITHDRAW_MIN_AMOUNT,
    arriveDaysText: '1-3个工作日',
    arriveHint: `申请通过后将在 1-3 个工作日内提现到入驻时提交的银行卡（${bankLabel}）`,
    bankHint: {
      bankName,
      bankAccountName,
      bankAccountNoMasked: bankMasked
    },
    hasSubMerchant: hasSubMch,
    settlementHint: hasSubMch
      ? '本店已开通二级商户收款：顾客扫码支付的资金由微信直接进入本店二级商户账户，并按微信规则结算到入驻银行卡，一般无需再走平台提现。下方「可提现余额」仅对应平台台账（如模拟支付、非微信直结部分）。'
      : '本店尚未完成二级商户进件时，货款记入平台台账；可申请提现到入驻时提交的银行卡（单笔须满 ¥10）。'
  }
}

async function applyWithdraw({ merchantId, accountType, amount }) {
  const type = accountType
  if (!['cash_goods', 'cash_settlement', 'points_redeem'].includes(type)) {
    throw new HttpError(400, '账户类型无效')
  }
  const amt = Math.round(Number(amount) * 100) / 100
  if (!amt || amt <= 0) throw new HttpError(400, '提现金额无效')
  if (amt < WITHDRAW_MIN_AMOUNT) {
    throw new HttpError(400, `单笔提现金额须满 ¥${WITHDRAW_MIN_AMOUNT}`)
  }
  const policy = await getWithdrawPolicy(merchantId)
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
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [no, merchantId, type, amt, '商户申请·将打至入驻银行卡']
    )
    return {
      requestNo: no,
      amount: amt,
      accountType: type,
      status: 'pending',
      minAmount: WITHDRAW_MIN_AMOUNT,
      arriveHint: policy.arriveHint
    }
  })
}

async function getMerchantAccounts(merchantId) {
  const rows = await query(
    `SELECT account_type AS type, balance, frozen, updated_at AS updatedAt
     FROM merchant_accounts WHERE merchant_id=:id`,
    { id: merchantId }
  )
  const policy = await getWithdrawPolicy(merchantId)
  return {
    accounts: rows,
    list: rows,
    policy
  }
}

async function listMerchantWithdraws(merchantId, { limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 100)
  const list = await query(
    `SELECT id, request_no AS requestNo, account_type AS accountType, amount, status, remark,
            created_at AS createdAt, updated_at AS updatedAt
     FROM withdraw_requests WHERE merchant_id=:id
     ORDER BY id DESC LIMIT ${lim}`,
    { id: merchantId }
  )
  const policy = await getWithdrawPolicy(merchantId)
  return { list, policy }
}

module.exports = {
  listNearbyStalls,
  listCrossStores,
  getStallMenu,
  createAndPayStallOrder,
  createScanPayOrder,
  completeStallOrder,
  handleWxPayNotify,
  syncConsumerPay,
  cancelUnpaidConsumerOrder,
  repayConsumerOrder,
  getConsumerOrderDetail,
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

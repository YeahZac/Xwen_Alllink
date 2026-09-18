const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const adminService = require('./adminService')
const orderService = require('./orderService')
const stallOptionsService = require('./stallOptionsService')
const feeService = require('./feeService')
const { applyGeo } = require('../utils/geo')

const ROLE_LABEL = { stall: '地摊', cross: '异业', supply: '供应链' }

async function dashboard(merchantId, role) {
  const mid = Number(merchantId)
  if (!mid) throw new HttpError(400, '缺少商户')

  const poolRows = await query(
    'SELECT IFNULL(balance,0) AS balance FROM merchant_points_pool WHERE merchant_id=:id',
    { id: mid }
  )
  const poolBalance = poolRows[0] ? Number(poolRows[0].balance) : 0

  const accounts = await query(
    `SELECT account_type AS type, balance, frozen FROM merchant_accounts WHERE merchant_id=:id`,
    { id: mid }
  )

  let todayOrders = 0
  let todayAmount = 0
  let monthOrders = 0
  let monthAmount = 0
  let goodsCount = 0
  let todayPointsAllocated = 0
  let monthPointsAllocated = 0
  let todayPointsOrders = 0
  let todayCashOrders = 0

  if (role === 'stall') {
    const [t] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a,
              IFNULL(SUM(CASE WHEN order_status='completed' THEN points_allocated ELSE 0 END),0) p
       FROM consumer_orders
       WHERE merchant_id=:id AND pay_status='paid' AND DATE(created_at)=CURDATE()`,
      { id: mid }
    )
    const [m] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a,
              IFNULL(SUM(CASE WHEN order_status='completed' THEN points_allocated ELSE 0 END),0) p
       FROM consumer_orders
       WHERE merchant_id=:id AND pay_status='paid' AND created_at>=DATE_FORMAT(NOW(),'%Y-%m-01')`,
      { id: mid }
    )
    todayOrders = Number(t.c)
    todayAmount = Number(t.a)
    monthOrders = Number(m.c)
    monthAmount = Number(m.a)
    todayPointsAllocated = Number(t.p) || 0
    monthPointsAllocated = Number(m.p) || 0
    const [g] = await query(
      `SELECT COUNT(*) c FROM stall_goods WHERE merchant_id=:id AND deleted_at IS NULL`,
      { id: mid }
    )
    goodsCount = Number(g.c)
  } else if (role === 'cross') {
    const [t] = await query(
      `SELECT COUNT(*) c,
              IFNULL(SUM(cash_amount),0) a,
              SUM(CASE WHEN pay_mode='points' THEN 1 ELSE 0 END) pts,
              SUM(CASE WHEN pay_mode='cash' THEN 1 ELSE 0 END) cash
       FROM cross_orders
       WHERE merchant_id=:id AND DATE(created_at)=CURDATE()`,
      { id: mid }
    )
    const [m] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(cash_amount),0) a
       FROM cross_orders
       WHERE merchant_id=:id AND created_at>=DATE_FORMAT(NOW(),'%Y-%m-01')`,
      { id: mid }
    )
    todayOrders = Number(t.c)
    todayAmount = Number(t.a)
    monthOrders = Number(m.c)
    monthAmount = Number(m.a)
    todayPointsOrders = Number(t.pts) || 0
    todayCashOrders = Number(t.cash) || 0
    const [g] = await query(
      `SELECT COUNT(*) c FROM cross_goods WHERE merchant_id=:id AND deleted_at IS NULL`,
      { id: mid }
    )
    goodsCount = Number(g.c)
  } else {
    const [t] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a FROM purchase_orders
       WHERE seller_merchant_id=:id AND DATE(created_at)=CURDATE()`,
      { id: mid }
    )
    const [m] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a FROM purchase_orders
       WHERE seller_merchant_id=:id AND created_at>=DATE_FORMAT(NOW(),'%Y-%m-01')`,
      { id: mid }
    )
    todayOrders = Number(t.c)
    todayAmount = Number(t.a)
    monthOrders = Number(m.c)
    monthAmount = Number(m.a)
    const [g] = await query(
      `SELECT COUNT(*) c FROM supply_goods WHERE merchant_id=:id AND deleted_at IS NULL`,
      { id: mid }
    )
    goodsCount = Number(g.c)
  }

  const merchant = await query(
    `SELECT id, name, role, cover_url AS coverUrl, city, invite_code AS inviteCode, status,
            service_status AS serviceStatus, trial_end_at AS trialEndAt
     FROM merchants WHERE id=:id`,
    { id: mid }
  )

  let fee = null
  try {
    fee = await feeService.merchantFeeStatus(mid)
  } catch (_) {
    fee = null
  }

  return {
    merchant: merchant[0] || null,
    poolBalance,
    accounts,
    todayOrders,
    todayAmount,
    monthOrders,
    monthAmount,
    todayPointsAllocated,
    monthPointsAllocated,
    todayPointsOrders,
    todayCashOrders,
    goodsCount,
    fee
  }
}

async function listOrders(merchantId, role, { type, limit = 50 } = {}) {
  const mid = Number(merchantId)
  const lim = Math.min(Number(limit) || 50, 100)

  if (type === 'buy') {
    return query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_grant AS pointsGrant,
              o.fulfill_type AS fulfillType, o.status, o.created_at AS time,
              s.name AS peerName, 'purchase_buy' AS type
       FROM purchase_orders o
       JOIN merchants s ON s.id=o.seller_merchant_id
       WHERE o.buyer_merchant_id=:id
       ORDER BY o.id DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  if (type === 'sell' || role === 'supply') {
    return query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_grant AS pointsGrant,
              o.fulfill_type AS fulfillType, o.status, o.created_at AS time,
              b.name AS peerName, 'purchase_sell' AS type
       FROM purchase_orders o
       JOIN merchants b ON b.id=o.buyer_merchant_id
       WHERE o.seller_merchant_id=:id
       ORDER BY o.id DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  if (type === 'cross' || role === 'cross') {
    return query(
      `SELECT o.id, o.order_no AS orderNo, o.goods_name AS goodsName, o.pay_mode AS payMode,
              o.points_spend AS pointsSpend, o.cash_amount AS cashAmount, o.status,
              o.created_at AS time, u.nickname AS userName, 'cross' AS type
       FROM cross_orders o
       JOIN users u ON u.id=o.user_id
       WHERE o.merchant_id=:id
       ORDER BY o.id DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  // stall consumer / type=consumer
  return query(
    `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount,
            o.points_allocated AS pointsAllocated, o.pay_status AS payStatus,
            o.order_status AS status, o.created_at AS time,
            u.nickname AS userName, 'stall' AS type
     FROM consumer_orders o
     JOIN users u ON u.id=o.user_id
     WHERE o.merchant_id=:id
     ORDER BY o.id DESC LIMIT ${lim}`,
    { id: mid }
  )
}

async function completeStallOrder(merchantId, orderId) {
  return orderService.completeStallOrder({ merchantId: Number(merchantId), orderId: Number(orderId) })
}

async function setMerchantOpen(merchantId, open) {
  const status = open ? 1 : 0
  const result = await query('UPDATE merchants SET status=:s WHERE id=:id AND deleted_at IS NULL', {
    s: status,
    id: Number(merchantId)
  })
  if (!result.affectedRows) throw new HttpError(404, '商户不存在')
  return { merchantId: Number(merchantId), status, open: !!status }
}

async function getMerchantGoodsOptions(merchantId, goodsId) {
  const rows = await query(
    'SELECT id FROM stall_goods WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL',
    { id: Number(goodsId), mid: Number(merchantId) }
  )
  if (!rows.length) throw new HttpError(404, '商品不存在')
  return stallOptionsService.getGoodsOptionGroups(Number(goodsId))
}

async function saveMerchantGoodsOptions(merchantId, goodsId, groups) {
  const rows = await query(
    'SELECT id FROM stall_goods WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL',
    { id: Number(goodsId), mid: Number(merchantId) }
  )
  if (!rows.length) throw new HttpError(404, '商品不存在')
  return stallOptionsService.saveGoodsOptionGroups(Number(goodsId), groups || [])
}

async function listGoods(merchantId, role) {
  const mid = Number(merchantId)
  if (role === 'stall') {
    try {
      return await query(
        `SELECT id, name, price, points_grant AS pointsGrant, category, unit, stock, on_sale AS onSale,
                mix_enabled AS mixEnabled, image_url AS imageUrl, sku_code AS sku, sales_count AS sales,
                desc_text AS description
         FROM stall_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
        { id: mid }
      )
    } catch (e) {
      if (e && e.code !== 'ER_BAD_FIELD_ERROR') throw e
      return query(
        `SELECT id, name, price, points_grant AS pointsGrant, category, stock, on_sale AS onSale,
                image_url AS imageUrl, sku_code AS sku, sales_count AS sales, desc_text AS description
         FROM stall_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
        { id: mid }
      )
    }
  }
  if (role === 'cross') {
    try {
      return await query(
        `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice, on_sale AS onSale,
                allow_mix AS allowMix, category, stock, image_url AS imageUrl, sku_code AS sku,
                sales_count AS sales, desc_text AS description
         FROM cross_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
        { id: mid }
      )
    } catch (e) {
      if (e && e.code !== 'ER_BAD_FIELD_ERROR') throw e
      return query(
        `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice, on_sale AS onSale,
                image_url AS imageUrl, sku_code AS sku, sales_count AS sales, desc_text AS description
         FROM cross_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
        { id: mid }
      )
    }
  }
  try {
    return await query(
      `SELECT id, name, price, stock, points_grant AS pointsGrant, points_ratio_text AS pointsRatio,
              category, desc_text AS description, status AS onSale, image_url AS imageUrl,
              sku_code AS sku, sales_count AS sales
       FROM supply_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
      { id: mid }
    )
  } catch (e) {
    if (e && e.code !== 'ER_BAD_FIELD_ERROR') throw e
    return query(
      `SELECT id, name, price, stock, points_grant AS pointsGrant, points_ratio_text AS pointsRatio,
              status AS onSale, image_url AS imageUrl, sku_code AS sku, sales_count AS sales
       FROM supply_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
      { id: mid }
    )
  }
}

async function saveGoods(merchantId, role, body) {
  const payload = { ...body, merchantId: Number(merchantId) }
  if (role === 'stall') return adminService.saveStallGoods(payload)
  if (role === 'cross') return adminService.saveCrossGoods(payload)
  return adminService.saveSupplyGoods({
    ...payload,
    status: body.onSale === 0 ? 0 : body.status === 0 ? 0 : 1
  })
}

async function getGoods(merchantId, role, id) {
  const list = await listGoods(merchantId, role)
  const item = (list || []).find((g) => String(g.id) === String(id))
  if (!item) throw new HttpError(404, '商品不存在')
  return item
}

async function listCustomers(merchantId, role, { limit = 50 } = {}) {
  const mid = Number(merchantId)
  const lim = Math.min(Number(limit) || 50, 100)
  if (role === 'stall') {
    return query(
      `SELECT u.id, u.nickname AS name, u.avatar_url AS avatarUrl,
              COUNT(*) AS orders, IFNULL(SUM(o.total_amount),0) AS spend,
              MAX(o.created_at) AS last
       FROM consumer_orders o
       JOIN users u ON u.id=o.user_id
       WHERE o.merchant_id=:id AND o.pay_status='paid'
       GROUP BY u.id
       ORDER BY last DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  if (role === 'cross') {
    return query(
      `SELECT u.id, u.nickname AS name, u.avatar_url AS avatarUrl,
              COUNT(*) AS orders,
              IFNULL(SUM(o.cash_amount),0) AS spend,
              SUM(CASE WHEN o.pay_mode='points' THEN 1 ELSE 0 END) AS pointsOrders,
              SUM(CASE WHEN o.pay_mode='cash' THEN 1 ELSE 0 END) AS cashOrders,
              MAX(o.created_at) AS last
       FROM cross_orders o
       JOIN users u ON u.id=o.user_id
       WHERE o.merchant_id=:id
       GROUP BY u.id
       ORDER BY last DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  return query(
    `SELECT m.id, m.name, m.role AS type, m.cover_url AS avatarUrl,
            COUNT(*) AS orders, IFNULL(SUM(o.total_amount),0) AS spend,
            MAX(o.created_at) AS last
     FROM purchase_orders o
     JOIN merchants m ON m.id=o.buyer_merchant_id
     WHERE o.seller_merchant_id=:id
     GROUP BY m.id
     ORDER BY last DESC LIMIT ${lim}`,
    { id: mid }
  )
}

async function listFlow(merchantId, { limit = 50 } = {}) {
  const mid = Number(merchantId)
  const lim = Math.min(Number(limit) || 50, 100)
  const account = await query(
    `SELECT id, account_type AS accountType, change_amount AS amount, title,
            biz_type AS type, created_at AS time, 'cash' AS unit
     FROM merchant_account_ledger WHERE merchant_id=:id
     ORDER BY id DESC LIMIT ${lim}`,
    { id: mid }
  )
  const pool = await query(
    `SELECT id, 'pool' AS accountType, change_amount AS amount, title,
            biz_type AS type, created_at AS time, 'points' AS unit
     FROM merchant_pool_ledger WHERE merchant_id=:id
     ORDER BY id DESC LIMIT ${lim}`,
    { id: mid }
  )
  return [...account, ...pool]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, lim)
}

async function listSupplyMerchants(opts = {}) {
  const rows = await query(
    `SELECT m.id, m.name, m.city, m.cover_url AS coverImage, m.cover_hue AS coverHue,
            m.address, m.latitude, m.longitude, LEFT(m.name,1) AS initial,
            (SELECT COUNT(*) FROM supply_goods g WHERE g.merchant_id=m.id AND g.status=1 AND g.deleted_at IS NULL) AS goodsCount,
            (SELECT IFNULL(SUM(g.sales_count),0) FROM supply_goods g WHERE g.merchant_id=m.id) AS monthSales
     FROM merchants m
     WHERE m.role='supply' AND m.status=1 AND m.deleted_at IS NULL
     ORDER BY m.id`
  )
  return applyGeo(rows, opts)
}

async function getCrossStoreDetail(id) {
  const stores = await query(
    `SELECT id, name, city, address, latitude, longitude, cover_url AS coverImage,
            cover_hue AS coverHue, LEFT(name,1) AS initial, '异业' AS category
     FROM merchants WHERE id=:id AND role='cross' AND status=1 AND deleted_at IS NULL`,
    { id }
  )
  if (!stores.length) throw new HttpError(404, '异业门店不存在')
  const s = stores[0]
  try {
    s.items = await query(
      `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice,
              desc_text AS \`desc\`, image_url AS coverImage, sku_code AS sku,
              IFNULL(allow_mix,1) AS allowMix, IFNULL(stock,9999) AS stock, category
       FROM cross_goods WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL`,
      { id }
    )
  } catch (e) {
    s.items = await query(
      `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice,
              desc_text AS \`desc\`, image_url AS coverImage, sku_code AS sku, 1 AS allowMix
       FROM cross_goods WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL`,
      { id }
    )
  }
  return s
}

module.exports = {
  ROLE_LABEL,
  dashboard,
  listOrders,
  completeStallOrder,
  setMerchantOpen,
  getMerchantGoodsOptions,
  saveMerchantGoodsOptions,
  listGoods,
  getGoods,
  saveGoods,
  listCustomers,
  listFlow,
  listSupplyMerchants,
  getCrossStoreDetail
}

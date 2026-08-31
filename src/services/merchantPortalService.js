const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const adminService = require('./adminService')

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

  if (role === 'stall') {
    const [t] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a FROM consumer_orders
       WHERE merchant_id=:id AND pay_status='paid' AND DATE(created_at)=CURDATE()`,
      { id: mid }
    )
    const [m] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a FROM consumer_orders
       WHERE merchant_id=:id AND pay_status='paid' AND created_at>=DATE_FORMAT(NOW(),'%Y-%m-01')`,
      { id: mid }
    )
    todayOrders = Number(t.c)
    todayAmount = Number(t.a)
    monthOrders = Number(m.c)
    monthAmount = Number(m.a)
    const [g] = await query(
      `SELECT COUNT(*) c FROM stall_goods WHERE merchant_id=:id AND deleted_at IS NULL`,
      { id: mid }
    )
    goodsCount = Number(g.c)
  } else if (role === 'cross') {
    const [t] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(cash_amount),0) a FROM cross_orders
       WHERE merchant_id=:id AND DATE(created_at)=CURDATE()`,
      { id: mid }
    )
    const [m] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(cash_amount),0) a FROM cross_orders
       WHERE merchant_id=:id AND created_at>=DATE_FORMAT(NOW(),'%Y-%m-01')`,
      { id: mid }
    )
    todayOrders = Number(t.c)
    todayAmount = Number(t.a)
    monthOrders = Number(m.c)
    monthAmount = Number(m.a)
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
    `SELECT id, name, role, cover_url AS coverUrl, city, invite_code AS inviteCode, status
     FROM merchants WHERE id=:id`,
    { id: mid }
  )

  return {
    merchant: merchant[0] || null,
    poolBalance,
    accounts,
    todayOrders,
    todayAmount,
    monthOrders,
    monthAmount,
    goodsCount
  }
}

async function listOrders(merchantId, role, { type, limit = 50 } = {}) {
  const mid = Number(merchantId)
  const lim = Math.min(Number(limit) || 50, 100)

  if (role === 'stall' || type === 'consumer') {
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
  if (role === 'cross' || type === 'cross') {
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
  // supply / purchase
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

async function listGoods(merchantId, role) {
  const mid = Number(merchantId)
  if (role === 'stall') {
    return query(
      `SELECT id, name, price, points_grant AS pointsGrant, category, stock, on_sale AS onSale,
              image_url AS imageUrl, sku_code AS sku, sales_count AS sales, desc_text AS description
       FROM stall_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
      { id: mid }
    )
  }
  if (role === 'cross') {
    return query(
      `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice, on_sale AS onSale,
              image_url AS imageUrl, sku_code AS sku, sales_count AS sales, desc_text AS description
       FROM cross_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
      { id: mid }
    )
  }
  return query(
    `SELECT id, name, price, stock, points_grant AS pointsGrant, points_ratio_text AS pointsRatio,
            status AS onSale, image_url AS imageUrl, sku_code AS sku, sales_count AS sales
     FROM supply_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
    { id: mid }
  )
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
              COUNT(*) AS orders, IFNULL(SUM(o.cash_amount),0) AS spend,
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
            biz_type AS type, created_at AS time
     FROM merchant_account_ledger WHERE merchant_id=:id
     ORDER BY id DESC LIMIT ${lim}`,
    { id: mid }
  )
  const pool = await query(
    `SELECT id, 'pool' AS accountType, change_amount AS amount, title,
            biz_type AS type, created_at AS time
     FROM merchant_pool_ledger WHERE merchant_id=:id
     ORDER BY id DESC LIMIT ${lim}`,
    { id: mid }
  )
  return [...account, ...pool]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, lim)
}

async function listSupplyMerchants() {
  return query(
    `SELECT m.id, m.name, m.city, m.cover_url AS coverImage, m.cover_hue AS coverHue,
            m.address, LEFT(m.name,1) AS initial,
            (SELECT COUNT(*) FROM supply_goods g WHERE g.merchant_id=m.id AND g.status=1 AND g.deleted_at IS NULL) AS goodsCount,
            (SELECT IFNULL(SUM(g.sales_count),0) FROM supply_goods g WHERE g.merchant_id=m.id) AS monthSales
     FROM merchants m
     WHERE m.role='supply' AND m.status=1 AND m.deleted_at IS NULL
     ORDER BY m.id`
  )
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
  s.items = await query(
    `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice,
            desc_text AS \`desc\`, image_url AS coverImage, sku_code AS sku
     FROM cross_goods WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL`,
    { id }
  )
  s.distance = s.city || ''
  return s
}

module.exports = {
  ROLE_LABEL,
  dashboard,
  listOrders,
  listGoods,
  saveGoods,
  listCustomers,
  listFlow,
  listSupplyMerchants,
  getCrossStoreDetail
}

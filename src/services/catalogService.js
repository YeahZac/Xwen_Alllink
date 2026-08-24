const { query } = require('../utils/db')

async function listBanners(role) {
  const scope = role || 'consumer'
  return query(
    `SELECT id, role_scope AS role, title, sub_title AS sub, image_url AS image,
            link_url AS link, link_type AS linkType, sort_order AS sortOrder
     FROM banners
     WHERE role_scope = :scope AND status = 1
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())
     ORDER BY sort_order ASC, id ASC`,
    { scope }
  )
}

async function listSupplyGoods() {
  return query(
    `SELECT g.id, g.name, g.price, g.stock, g.points_grant AS pointsGrant,
            g.points_ratio_text AS pointsRatio, m.name AS vendor, m.id AS vendorId
     FROM supply_goods g
     JOIN merchants m ON m.id = g.merchant_id
     WHERE g.status = 1 AND m.status = 1
     ORDER BY g.id`
  )
}

async function getPool(merchantId) {
  const rows = await query(
    'SELECT balance FROM merchant_points_pool WHERE merchant_id = :id',
    { id: merchantId }
  )
  const ledger = await query(
    `SELECT id, change_amount AS \`change\`, biz_type AS type, title, created_at AS time
     FROM merchant_pool_ledger WHERE merchant_id = :id
     ORDER BY id DESC LIMIT 50`,
    { id: merchantId }
  )
  return {
    balance: rows[0] ? rows[0].balance : 0,
    ledger
  }
}

async function getUserPoints(userId) {
  const rows = await query(
    'SELECT points_balance FROM users WHERE id = :id',
    { id: userId }
  )
  const ledger = await query(
    `SELECT id, change_amount AS \`change\`, biz_type AS type, title, cash_value AS cashValue,
            created_at AS time
     FROM user_points_ledger WHERE user_id = :id
     ORDER BY id DESC LIMIT 50`,
    { id: userId }
  )
  return {
    points: rows[0] ? rows[0].points_balance : 0,
    ledger
  }
}

async function listConsumerOrders(userId) {
  const orders = await query(
    `SELECT o.order_no AS id, o.total_amount AS totalPrice, o.points_allocated AS pointsGrant,
            o.order_status AS status, o.created_at AS time, m.name AS stallName
     FROM consumer_orders o
     JOIN merchants m ON m.id = o.merchant_id
     WHERE o.user_id = :uid
     ORDER BY o.id DESC LIMIT 50`,
    { uid: userId }
  )
  for (const o of orders) {
    o.type = 'stall'
    o.items = await query(
      `SELECT goods_name AS name, qty FROM consumer_order_items coi
       JOIN consumer_orders co ON co.id = coi.order_id
       WHERE co.order_no = :ono`,
      { ono: o.id }
    )
  }
  const cross = await query(
    `SELECT order_no AS id, points_spend AS pointsSpend, cash_amount AS totalPrice,
            status, created_at AS time, goods_name,
            (SELECT name FROM merchants WHERE id = merchant_id) AS storeName
     FROM cross_orders WHERE user_id = :uid ORDER BY id DESC LIMIT 50`,
    { uid: userId }
  )
  cross.forEach((c) => {
    c.type = 'cross'
    c.items = [{ name: c.goods_name, qty: 1 }]
  })
  return [...orders, ...cross].sort(
    (a, b) => new Date(b.time) - new Date(a.time)
  )
}

module.exports = {
  listBanners,
  listSupplyGoods,
  getPool,
  getUserPoints,
  listConsumerOrders
}

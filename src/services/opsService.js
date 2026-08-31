const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')

const ROLE_LABEL = { stall: '地摊', cross: '异业', supply: '供应链', consumer: 'C端用户' }

async function one(sql, params) {
  const rows = await query(sql, params || {})
  return rows[0] ? Number(Object.values(rows[0])[0]) : 0
}

/** 数据大屏聚合 */
async function bigScreen() {
  const [
    consumers,
    stalls,
    crosses,
    supplies,
    openStores,
    consumerGmv,
    crossGmv,
    purchaseGmv,
    visitsToday,
    visits7d,
    ordersToday
  ] = await Promise.all([
    one(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`),
    one(`SELECT COUNT(*) c FROM merchants WHERE role='stall' AND deleted_at IS NULL`),
    one(`SELECT COUNT(*) c FROM merchants WHERE role='cross' AND deleted_at IS NULL`),
    one(`SELECT COUNT(*) c FROM merchants WHERE role='supply' AND deleted_at IS NULL`),
    one(`SELECT COUNT(*) c FROM merchants WHERE status=1 AND deleted_at IS NULL`),
    one(`SELECT IFNULL(SUM(total_amount),0) c FROM consumer_orders WHERE pay_status='paid'`),
    one(`SELECT IFNULL(SUM(cash_amount),0) c FROM cross_orders`),
    one(`SELECT IFNULL(SUM(total_amount),0) c FROM purchase_orders WHERE status IN ('confirmed','shipped','pending')`),
    one(`SELECT COUNT(*) c FROM visit_logs WHERE created_at >= CURDATE()`),
    one(`SELECT COUNT(*) c FROM visit_logs WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`),
    one(
      `SELECT (
         (SELECT COUNT(*) FROM consumer_orders WHERE DATE(created_at)=CURDATE()) +
         (SELECT COUNT(*) FROM cross_orders WHERE DATE(created_at)=CURDATE()) +
         (SELECT COUNT(*) FROM purchase_orders WHERE DATE(created_at)=CURDATE())
       ) c`
    )
  ])

  const gmvTotal = Math.round((consumerGmv + crossGmv + purchaseGmv) * 100) / 100

  const hotCities = await query(
    `SELECT IFNULL(city,'(未知)') AS city, COUNT(*) AS visits
     FROM visit_logs
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY IFNULL(city,'(未知)')
     ORDER BY visits DESC LIMIT 10`
  )

  const geoPoints = await query(
    `SELECT m.id, m.name, m.role, m.city, m.latitude AS lat, m.longitude AS lng, m.status,
            (SELECT COUNT(*) FROM visit_logs v WHERE v.merchant_id=m.id) AS visits
     FROM merchants m
     WHERE m.deleted_at IS NULL AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
     ORDER BY visits DESC`
  )

  const visitTrend = await query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS visits
     FROM visit_logs
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(created_at)
     ORDER BY day ASC`
  )

  const roleMix = [
    { role: 'consumer', label: 'C端用户', count: consumers },
    { role: 'stall', label: '地摊', count: stalls },
    { role: 'cross', label: '异业', count: crosses },
    { role: 'supply', label: '供应链', count: supplies }
  ]

  const topGoods = await query(
    `(SELECT 'stall' AS type, name, sku_code AS sku, sales_count AS sales, price AS price
      FROM stall_goods WHERE deleted_at IS NULL ORDER BY sales_count DESC LIMIT 5)
     UNION ALL
     (SELECT 'cross' AS type, name, sku_code AS sku, sales_count AS sales, cash_price AS price
      FROM cross_goods WHERE deleted_at IS NULL ORDER BY sales_count DESC LIMIT 5)
     UNION ALL
     (SELECT 'supply' AS type, name, sku_code AS sku, sales_count AS sales, price AS price
      FROM supply_goods WHERE deleted_at IS NULL ORDER BY sales_count DESC LIMIT 5)`
  )

  return {
    updatedAt: new Date().toISOString(),
    kpis: {
      visitsToday,
      visits7d,
      ordersToday,
      gmvTotal,
      consumerGmv,
      crossGmv,
      purchaseGmv,
      openStores,
      consumers,
      stalls,
      crosses,
      supplies
    },
    roleMix,
    hotCities,
    geoPoints,
    visitTrend,
    topGoods
  }
}

async function trackVisit(body = {}) {
  await query(
    `INSERT INTO visit_logs (role_scope, page_key, merchant_id, user_id, city, latitude, longitude)
     VALUES (:role, :page, :mid, :uid, :city, :lat, :lng)`,
    {
      role: body.roleScope || 'consumer',
      page: body.pageKey || null,
      mid: body.merchantId ? Number(body.merchantId) : null,
      uid: body.userId ? Number(body.userId) : null,
      city: body.city || null,
      lat: body.latitude || null,
      lng: body.longitude || null
    }
  )
  return { ok: true }
}

/** 用户总览：C端 + 商户身份 */
async function listAllIdentities({ role, q, limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  const rows = []

  if (!role || role === 'consumer' || role === 'all') {
    let sql = `SELECT u.id, 'consumer' AS identity, 'C端用户' AS identityLabel,
                      u.nickname AS name, u.invite_code AS code, u.phone, u.points_balance AS points,
                      u.status, u.deleted_at AS deletedAt, u.created_at AS createdAt,
                      u.avatar_url AS avatarUrl,
                      NULL AS merchantId, NULL AS city, NULL AS materials, NULL AS coverUrl
               FROM users u WHERE u.deleted_at IS NULL`
    const params = {}
    if (q) {
      sql += ` AND (u.nickname LIKE :q OR u.invite_code LIKE :q OR u.phone LIKE :q)`
      params.q = `%${q}%`
    }
    sql += ` ORDER BY u.id DESC LIMIT ${lim}`
    rows.push(...(await query(sql, params)))
  }

  if (!role || role === 'all' || ['stall', 'cross', 'supply'].includes(role)) {
    let sql = `SELECT m.id AS merchantId, m.role AS identity,
                      CASE m.role WHEN 'stall' THEN '地摊' WHEN 'cross' THEN '异业' ELSE '供应链' END AS identityLabel,
                      m.name, m.invite_code AS code, m.contact_phone AS phone, NULL AS points,
                      m.status, m.deleted_at AS deletedAt, m.created_at AS createdAt,
                      m.city, m.materials_json AS materials, m.cover_url AS coverUrl,
                      m.address, m.contact_name AS contactName
               FROM merchants m WHERE m.deleted_at IS NULL`
    const params = {}
    if (role && role !== 'all') {
      sql += ` AND m.role=:role`
      params.role = role
    }
    if (q) {
      sql += ` AND (m.name LIKE :q OR m.invite_code LIKE :q OR m.contact_phone LIKE :q)`
      params.q = `%${q}%`
    }
    sql += ` ORDER BY m.id DESC LIMIT ${lim}`
    const merchants = await query(sql, params)
    for (const m of merchants) {
      if (m.materials && typeof m.materials === 'string') {
        try {
          m.materials = JSON.parse(m.materials)
        } catch (_) {}
      }
      rows.push({
        id: m.merchantId,
        identity: m.identity,
        identityLabel: m.identityLabel,
        name: m.name,
        code: m.code,
        phone: m.phone,
        points: null,
        status: m.status,
        deletedAt: m.deletedAt,
        createdAt: m.createdAt,
        merchantId: m.merchantId,
        city: m.city,
        materials: m.materials,
        coverUrl: m.coverUrl,
        avatarUrl: m.coverUrl,
        address: m.address,
        contactName: m.contactName
      })
    }
  }

  return rows
}

async function getStoreDetail(merchantId) {
  const rows = await query(
    `SELECT m.*, IFNULL(p.balance,0) AS pool_balance
     FROM merchants m
     LEFT JOIN merchant_points_pool p ON p.merchant_id=m.id
     WHERE m.id=:id AND m.deleted_at IS NULL`,
    { id: merchantId }
  )
  if (!rows.length) throw new HttpError(404, '门店不存在')
  const m = rows[0]
  let materials = m.materials_json
  if (materials && typeof materials === 'string') {
    try {
      materials = JSON.parse(materials)
    } catch (_) {}
  }
  if (!materials) {
    const apps = await query(
      `SELECT license_json FROM merchant_applications
       WHERE merchant_id=:id AND status='approved' ORDER BY id DESC LIMIT 1`,
      { id: merchantId }
    )
    if (apps.length) {
      materials = apps[0].license_json
      if (typeof materials === 'string') {
        try {
          materials = JSON.parse(materials)
        } catch (_) {}
      }
    }
  }

  const goodsTable =
    m.role === 'stall' ? 'stall_goods' : m.role === 'cross' ? 'cross_goods' : 'supply_goods'
  const goods = await query(
    `SELECT id, name, sku_code, image_url, sales_count, stock,
            ${m.role === 'cross' ? 'cash_price AS price, points_need, on_sale' : m.role === 'supply' ? 'price, points_grant, status AS on_sale' : 'price, points_grant, on_sale'}
     FROM ${goodsTable} WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC LIMIT 100`,
    { id: merchantId }
  )

  return {
    id: m.id,
    role: m.role,
    roleLabel: ROLE_LABEL[m.role],
    name: m.name,
    merchantNo: m.merchant_no,
    inviteCode: m.invite_code,
    contactName: m.contact_name,
    contactPhone: m.contact_phone,
    city: m.city,
    address: m.address,
    latitude: m.latitude,
    longitude: m.longitude,
    coverUrl: m.cover_url,
    status: m.status,
    poolBalance: m.pool_balance,
    materials: materials || {},
    goods
  }
}

async function setMerchantStatus(id, status) {
  const rows = await query('SELECT id FROM merchants WHERE id=:id AND deleted_at IS NULL', { id })
  if (!rows.length) throw new HttpError(404, '门店不存在')
  await query('UPDATE merchants SET status=:s WHERE id=:id', { id, s: Number(status) })
  return { id: Number(id), status: Number(status) }
}

async function softDeleteMerchant(id) {
  const rows = await query('SELECT id FROM merchants WHERE id=:id AND deleted_at IS NULL', { id })
  if (!rows.length) throw new HttpError(404, '门店不存在')
  await query(`UPDATE merchants SET status=2, deleted_at=NOW() WHERE id=:id`, { id })
  return { id: Number(id), deleted: true }
}

async function updateMerchantMaterials(id, materials) {
  await query(`UPDATE merchants SET materials_json=CAST(:j AS JSON) WHERE id=:id`, {
    id,
    j: JSON.stringify(materials || {})
  })
  return { id: Number(id) }
}

async function softDeleteUser(id) {
  await query(`UPDATE users SET status=0, deleted_at=NOW() WHERE id=:id`, { id })
  return { id: Number(id), deleted: true }
}

async function setUserStatus(id, status) {
  await query(`UPDATE users SET status=:s WHERE id=:id AND deleted_at IS NULL`, {
    id,
    s: Number(status)
  })
  return { id: Number(id), status: Number(status) }
}

/** 商品 SKU 列表（三类） */
async function listSkus({ type, merchantId, shopName, includeDeleted } = {}) {
  const types = type ? [type] : ['stall', 'cross', 'supply']
  const typeLabel = { stall: '地摊', cross: '异业门店', supply: '供应链门店' }
  const out = []
  for (const t of types) {
    const table = t === 'stall' ? 'stall_goods' : t === 'cross' ? 'cross_goods' : 'supply_goods'
    let sql = `SELECT g.*, m.name AS shopName, '${t}' AS goodsType
               FROM ${table} g JOIN merchants m ON m.id=g.merchant_id
               WHERE 1=1`
    const params = {}
    if (!includeDeleted) sql += ` AND g.deleted_at IS NULL`
    if (merchantId) {
      sql += ` AND g.merchant_id=:mid`
      params.mid = Number(merchantId)
    }
    if (shopName && String(shopName).trim()) {
      sql += ` AND m.name LIKE :shopName`
      params.shopName = `%${String(shopName).trim()}%`
    }
    sql += ` ORDER BY g.id DESC LIMIT 200`
    const rows = await query(sql, params)
    for (const g of rows) {
      out.push({
        id: g.id,
        goodsType: t,
        goodsTypeLabel: typeLabel[t] || t,
        merchantId: g.merchant_id,
        shopName: g.shopName,
        name: g.name,
        sku: g.sku_code,
        price: g.price != null ? g.price : g.cash_price,
        pointsNeed: g.points_need,
        pointsGrant: g.points_grant,
        stock: g.stock,
        sales: g.sales_count || 0,
        onSale: g.on_sale != null ? g.on_sale : g.status,
        imageUrl: g.image_url,
        deletedAt: g.deleted_at
      })
    }
  }
  return out
}

async function setGoodsOpen(type, id, open) {
  const table = type === 'stall' ? 'stall_goods' : type === 'cross' ? 'cross_goods' : 'supply_goods'
  const col = type === 'supply' ? 'status' : 'on_sale'
  await query(`UPDATE ${table} SET ${col}=:v WHERE id=:id AND deleted_at IS NULL`, {
    id,
    v: open ? 1 : 0
  })
  return { id: Number(id), open: !!open }
}

async function softDeleteGoods(type, id) {
  const table = type === 'stall' ? 'stall_goods' : type === 'cross' ? 'cross_goods' : 'supply_goods'
  const col = type === 'supply' ? 'status' : 'on_sale'
  await query(`UPDATE ${table} SET ${col}=0, deleted_at=NOW() WHERE id=:id`, { id })
  return { id: Number(id), deleted: true }
}

async function saveSku(type, body) {
  const table = type === 'stall' ? 'stall_goods' : type === 'cross' ? 'cross_goods' : 'supply_goods'
  if (!body.id) throw new HttpError(400, '缺少商品ID')
  if (type === 'stall') {
    await query(
      `UPDATE stall_goods SET name=:n, sku_code=:sku, price=:p, points_grant=:pg, stock=:s,
       sales_count=:sales, image_url=:img, on_sale=:onSale WHERE id=:id`,
      {
        id: body.id,
        n: body.name,
        sku: body.sku || null,
        p: Number(body.price),
        pg: Number(body.pointsGrant) || 0,
        s: Number(body.stock) || 0,
        sales: Number(body.sales) || 0,
        img: body.imageUrl || null,
        onSale: body.onSale === 0 ? 0 : 1
      }
    )
  } else if (type === 'cross') {
    await query(
      `UPDATE cross_goods SET name=:n, sku_code=:sku, points_need=:pn, cash_price=:cp,
       sales_count=:sales, image_url=:img, on_sale=:onSale WHERE id=:id`,
      {
        id: body.id,
        n: body.name,
        sku: body.sku || null,
        pn: Number(body.pointsNeed) || 0,
        cp: Number(body.price || body.cashPrice) || 0,
        sales: Number(body.sales) || 0,
        img: body.imageUrl || null,
        onSale: body.onSale === 0 ? 0 : 1
      }
    )
  } else {
    await query(
      `UPDATE supply_goods SET name=:n, sku_code=:sku, price=:p, stock=:s, points_grant=:pg,
       sales_count=:sales, image_url=:img, status=:st WHERE id=:id`,
      {
        id: body.id,
        n: body.name,
        sku: body.sku || null,
        p: Number(body.price),
        s: Number(body.stock) || 0,
        pg: Number(body.pointsGrant) || 0,
        sales: Number(body.sales) || 0,
        img: body.imageUrl || null,
        st: body.onSale === 0 ? 0 : 1
      }
    )
  }
  return { id: Number(body.id) }
}

module.exports = {
  bigScreen,
  trackVisit,
  listAllIdentities,
  getStoreDetail,
  setMerchantStatus,
  softDeleteMerchant,
  updateMerchantMaterials,
  softDeleteUser,
  setUserStatus,
  listSkus,
  setGoodsOpen,
  softDeleteGoods,
  saveSku,
  ROLE_LABEL
}

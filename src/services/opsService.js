const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { parsePaging, pageResult } = require('../utils/paging')
const { enrichScreen } = require('./screenSim')

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

  let hourly = []
  try {
    hourly = await query(
      `SELECT HOUR(created_at) AS hour, COUNT(*) AS count
       FROM visit_logs WHERE created_at >= CURDATE()
       GROUP BY HOUR(created_at)`
    )
  } catch (_) {
    hourly = []
  }

  return enrichScreen(
    {
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
    },
    { hourly }
  )
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

function mapMerchantIdentity(m, pickCoverFromLicenses, parseMaybeJson) {
  const materials = parseMaybeJson(m.materials) || m.materials || {}
  const coverUrl = m.coverUrl || pickCoverFromLicenses(materials) || ''
  return {
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
    materials,
    coverUrl,
    avatarUrl: coverUrl,
    address: m.address,
    contactName: m.contactName
  }
}

/** 用户总览：C端 + 商户身份（分页） */
async function listAllIdentities({ role, q, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const { pickCoverFromLicenses, parseMaybeJson } = require('../utils/mediaPick')
  const wantUsers = !role || role === 'consumer' || role === 'all'
  const wantMerchants = !role || role === 'all' || ['stall', 'cross', 'supply'].includes(role)
  const onlyUsers = role === 'consumer'
  const onlyMerchants = ['stall', 'cross', 'supply'].includes(role)

  if (onlyUsers) {
    let where = ` WHERE u.deleted_at IS NULL`
    const params = {}
    if (q) {
      where += ` AND (u.nickname LIKE :q OR u.invite_code LIKE :q OR u.phone LIKE :q)`
      params.q = `%${q}%`
    }
    const countRows = await query(`SELECT COUNT(*) AS c FROM users u${where}`, params)
    const rows = await query(
      `SELECT u.id, 'consumer' AS identity, 'C端用户' AS identityLabel,
              u.nickname AS name, u.invite_code AS code, u.phone, u.points_balance AS points,
              u.status, u.deleted_at AS deletedAt, u.created_at AS createdAt,
              u.avatar_url AS avatarUrl,
              NULL AS merchantId, NULL AS city, NULL AS materials, NULL AS coverUrl
       FROM users u${where}
       ORDER BY u.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
    return pageResult(rows, Number(countRows[0]?.c) || 0, paging)
  }

  if (onlyMerchants) {
    let where = ` WHERE m.deleted_at IS NULL AND m.role=:role`
    const params = { role }
    if (q) {
      where += ` AND (m.name LIKE :q OR m.invite_code LIKE :q OR m.contact_phone LIKE :q)`
      params.q = `%${q}%`
    }
    const countRows = await query(`SELECT COUNT(*) AS c FROM merchants m${where}`, params)
    const merchants = await query(
      `SELECT m.id AS merchantId, m.role AS identity,
              CASE m.role WHEN 'stall' THEN '地摊' WHEN 'cross' THEN '异业' ELSE '供应链' END AS identityLabel,
              m.name, m.invite_code AS code, m.contact_phone AS phone, NULL AS points,
              m.status, m.deleted_at AS deletedAt, m.created_at AS createdAt,
              m.city, m.materials_json AS materials, m.cover_url AS coverUrl,
              m.address, m.contact_name AS contactName
       FROM merchants m${where}
       ORDER BY m.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
    const list = merchants.map((m) => mapMerchantIdentity(m, pickCoverFromLicenses, parseMaybeJson))
    return pageResult(list, Number(countRows[0]?.c) || 0, paging)
  }

  // role=all：两侧各取 offset+pageSize 再合并切片，保证翻页可用
  const fetchLimit = paging.offset + paging.pageSize
  let userWhere = ` WHERE u.deleted_at IS NULL`
  let merchantWhere = ` WHERE m.deleted_at IS NULL`
  const userParams = {}
  const merchantParams = {}
  if (q) {
    userWhere += ` AND (u.nickname LIKE :q OR u.invite_code LIKE :q OR u.phone LIKE :q)`
    merchantWhere += ` AND (m.name LIKE :q OR m.invite_code LIKE :q OR m.contact_phone LIKE :q)`
    userParams.q = `%${q}%`
    merchantParams.q = `%${q}%`
  }
  const [userCountRows, merchantCountRows, users, merchants] = await Promise.all([
    wantUsers ? query(`SELECT COUNT(*) AS c FROM users u${userWhere}`, userParams) : Promise.resolve([{ c: 0 }]),
    wantMerchants
      ? query(`SELECT COUNT(*) AS c FROM merchants m${merchantWhere}`, merchantParams)
      : Promise.resolve([{ c: 0 }]),
    wantUsers
      ? query(
          `SELECT u.id, 'consumer' AS identity, 'C端用户' AS identityLabel,
                  u.nickname AS name, u.invite_code AS code, u.phone, u.points_balance AS points,
                  u.status, u.deleted_at AS deletedAt, u.created_at AS createdAt,
                  u.avatar_url AS avatarUrl,
                  NULL AS merchantId, NULL AS city, NULL AS materials, NULL AS coverUrl
           FROM users u${userWhere}
           ORDER BY u.id DESC LIMIT ${fetchLimit}`,
          userParams
        )
      : Promise.resolve([]),
    wantMerchants
      ? query(
          `SELECT m.id AS merchantId, m.role AS identity,
                  CASE m.role WHEN 'stall' THEN '地摊' WHEN 'cross' THEN '异业' ELSE '供应链' END AS identityLabel,
                  m.name, m.invite_code AS code, m.contact_phone AS phone, NULL AS points,
                  m.status, m.deleted_at AS deletedAt, m.created_at AS createdAt,
                  m.city, m.materials_json AS materials, m.cover_url AS coverUrl,
                  m.address, m.contact_name AS contactName
           FROM merchants m${merchantWhere}
           ORDER BY m.id DESC LIMIT ${fetchLimit}`,
          merchantParams
        )
      : Promise.resolve([])
  ])
  const merged = [
    ...users,
    ...merchants.map((m) => mapMerchantIdentity(m, pickCoverFromLicenses, parseMaybeJson))
  ].sort((a, b) => Number(b.id) - Number(a.id))
  const total = (Number(userCountRows[0]?.c) || 0) + (Number(merchantCountRows[0]?.c) || 0)
  const list = merged.slice(paging.offset, paging.offset + paging.pageSize)
  return pageResult(list, total, paging)
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
    `SELECT id, name, sku_code AS skuCode, image_url AS imageUrl, sales_count AS salesCount, stock,
            ${
              m.role === 'cross'
                ? 'cash_price AS price, points_need AS pointsNeed, on_sale AS onSale'
                : m.role === 'supply'
                  ? 'price, points_grant AS pointsGrant, status AS onSale'
                  : 'price, points_grant AS pointsGrant, on_sale AS onSale'
            }
     FROM ${goodsTable} WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC LIMIT 100`,
    { id: merchantId }
  )

  const { pickCoverFromLicenses } = require('../utils/mediaPick')
  const coverUrl = m.cover_url || pickCoverFromLicenses(materials) || ''
  return {
    id: m.id,
    role: m.role,
    roleLabel: ROLE_LABEL[m.role],
    name: m.name,
    merchantNo: m.merchant_no,
    inviteCode: m.invite_code,
    legalPerson: m.legal_person || '',
    contactName: m.contact_name,
    contactPhone: m.contact_phone,
    city: m.city,
    address: m.address,
    latitude: m.latitude,
    longitude: m.longitude,
    bizType: m.biz_type || '',
    coverUrl,
    status: m.status,
    poolBalance: m.pool_balance,
    materials: materials || {},
    goods: (goods || []).map((g) => ({
      ...g,
      goodsType: m.role,
      merchantId: m.id,
      sku: g.skuCode,
      sales: g.salesCount,
      onSale: g.onSale,
      imageUrl: g.imageUrl
    }))
  }
}

/** 运营台编辑门店基础信息（可含封面、类目） */
async function updateStore(id, body = {}) {
  const rows = await query('SELECT id, role FROM merchants WHERE id=:id AND deleted_at IS NULL', { id })
  if (!rows.length) throw new HttpError(404, '门店不存在')
  const fields = []
  const params = { id: Number(id) }
  const map = {
    name: 'name',
    city: 'city',
    address: 'address',
    legalPerson: 'legal_person',
    contactName: 'contact_name',
    contactPhone: 'contact_phone',
    status: 'status',
    coverUrl: 'cover_url',
    bizType: 'biz_type',
    latitude: 'latitude',
    longitude: 'longitude'
  }
  for (const [k, col] of Object.entries(map)) {
    if (body[k] === undefined) continue
    fields.push(`${col} = :${k}`)
    params[k] =
      k === 'latitude' || k === 'longitude' || k === 'status'
        ? body[k] === '' || body[k] == null
          ? null
          : Number(body[k])
        : body[k]
  }
  if (body.materials && typeof body.materials === 'object') {
    fields.push('materials_json = CAST(:materialsJson AS JSON)')
    params.materialsJson = JSON.stringify(body.materials)
    if (body.coverUrl === undefined) {
      const { pickCoverFromLicenses } = require('../utils/mediaPick')
      const picked = pickCoverFromLicenses(body.materials)
      if (picked) {
        fields.push('cover_url = :autoCover')
        params.autoCover = picked
      }
    }
  }
  if (!fields.length) throw new HttpError(400, '没有可更新字段')
  await query(`UPDATE merchants SET ${fields.join(', ')} WHERE id=:id`, params)
  return getStoreDetail(Number(id))
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
  const { pickCoverFromLicenses } = require('../utils/mediaPick')
  const mats = materials || {}
  const cover = pickCoverFromLicenses(mats)
  await query(
    `UPDATE merchants SET materials_json=CAST(:j AS JSON),
     cover_url = IF(:cover = '', cover_url, :cover)
     WHERE id=:id`,
    {
      id,
      j: JSON.stringify(mats),
      cover: cover || ''
    }
  )
  return getStoreDetail(Number(id))
}

/** 新建门店商品（运营台从门店详情创建） */
async function createSku(type, body = {}) {
  const merchantId = Number(body.merchantId)
  if (!merchantId) throw new HttpError(400, '缺少商户ID')
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写商品名称')
  const mrows = await query(
    'SELECT id, role FROM merchants WHERE id=:id AND deleted_at IS NULL',
    { id: merchantId }
  )
  if (!mrows.length) throw new HttpError(404, '门店不存在')
  if (type && type !== mrows[0].role) {
    throw new HttpError(400, '商品类型与门店角色不一致')
  }
  const role = mrows[0].role
  const sku = String(body.sku || '').trim() || null
  const img = body.imageUrl || null
  const onSale = body.onSale === 0 ? 0 : 1
  let insertId = 0
  if (role === 'stall') {
    const r = await query(
      `INSERT INTO stall_goods
        (merchant_id, name, sku_code, price, points_grant, category, desc_text, image_url, stock, on_sale)
       VALUES (:mid, :name, :sku, :price, :pg, :cat, :desc, :img, :stock, :onSale)`,
      {
        mid: merchantId,
        name,
        sku,
        price: Number(body.price) || 0,
        pg: Number(body.pointsGrant) || 0,
        cat: body.category || '主食',
        desc: body.desc || '',
        img,
        stock: Number(body.stock) || 9999,
        onSale
      }
    )
    insertId = r.insertId
    if (!sku && insertId) {
      await query(`UPDATE stall_goods SET sku_code=CONCAT('ST', LPAD(id,6,'0')) WHERE id=:id`, {
        id: insertId
      })
    }
  } else if (role === 'cross') {
    const r = await query(
      `INSERT INTO cross_goods
        (merchant_id, name, sku_code, points_need, cash_price, desc_text, image_url, stock, on_sale)
       VALUES (:mid, :name, :sku, :pn, :cp, :desc, :img, :stock, :onSale)`,
      {
        mid: merchantId,
        name,
        sku,
        pn: Number(body.pointsNeed) || 0,
        cp: Number(body.price || body.cashPrice) || 0,
        desc: body.desc || '',
        img,
        stock: Number(body.stock) || 9999,
        onSale
      }
    )
    insertId = r.insertId
    if (!sku && insertId) {
      await query(`UPDATE cross_goods SET sku_code=CONCAT('CR', LPAD(id,6,'0')) WHERE id=:id`, {
        id: insertId
      })
    }
  } else {
    const r = await query(
      `INSERT INTO supply_goods
        (merchant_id, name, sku_code, price, stock, points_grant, image_url, status)
       VALUES (:mid, :name, :sku, :price, :stock, :pg, :img, :st)`,
      {
        mid: merchantId,
        name,
        sku,
        price: Number(body.price) || 0,
        stock: Number(body.stock) || 0,
        pg: Number(body.pointsGrant) || 0,
        img,
        st: onSale
      }
    )
    insertId = r.insertId
    if (!sku && insertId) {
      await query(`UPDATE supply_goods SET sku_code=CONCAT('SP', LPAD(id,6,'0')) WHERE id=:id`, {
        id: insertId
      })
    }
  }
  return { id: insertId, merchantId, role }
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

function mapSkuRow(g, t, typeLabel) {
  return {
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
  }
}

/** 商品 SKU 列表（三类，分页） */
async function listSkus({ type, merchantId, shopName, includeDeleted, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const types = type ? [type] : ['stall', 'cross', 'supply']
  const typeLabel = { stall: '地摊', cross: '异业门店', supply: '供应链门店' }

  async function queryType(t, lim, off) {
    const table = t === 'stall' ? 'stall_goods' : t === 'cross' ? 'cross_goods' : 'supply_goods'
    let where = ` WHERE 1=1`
    const params = {}
    if (!includeDeleted) where += ` AND g.deleted_at IS NULL`
    if (merchantId) {
      where += ` AND g.merchant_id=:mid`
      params.mid = Number(merchantId)
    }
    if (shopName && String(shopName).trim()) {
      where += ` AND m.name LIKE :shopName`
      params.shopName = `%${String(shopName).trim()}%`
    }
    const countRows = await query(
      `SELECT COUNT(*) AS c FROM ${table} g JOIN merchants m ON m.id=g.merchant_id${where}`,
      params
    )
    const rows = await query(
      `SELECT g.*, m.name AS shopName, '${t}' AS goodsType
       FROM ${table} g JOIN merchants m ON m.id=g.merchant_id${where}
       ORDER BY g.id DESC LIMIT ${lim} OFFSET ${off}`,
      params
    )
    return {
      total: Number(countRows[0]?.c) || 0,
      list: rows.map((g) => mapSkuRow(g, t, typeLabel))
    }
  }

  if (types.length === 1) {
    const result = await queryType(types[0], paging.limit, paging.offset)
    return pageResult(result.list, result.total, paging)
  }

  const fetchLimit = paging.offset + paging.pageSize
  const parts = await Promise.all(types.map((t) => queryType(t, fetchLimit, 0)))
  const total = parts.reduce((s, p) => s + p.total, 0)
  const merged = parts
    .flatMap((p) => p.list)
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(paging.offset, paging.offset + paging.pageSize)
  return pageResult(merged, total, paging)
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
       stock=:s, sales_count=:sales, image_url=:img, on_sale=:onSale WHERE id=:id`,
      {
        id: body.id,
        n: body.name,
        sku: body.sku || null,
        pn: Number(body.pointsNeed) || 0,
        cp: Number(body.price || body.cashPrice) || 0,
        s: Number(body.stock) || 0,
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
  updateStore,
  setMerchantStatus,
  softDeleteMerchant,
  updateMerchantMaterials,
  createSku,
  softDeleteUser,
  setUserStatus,
  listSkus,
  setGoodsOpen,
  softDeleteGoods,
  saveSku,
  ROLE_LABEL
}

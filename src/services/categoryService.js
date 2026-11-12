const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { applyGeo } = require('../utils/geo')
const { enrichCoverRow } = require('../utils/mediaPick')
const { getHomeVisibleSql } = require('./merchantReady')

const ROLE_LABEL = {
  stall: '地摊',
  cross: '异业门店',
  supply: '供应链'
}

const ROLE_ACTION = {
  stall: '点餐',
  cross: '兑换',
  supply: '供货'
}

function normalizeRole(role) {
  const r = String(role || '').trim()
  if (!ROLE_LABEL[r]) throw new HttpError(400, '类目须关联地摊、异业门店或供应链')
  return r
}

function mapRow(r) {
  return {
    ...r,
    imageUrl: r.imageUrl || r.image_url || '',
    roleLabel: ROLE_LABEL[r.role] || r.role
  }
}

async function listCategories(role, { activeOnly = false } = {}) {
  const params = {}
  let where = 'WHERE 1=1'
  if (role) {
    where += ' AND role=:role'
    params.role = normalizeRole(role)
  }
  if (activeOnly) where += ' AND status=1'
  let rows
  try {
    rows = await query(
      `SELECT id, role, name, image_url AS imageUrl, sort_order AS sortOrder, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM goods_categories ${where}
       ORDER BY FIELD(role,'stall','cross','supply'), sort_order ASC, id ASC`,
      params
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column.*image_url/i.test(String(e.message || ''))))) {
      throw e
    }
    rows = await query(
      `SELECT id, role, name, sort_order AS sortOrder, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM goods_categories ${where}
       ORDER BY FIELD(role,'stall','cross','supply'), sort_order ASC, id ASC`,
      params
    )
    rows = rows.map((r) => ({ ...r, imageUrl: '' }))
  }
  return rows.map(mapRow)
}

/** C 端：全部启用类目；role=all/空 时不按角色过滤 */
async function listPublicCategories(role) {
  const raw = String(role || '').trim().toLowerCase()
  if (!raw || raw === 'all') return listCategories('', { activeOnly: true })
  return listCategories(normalizeRole(raw), { activeOnly: true })
}

async function getCategoryById(id) {
  const sid = Number(id)
  if (!sid) throw new HttpError(400, '缺少类目 ID')
  const rows = await listCategories('', { activeOnly: false })
  const hit = rows.find((r) => Number(r.id) === sid)
  if (!hit) throw new HttpError(404, '类目不存在')
  return hit
}

/**
 * 新建/编辑商品时解析启用中的类目。
 * 优先 categoryId；否则按名称在同角色启用类目中匹配。
 */
async function resolveActiveCategory(role, { categoryId, category, categoryName, allowEmpty = false } = {}) {
  const r = normalizeRole(role)
  const cats = await listCategories(r, { activeOnly: true })
  const cid = Number(categoryId) || 0
  if (cid) {
    const hit = cats.find((c) => Number(c.id) === cid)
    if (!hit) throw new HttpError(400, '请选择当前启用的商品类目')
    return { categoryId: Number(hit.id), category: hit.name }
  }
  const name = String(categoryName || category || '').trim()
  if (!name) {
    if (allowEmpty) return { categoryId: null, category: '' }
    if (!cats.length) throw new HttpError(400, '暂无启用类目，请先在运营台「商品类目」中添加并启用')
    throw new HttpError(400, '请选择商品类目')
  }
  const hit = cats.find((c) => String(c.name) === name)
  if (!hit) {
    throw new HttpError(
      400,
      `类目「${name}」未启用或不属于当前角色，请从启用类目中选择`
    )
  }
  return { categoryId: Number(hit.id), category: hit.name }
}

/** 类目名与门店经营类目宽松匹配（兼容旧数据） */
function merchantMatchesCategory(merchant, cat) {
  if (!merchant || !cat) return false
  if (String(merchant.role || '') !== String(cat.role || '')) return false
  const biz = String(merchant.bizType || merchant.category || merchant.tag || '').trim()
  const name = String(cat.name || '').trim()
  if (!name) return false
  if (!biz) return true
  if (biz === name) return true
  if (name.includes(biz) || biz.includes(name)) return true
  const keys = ['餐饮', '百货', '鲜花', '蛋糕', '粮油', '生鲜', '小吃', '烧烤', '饮品', '果切', '茶饮']
  return keys.some((k) => name.includes(k) && biz.includes(k))
}

function goodsMatchesCategory(goods, cat) {
  if (!goods || !cat) return false
  const cid = Number(goods.categoryId || goods.category_id) || 0
  if (cid && cid === Number(cat.id)) return true
  const name = String(goods.category || '').trim()
  return Boolean(name && name === String(cat.name || '').trim())
}

async function listMerchantsByCategory(categoryId, opts = {}) {
  const cat = await getCategoryById(categoryId)
  if (Number(cat.status) === 0) throw new HttpError(404, '类目已停用')
  const role = cat.role
  const homeSql = await getHomeVisibleSql()
  const goodsTable =
    role === 'cross' ? 'cross_goods' : role === 'supply' ? 'supply_goods' : 'stall_goods'
  const saleSql =
    role === 'supply'
      ? 'IFNULL(g.status,0)=1'
      : 'IFNULL(g.on_sale,0)=1'
  let rows
  try {
    rows = await query(
      `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude, m.role, m.status,
              m.cover_hue AS coverHue, m.cover_url AS coverImage, m.materials_json AS materialsJson,
              LEFT(m.name,1) AS initial,
              CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
              IFNULL(NULLIF(m.biz_type,''), '') AS bizType,
              IFNULL(NULLIF(m.biz_type,''), '') AS category,
              IFNULL(NULLIF(m.biz_type,''), '') AS tag,
              (
                SELECT COUNT(*) FROM ${goodsTable} g
                WHERE g.merchant_id=m.id AND g.deleted_at IS NULL AND ${saleSql}
                  AND (
                    g.category_id=:cid
                    OR (IFNULL(g.category_id,0)=0 AND g.category=:cname)
                  )
              ) AS goodsCount
       FROM merchants m
       WHERE m.role=:role AND m.status=1 AND m.deleted_at IS NULL
         AND ${homeSql}
       ORDER BY m.id DESC`,
      { role, cid: Number(cat.id), cname: cat.name }
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column.*wx_sub_mch|category_id|operating_cities/i.test(String(e.message || ''))))) {
      throw e
    }
    rows = await query(
      `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude, m.role, m.status,
              m.cover_hue AS coverHue, m.cover_url AS coverImage, m.materials_json AS materialsJson,
              LEFT(m.name,1) AS initial,
              CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
              IFNULL(NULLIF(m.biz_type,''), '') AS bizType,
              IFNULL(NULLIF(m.biz_type,''), '') AS category,
              IFNULL(NULLIF(m.biz_type,''), '') AS tag,
              (
                SELECT COUNT(*) FROM ${goodsTable} g
                WHERE g.merchant_id=m.id AND g.deleted_at IS NULL AND ${saleSql}
                  AND g.category=:cname
              ) AS goodsCount
       FROM merchants m
       WHERE m.role=:role AND m.status=1 AND m.deleted_at IS NULL
         AND ${homeSql}
       ORDER BY m.id DESC`,
      { role, cname: cat.name }
    ).catch(async () =>
      query(
        `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude, m.role, m.status,
                m.cover_hue AS coverHue, m.cover_url AS coverImage, m.materials_json AS materialsJson,
                LEFT(m.name,1) AS initial,
                CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
                IFNULL(NULLIF(m.biz_type,''), '') AS bizType,
                IFNULL(NULLIF(m.biz_type,''), '') AS category,
                IFNULL(NULLIF(m.biz_type,''), '') AS tag, 0 AS goodsCount
         FROM merchants m
         WHERE m.role=:role AND m.status=1 AND m.deleted_at IS NULL
         ORDER BY m.id DESC`,
        { role }
      )
    )
  }
  const matched = rows
    .filter((m) => Number(m.goodsCount) > 0 || merchantMatchesCategory(m, cat))
    .map((m) => {
      const enriched = enrichCoverRow(m)
      return {
        ...enriched,
        role,
        roleLabel: ROLE_ACTION[role] || ROLE_LABEL[role] || role,
        categoryName: cat.name,
        goodsCount: Number(m.goodsCount) || 0
      }
    })
  return {
    category: cat,
    list: applyGeo(matched, opts)
  }
}

/** C 端分类详情：按类目列出上架商品（绑定 category_id 或同名 category） */
async function listGoodsByCategory(categoryId, opts = {}) {
  const cat = await getCategoryById(categoryId)
  if (Number(cat.status) === 0) throw new HttpError(404, '类目已停用')
  const role = cat.role
  const homeSql = await getHomeVisibleSql()
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 200)
  let rows = []
  if (role === 'stall') {
    try {
      rows = await query(
        `SELECT g.id, g.name, g.price, g.points_grant AS pointsGrant, g.category, g.category_id AS categoryId,
                g.image_url AS coverImage, g.image_url AS imageUrl, g.sku_code AS sku, g.stock,
                m.id AS merchantId, m.name AS shopName, m.city, m.address, m.role,
                m.cover_url AS shopCover, m.cover_hue AS coverHue, m.materials_json AS materialsJson
         FROM stall_goods g
         JOIN merchants m ON m.id=g.merchant_id
         WHERE g.deleted_at IS NULL AND IFNULL(g.on_sale,0)=1
           AND m.status=1 AND m.deleted_at IS NULL AND m.role='stall'
           AND ${homeSql}
           AND (g.category_id=:cid OR (IFNULL(g.category_id,0)=0 AND g.category=:cname))
         ORDER BY g.id DESC LIMIT ${limit}`,
        { cid: Number(cat.id), cname: cat.name }
      )
    } catch (e) {
      if (!/Unknown column.*category_id|wx_sub|operating_cities/i.test(String(e.message || ''))) throw e
      rows = await query(
        `SELECT g.id, g.name, g.price, g.points_grant AS pointsGrant, g.category, NULL AS categoryId,
                g.image_url AS coverImage, g.image_url AS imageUrl, g.sku_code AS sku, g.stock,
                m.id AS merchantId, m.name AS shopName, m.city, m.address, m.role,
                m.cover_url AS shopCover, m.cover_hue AS coverHue, m.materials_json AS materialsJson
         FROM stall_goods g
         JOIN merchants m ON m.id=g.merchant_id
         WHERE g.deleted_at IS NULL AND IFNULL(g.on_sale,0)=1
           AND m.status=1 AND m.deleted_at IS NULL AND m.role='stall'
           AND ${homeSql}
           AND g.category=:cname
         ORDER BY g.id DESC LIMIT ${limit}`,
        { cname: cat.name }
      )
    }
  } else if (role === 'cross') {
    try {
      rows = await query(
        `SELECT g.id, g.name, g.points_need AS pointsNeed, g.cash_price AS cashPrice, g.price,
                g.category, g.category_id AS categoryId,
                g.image_url AS coverImage, g.image_url AS imageUrl, g.sku_code AS sku, g.stock,
                m.id AS merchantId, m.name AS shopName, m.city, m.address, m.role,
                m.cover_url AS shopCover, m.cover_hue AS coverHue, m.materials_json AS materialsJson
         FROM cross_goods g
         JOIN merchants m ON m.id=g.merchant_id
         WHERE g.deleted_at IS NULL AND IFNULL(g.on_sale,0)=1
           AND m.status=1 AND m.deleted_at IS NULL AND m.role='cross'
           AND ${homeSql}
           AND (g.category_id=:cid OR (IFNULL(g.category_id,0)=0 AND g.category=:cname))
         ORDER BY g.id DESC LIMIT ${limit}`,
        { cid: Number(cat.id), cname: cat.name }
      )
    } catch (e) {
      if (!/Unknown column/i.test(String(e.message || ''))) throw e
      rows = await query(
        `SELECT g.id, g.name, g.points_need AS pointsNeed, g.cash_price AS cashPrice,
                g.category, NULL AS categoryId,
                g.image_url AS coverImage, g.image_url AS imageUrl, g.sku_code AS sku,
                m.id AS merchantId, m.name AS shopName, m.city, m.address, m.role,
                m.cover_url AS shopCover, m.cover_hue AS coverHue, m.materials_json AS materialsJson
         FROM cross_goods g
         JOIN merchants m ON m.id=g.merchant_id
         WHERE g.deleted_at IS NULL AND IFNULL(g.on_sale,0)=1
           AND m.status=1 AND m.deleted_at IS NULL AND m.role='cross'
           AND ${homeSql}
           AND g.category=:cname
         ORDER BY g.id DESC LIMIT ${limit}`,
        { cname: cat.name }
      )
    }
  } else {
    try {
      rows = await query(
        `SELECT g.id, g.name, g.price, g.points_grant AS pointsGrant, g.category, g.category_id AS categoryId,
                g.image_url AS coverImage, g.image_url AS imageUrl, g.sku_code AS sku, g.stock,
                m.id AS merchantId, m.name AS shopName, m.city, m.address, m.role,
                m.cover_url AS shopCover, m.cover_hue AS coverHue, m.materials_json AS materialsJson
         FROM supply_goods g
         JOIN merchants m ON m.id=g.merchant_id
         WHERE g.deleted_at IS NULL AND IFNULL(g.status,0)=1
           AND m.status=1 AND m.deleted_at IS NULL AND m.role='supply'
           AND ${homeSql}
           AND (g.category_id=:cid OR (IFNULL(g.category_id,0)=0 AND g.category=:cname))
         ORDER BY g.id DESC LIMIT ${limit}`,
        { cid: Number(cat.id), cname: cat.name }
      )
    } catch (e) {
      if (!/Unknown column/i.test(String(e.message || ''))) throw e
      rows = await query(
        `SELECT g.id, g.name, g.price, g.points_grant AS pointsGrant, g.category, NULL AS categoryId,
                g.image_url AS coverImage, g.image_url AS imageUrl, g.sku_code AS sku, g.stock,
                m.id AS merchantId, m.name AS shopName, m.city, m.address, m.role,
                m.cover_url AS shopCover, m.cover_hue AS coverHue, m.materials_json AS materialsJson
         FROM supply_goods g
         JOIN merchants m ON m.id=g.merchant_id
         WHERE g.deleted_at IS NULL AND IFNULL(g.status,0)=1
           AND m.status=1 AND m.deleted_at IS NULL AND m.role='supply'
           AND ${homeSql}
           AND g.category=:cname
         ORDER BY g.id DESC LIMIT ${limit}`,
        { cname: cat.name }
      )
    }
  }

  const list = rows.map((r) => {
    const enriched = enrichCoverRow({
      ...r,
      coverImage: r.coverImage || r.shopCover,
      materialsJson: r.materialsJson
    })
    const price =
      r.price != null
        ? Number(r.price)
        : r.cashPrice != null
          ? Number(r.cashPrice)
          : null
    return {
      id: Number(r.id),
      name: r.name,
      price,
      cashPrice: r.cashPrice != null ? Number(r.cashPrice) : null,
      pointsNeed: r.pointsNeed != null ? Number(r.pointsNeed) : null,
      pointsGrant: r.pointsGrant != null ? Number(r.pointsGrant) : null,
      category: r.category || cat.name,
      categoryId: r.categoryId != null ? Number(r.categoryId) : Number(cat.id),
      coverImage: enriched.coverImage || r.coverImage || '',
      imageUrl: enriched.coverImage || r.imageUrl || '',
      sku: r.sku || '',
      stock: r.stock,
      merchantId: Number(r.merchantId),
      shopName: r.shopName,
      city: r.city,
      address: r.address,
      role,
      roleLabel: ROLE_ACTION[role] || ROLE_LABEL[role] || role
    }
  })

  return {
    category: cat,
    list,
    total: list.length
  }
}

async function saveCategory(body) {
  const role = normalizeRole(body.role)
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写类目名称')
  const sortOrder = Number(body.sortOrder != null ? body.sortOrder : body.sort_order) || 0
  const status = body.status === 0 ? 0 : 1
  const imageUrl = String(body.imageUrl || body.image_url || '').trim() || null

  if (body.id) {
    const id = Number(body.id)
    const rows = await query('SELECT id FROM goods_categories WHERE id=:id', { id })
    if (!rows.length) throw new HttpError(404, '类目不存在')
    const dup = await query(
      'SELECT id FROM goods_categories WHERE role=:role AND name=:name AND id<>:id LIMIT 1',
      { role, name, id }
    )
    if (dup.length) throw new HttpError(400, '该类目名称已存在')
    try {
      await query(
        `UPDATE goods_categories SET role=:role, name=:name, image_url=:imageUrl,
         sort_order=:sortOrder, status=:status WHERE id=:id`,
        { id, role, name, imageUrl, sortOrder, status }
      )
    } catch (e) {
      if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
      await query(
        `UPDATE goods_categories SET role=:role, name=:name, sort_order=:sortOrder, status=:status
         WHERE id=:id`,
        { id, role, name, sortOrder, status }
      )
    }
    return { id }
  }

  const exists = await query(
    'SELECT id FROM goods_categories WHERE role=:role AND name=:name LIMIT 1',
    { role, name }
  )
  if (exists.length) throw new HttpError(400, '该类目名称已存在')
  let r
  try {
    r = await query(
      `INSERT INTO goods_categories (role, name, image_url, sort_order, status)
       VALUES (:role, :name, :imageUrl, :sortOrder, :status)`,
      { role, name, imageUrl, sortOrder, status }
    )
  } catch (e) {
    if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
    r = await query(
      `INSERT INTO goods_categories (role, name, sort_order, status)
       VALUES (:role, :name, :sortOrder, :status)`,
      { role, name, sortOrder, status }
    )
  }
  return { id: r.insertId }
}

async function deleteCategory(id) {
  const rows = await query('SELECT id FROM goods_categories WHERE id=:id', { id })
  if (!rows.length) throw new HttpError(404, '类目不存在')
  await query('DELETE FROM goods_categories WHERE id=:id', { id })
  return { id: Number(id) }
}

async function setCategoryStatus(id, status) {
  const sid = Number(id)
  if (!sid) throw new HttpError(400, '缺少类目 ID')
  const on = Number(status) === 1 ? 1 : 0
  const rows = await query('SELECT id FROM goods_categories WHERE id=:id', { id: sid })
  if (!rows.length) throw new HttpError(404, '类目不存在')
  await query('UPDATE goods_categories SET status=:s WHERE id=:id', { id: sid, s: on })
  return { id: sid, status: on }
}

module.exports = {
  ROLE_LABEL,
  listCategories,
  listPublicCategories,
  listMerchantsByCategory,
  listGoodsByCategory,
  resolveActiveCategory,
  goodsMatchesCategory,
  getCategoryById,
  saveCategory,
  deleteCategory,
  setCategoryStatus
}

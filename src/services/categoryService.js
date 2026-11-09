const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { applyGeo } = require('../utils/geo')
const { enrichCoverRow } = require('../utils/mediaPick')

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

/** 类目名与门店经营类目宽松匹配（支持「门店餐饮」对「餐饮」） */
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

const PAY_READY_SQL = `NULLIF(TRIM(IFNULL(m.wx_sub_mch_id,'')), '') IS NOT NULL
       AND (m.wx_apply_state IS NULL OR m.wx_apply_state='' OR m.wx_apply_state='FINISH')`

async function listMerchantsByCategory(categoryId, opts = {}) {
  const cat = await getCategoryById(categoryId)
  if (Number(cat.status) === 0) throw new HttpError(404, '类目已停用')
  const role = cat.role
  let rows
  try {
    rows = await query(
      `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude, m.role, m.status,
              m.cover_hue AS coverHue, m.cover_url AS coverImage, m.materials_json AS materialsJson,
              LEFT(m.name,1) AS initial,
              CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
              IFNULL(NULLIF(m.biz_type,''), '') AS bizType,
              IFNULL(NULLIF(m.biz_type,''), '') AS category,
              IFNULL(NULLIF(m.biz_type,''), '') AS tag
       FROM merchants m
       WHERE m.role=:role AND m.status=1 AND m.deleted_at IS NULL
         AND ${PAY_READY_SQL}
       ORDER BY m.id DESC`,
      { role }
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column.*wx_sub_mch/i.test(String(e.message || ''))))) {
      throw e
    }
    rows = await query(
      `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude, m.role, m.status,
              m.cover_hue AS coverHue, m.cover_url AS coverImage, m.materials_json AS materialsJson,
              LEFT(m.name,1) AS initial,
              CASE WHEN m.status=1 THEN 1 ELSE 0 END AS open,
              IFNULL(NULLIF(m.biz_type,''), '') AS bizType,
              IFNULL(NULLIF(m.biz_type,''), '') AS category,
              IFNULL(NULLIF(m.biz_type,''), '') AS tag
       FROM merchants m
       WHERE m.role=:role AND m.status=1 AND m.deleted_at IS NULL
       ORDER BY m.id DESC`,
      { role }
    )
  }
  const matched = rows.filter((m) => merchantMatchesCategory(m, cat)).map((m) => {
    const enriched = enrichCoverRow(m)
    return {
      ...enriched,
      role,
      roleLabel: ROLE_ACTION[role] || ROLE_LABEL[role] || role,
      categoryName: cat.name
    }
  })
  return {
    category: cat,
    list: applyGeo(matched, opts)
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
  getCategoryById,
  saveCategory,
  deleteCategory,
  setCategoryStatus
}

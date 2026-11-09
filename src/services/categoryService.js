const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')

const ROLE_LABEL = {
  stall: '地摊',
  cross: '异业门店',
  supply: '供应链'
}

/** 每个关联角色最多启用类目数 */
const MAX_ACTIVE_PER_ROLE = 2

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

/** C 端：启用类目，按 sort_order */
async function listPublicCategories(role) {
  const r = role ? normalizeRole(role) : 'cross'
  return listCategories(r, { activeOnly: true })
}

async function countActive(role, excludeId) {
  const params = { role }
  let sql = 'SELECT COUNT(*) AS c FROM goods_categories WHERE role=:role AND status=1'
  if (excludeId) {
    sql += ' AND id<>:id'
    params.id = Number(excludeId)
  }
  const rows = await query(sql, params)
  return Number(rows[0]?.c) || 0
}

async function saveCategory(body) {
  const role = normalizeRole(body.role)
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写类目名称')
  const sortOrder = Number(body.sortOrder != null ? body.sortOrder : body.sort_order) || 0
  const status = body.status === 0 ? 0 : 1
  const imageUrl = String(body.imageUrl || body.image_url || '').trim() || null

  if (status === 1) {
    const active = await countActive(role, body.id ? Number(body.id) : 0)
    if (active >= MAX_ACTIVE_PER_ROLE) {
      throw new HttpError(400, `每个角色最多启用 ${MAX_ACTIVE_PER_ROLE} 个类目名称，请先停用其它类目`)
    }
  }

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
  const rows = await query('SELECT id, role FROM goods_categories WHERE id=:id', { id: sid })
  if (!rows.length) throw new HttpError(404, '类目不存在')
  if (on === 1) {
    const active = await countActive(rows[0].role, sid)
    if (active >= MAX_ACTIVE_PER_ROLE) {
      throw new HttpError(400, `每个角色最多启用 ${MAX_ACTIVE_PER_ROLE} 个类目名称，请先停用其它类目`)
    }
  }
  await query('UPDATE goods_categories SET status=:s WHERE id=:id', { id: sid, s: on })
  return { id: sid, status: on }
}

module.exports = {
  ROLE_LABEL,
  MAX_ACTIVE_PER_ROLE,
  listCategories,
  listPublicCategories,
  saveCategory,
  deleteCategory,
  setCategoryStatus
}

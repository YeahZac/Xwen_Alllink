const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')

const ROLE_LABEL = {
  stall: '地摊',
  cross: '异业门店',
  supply: '供应链'
}

function normalizeRole(role) {
  const r = String(role || '').trim()
  if (!ROLE_LABEL[r]) throw new HttpError(400, '类目须关联地摊、异业门店或供应链')
  return r
}

async function listCategories(role) {
  const params = {}
  let where = 'WHERE 1=1'
  if (role) {
    where += ' AND role=:role'
    params.role = normalizeRole(role)
  }
  const rows = await query(
    `SELECT id, role, name, sort_order AS sortOrder, status,
            created_at AS createdAt, updated_at AS updatedAt
     FROM goods_categories ${where}
     ORDER BY FIELD(role,'stall','cross','supply'), sort_order, id`,
    params
  )
  return rows.map((r) => ({
    ...r,
    roleLabel: ROLE_LABEL[r.role] || r.role
  }))
}

async function saveCategory(body) {
  const role = normalizeRole(body.role)
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写类目名称')
  const sortOrder = Number(body.sortOrder != null ? body.sortOrder : body.sort_order) || 0
  const status = body.status === 0 ? 0 : 1

  if (body.id) {
    const id = Number(body.id)
    const rows = await query('SELECT id FROM goods_categories WHERE id=:id', { id })
    if (!rows.length) throw new HttpError(404, '类目不存在')
    const dup = await query(
      'SELECT id FROM goods_categories WHERE role=:role AND name=:name AND id<>:id LIMIT 1',
      { role, name, id }
    )
    if (dup.length) throw new HttpError(400, '该类目名称已存在')
    await query(
      `UPDATE goods_categories SET role=:role, name=:name, sort_order=:sortOrder, status=:status
       WHERE id=:id`,
      { id, role, name, sortOrder, status }
    )
    return { id }
  }

  const exists = await query(
    'SELECT id FROM goods_categories WHERE role=:role AND name=:name LIMIT 1',
    { role, name }
  )
  if (exists.length) throw new HttpError(400, '该类目名称已存在')
  const r = await query(
    `INSERT INTO goods_categories (role, name, sort_order, status)
     VALUES (:role, :name, :sortOrder, :status)`,
    { role, name, sortOrder, status }
  )
  return { id: r.insertId }
}

async function deleteCategory(id) {
  const rows = await query('SELECT id FROM goods_categories WHERE id=:id', { id })
  if (!rows.length) throw new HttpError(404, '类目不存在')
  await query('DELETE FROM goods_categories WHERE id=:id', { id })
  return { id: Number(id) }
}

module.exports = {
  ROLE_LABEL,
  listCategories,
  saveCategory,
  deleteCategory
}

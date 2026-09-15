/**
 * 经营城市开通（BRD §2.5、§4.1、§9 已确认 #7）
 * 商户必须归属已开通城市才能入驻成交。
 */
const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')

async function listOpenCities() {
  return query(
    `SELECT id, name, province, opened_at AS openedAt
     FROM operating_cities WHERE status = 1 ORDER BY name`
  )
}

async function listCities() {
  return query(
    `SELECT c.id, c.name, c.province, c.status, c.opened_at AS openedAt, c.remark,
            (SELECT COUNT(*) FROM merchants m
              WHERE m.city = c.name AND m.deleted_at IS NULL) AS merchantCount,
            (SELECT COUNT(*) FROM merchants m
              WHERE m.city = c.name AND m.deleted_at IS NULL
                AND m.latitude IS NOT NULL) AS geoCount
     FROM operating_cities c
     ORDER BY c.status DESC, c.name`
  )
}

/** 入驻/开店前置校验 */
async function ensureOpen(cityName) {
  const name = String(cityName || '').trim()
  if (!name) throw new HttpError(400, '请填写经营城市')
  const rows = await query(
    'SELECT id, status FROM operating_cities WHERE name = :name LIMIT 1',
    { name }
  )
  if (!rows.length || !Number(rows[0].status)) {
    throw new HttpError(400, `经营城市「${name}」尚未开通，请联系平台运营开城后再提交`)
  }
  return true
}

async function saveCity(body = {}) {
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写城市名')
  const status = body.status === 0 || body.status === '0' ? 0 : 1
  await query(
    `INSERT INTO operating_cities (name, province, status, opened_at, remark)
     VALUES (:name, :province, :status, IF(:status = 1, NOW(), NULL), :remark)
     ON DUPLICATE KEY UPDATE
       province = VALUES(province),
       status = VALUES(status),
       opened_at = IF(VALUES(status) = 1, IFNULL(opened_at, NOW()), opened_at),
       remark = VALUES(remark)`,
    {
      name,
      province: body.province || null,
      status,
      remark: body.remark || null
    }
  )
  return { name, status }
}

/** 关城前提示影响面，避免误操作把在营商户挂空 */
async function closeCity(id) {
  const rows = await query('SELECT name FROM operating_cities WHERE id = :id', { id })
  if (!rows.length) throw new HttpError(404, '城市不存在')
  const cnt = await query(
    `SELECT COUNT(*) AS n FROM merchants
     WHERE city = :name AND status = 1 AND deleted_at IS NULL`,
    { name: rows[0].name }
  )
  await query('UPDATE operating_cities SET status = 0 WHERE id = :id', { id })
  return { id, status: 0, activeMerchants: Number(cnt[0].n) || 0 }
}

module.exports = { listOpenCities, listCities, ensureOpen, saveCity, closeCity }

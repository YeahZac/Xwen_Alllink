const { query } = require('../utils/db')

const APPLY_TYPES = new Set(['merchant', 'partner', 'platform_role'])

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS apply_review_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      apply_type VARCHAR(32) NOT NULL,
      apply_id BIGINT UNSIGNED NOT NULL,
      from_status VARCHAR(32) DEFAULT NULL,
      to_status VARCHAR(32) NOT NULL,
      reason VARCHAR(512) DEFAULT NULL,
      reviewer_id BIGINT UNSIGNED DEFAULT NULL,
      reviewer_name VARCHAR(64) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_apply_type_id (apply_type, apply_id),
      KEY idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
}

let tableReady = false
async function ready() {
  if (tableReady) return
  try {
    await ensureTable()
    tableReady = true
  } catch (e) {
    console.warn('[apply-review-log] ensure', e.message)
  }
}

async function writeLog({
  applyType,
  applyId,
  fromStatus,
  toStatus,
  reason,
  reviewerId,
  reviewerName
} = {}) {
  if (!APPLY_TYPES.has(applyType) || !applyId || !toStatus) return null
  await ready()
  try {
    const r = await query(
      `INSERT INTO apply_review_logs
        (apply_type, apply_id, from_status, to_status, reason, reviewer_id, reviewer_name)
       VALUES (:applyType, :applyId, :fromStatus, :toStatus, :reason, :reviewerId, :reviewerName)`,
      {
        applyType,
        applyId: Number(applyId),
        fromStatus: fromStatus || null,
        toStatus,
        reason: String(reason || '').trim().slice(0, 512) || null,
        reviewerId: reviewerId || null,
        reviewerName: String(reviewerName || '').trim().slice(0, 64) || null
      }
    )
    return r && r.insertId ? r.insertId : null
  } catch (e) {
    console.warn('[apply-review-log] write', e.message)
    return null
  }
}

async function listLogs(applyType, applyId, { limit = 50 } = {}) {
  if (!APPLY_TYPES.has(applyType) || !applyId) return []
  await ready()
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100)
  try {
    const rows = await query(
      `SELECT id, apply_type AS applyType, apply_id AS applyId,
              from_status AS fromStatus, to_status AS toStatus,
              reason, reviewer_id AS reviewerId, reviewer_name AS reviewerName,
              created_at AS createdAt
       FROM apply_review_logs
       WHERE apply_type=:applyType AND apply_id=:applyId
       ORDER BY id DESC
       LIMIT ${lim}`,
      { applyType, applyId: Number(applyId) }
    )
    const actionMap = {
      pending: '待审',
      approved: '通过',
      rejected: '驳回'
    }
    return (rows || []).map((r) => ({
      ...r,
      fromLabel: actionMap[r.fromStatus] || r.fromStatus || '—',
      toLabel: actionMap[r.toStatus] || r.toStatus || '—',
      actionText:
        r.toStatus === 'approved'
          ? '审核通过'
          : r.toStatus === 'rejected'
            ? '审核驳回'
            : `状态→${actionMap[r.toStatus] || r.toStatus}`
    }))
  } catch (e) {
    if (/doesn't exist|apply_review_logs/i.test(String(e.message || ''))) return []
    throw e
  }
}

async function listLogsBatch(applyType, ids = []) {
  const list = (ids || []).map(Number).filter((n) => n > 0)
  if (!APPLY_TYPES.has(applyType) || !list.length) return {}
  await ready()
  try {
    const rows = await query(
      `SELECT id, apply_type AS applyType, apply_id AS applyId,
              from_status AS fromStatus, to_status AS toStatus,
              reason, reviewer_id AS reviewerId, reviewer_name AS reviewerName,
              created_at AS createdAt
       FROM apply_review_logs
       WHERE apply_type=:applyType AND apply_id IN (${list.join(',')})
       ORDER BY id DESC`,
      { applyType }
    )
    const map = {}
    for (const r of rows || []) {
      const key = String(r.applyId)
      if (!map[key]) map[key] = []
      if (map[key].length >= 20) continue
      map[key].push({
        ...r,
        actionText:
          r.toStatus === 'approved'
            ? '审核通过'
            : r.toStatus === 'rejected'
              ? '审核驳回'
              : `状态→${r.toStatus}`
      })
    }
    return map
  } catch (e) {
    if (/doesn't exist|apply_review_logs/i.test(String(e.message || ''))) return {}
    throw e
  }
}

module.exports = {
  writeLog,
  listLogs,
  listLogsBatch,
  ensureTable
}

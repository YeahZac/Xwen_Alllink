const { query } = require('../utils/db')

async function getConfig(key, fallback = null) {
  const rows = await query(
    'SELECT config_value FROM platform_config WHERE config_key = :key LIMIT 1',
    { key }
  )
  if (!rows.length) return fallback
  return rows[0].config_value
}

async function getCashRate() {
  const v = await getConfig('points_cash_rate', '0.01')
  return Number(v) || 0.01
}

function pointsToCash(points, rate) {
  return Math.round(Number(points) * Number(rate) * 10000) / 10000
}

async function listConfigs() {
  return query(
    `SELECT id, config_key AS \`key\`, config_value AS value, remark, updated_at AS updatedAt
     FROM platform_config ORDER BY id`
  )
}

async function setConfig(key, value, remark) {
  const rows = await query('SELECT id FROM platform_config WHERE config_key=:key', { key })
  if (rows.length) {
    await query(
      `UPDATE platform_config SET config_value=:v, remark=IFNULL(:r, remark) WHERE config_key=:key`,
      { key, v: String(value), r: remark || null }
    )
  } else {
    await query(
      `INSERT INTO platform_config (config_key, config_value, remark) VALUES (:key, :v, :r)`,
      { key, v: String(value), r: remark || null }
    )
  }
  return { key, value: String(value) }
}

module.exports = { getConfig, getCashRate, pointsToCash, listConfigs, setConfig }

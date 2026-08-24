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

module.exports = { getConfig, getCashRate, pointsToCash }

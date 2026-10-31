/**
 * 列表数据本地缓存（stale-while-revalidate）
 * - fresh：直接用缓存，可后台静默刷新
 * - stale：先展示缓存，同时拉新
 */
const PREFIX = 'wy_dc_'

const TTL = {
  homeLists: 3 * 60 * 1000,
  crossStores: 3 * 60 * 1000,
  supplyMerchants: 5 * 60 * 1000,
  points: 60 * 1000
}

function read(key) {
  try {
    const row = wx.getStorageSync(PREFIX + key)
    if (!row || typeof row !== 'object' || row.d === undefined) return null
    const age = Date.now() - Number(row.t || 0)
    const ttl = Number(row.ttl) || TTL.homeLists
    return {
      data: row.d,
      age,
      ttl,
      fresh: age >= 0 && age < ttl,
      stale: age >= ttl
    }
  } catch (_) {
    return null
  }
}

function write(key, data, ttlMs) {
  try {
    wx.setStorageSync(PREFIX + key, {
      d: data,
      t: Date.now(),
      ttl: ttlMs != null ? ttlMs : TTL.homeLists
    })
  } catch (_) {}
  return data
}

function remove(key) {
  try {
    wx.removeStorageSync(PREFIX + key)
  } catch (_) {}
}

function homeKey(q) {
  const lat = q && q.lat != null ? Number(q.lat).toFixed(2) : ''
  const lng = q && q.lng != null ? Number(q.lng).toFixed(2) : ''
  const city = (q && q.city) || ''
  return `home:${city}:${lat},${lng}`
}

module.exports = {
  TTL,
  read,
  write,
  remove,
  homeKey
}

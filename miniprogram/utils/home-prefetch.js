/**
 * 首页列表启动预取：用默认沙井坐标尽早拉门店，进入首页时尽量已有数据。
 */
const location = require('./location')
const dataCache = require('./data-cache')

let prefetchPromise = null
let lastPayload = null
let lastQueryKey = ''

function queryKey(q) {
  return dataCache.homeKey(q || {})
}

async function fetchHomeLists(q) {
  const api = require('./api')
  const [stalls, crossStores, supplyMerchants] = await Promise.all([
    api.stalls(q),
    api.crossStores(q),
    api.supplyMerchants(q).catch(() => [])
  ])
  return {
    stalls: stalls || [],
    crossStores: crossStores || [],
    supplyMerchants: supplyMerchants || [],
    points: 0,
    cashValue: 0
  }
}

/**
 * App.onLaunch 调用：预热 + 按默认定位拉首页三列表
 */
function start(warmPromise) {
  location.ensureDefaultLoc()
  const q = location.queryFromSaved()
  lastQueryKey = queryKey(q)

  prefetchPromise = (async () => {
    try {
      if (warmPromise && typeof warmPromise.then === 'function') {
        await Promise.race([
          warmPromise.catch(() => null),
          new Promise((resolve) => setTimeout(resolve, 2800))
        ])
      }
      const payload = await fetchHomeLists(q)
      dataCache.write(lastQueryKey, payload, dataCache.TTL.homeLists)
      lastPayload = payload
      try {
        const app = getApp()
        if (app && app.globalData) {
          app.globalData.homePrefetch = payload
          app.globalData.homePrefetchKey = lastQueryKey
        }
      } catch (_) {}
      return payload
    } catch (e) {
      console.warn('[home-prefetch]', (e && e.message) || e)
      return null
    }
  })()

  return prefetchPromise
}

function getPayload() {
  if (lastPayload) return lastPayload
  try {
    const app = getApp()
    if (app && app.globalData && app.globalData.homePrefetch) {
      return app.globalData.homePrefetch
    }
  } catch (_) {}
  const q = location.queryFromSaved()
  const cached = dataCache.read(queryKey(q))
  return cached && cached.data ? cached.data : null
}

function ready() {
  return prefetchPromise || Promise.resolve(getPayload())
}

/** 首页可等到预取完成（有上限），避免空白闪一下 */
function waitForData(maxMs = 3200) {
  const existing = getPayload()
  if (existing && ((existing.stalls && existing.stalls.length) || (existing.crossStores && existing.crossStores.length))) {
    return Promise.resolve(existing)
  }
  return Promise.race([
    ready(),
    new Promise((resolve) => setTimeout(() => resolve(getPayload()), maxMs))
  ])
}

module.exports = {
  start,
  ready,
  waitForData,
  getPayload,
  fetchHomeLists
}

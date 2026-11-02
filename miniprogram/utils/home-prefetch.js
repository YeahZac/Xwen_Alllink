/**
 * 首页启动预取三策略：
 * 1) 网络预加载：App.onLaunch 用默认沙井坐标立刻拉列表（不等 GPS、不等 health）
 * 2) 缓存：写入 data-cache，进入首页先同步灌入
 * 3) 实时：首页 onShow / 定位成功后再按真实坐标刷新
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

function publish(payload, key) {
  lastPayload = payload
  lastQueryKey = key
  try {
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.homePrefetch = payload
      app.globalData.homePrefetchKey = key
    }
  } catch (_) {}
  return payload
}

/**
 * App.onLaunch：默认沙井立刻预拉；warmPromise 仅并行预热，不阻塞首包列表
 */
function start(warmPromise) {
  location.ensureDefaultLoc()
  const q = location.queryFromSaved()
  const key = queryKey(q)

  // 先把磁盘缓存挂到内存，首页 onLoad 可同步渲染
  const cached = dataCache.read(key)
  if (cached && cached.data) {
    publish(cached.data, key)
  }

  // 云托管预热并行，不 await
  if (warmPromise && typeof warmPromise.then === 'function') {
    warmPromise.catch(() => null)
  }

  prefetchPromise = (async () => {
    try {
      const payload = await fetchHomeLists(q)
      dataCache.write(key, payload, dataCache.TTL.homeLists)
      return publish(payload, key)
    } catch (e) {
      console.warn('[home-prefetch]', (e && e.message) || e)
      return getPayload()
    }
  })()

  return prefetchPromise
}

/** 按新坐标重新预取（定位成功后调用）；不打断当前页已有渲染 */
function refreshWithQuery(q) {
  location.ensureDefaultLoc()
  const query = q || location.queryFromSaved()
  const key = queryKey(query)
  prefetchPromise = (async () => {
    try {
      const payload = await fetchHomeLists(query)
      dataCache.write(key, payload, dataCache.TTL.homeLists)
      return publish(payload, key)
    } catch (e) {
      console.warn('[home-prefetch:refresh]', (e && e.message) || e)
      return getPayload()
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
  location.ensureDefaultLoc()
  const cached = dataCache.read(queryKey(location.queryFromSaved()))
  return cached && cached.data ? cached.data : null
}

function ready() {
  return prefetchPromise || Promise.resolve(getPayload())
}

/** 有上限地等待预取；调用方不应阻塞首屏渲染 */
function waitForData(maxMs = 2500) {
  const existing = getPayload()
  if (
    existing &&
    ((existing.stalls && existing.stalls.length) ||
      (existing.crossStores && existing.crossStores.length))
  ) {
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
  fetchHomeLists,
  refreshWithQuery
}

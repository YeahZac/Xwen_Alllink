/**
 * 定位与列表刷新规则（用户体验优先，最终以真实位置为准）
 *
 * 1) 首屏立刻展示
 *    - 有上次真实定位（gps）→ 用它出城市名 + 拉附近店（即使略过期）
 *    - 否则临时用宝安默认占位（source=default，仅过渡，不当长期真相）
 *
 * 2) 顶部「正在获取定位」
 *    - 仅在「没有可用真实定位」或「手动刷新」时亮起
 *    - 最长 UI_LOCATING_MS（约 1.6s），超时立刻恢复城市名，不拖顶部
 *    - 有 30 分钟内可用缓存时：顶部不转圈，后台静默校正
 *
 * 3) 真实定位获取（微信能力）
 *    - 先 wx.getSetting 看 scope.userLocation（已授权则 getLocation 更快、无弹窗）
 *    - 调用 wx.getLocation(type=gcj02)；手动刷新可开高精度
 *    - 与 getFuzzyLocation 互斥，本项目已申明 getLocation，继续用精确定位（距离排序需要）
 *    - 前台最多等 GPS_WAIT_MS；超时后 Promise 仍在后台跑完
 *
 * 4) 列表何时按新坐标重拉
 *    - default → 真实定位：必须重拉
 *    - 相对「当前列表所用原点」位移 ≥ RELOAD_MOVE_KM：重拉
 *    - 真实定位仍新鲜（≤ FRESH_MS）且位移小：不重拉
 *    - 用户点顶部定位：强制 GPS + 强制重拉列表
 *
 * 5) 拒绝授权
 *    - 保留上次真实点或默认占位；手动定位时再尝试 / 引导设置
 */

const KEY = 'wy_loc'
const ORIGIN_KEY = 'wy_list_origin'

/** 真实 GPS 视为「很新」，可跳过本次定位 */
const FRESH_MS = 10 * 60 * 1000
/** 真实 GPS 视为「仍可用」：先出数，后台静默校正 */
const USABLE_MS = 30 * 60 * 1000
/** 顶部「正在获取定位」最长展示 */
const UI_LOCATING_MS = 1600
/** 前台最多等待微信定位返回；超时后后台继续 */
const GPS_WAIT_MS = 2800
/** 位移超过该距离才因定位变化重拉列表 */
const RELOAD_MOVE_KM = 0.8

/** 默认：深圳市宝安区沙井街道（首屏有数，不等 GPS） */
const DEFAULT_LOC = {
  city: '深圳·宝安',
  displayCity: '深圳市宝安区沙井街道',
  street: '沙井街道',
  lat: 22.73585,
  lng: 113.8068,
  source: 'default',
  inService: true
}

/** 区级中心点（GCJ-02），用于顶栏展示「市+区」，绝不回退成经纬度 */
const DISTRICTS = [
  // 深圳
  { city: '深圳·南山', label: '深圳市南山区', lat: 22.53, lng: 113.94 },
  { city: '深圳·福田', label: '深圳市福田区', lat: 22.54, lng: 114.055 },
  { city: '深圳·罗湖', label: '深圳市罗湖区', lat: 22.548, lng: 114.118 },
  { city: '深圳·宝安', label: '深圳市宝安区', lat: 22.555, lng: 113.89 },
  { city: '深圳·沙井', label: '深圳市宝安区沙井街道', lat: 22.73585, lng: 113.8068 },
  { city: '深圳·龙华', label: '深圳市龙华区', lat: 22.65, lng: 114.03 },
  { city: '深圳·龙岗', label: '深圳市龙岗区', lat: 22.72, lng: 114.25 },
  { city: '深圳·盐田', label: '深圳市盐田区', lat: 22.557, lng: 114.237 },
  { city: '深圳·光明', label: '深圳市光明区', lat: 22.748, lng: 113.945 },
  { city: '深圳·坪山', label: '深圳市坪山区', lat: 22.69, lng: 114.346 },
  // 广州（模拟器/真机常落在此）
  { city: '广州·天河', label: '广州市天河区', lat: 23.125, lng: 113.361 },
  { city: '广州·越秀', label: '广州市越秀区', lat: 23.129, lng: 113.267 },
  { city: '广州·海珠', label: '广州市海珠区', lat: 23.084, lng: 113.317 },
  { city: '广州·荔湾', label: '广州市荔湾区', lat: 23.126, lng: 113.244 },
  { city: '广州·白云', label: '广州市白云区', lat: 23.158, lng: 113.273 },
  { city: '广州·黄埔', label: '广州市黄埔区', lat: 23.106, lng: 113.459 },
  { city: '广州·番禺', label: '广州市番禺区', lat: 22.938, lng: 113.384 },
  { city: '广州·花都', label: '广州市花都区', lat: 23.404, lng: 113.22 },
  { city: '广州·南沙', label: '广州市南沙区', lat: 22.802, lng: 113.525 },
  { city: '广州·增城', label: '广州市增城区', lat: 23.291, lng: 113.811 },
  { city: '广州·从化', label: '广州市从化区', lat: 23.549, lng: 113.587 },
  // 东莞 / 佛山 / 珠海 / 惠州 / 中山（邻近常出现）
  { city: '东莞·莞城', label: '东莞市莞城区', lat: 23.043, lng: 113.763 },
  { city: '东莞·南城', label: '东莞市南城区', lat: 23.02, lng: 113.752 },
  { city: '佛山·禅城', label: '佛山市禅城区', lat: 23.01, lng: 113.122 },
  { city: '佛山·南海', label: '佛山市南海区', lat: 23.029, lng: 113.143 },
  { city: '佛山·顺德', label: '佛山市顺德区', lat: 22.805, lng: 113.293 },
  { city: '珠海·香洲', label: '珠海市香洲区', lat: 22.272, lng: 113.577 },
  { city: '惠州·惠城', label: '惠州市惠城区', lat: 23.112, lng: 114.416 },
  { city: '中山·石岐', label: '中山市石岐区', lat: 22.517, lng: 113.392 }
]

const SZ_DISTRICTS = DISTRICTS.filter((d) => String(d.city).indexOf('深圳') === 0)

function haversineKm(lat1, lng1, lat2, lng2) {
  const a1 = Number(lat1)
  const n1 = Number(lng1)
  const a2 = Number(lat2)
  const n2 = Number(lng2)
  if (![a1, n1, a2, n2].every((v) => Number.isFinite(v))) return null
  const toRad = (d) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(a2 - a1)
  const dLng = toRad(n2 - n1)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) ** 2
  return R * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)))
}

function formatDistance(km) {
  if (km == null || Number.isNaN(Number(km))) return ''
  const n = Number(km)
  if (n < 0.05) return '<50m'
  if (n < 1) return `${Math.round(n * 1000)}m`
  if (n < 10) return `${n.toFixed(1)}km`
  return `${Math.round(n)}km`
}

function isDistanceText(v) {
  const s = String(v || '')
  return /\d/.test(s) && /(km|m|公里|米)/i.test(s)
}

function nearestDistrict(lat, lng, list) {
  let best = null
  let bestKm = Number.POSITIVE_INFINITY
  for (const d of list) {
    const km = haversineKm(lat, lng, d.lat, d.lng)
    if (km == null) continue
    if (km < bestKm) {
      bestKm = km
      best = d
    }
  }
  return { district: best, km: Number.isFinite(bestKm) ? bestKm : null }
}

function looksLikeCoords(text) {
  return /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+/.test(String(text || ''))
}

/** 顶栏区级名：永远返回「XX市XX区」，不显示经纬度 */
function reverseLabel(lat, lng) {
  const a = Number(lat)
  const n = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(n)) return DEFAULT_LOC.displayCity
  const { district } = nearestDistrict(a, n, DISTRICTS)
  if (district && district.label) return district.label
  return DEFAULT_LOC.displayCity
}

/** 把「深圳·宝安」等业务城市码规范成区级展示名 */
function toDistrictLabel(raw, lat, lng) {
  const s = String(raw || '').trim()
  if (!s || looksLikeCoords(s)) {
    if (lat != null && lng != null) return reverseLabel(lat, lng)
    return DEFAULT_LOC.displayCity
  }
  if (/市.+[区县市]$/.test(s)) return s
  const hit = DISTRICTS.find((d) => d.city === s || d.label === s || d.label.indexOf(s) >= 0)
  if (hit) return hit.label
  // 深圳·宝安 → 深圳市宝安区
  const m = s.match(/^(.+?)[·•](.+)$/)
  if (m) {
    const city = m[1].replace(/市$/, '')
    let dist = m[2].replace(/[区县]$/, '')
    if (!/区|县|市$/.test(dist)) dist = `${dist}区`
    return `${city}市${dist}`
  }
  if (lat != null && lng != null) return reverseLabel(lat, lng)
  return s
}

/** 顶栏展示用（优先 displayCity，并清洗经纬度脏数据） */
function displayDistrictName(loc) {
  const row = loc || getEffective() || DEFAULT_LOC
  return toDistrictLabel(row.displayCity || row.city, row.lat, row.lng)
}

function matchOpenCity(lat, lng) {
  const { district, km } = nearestDistrict(lat, lng, DISTRICTS)
  if (district && km != null && km <= 55 && String(district.city).indexOf('深圳') === 0) {
    return { city: district.city, label: district.label, inService: true, km }
  }
  if (district && district.label) {
    return {
      city: district.city || '',
      label: district.label,
      inService: false,
      km
    }
  }
  return { city: '', label: reverseLabel(lat, lng), inService: false, km }
}

function getSaved() {
  try {
    return wx.getStorageSync(KEY) || null
  } catch (_) {
    return null
  }
}

function save(loc) {
  const next = loc || null
  try {
    if (next) wx.setStorageSync(KEY, next)
    else wx.removeStorageSync(KEY)
  } catch (_) {}
  return next
}

function ensureDefaultLoc() {
  const s = getSaved()
  // 已有真实 GPS：保留
  if (s && s.source === 'gps' && s.lat != null && s.lng != null) return s
  // 旧默认点 / 无定位：统一落到沙井街道，保证首屏有门店距离基准
  if (!s || s.source === 'default' || s.lat == null || s.lng == null) {
    return save({
      ...DEFAULT_LOC,
      updatedAt: Date.now()
    })
  }
  return s
}

function getEffective() {
  const s = getSaved()
  if (s && s.lat != null && s.lng != null) return s
  return { ...DEFAULT_LOC, updatedAt: 0 }
}

function isRealLoc(loc) {
  return !!(loc && loc.lat != null && loc.lng != null && loc.source && loc.source !== 'default')
}

function ageOf(loc) {
  return Date.now() - Number((loc && loc.updatedAt) || 0)
}

function isFresh(loc, maxAge = FRESH_MS) {
  if (!isRealLoc(loc)) return false
  const age = ageOf(loc)
  return age >= 0 && age < maxAge
}

function isUsable(loc, maxAge = USABLE_MS) {
  if (!isRealLoc(loc)) return false
  const age = ageOf(loc)
  return age >= 0 && age < maxAge
}

function getListOrigin() {
  try {
    return wx.getStorageSync(ORIGIN_KEY) || null
  } catch (_) {
    return null
  }
}

function setListOrigin(loc) {
  if (!loc || loc.lat == null || loc.lng == null) return
  try {
    wx.setStorageSync(ORIGIN_KEY, {
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      source: loc.source || '',
      at: Date.now()
    })
  } catch (_) {}
}

function queryFromSaved() {
  const s = getEffective()
  const q = {}
  if (s.inService && String(s.city || '').indexOf('深圳') === 0) {
    // 深圳全市按距离排
  } else if (s.city) {
    q.city = s.city
  }
  if (s.lat != null && s.lat !== '') q.lat = s.lat
  if (s.lng != null && s.lng !== '') q.lng = s.lng
  return q
}

function getUserLocationAuth() {
  return new Promise((resolve) => {
    if (!wx.getSetting) {
      resolve(undefined)
      return
    }
    wx.getSetting({
      success: (res) => {
        const v = res.authSetting && res.authSetting['scope.userLocation']
        resolve(v)
      },
      fail: () => resolve(undefined)
    })
  })
}

function getGps({ highAccuracy = false } = {}) {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: !!highAccuracy,
      highAccuracyExpireTime: highAccuracy ? 3500 : 1500,
      success: resolve,
      fail: (err) => {
        const msg = String((err && err.errMsg) || '')
        if (/auth deny|authorize|permission|隐私|deny/i.test(msg)) {
          reject(Object.assign(new Error('请允许定位权限，才能展示附近门店'), { code: 'AUTH_DENY' }))
          return
        }
        reject(Object.assign(new Error('定位失败，请打开手机定位后重试'), { code: 'GPS_FAIL' }))
      }
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildLocFromPos(pos, source) {
  const lat = Number(pos.latitude)
  const lng = Number(pos.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw Object.assign(new Error('定位失败，请打开手机定位后重试'), { code: 'GPS_FAIL' })
  }
  const local = matchOpenCity(lat, lng)
  return {
    city: local.inService ? local.city : local.city || '',
    displayCity: toDistrictLabel(local.label, lat, lng),
    lat,
    lng,
    source: source || 'gps',
    inService: local.inService,
    updatedAt: Date.now()
  }
}

function scheduleResolveCity(api, loc) {
  if (!api || typeof api.resolveCity !== 'function' || !loc) return
  const lat = loc.lat
  const lng = loc.lng
  Promise.resolve()
    .then(() => api.resolveCity(lat, lng))
    .then((resolved) => {
      const resolvedCity = String((resolved && (resolved.city || resolved.name)) || '').trim()
      const km = resolved && resolved.distanceKm
      if (!resolvedCity || (km != null && Number(km) > 80)) return
      const hit = DISTRICTS.find((d) => d.city === resolvedCity || d.label === resolvedCity)
      const cur = getSaved() || {}
      if (Number(cur.lat) !== Number(lat) || Number(cur.lng) !== Number(lng)) return
      // 开城校对只更新业务 city；区级展示名仍以本地反解为准（避免变成「深圳」无区）
      const districtLabel = hit
        ? hit.label
        : toDistrictLabel(cur.displayCity || resolvedCity, lat, lng)
      save({
        ...cur,
        city: resolvedCity,
        displayCity: districtLabel,
        inService: true
      })
    })
    .catch(() => {})
}

function decorateList(rows, loc) {
  const saved = loc || getEffective() || {}
  const city = String(saved.city || '').trim()
  const lat = Number(saved.lat)
  const lng = Number(saved.lng)
  const hasOrigin = Number.isFinite(lat) && Number.isFinite(lng)
  let list = Array.isArray(rows) ? rows.slice() : []
  if (city) {
    if (city.indexOf('深圳') === 0) {
      const filtered = list.filter((r) => String(r.city || '').indexOf('深圳') === 0)
      if (filtered.length) list = filtered
    } else {
      const filtered = list.filter((r) => String(r.city || '') === city)
      if (filtered.length) list = filtered
    }
  }
  list = list.map((r) => {
    const km =
      r.distanceKm != null && Number.isFinite(Number(r.distanceKm))
        ? Number(r.distanceKm)
        : hasOrigin
          ? haversineKm(lat, lng, r.latitude, r.longitude)
          : null
    const distance = isDistanceText(r.distance) ? r.distance : formatDistance(km)
    return Object.assign({}, r, { distanceKm: km, distance })
  })
  if (hasOrigin) {
    list.sort((a, b) => {
      const da = a.distanceKm == null ? Number.POSITIVE_INFINITY : a.distanceKm
      const db = b.distanceKm == null ? Number.POSITIVE_INFINITY : b.distanceKm
      return da - db
    })
  }
  return list
}

function movedSignificantly(prev, next, thresholdKm = RELOAD_MOVE_KM) {
  if (!prev || !next) return true
  const km = haversineKm(prev.lat, prev.lng, next.lat, next.lng)
  if (km == null) return true
  return km >= thresholdKm
}

/** 相对「列表已用原点」是否需要重拉 */
function shouldReloadForLoc(next) {
  if (!isRealLoc(next)) return false
  const origin = getListOrigin()
  if (!origin || origin.source === 'default') return true
  return movedSignificantly(origin, next)
}

/**
 * 获取定位。返回：
 * - status: fresh | ok | pending | denied | fail
 * - loc: 当前应展示/可用的位置
 * - pending: status=pending 时，后台定位 Promise
 * - shouldReload: 是否建议立刻重拉列表
 * - showLocatingUi: 是否应短暂展示「正在获取定位」
 */
async function locate(api, { force = false, highAccuracy = false } = {}) {
  const cached = getSaved()
  if (!force && isFresh(cached)) {
    return {
      status: 'fresh',
      loc: cached,
      shouldReload: false,
      showLocatingUi: false
    }
  }

  const usable = !force && isUsable(cached)
  const showLocatingUi = force || !usable
  const auth = await getUserLocationAuth()

  if (auth === false && !force) {
    return {
      status: 'denied',
      loc: getEffective(),
      shouldReload: false,
      showLocatingUi: false,
      message: '请允许定位权限，才能按真实位置展示附近门店'
    }
  }

  const prevReal = isRealLoc(cached) ? cached : null
  const gpsTask = (async () => {
    const pos = await getGps({ highAccuracy: !!highAccuracy || !!force })
    const built = buildLocFromPos(pos, 'gps')
    const saved = save(built)
    scheduleResolveCity(api, saved)
    return saved
  })()

  const waitMs = force ? Math.max(GPS_WAIT_MS, 4500) : GPS_WAIT_MS
  const raced = await Promise.race([
    gpsTask.then((loc) => ({ done: true, loc })),
    sleep(waitMs).then(() => ({ done: false }))
  ])

  if (raced.done) {
    const loc = raced.loc
    const fromDefault = !prevReal
    const moved = fromDefault || movedSignificantly(prevReal, loc) || shouldReloadForLoc(loc)
    return {
      status: 'ok',
      loc,
      shouldReload: !!moved,
      showLocatingUi,
      _moved: !!moved
    }
  }

  // 超时：顶部可先恢复；后台继续，拿到真实点后再校正
  return {
    status: 'pending',
    loc: usable ? cached : getEffective(),
    pending: gpsTask,
    shouldReload: false,
    showLocatingUi,
    fromDefault: !usable
  }
}

/** 后台 pending 完成后，判断是否要刷新列表 */
function finalizePending(prevEffective, realLoc) {
  if (!isRealLoc(realLoc)) {
    return { shouldReload: false, loc: realLoc }
  }
  const base = prevEffective || getListOrigin() || DEFAULT_LOC
  const moved =
    !isRealLoc(base) ||
    base.source === 'default' ||
    movedSignificantly(base, realLoc) ||
    shouldReloadForLoc(realLoc)
  return { shouldReload: !!moved, loc: realLoc }
}

module.exports = {
  KEY,
  DEFAULT_LOC,
  FRESH_MS,
  USABLE_MS,
  UI_LOCATING_MS,
  GPS_WAIT_MS,
  RELOAD_MOVE_KM,
  getSaved,
  getEffective,
  ensureDefaultLoc,
  save,
  queryFromSaved,
  locate,
  isFresh,
  isUsable,
  isRealLoc,
  decorateList,
  formatDistance,
  haversineKm,
  reverseLabel,
  toDistrictLabel,
  displayDistrictName,
  matchOpenCity,
  movedSignificantly,
  shouldReloadForLoc,
  getListOrigin,
  setListOrigin,
  finalizePending,
  getUserLocationAuth
}

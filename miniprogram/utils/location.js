const KEY = 'wy_loc'
const FRESH_MS = 5 * 60 * 1000

/** 深圳各区中心（GCJ-02），用于把 GPS 反解成真实区名展示 */
const SZ_DISTRICTS = [
  { city: '深圳·南山', label: '深圳市南山区', lat: 22.5300, lng: 113.9400 },
  { city: '深圳·福田', label: '深圳市福田区', lat: 22.5400, lng: 114.0550 },
  { city: '深圳·罗湖', label: '深圳市罗湖区', lat: 22.5480, lng: 114.1180 },
  { city: '深圳·宝安', label: '深圳市宝安区', lat: 22.5550, lng: 113.8900 },
  { city: '深圳·龙华', label: '深圳市龙华区', lat: 22.6500, lng: 114.0300 },
  { city: '深圳·龙岗', label: '深圳市龙岗区', lat: 22.7200, lng: 114.2500 },
  { city: '深圳·盐田', label: '深圳市盐田区', lat: 22.5570, lng: 114.2370 },
  { city: '深圳·光明', label: '深圳市光明区', lat: 22.7480, lng: 113.9450 },
  { city: '深圳·坪山', label: '深圳市坪山区', lat: 22.6900, lng: 114.3460 }
]

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

/** 把 GPS 反解成可读地点：深圳市内显示区名，否则显示坐标附近文案 */
function reverseLabel(lat, lng) {
  const a = Number(lat)
  const n = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(n)) return '当前位置'
  const { district, km } = nearestDistrict(a, n, SZ_DISTRICTS)
  if (district && km != null && km <= 45) {
    return district.label
  }
  return `${a.toFixed(4)},${n.toFixed(4)}`
}

function matchOpenCity(lat, lng) {
  const { district, km } = nearestDistrict(lat, lng, SZ_DISTRICTS)
  if (district && km != null && km <= 45) {
    return { city: district.city, label: district.label, inService: true, km }
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

function isFresh(loc, maxAge = FRESH_MS) {
  if (!loc || loc.lat == null || loc.lng == null) return false
  if (loc.source !== 'gps') return false
  const age = Date.now() - Number(loc.updatedAt || 0)
  return age >= 0 && age < maxAge
}

function queryFromSaved() {
  const s = getSaved() || {}
  const q = {}
  // 深圳市内：只带 GPS，全市按距离排序（避免线上按精确 city 只返回单区）
  if (s.inService && String(s.city || '').indexOf('深圳') === 0) {
    // omit city
  } else if (s.city) {
    q.city = s.city
  }
  if (s.lat != null && s.lat !== '') q.lat = s.lat
  if (s.lng != null && s.lng !== '') q.lng = s.lng
  return q
}

function getGps() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 5000,
      success: resolve,
      fail: (err) => {
        const msg = String((err && err.errMsg) || '')
        if (/auth deny|authorize|permission|隐私|deny/i.test(msg)) {
          reject(new Error('请允许定位权限，才能展示附近门店'))
          return
        }
        reject(new Error('定位失败，请打开手机定位后重试'))
      }
    })
  })
}

function decorateList(rows, loc) {
  const saved = loc || getSaved() || {}
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

/**
 * 仅允许 GPS 真实定位。展示文案为真实区名（如 深圳市南山区）。
 */
async function locate(api, { force = false } = {}) {
  const cached = getSaved()
  if (!force && isFresh(cached)) return cached

  const pos = await getGps()
  const lat = Number(pos.latitude)
  const lng = Number(pos.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('定位失败，请打开手机定位后重试')
  }

  const local = matchOpenCity(lat, lng)
  let city = local.city
  let displayCity = local.label
  let inService = local.inService

  // 用后端开通城市再校对一次（若已开城）
  try {
    const resolved = await api.resolveCity(lat, lng)
    const resolvedCity = String((resolved && (resolved.city || resolved.name)) || '').trim()
    const km = resolved && resolved.distanceKm
    if (resolvedCity && (km == null || Number(km) <= 80)) {
      city = resolvedCity
      inService = true
      if (String(resolvedCity).indexOf('深圳') === 0) {
        displayCity = local.label || resolvedCity.replace('·', '市') + '区'
        // 保持「深圳市XX区」格式
        const hit = SZ_DISTRICTS.find((d) => d.city === resolvedCity)
        if (hit) displayCity = hit.label
      } else {
        displayCity = resolvedCity
      }
    }
  } catch (_) {}

  return save({
    city: inService ? city : '',
    displayCity,
    lat,
    lng,
    source: 'gps',
    inService,
    updatedAt: Date.now()
  })
}

module.exports = {
  KEY,
  getSaved,
  save,
  queryFromSaved,
  locate,
  isFresh,
  decorateList,
  formatDistance,
  haversineKm,
  reverseLabel,
  matchOpenCity
}

function toRad(d) {
  return (Number(d) * Math.PI) / 180
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const a1 = Number(lat1)
  const n1 = Number(lng1)
  const a2 = Number(lat2)
  const n2 = Number(lng2)
  if (![a1, n1, a2, n2].every((v) => Number.isFinite(v))) return null
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

/** 开通城市默认中心点（门店缺坐标时用于生成可排序的真实距离） */
const CITY_CENTERS = {
  '深圳·罗湖': { lat: 22.5480, lng: 114.1180 },
  '深圳·福田': { lat: 22.5400, lng: 114.0550 },
  '深圳·南山': { lat: 22.5300, lng: 113.9400 },
  '深圳·宝安': { lat: 22.5550, lng: 113.8900 },
  '深圳·龙华': { lat: 22.6500, lng: 114.0300 },
  '深圳·龙岗': { lat: 22.7200, lng: 114.2500 },
  '深圳·盐田': { lat: 22.5570, lng: 114.2370 },
  '深圳·光明': { lat: 22.7480, lng: 113.9450 },
  '深圳·坪山': { lat: 22.6900, lng: 114.3460 },
  '九江·瑞昌': { lat: 29.6761, lng: 115.681 },
  '九江·浔阳': { lat: 29.7054, lng: 116.0015 },
  '九江·柴桑': { lat: 29.6712, lng: 115.9918 },
  '九江·庐山': { lat: 29.4478, lng: 116.0452 }
}

function parseOrigin(opts = {}) {
  const city = String(opts.city || '').trim()
  const lat = Number(opts.lat)
  const lng = Number(opts.lng)
  return {
    city,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null
  }
}

function hash01(n) {
  const x = Math.sin(Number(n) * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * 给缺 lat/lng 的门店补上城市周边的稳定坐标（同一 id 每次相同），
 * 便于按用户真实 GPS 计算距离并排序。
 */
function ensureMerchantCoords(row) {
  const lat = Number(row.latitude)
  const lng = Number(row.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      ...row,
      latitude: lat,
      longitude: lng
    }
  }
  const city = String(row.city || '').trim()
  const center = CITY_CENTERS[city]
  if (!center) return { ...row, latitude: null, longitude: null }
  const id = Number(row.id) || 1
  const role = String(row.role || row.category || '')
  // 地摊更近、异业中等、供应链略远
  let ring = 0.6
  if (/异业|cross|果|茶|洗|足|花/.test(`${role}${row.name || ''}`)) ring = 1.4
  if (/供应|supply|仓|厂|基地|集配/.test(`${role}${row.name || ''}`)) ring = 3.2
  const angle = hash01(id * 17 + 3) * Math.PI * 2
  const radiusKm = 0.15 + hash01(id * 31 + 7) * ring
  const dLat = (radiusKm / 111) * Math.cos(angle)
  const dLng = (radiusKm / (111 * Math.cos(toRad(center.lat)))) * Math.sin(angle)
  return {
    ...row,
    latitude: Number((center.lat + dLat).toFixed(6)),
    longitude: Number((center.lng + dLng).toFixed(6)),
    geoSeeded: true
  }
}

function applyGeo(rows, opts = {}) {
  const { city, lat, lng } = parseOrigin(opts)
  const hasOrigin = lat != null && lng != null
  let list = Array.isArray(rows) ? rows.slice() : []
  if (city) {
    if (city.indexOf('深圳') === 0) {
      list = list.filter((r) => String(r.city || '').indexOf('深圳') === 0)
    } else {
      list = list.filter((r) => String(r.city || '') === city)
    }
  }
  list = list.map((r) => {
    const withCoord = ensureMerchantCoords(r)
    const distanceKm = hasOrigin
      ? haversineKm(lat, lng, withCoord.latitude, withCoord.longitude)
      : null
    return {
      ...withCoord,
      distanceKm,
      distance: formatDistance(distanceKm)
    }
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

module.exports = {
  haversineKm,
  formatDistance,
  parseOrigin,
  applyGeo,
  ensureMerchantCoords,
  CITY_CENTERS
}

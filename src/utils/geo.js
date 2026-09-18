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

function applyGeo(rows, opts = {}) {
  const { city, lat, lng } = parseOrigin(opts)
  const hasOrigin = lat != null && lng != null
  let list = Array.isArray(rows) ? rows.slice() : []
  if (city) list = list.filter((r) => String(r.city || '') === city)
  list = list.map((r) => {
    const distanceKm = hasOrigin ? haversineKm(lat, lng, r.latitude, r.longitude) : null
    return {
      ...r,
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

module.exports = { haversineKm, formatDistance, parseOrigin, applyGeo }

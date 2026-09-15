/**
 * 运营大屏样例扩样：在真实库表之上补齐夜市带点位、货脉、积分核销。
 * 同一天内点位坐标稳定，访问/成交随分钟轻微跳动。
 */

function mulberry32(seed) {
  let a = seed >>> 0
  return function rand() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function daySeed() {
  const d = new Date()
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

function jitter(rng, lat, lng, meters) {
  const dlat = (rng() - 0.5) * 2 * (meters / 111000)
  const dlng = (rng() - 0.5) * 2 * (meters / (111000 * Math.cos((lat * Math.PI) / 180)))
  return { lat: +(lat + dlat).toFixed(6), lng: +(lng + dlng).toFixed(6) }
}

const CLUSTERS = [
  { city: '九江·瑞昌', lat: 29.6761, lng: 115.681, stall: 16, cross: 6, supply: 2, district: '夜市一条街' },
  { city: '九江·浔阳', lat: 29.7054, lng: 116.0015, stall: 12, cross: 5, supply: 1, district: '浔阳夜市' },
  { city: '九江·柴桑', lat: 29.6712, lng: 115.9918, stall: 8, cross: 3, supply: 1, district: '柴桑集市' },
  { city: '九江·庐山', lat: 29.4478, lng: 116.0452, stall: 6, cross: 2, supply: 0, district: '牯岭夜摊' },
  { city: '南昌·东湖', lat: 28.6832, lng: 115.8581, stall: 10, cross: 4, supply: 2, district: '八一商圈' },
  { city: '景德镇·昌江', lat: 29.2687, lng: 117.1784, stall: 7, cross: 3, supply: 1, district: '陶溪川夜市' },
  { city: '上饶·信州', lat: 28.4549, lng: 117.9431, stall: 5, cross: 2, supply: 1, district: '信江夜市' },
  { city: '宜春·袁州', lat: 27.8045, lng: 114.3937, stall: 4, cross: 2, supply: 1, district: '袁州老街' }
]

const STALL_NAMES = [
  '张记炒面', '阿姐烤串', '老周鱿鱼须', '辣椒炒肉盖饭', '冰粉阿婆', '油炸年糕摊',
  '赣北瓦罐汤', '现切凉皮', '铁板鱿鱼王', '手抓饼兄弟', '烤冷面小妹', '臭豆腐一绝',
  '砂锅米线', '鸭血粉丝', '南昌拌粉', '庐山石鱼摊', '瑞昌炒河粉', '浔阳牛肉粉',
  '糖葫芦老张', '烤生蚝码头', '辣子鸡架', '蛋烘糕小店', '炸鸡锁骨', '酸辣粉夜档'
]

const CROSS_NAMES = [
  '果切小屋', '老街奶茶', '夜间理发铺', '24h便利柜', '修鞋钥匙摊', '鲜花零售',
  '剧本杀驿站', '台球休闲', '洗衣即取', '眼镜快修', '烘焙甜品', '运动彩票'
]

const SUPPLY_NAMES = [
  '赣北粮油仓', '浔阳冻品配货', '昌江调味集散', '东湖包材仓', '信州蔬菜批发', '袁州干货栈'
]

const GOODS_STALL = [
  ['招牌炒面', 12], ['羊肉串×5', 20], ['酸辣粉', 10], ['烤茄子', 8], ['冰粉', 6],
  ['瓦罐汤', 18], ['南昌拌粉', 11], ['铁板鱿鱼', 16], ['鸭血粉丝', 14], ['糖油粑粑', 5]
]
const GOODS_CROSS = [
  ['时令果切', 18], ['招牌奶茶', 12], ['椰子水', 8], ['夜间剪发', 35], ['鲜花一束', 29]
]
const GOODS_SUPPLY = [
  ['宽面 5kg', 28], ['菜籽油 10L', 86], ['冷冻鸡翅件', 42], ['辣椒面 2kg', 19], ['一次性餐盒件', 36]
]

const HOUR_WEIGHT = [
  0.04, 0.02, 0.01, 0.01, 0.01, 0.03, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.15, 0.13, 0.11, 0.1, 0.14, 0.22,
  0.42, 0.7, 1, 0.86, 0.48, 0.18
]

function liveBump() {
  return Math.floor(Date.now() / 20000) % 11
}

function buildGeo(rng) {
  const points = []
  let sid = 9000
  for (const c of CLUSTERS) {
    for (let i = 0; i < c.stall; i++) {
      const p = jitter(rng, c.lat, c.lng, 420)
      points.push({
        id: sid++,
        name: pick(rng, STALL_NAMES) + (i > 8 ? `·${i}` : ''),
        role: 'stall',
        city: c.city,
        district: c.district,
        lat: p.lat,
        lng: p.lng,
        status: 1,
        visits: Math.floor(40 + rng() * 420),
        gmv: +(80 + rng() * 9800).toFixed(2),
        sim: true
      })
    }
    for (let i = 0; i < c.cross; i++) {
      const p = jitter(rng, c.lat, c.lng, 520)
      points.push({
        id: sid++,
        name: pick(rng, CROSS_NAMES) + (i > 3 ? ` ${i}` : ''),
        role: 'cross',
        city: c.city,
        district: c.district,
        lat: p.lat,
        lng: p.lng,
        status: 1,
        visits: Math.floor(20 + rng() * 260),
        gmv: +(60 + rng() * 4200).toFixed(2),
        sim: true
      })
    }
    for (let i = 0; i < c.supply; i++) {
      const p = jitter(rng, c.lat + 0.012, c.lng + 0.018, 900)
      points.push({
        id: sid++,
        name: pick(rng, SUPPLY_NAMES),
        role: 'supply',
        city: c.city,
        district: '仓配园区',
        lat: p.lat,
        lng: p.lng,
        status: 1,
        visits: Math.floor(8 + rng() * 80),
        gmv: +(400 + rng() * 28000).toFixed(2),
        sim: true
      })
    }
  }
  return points
}

function buildDistricts() {
  return CLUSTERS.map((c) => ({
    name: c.district,
    city: c.city,
    lat: c.lat,
    lng: c.lng,
    kind: 'night-market'
  }))
}

function buildRoutes(points, rng) {
  const stalls = points.filter((p) => p.role === 'stall')
  const supplies = points.filter((p) => p.role === 'supply')
  const crosses = points.filter((p) => p.role === 'cross')
  const cargo = []
  stalls.forEach((s) => {
    const same = supplies.filter((w) => w.city === s.city)
    const src = same.length ? pick(rng, same) : pick(rng, supplies)
    if (!src) return
    cargo.push({
      from: { name: src.name, lat: src.lat, lng: src.lng, city: src.city },
      to: { name: s.name, lat: s.lat, lng: s.lng, city: s.city },
      sku: pick(rng, GOODS_SUPPLY)[0],
      amount: +(200 + rng() * 6800).toFixed(0),
      mode: rng() > 0.38 ? '物流配送' : '线下记账'
    })
  })
  const redeem = []
  stalls.slice(0, 48).forEach((s) => {
    const near = crosses.filter((x) => x.city === s.city)
    const dst = near.length ? pick(rng, near) : pick(rng, crosses)
    if (!dst) return
    redeem.push({
      from: { name: s.name, lat: s.lat, lng: s.lng, city: s.city },
      to: { name: dst.name, lat: dst.lat, lng: dst.lng, city: dst.city },
      points: Math.floor(80 + rng() * 900),
      cash: +(8 + rng() * 46).toFixed(2)
    })
  })
  return { cargo: cargo.slice(0, 42), redeem: redeem.slice(0, 36) }
}

function buildTicker(points, rng) {
  const stalls = points.filter((p) => p.role === 'stall')
  const crosses = points.filter((p) => p.role === 'cross')
  const items = []
  for (let i = 0; i < 18; i++) {
    const kind = rng()
    if (kind < 0.55) {
      const s = pick(rng, stalls)
      const g = pick(rng, GOODS_STALL)
      items.push({
        type: 'stall',
        text: `${s.city} · ${s.name} 售出「${g[0]}」¥${g[1]}，划拨 ${Math.round(g[1] * 1.4)} 积分`
      })
    } else if (kind < 0.82) {
      const x = pick(rng, crosses)
      const g = pick(rng, GOODS_CROSS)
      items.push({
        type: 'cross',
        text: `${x.city} · ${x.name} 核销「${g[0]}」现金 ¥${g[1]}`
      })
    } else {
      const s = pick(rng, stalls)
      const g = pick(rng, GOODS_SUPPLY)
      items.push({
        type: 'supply',
        text: `${s.city} · ${s.name} 向仓网采购「${g[0]}」¥${g[1]}`
      })
    }
  }
  return items
}

function buildHourly(rng, realHourly) {
  if (realHourly && realHourly.some((r) => Number(r.count) > 2)) {
    const map = {}
    realHourly.forEach((r) => {
      map[Number(r.hour)] = Number(r.count)
    })
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: map[h] || 0 }))
  }
  const peak = 86 + Math.floor(rng() * 40)
  return HOUR_WEIGHT.map((w, hour) => ({
    hour,
    orders: Math.round(w * peak)
  }))
}

function simKpis(rng, real) {
  const bump = liveBump()
  const visitsToday = 11840 + Math.floor(rng() * 800) + bump * 17
  const ordersToday = 1680 + Math.floor(rng() * 220) + bump * 3
  const consumerGmv = +(96200 + rng() * 8600 + bump * 48).toFixed(2)
  const crossGmv = +(38600 + rng() * 4200 + bump * 22).toFixed(2)
  const purchaseGmv = +(44200 + rng() * 5100 + bump * 30).toFixed(2)
  const gmvTotal = +(consumerGmv + crossGmv + purchaseGmv).toFixed(2)
  return {
    visitsToday: Math.max(Number(real.visitsToday) || 0, visitsToday),
    visits7d: Math.max(Number(real.visits7d) || 0, visitsToday * 6 + Math.floor(rng() * 4000)),
    ordersToday: Math.max(Number(real.ordersToday) || 0, ordersToday),
    gmvTotal: Math.max(Number(real.gmvTotal) || 0, gmvTotal),
    consumerGmv: Math.max(Number(real.consumerGmv) || 0, consumerGmv),
    crossGmv: Math.max(Number(real.crossGmv) || 0, crossGmv),
    purchaseGmv: Math.max(Number(real.purchaseGmv) || 0, purchaseGmv),
    openStores: Math.max(Number(real.openStores) || 0, 118 + Math.floor(rng() * 12)),
    consumers: Math.max(Number(real.consumers) || 0, 23180 + Math.floor(rng() * 900) + bump),
    stalls: Math.max(Number(real.stalls) || 0, 68),
    crosses: Math.max(Number(real.crosses) || 0, 27),
    supplies: Math.max(Number(real.supplies) || 0, 9),
    pointsIssued: 186420 + Math.floor(rng() * 8000) + bump * 40,
    pointsRedeemed: 124680 + Math.floor(rng() * 5000) + bump * 22,
    pointsPool: 42800 + Math.floor(rng() * 2000),
    redeemRate: 0.67,
    avgTicket: +(18.6 + rng() * 4).toFixed(1),
    onTimeRate: +(0.91 + rng() * 0.05).toFixed(3),
    inTransit: 24 + Math.floor(rng() * 10),
    warehouseSku: 312 + Math.floor(rng() * 40)
  }
}

function mergeGeo(real, sim) {
  const out = []
  const seen = new Set()
  ;(real || []).forEach((p) => {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const key = `${p.id}`
    seen.add(key)
    out.push({
      id: p.id,
      name: p.name,
      role: p.role,
      city: p.city,
      district: p.city || '',
      lat,
      lng,
      status: p.status,
      visits: Number(p.visits) || 0,
      gmv: Number(p.gmv) || Number(p.visits) * 22 || 860,
      sim: false
    })
  })
  sim.forEach((p) => {
    if (seen.has(String(p.id))) return
    out.push(p)
  })
  return out
}

function enrichScreen(raw, extra = {}) {
  const rng = mulberry32(daySeed() ^ 0x51c3)
  const simGeo = buildGeo(rng)
  const geoPoints = mergeGeo(raw.geoPoints, simGeo)
  const routes = buildRoutes(geoPoints, rng)
  const kpis = simKpis(rng, raw.kpis || {})
  const cityMap = {}
  geoPoints.forEach((p) => {
    cityMap[p.city] = cityMap[p.city] || { city: p.city, visits: 0, stalls: 0, gmv: 0 }
    cityMap[p.city].visits += Number(p.visits) || 0
    cityMap[p.city].gmv += Number(p.gmv) || 0
    if (p.role === 'stall') cityMap[p.city].stalls += 1
  })
  const hotCities = Object.values(cityMap)
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 8)

  const goods = []
  GOODS_STALL.forEach((g, i) => goods.push({ type: 'stall', name: g[0], sku: `ST${1000 + i}`, sales: 180 - i * 11, price: g[1] }))
  GOODS_CROSS.forEach((g, i) => goods.push({ type: 'cross', name: g[0], sku: `CR${1000 + i}`, sales: 96 - i * 8, price: g[1] }))
  GOODS_SUPPLY.forEach((g, i) => goods.push({ type: 'supply', name: g[0], sku: `SP${1000 + i}`, sales: 64 - i * 6, price: g[1] }))

  const visitTrend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const day = d.toISOString().slice(0, 10)
    const real = (raw.visitTrend || []).find((r) => String(r.day).slice(0, 10) === day)
    const base = 8200 + Math.floor(rng() * 1800) + i * 260
    return { day, visits: Math.max(Number(real && real.visits) || 0, base) }
  })

  const roleMix = [
    { role: 'consumer', label: 'C端用户', count: kpis.consumers },
    { role: 'stall', label: '地摊', count: kpis.stalls },
    { role: 'cross', label: '异业', count: kpis.crosses },
    { role: 'supply', label: '供应链', count: kpis.supplies }
  ]

  const fulfill = [
    { label: '物流配送', count: 62, color: '#E8A317' },
    { label: '线下记账', count: 38, color: '#C41E3A' }
  ]

  const pointsHealth = [
    { label: '今日发放', value: kpis.pointsIssued, color: '#E8A317' },
    { label: '今日核销', value: kpis.pointsRedeemed, color: '#C41E3A' },
    { label: '池内沉淀', value: kpis.pointsPool, color: '#3D9B7A' }
  ]

  return {
    updatedAt: new Date().toISOString(),
    demoEnriched: true,
    kpis,
    roleMix,
    hotCities,
    geoPoints,
    visitTrend,
    topGoods: goods,
    hourly: buildHourly(rng, extra.hourly),
    ticker: buildTicker(geoPoints, rng),
    districts: buildDistricts(),
    cargoRoutes: routes.cargo,
    redeemRoutes: routes.redeem,
    fulfill,
    pointsHealth,
    warehouses: geoPoints.filter((p) => p.role === 'supply').slice(0, 8)
  }
}

module.exports = { enrichScreen }

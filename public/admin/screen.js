const TOKEN_KEY = 'xwen_admin_token'
const ROLE_LABEL = { stall: '地摊', cross: '异业', supply: '仓网', consumer: 'C端' }
const ROLE_COLOR = { stall: '#c41e3a', cross: '#e8a317', supply: '#3d9b7a', consumer: '#f3d5a6' }

let lastData = null
let currentPage = 'ops'
let rotateTimer = null
let paused = false
const maps = {}
const layers = {}
const filters = { ops: 'all' }

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function api(path) {
  const token = localStorage.getItem(TOKEN_KEY) || ''
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  const json = await res.json()
  if (res.status === 401) {
    location.href = './'
    throw new Error('请先登录运营台')
  }
  if (!res.ok || json.code !== 0) throw new Error(json.message || '加载失败')
  return json.data
}

function tick() {
  document.getElementById('clock').textContent = new Date().toLocaleString('zh-CN', { hour12: false })
}

function animateNumber(el, target, opts = {}) {
  const decimals = opts.decimals ?? 0
  const prefix = opts.prefix || ''
  const suffix = opts.suffix || ''
  const duration = 800
  const start = performance.now()
  const from = Number(el.dataset.val || 0)
  const to = Number(target) || 0
  function frame(t) {
    const p = Math.min(1, (t - start) / duration)
    const eased = 1 - Math.pow(1 - p, 3)
    const cur = from + (to - from) * eased
    const num = decimals ? cur.toFixed(decimals) : Math.round(cur).toLocaleString('zh-CN')
    el.textContent = prefix + num + suffix
    if (p < 1) requestAnimationFrame(frame)
    else el.dataset.val = String(to)
  }
  requestAnimationFrame(frame)
}

function renderKpiRow(root, items, k) {
  if (!root.dataset.ready) {
    root.innerHTML = items
      .map(
        (it) => `<div class="kpi" style="--accent:${it.color}">
          <div class="n" data-key="${it.key}" data-val="0">0</div>
          <div class="l">${esc(it.label)}</div>
        </div>`
      )
      .join('')
    root.dataset.ready = '1'
  }
  items.forEach((it) => {
    const el = root.querySelector(`[data-key="${it.key}"]`)
    if (el) animateNumber(el, k[it.key], it)
  })
}

function renderBars(el, rows, labelKey, valueKey, colorFn, format) {
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1)
  el.innerHTML = rows
    .map((r) => {
      const v = Number(r[valueKey]) || 0
      const pct = Math.round((v / max) * 100)
      const color = colorFn ? colorFn(r) : '#e8a317'
      const shown = format ? format(v) : v.toLocaleString('zh-CN')
      return `<div class="row">
        <span class="label"><i class="dot" style="background:${color}"></i>${esc(r[labelKey])}</span>
        <div class="bar"><i style="width:0;background:linear-gradient(90deg, ${color}55, ${color})" data-w="${pct}%"></i></div>
        <span class="val">${shown}</span>
      </div>`
    })
    .join('')
  requestAnimationFrame(() => {
    el.querySelectorAll('.bar > i').forEach((i) => {
      i.style.width = i.dataset.w
    })
  })
}

function renderMix(el, items, total) {
  const t = total || items.reduce((s, i) => s + Number(i.value || i.count || 0), 0) || 1
  el.innerHTML = items
    .map((it) => {
      const v = Number(it.value ?? it.count) || 0
      const label = it.label
      const color = it.color
      const text = it.prefix === '¥' ? `¥${v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : v.toLocaleString('zh-CN')
      return `<div class="gmv-item">
        <span class="tag" style="color:${color}">${esc(label)}</span>
        <div class="bar"><i style="width:${Math.min(100, (v / t) * 100)}%;background:${color}"></i></div>
        <strong>${text}${it.suffix || ''}</strong>
      </div>`
    })
    .join('')
}

function drawHourly(canvas, points) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || 520
  const cssH = 168
  canvas.width = cssW * dpr
  canvas.height = cssH * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  const pad = { l: 22, r: 8, t: 12, b: 22 }
  const max = Math.max(...points.map((p) => Number(p.orders) || 0), 1)
  const w = cssW - pad.l - pad.r
  const h = cssH - pad.t - pad.b
  ctx.strokeStyle = 'rgba(232,163,23,.15)'
  for (let i = 0; i < 4; i++) {
    const y = pad.t + (h * i) / 3
    ctx.beginPath()
    ctx.moveTo(pad.l, y)
    ctx.lineTo(cssW - pad.r, y)
    ctx.stroke()
  }
  const coords = points.map((p, i) => ({
    x: pad.l + (i * w) / Math.max(points.length - 1, 1),
    y: pad.t + (1 - (Number(p.orders) || 0) / max) * h,
    p
  }))
  const grad = ctx.createLinearGradient(0, pad.t, 0, cssH - pad.b)
  grad.addColorStop(0, 'rgba(196,30,58,.45)')
  grad.addColorStop(1, 'rgba(232,163,23,0)')
  ctx.beginPath()
  coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)))
  ctx.lineTo(coords[coords.length - 1].x, cssH - pad.b)
  ctx.lineTo(coords[0].x, cssH - pad.b)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.beginPath()
  coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)))
  ctx.strokeStyle = '#e8a317'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#b59a86'
  ctx.font = '10px sans-serif'
  ;[0, 6, 12, 18, 23].forEach((h) => {
    const c = coords[h]
    if (c) ctx.fillText(`${h}时`, c.x - 8, cssH - 6)
  })
}

function bezierArc(a, b, n = 22) {
  const dx = b.lng - a.lng
  const dy = b.lat - a.lat
  const mag = Math.hypot(dx, dy) || 0.01
  const mx = (a.lng + b.lng) / 2 - (dy / mag) * mag * 0.22
  const my = (a.lat + b.lat) / 2 + (dx / mag) * mag * 0.22
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    pts.push([u * u * a.lat + 2 * u * t * my + t * t * b.lat, u * u * a.lng + 2 * u * t * mx + t * t * b.lng])
  }
  return pts
}

function ensureMap(id, view) {
  if (maps[id]) return maps[id]
  const map = L.map(id, { zoomControl: true, attributionControl: false }).setView(view || [29.7, 115.9], 9)
  L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {
    subdomains: '1234',
    maxZoom: 18
  }).addTo(map)
  layers[id] = L.layerGroup().addTo(map)
  maps[id] = map
  return map
}

function addDistricts(layer, districts) {
  ;(districts || []).forEach((d) => {
    const icon = L.divIcon({
      className: 'district-label',
      html: `<div class="district-chip">${esc(d.name)}</div>`,
      iconSize: [120, 28],
      iconAnchor: [60, 28]
    })
    L.marker([d.lat, d.lng], { icon, interactive: false, zIndexOffset: 400 }).addTo(layer)
  })
}

function addPins(layer, points) {
  const bounds = []
  points.forEach((p) => {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    bounds.push([lat, lng])
    const icon = L.divIcon({
      className: 'hot-marker',
      html: `<div class="pin ${esc(p.role)}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    })
    const marker = L.marker([lat, lng], { icon })
    marker.bindPopup(
      `<strong>${esc(p.name)}</strong><br/>
       ${esc(ROLE_LABEL[p.role] || p.role)} · ${esc(p.city || '')}<br/>
       ${esc(p.district || '')}<br/>
       热度 <b>${p.visits || 0}</b>　成交约 <b>¥${Number(p.gmv || 0).toFixed(0)}</b>`
    )
    marker.addTo(layer)
    const radius = 50 + Math.min(220, Number(p.visits || 0) * 0.55)
    L.circle([lat, lng], {
      radius,
      color: ROLE_COLOR[p.role] || '#e8a317',
      weight: 1,
      opacity: 0.35,
      fillColor: ROLE_COLOR[p.role] || '#e8a317',
      fillOpacity: 0.1
    }).addTo(layer)
  })
  return bounds
}

function addArcs(layer, routes, color) {
  ;(routes || []).forEach((r) => {
    if (!r.from || !r.to) return
    const latlngs = bezierArc(r.from, r.to)
    L.polyline(latlngs, {
      color,
      weight: 2,
      opacity: 0.7,
      dashArray: '6 8'
    }).addTo(layer)
  })
}

function renderMapOps(data) {
  const map = ensureMap('mapOps', [29.68, 115.85])
  const layer = layers.mapOps
  layer.clearLayers()
  const all = data.geoPoints || []
  const filtered = filters.ops === 'all' ? all : all.filter((p) => p.role === filters.ops)
  addDistricts(layer, data.districts)
  const bounds = addPins(layer, filtered)
  if (bounds.length) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 12 })
  setTimeout(() => map.invalidateSize(), 80)
  const stallN = all.filter((p) => p.role === 'stall').length
  const crossN = all.filter((p) => p.role === 'cross').length
  const supplyN = all.filter((p) => p.role === 'supply').length
  document.getElementById('mapStatOps').innerHTML = `
    <span>标注 <b>${filtered.length}</b></span>
    <span class="role-stall">地摊 <b>${stallN}</b></span>
    <span class="role-cross">异业 <b>${crossN}</b></span>
    <span class="role-supply">仓网 <b>${supplyN}</b></span>`
}

function renderMapFlow(data) {
  const map = ensureMap('mapFlow', [28.9, 116.1])
  const layer = layers.mapFlow
  layer.clearLayers()
  const pins = (data.geoPoints || []).filter((p) => p.role === 'supply' || p.role === 'stall')
  addDistricts(layer, data.districts)
  addPins(layer, pins)
  addArcs(layer, data.cargoRoutes, '#e8a317')
  const bounds = pins.map((p) => [Number(p.lat), Number(p.lng)]).filter((x) => Number.isFinite(x[0]))
  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 })
  setTimeout(() => map.invalidateSize(), 80)
  document.getElementById('mapStatFlow').innerHTML = `
    <span>货脉弧 <b>${(data.cargoRoutes || []).length}</b></span>
    <span>仓网 <b>${(data.warehouses || []).length}</b></span>
    <span>在途 <b>${data.kpis.inTransit || 0}</b></span>`
}

function renderMapPoints(data) {
  const map = ensureMap('mapPoints', [29.4, 115.9])
  const layer = layers.mapPoints
  layer.clearLayers()
  const pins = (data.geoPoints || []).filter((p) => p.role === 'cross' || p.role === 'stall')
  addDistricts(layer, data.districts)
  addPins(layer, pins)
  addArcs(layer, data.redeemRoutes, '#c41e3a')
  const bounds = pins.map((p) => [Number(p.lat), Number(p.lng)]).filter((x) => Number.isFinite(x[0]))
  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 })
  setTimeout(() => map.invalidateSize(), 80)
  document.getElementById('mapStatPoints').innerHTML = `
    <span>核销弧 <b>${(data.redeemRoutes || []).length}</b></span>
    <span>兑换率 <b>${Math.round((data.kpis.redeemRate || 0) * 100)}%</b></span>`
}

function renderGoods(el, list, type) {
  const typeLabel = { stall: '地摊', cross: '异业', supply: '仓网' }
  let rows = [...(list || [])]
  if (type) rows = rows.filter((g) => g.type === type)
  rows.sort((a, b) => Number(b.sales) - Number(a.sales))
  el.innerHTML = rows
    .slice(0, 8)
    .map(
      (g, i) => `<div class="rank-item">
        <div class="rank-no">${i + 1}</div>
        <div>
          <div class="rank-name">${esc(g.name)}</div>
          <div class="rank-meta">${esc(typeLabel[g.type] || g.type)} · ${esc(g.sku || '-')}</div>
        </div>
        <div class="rank-sales">${g.sales}</div>
      </div>`
    )
    .join('')
}

function renderTicker(items) {
  const html = (items || [])
    .concat(items || [])
    .map((it) => `<span class="${esc(it.type)}">${esc(it.text)}</span>`)
    .join('')
  document.getElementById('ticker').innerHTML = html
}

function renderOps(data) {
  const k = data.kpis
  renderKpiRow(document.getElementById('kpisOps'), [
    { key: 'visitsToday', label: '今日访问', color: '#e8a317' },
    { key: 'ordersToday', label: '今日订单', color: '#c41e3a' },
    { key: 'gmvTotal', label: '交易流水', color: '#f3d5a6', prefix: '¥', decimals: 0 },
    { key: 'openStores', label: '营业门店', color: '#3d9b7a' },
    { key: 'stalls', label: '夜市地摊', color: '#c41e3a' },
    { key: 'consumers', label: 'C 端用户', color: '#f3d5a6' }
  ], k)
  renderMix(
    document.getElementById('gmvMix'),
    [
      { label: '点餐', value: k.consumerGmv, color: '#f3d5a6', prefix: '¥' },
      { label: '异业现金', value: k.crossGmv, color: '#e8a317', prefix: '¥' },
      { label: '采购', value: k.purchaseGmv, color: '#3d9b7a', prefix: '¥' }
    ],
    k.gmvTotal
  )
  renderBars(document.getElementById('roleMix'), data.roleMix || [], 'label', 'count', (r) => ROLE_COLOR[r.role])
  renderBars(document.getElementById('cities'), data.hotCities || [], 'city', 'visits', () => '#e8a317')
  drawHourly(document.getElementById('hourlyOps'), data.hourly || [])
  renderGoods(document.getElementById('goodsOps'), data.topGoods, 'stall')
  renderMapOps(data)
}

function renderFlow(data) {
  const k = data.kpis
  renderKpiRow(document.getElementById('kpisFlow'), [
    { key: 'purchaseGmv', label: '采购流水', color: '#3d9b7a', prefix: '¥', decimals: 0 },
    { key: 'inTransit', label: '在途单据', color: '#e8a317' },
    { key: 'onTimeRate', label: '准时履约', color: '#8fd4b8', decimals: 1, suffix: '%' },
    { key: 'warehouseSku', label: '仓网 SKU', color: '#f3d5a6' },
    { key: 'supplies', label: '供应链', color: '#3d9b7a' },
    { key: 'stalls', label: '收货档口', color: '#c41e3a' }
  ], { ...k, onTimeRate: (k.onTimeRate || 0) * 100 })
  const cargo = document.getElementById('cargoList')
  cargo.innerHTML = (data.cargoRoutes || [])
    .slice(0, 12)
    .map(
      (r) => `<div class="route-item">
        <div>
          <div class="path">${esc(r.from.name)} → ${esc(r.to.name)}</div>
          <div class="meta">${esc(r.from.city)} · ${esc(r.sku)} · ${esc(r.mode)}</div>
        </div>
        <b>¥${Number(r.amount).toLocaleString('zh-CN')}</b>
      </div>`
    )
    .join('')
  renderMix(
    document.getElementById('fulfill'),
    (data.fulfill || []).map((f) => ({ ...f, value: f.count, suffix: '%' })),
    100
  )
  const wh = document.getElementById('warehouses')
  wh.innerHTML = (data.warehouses || [])
    .map(
      (p) => `<div class="hot-store">
        <span>${esc(p.name)}<span class="role role-supply">${esc(p.city)}</span></span>
        <b>¥${Number(p.gmv || 0).toFixed(0)}</b>
      </div>`
    )
    .join('')
  renderGoods(document.getElementById('goodsFlow'), data.topGoods, 'supply')
  renderMapFlow(data)
}

function renderPoints(data) {
  const k = data.kpis
  renderKpiRow(document.getElementById('kpisPoints'), [
    { key: 'pointsIssued', label: '今日发放', color: '#e8a317' },
    { key: 'pointsRedeemed', label: '今日核销', color: '#c41e3a' },
    { key: 'redeemRate', label: '兑换率', color: '#f3d5a6', decimals: 0, suffix: '%' },
    { key: 'pointsPool', label: '池内沉淀', color: '#3d9b7a' },
    { key: 'avgTicket', label: '异业客单', color: '#e8a317', prefix: '¥', decimals: 1 },
    { key: 'crosses', label: '异业门店', color: '#c41e3a' }
  ], { ...k, redeemRate: (k.redeemRate || 0) * 100 })
  renderMix(
    document.getElementById('pointsHealth'),
    (data.pointsHealth || []).map((x) => ({ ...x, prefix: '' })),
    k.pointsIssued
  )
  const ratio = k.pointsIssued ? k.pointsRedeemed / k.pointsIssued : 0
  document.getElementById('pointsNote').textContent =
    ratio > 0.85 ? '核销偏快，留意异业高兑套利。' : ratio < 0.45 ? '发放大于核销，积分在池内沉淀。' : '发放与核销匹配，飞轮健康。'
  drawHourly(document.getElementById('hourlyPoints'), data.hourly || [])
  document.getElementById('discipline').innerHTML = `
    <li>地摊积分只划拨给顾客，不开放提现。</li>
    <li>异业货架价由门店自定，积分不够走全现金。</li>
    <li>池不足按运营策略部分划拨，避免穿仓。</li>`
  const radar = document.getElementById('crossRadar')
  const crosses = (data.geoPoints || [])
    .filter((p) => p.role === 'cross')
    .sort((a, b) => Number(b.visits) - Number(a.visits))
    .slice(0, 8)
  radar.innerHTML = crosses
    .map(
      (p) => `<div class="hot-store">
        <span>${esc(p.name)}<span class="role role-cross">${esc(p.city)}</span></span>
        <b>${p.visits}</b>
      </div>`
    )
    .join('')
  renderGoods(document.getElementById('goodsPoints'), data.topGoods, 'cross')
  renderMapPoints(data)
}

function showPage(page, user) {
  currentPage = page
  if (user) paused = true
  document.querySelectorAll('.board').forEach((b) => b.classList.toggle('on', b.dataset.page === page))
  document.querySelectorAll('.page-tabs .tab').forEach((t) => {
    const on = t.dataset.page === page
    t.classList.toggle('on', on)
    t.setAttribute('aria-selected', on ? 'true' : 'false')
  })
  if (!lastData) return
  if (page === 'ops') renderOps(lastData)
  if (page === 'flow') renderFlow(lastData)
  if (page === 'points') renderPoints(lastData)
}

function paint(data) {
  lastData = data
  renderTicker(data.ticker)
  if (currentPage === 'ops') renderOps(data)
  if (currentPage === 'flow') renderFlow(data)
  if (currentPage === 'points') renderPoints(data)
  const updated = document.getElementById('updatedAt')
  if (updated) {
    const tag = data.demoEnriched ? '含夜市带扩样  ·  ' : ''
    updated.textContent = `${tag}更新于 ${new Date(data.updatedAt || Date.now()).toLocaleString('zh-CN', { hour12: false })}`
  }
}

function bind() {
  document.querySelectorAll('#pageTabs .tab').forEach((btn) => {
    btn.onclick = () => showPage(btn.dataset.page, true)
  })
  document.querySelectorAll('#mapFiltersOps .chip').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('#mapFiltersOps .chip').forEach((b) => b.classList.remove('on'))
      btn.classList.add('on')
      filters.ops = btn.dataset.role
      if (lastData) renderMapOps(lastData)
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === '1') showPage('ops', true)
    if (e.key === '2') showPage('flow', true)
    if (e.key === '3') showPage('points', true)
  })
  rotateTimer = setInterval(() => {
    if (paused || document.hidden) return
    const order = ['ops', 'flow', 'points']
    const i = order.indexOf(currentPage)
    showPage(order[(i + 1) % 3])
  }, 50000)
}

async function load() {
  tick()
  paint(await api('/admin/ops/screen'))
}

bind()
setInterval(tick, 1000)
window.addEventListener('resize', () => {
  Object.values(maps).forEach((m) => m.invalidateSize())
  if (!lastData) return
  drawHourly(document.getElementById('hourlyOps'), lastData.hourly || [])
  drawHourly(document.getElementById('hourlyPoints'), lastData.hourly || [])
})

load().catch((e) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<p style="color:#ff8a93;padding:16px;position:relative;z-index:2">${esc(e.message)}</p>`
  )
})
setInterval(() => load().catch(() => {}), 60000)

const TOKEN_KEY = 'xwen_admin_token'
const ROLE_LABEL = { stall: '地摊', cross: '异业', supply: '供应链', consumer: 'C端' }
const ROLE_COLOR = {
  stall: '#fb7185',
  cross: '#fbbf24',
  supply: '#34d399',
  consumer: '#38bdf8'
}

const ICONS = {
  visits:
    '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  week:
    '<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 15v4M12 11v8M16 7v12"/></svg>',
  orders:
    '<svg viewBox="0 0 24 24"><path d="M7 4h10l1 4H6l1-4zM6 8h12v12H6z"/><path d="M9 12h6"/></svg>',
  gmv:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5c.8-1 2-1.5 3-1.5s2.2.6 3 1.5M9 14.5c.8 1 2 1.5 3 1.5s2.2-.6 3-1.5"/></svg>',
  store:
    '<svg viewBox="0 0 24 24"><path d="M4 10l2-5h12l2 5M4 10v10h16V10M9 20v-6h6v6"/></svg>',
  user:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  stall:
    '<svg viewBox="0 0 24 24"><path d="M3 10l2-5h14l2 5M4 10h16v9H4z"/><path d="M8 14h2v5H8z"/></svg>',
  cross:
    '<svg viewBox="0 0 24 24"><path d="M4 7h16v13H4z"/><path d="M8 7V5h8v2M10 12h4"/></svg>',
  supply:
    '<svg viewBox="0 0 24 24"><path d="M3 17V7l9-4 9 4v10l-9 4-9-4z"/><path d="M12 21V11M3 7l9 4 9-4"/></svg>'
}

let map
let markerLayer
let allGeo = []
let mapFilter = 'all'
let lastData = null

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
  const d = new Date()
  document.getElementById('clock').textContent = d.toLocaleString('zh-CN', { hour12: false })
}

function animateNumber(el, target, opts = {}) {
  const decimals = opts.decimals ?? 0
  const prefix = opts.prefix || ''
  const duration = opts.duration || 900
  const start = performance.now()
  const from = Number(el.dataset.val || 0)
  const to = Number(target) || 0
  function frame(t) {
    const p = Math.min(1, (t - start) / duration)
    const eased = 1 - Math.pow(1 - p, 3)
    const cur = from + (to - from) * eased
    el.textContent = prefix + (decimals ? cur.toFixed(decimals) : Math.round(cur).toLocaleString('zh-CN'))
    if (p < 1) requestAnimationFrame(frame)
    else el.dataset.val = String(to)
  }
  requestAnimationFrame(frame)
}

function renderKpis(k) {
  const items = [
    { key: 'visitsToday', label: '今日访问', icon: 'visits', color: '#22d3ee', decimals: 0 },
    { key: 'visits7d', label: '近7日访问', icon: 'week', color: '#38bdf8', decimals: 0 },
    { key: 'ordersToday', label: '今日订单', icon: 'orders', color: '#a78bfa', decimals: 0 },
    { key: 'gmvTotal', label: '交易流水', icon: 'gmv', color: '#fbbf24', decimals: 2, prefix: '¥' },
    { key: 'openStores', label: '营业门店', icon: 'store', color: '#34d399', decimals: 0 },
    { key: 'consumers', label: 'C端用户', icon: 'user', color: '#60a5fa', decimals: 0 },
    { key: 'stalls', label: '地摊门店', icon: 'stall', color: '#fb7185', decimals: 0 },
    { key: 'crosses', label: '异业门店', icon: 'cross', color: '#fb923c', decimals: 0 },
    { key: 'supplies', label: '供应链', icon: 'supply', color: '#2dd4bf', decimals: 0 }
  ]
  const root = document.getElementById('kpis')
  if (!root.dataset.ready) {
    root.innerHTML = items
      .map(
        (it) => `<div class="kpi" style="--accent:${it.color}">
          <div class="kpi-top">
            <div class="kpi-ico">${ICONS[it.icon]}</div>
          </div>
          <div class="n" data-key="${it.key}" data-val="0">0</div>
          <div class="l">${esc(it.label)}</div>
        </div>`
      )
      .join('')
    root.dataset.ready = '1'
  }
  items.forEach((it) => {
    const el = root.querySelector(`[data-key="${it.key}"]`)
    if (el) animateNumber(el, k[it.key], { decimals: it.decimals, prefix: it.prefix || '' })
  })
}

function renderBars(el, rows, labelKey, valueKey, colorFn) {
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1)
  el.innerHTML = rows
    .map((r, idx) => {
      const v = Number(r[valueKey]) || 0
      const pct = Math.round((v / max) * 100)
      const color = colorFn ? colorFn(r, idx) : '#22d3ee'
      return `<div class="row">
        <span class="label"><i class="dot" style="background:${color}"></i>${esc(r[labelKey])}</span>
        <div class="bar"><i style="width:0;background:linear-gradient(90deg, ${color}55, ${color})" data-w="${pct}%"></i></div>
        <span class="val">${v}</span>
      </div>`
    })
    .join('')
  requestAnimationFrame(() => {
    el.querySelectorAll('.bar > i').forEach((i) => {
      i.style.width = i.dataset.w
    })
  })
}

function renderGmvMix(k) {
  const items = [
    { label: '点餐流水', value: k.consumerGmv || 0, color: '#38bdf8' },
    { label: '异业现金', value: k.crossGmv || 0, color: '#fbbf24' },
    { label: '采购流水', value: k.purchaseGmv || 0, color: '#34d399' }
  ]
  document.getElementById('gmvMix').innerHTML = items
    .map(
      (it) => `<div class="gmv-item">
        <span class="tag" style="color:${it.color}">${esc(it.label)}</span>
        <div class="bar"><i style="width:${Math.min(100, (Number(it.value) / Math.max(k.gmvTotal || 1, 1)) * 100)}%;background:linear-gradient(90deg, ${it.color}55, ${it.color})"></i></div>
        <strong>¥${Number(it.value).toFixed(2)}</strong>
      </div>`
    )
    .join('')
}

function renderTrend(points) {
  const canvas = document.getElementById('trend')
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || 560
  const cssH = 200
  canvas.width = cssW * dpr
  canvas.height = cssH * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const w = cssW
  const h = cssH
  ctx.clearRect(0, 0, w, h)

  // grid
  ctx.strokeStyle = 'rgba(56,189,248,.12)'
  ctx.lineWidth = 1
  for (let i = 0; i < 4; i++) {
    const y = 20 + ((h - 40) * i) / 3
    ctx.beginPath()
    ctx.moveTo(28, y)
    ctx.lineTo(w - 12, y)
    ctx.stroke()
  }

  if (!points.length) {
    ctx.fillStyle = '#7ea0bf'
    ctx.fillText('暂无趋势数据', w / 2 - 36, h / 2)
    return
  }

  const max = Math.max(...points.map((p) => Number(p.visits) || 0), 1)
  const padL = 28
  const padR = 12
  const padT = 20
  const padB = 28
  const coords = points.map((p, i) => {
    const x = padL + (i * (w - padL - padR)) / Math.max(points.length - 1, 1)
    const y = padT + (1 - (Number(p.visits) || 0) / max) * (h - padT - padB)
    return { x, y, p }
  })

  const grad = ctx.createLinearGradient(0, padT, 0, h - padB)
  grad.addColorStop(0, 'rgba(34,211,238,.35)')
  grad.addColorStop(1, 'rgba(34,211,238,0)')

  ctx.beginPath()
  coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)))
  ctx.lineTo(coords[coords.length - 1].x, h - padB)
  ctx.lineTo(coords[0].x, h - padB)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  ctx.beginPath()
  coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)))
  ctx.strokeStyle = '#22d3ee'
  ctx.lineWidth = 2.5
  ctx.shadowColor = 'rgba(34,211,238,.8)'
  ctx.shadowBlur = 12
  ctx.stroke()
  ctx.shadowBlur = 0

  coords.forEach((c) => {
    ctx.beginPath()
    ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2
    ctx.stroke()
  })

  ctx.fillStyle = '#9ec5ff'
  ctx.font = '11px sans-serif'
  coords.forEach((c) => {
    const day = String(c.p.day).slice(5, 10)
    ctx.fillText(day, c.x - 12, h - 8)
  })
}

function ensureMap() {
  if (map) return
  map = L.map('leafletMap', {
    zoomControl: true,
    attributionControl: false
  }).setView([29.6761, 115.681], 13)

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map)

  markerLayer = L.layerGroup().addTo(map)
}

function renderMap(points) {
  ensureMap()
  allGeo = points || []
  markerLayer.clearLayers()

  const filtered =
    mapFilter === 'all' ? allGeo : allGeo.filter((p) => p.role === mapFilter)

  const bounds = []
  filtered.forEach((p) => {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    bounds.push([lat, lng])
    const icon = L.divIcon({
      className: 'hot-marker',
      html: `<div class="pin ${esc(p.role)}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    })
    const marker = L.marker([lat, lng], { icon })
    marker.bindPopup(
      `<strong>${esc(p.name)}</strong><br/>
       ${esc(ROLE_LABEL[p.role] || p.role)} · ${esc(p.city || '')}<br/>
       访问热度 <b>${p.visits || 0}</b>`
    )
    markerLayer.addLayer(marker)

    // heat halo circle by visits
    const radius = 40 + Math.min(180, Number(p.visits || 0) * 18)
    L.circle([lat, lng], {
      radius,
      color: ROLE_COLOR[p.role] || '#22d3ee',
      weight: 1,
      opacity: 0.55,
      fillColor: ROLE_COLOR[p.role] || '#22d3ee',
      fillOpacity: 0.12
    }).addTo(markerLayer)
  })

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
  } else {
    map.setView([29.6761, 115.681], 13)
  }

  setTimeout(() => map.invalidateSize(), 80)

  const stallN = allGeo.filter((p) => p.role === 'stall').length
  const crossN = allGeo.filter((p) => p.role === 'cross').length
  const supplyN = allGeo.filter((p) => p.role === 'supply').length
  document.getElementById('mapStat').innerHTML = `
    <span>地图点位 <b>${filtered.length}</b> / ${allGeo.length}</span>
    <span class="role-stall">地摊 <b>${stallN}</b></span>
    <span class="role-cross">异业 <b>${crossN}</b></span>
    <span class="role-supply">供应链 <b>${supplyN}</b></span>`

  const hot = [...allGeo].sort((a, b) => Number(b.visits) - Number(a.visits)).slice(0, 6)
  document.getElementById('hotStores').innerHTML = hot.length
    ? hot
        .map(
          (p) => `<div class="hot-store">
            <span>${esc(p.name)}<span class="role role-${esc(p.role)}">${esc(ROLE_LABEL[p.role] || p.role)}</span></span>
            <b>${p.visits || 0}</b>
          </div>`
        )
        .join('')
    : '<div class="hot-store"><span class="muted">暂无热点门店</span></div>'
}

function renderGoods(list) {
  const typeLabel = { stall: '地摊', cross: '异业', supply: '供应链' }
  const sorted = [...(list || [])].sort((a, b) => Number(b.sales) - Number(a.sales)).slice(0, 8)
  document.getElementById('goods').innerHTML = sorted
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

function bindMapFilters() {
  document.querySelectorAll('#mapFilters .chip').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('#mapFilters .chip').forEach((b) => b.classList.remove('on'))
      btn.classList.add('on')
      mapFilter = btn.dataset.role
      renderMap(allGeo)
    }
  })
}

async function load() {
  tick()
  const data = await api('/admin/ops/screen')
  lastData = data
  renderKpis(data.kpis)
  renderGmvMix(data.kpis)
  renderTrend(data.visitTrend || [])
  renderBars(
    document.getElementById('roleMix'),
    data.roleMix || [],
    'label',
    'count',
    (r) => ROLE_COLOR[r.role] || '#22d3ee'
  )
  renderBars(
    document.getElementById('cities'),
    data.hotCities || [],
    'city',
    'visits',
    (_, i) => `hsl(${190 + i * 12}, 90%, 60%)`
  )
  renderMap(data.geoPoints || [])
  renderGoods(data.topGoods || [])
  const updated = document.getElementById('updatedAt')
  if (updated) {
    updated.textContent = `更新于 ${new Date(data.updatedAt || Date.now()).toLocaleString('zh-CN', { hour12: false })}`
  }
}

bindMapFilters()
setInterval(tick, 1000)
window.addEventListener('resize', () => {
  if (lastData) renderTrend(lastData.visitTrend || [])
  if (map) setTimeout(() => map.invalidateSize(), 100)
})

load().catch((e) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<p style="color:#ff8a93;padding:16px;position:relative;z-index:2">${esc(e.message)}</p>`
  )
})
setInterval(() => {
  load().catch(() => {})
}, 60000)

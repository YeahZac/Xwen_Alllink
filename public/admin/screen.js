const TOKEN_KEY = 'xwen_admin_token'

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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

function renderKpis(k) {
  const items = [
    ['今日访问', k.visitsToday],
    ['近7日访问', k.visits7d],
    ['今日订单', k.ordersToday],
    ['交易流水¥', k.gmvTotal],
    ['营业门店', k.openStores],
    ['C端用户', k.consumers],
    ['地摊', k.stalls],
    ['异业', k.crosses],
    ['供应链', k.supplies]
  ]
  document.getElementById('kpis').innerHTML = items
    .map(([l, n]) => `<div class="kpi"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`)
    .join('')
}

function renderBars(el, rows, labelKey, valueKey) {
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1)
  el.innerHTML = rows
    .map((r) => {
      const v = Number(r[valueKey]) || 0
      const pct = Math.round((v / max) * 100)
      return `<div class="row"><span>${esc(r[labelKey])}</span><div class="bar"><i style="width:${pct}%"></i></div><span>${v}</span></div>`
    })
    .join('')
}

function renderTrend(points) {
  const canvas = document.getElementById('trend')
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  if (!points.length) return
  const max = Math.max(...points.map((p) => Number(p.visits) || 0), 1)
  const pad = 24
  ctx.strokeStyle = 'rgba(80,140,220,.35)'
  ctx.beginPath()
  ctx.moveTo(pad, h - pad)
  ctx.lineTo(w - pad, h - pad)
  ctx.stroke()
  ctx.strokeStyle = '#3ad0ff'
  ctx.lineWidth = 2
  ctx.beginPath()
  points.forEach((p, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(points.length - 1, 1)
    const y = h - pad - ((Number(p.visits) || 0) / max) * (h - pad * 2)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.fillStyle = '#9ec5ff'
  ctx.font = '12px sans-serif'
  points.forEach((p, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(points.length - 1, 1)
    const day = String(p.day).slice(5, 10)
    ctx.fillText(day, x - 12, h - 6)
  })
}

function renderMap(points) {
  const map = document.getElementById('map')
  const legend = document.getElementById('mapLegend')
  if (!points.length) {
    map.innerHTML = '<div style="padding:24px;color:#7f97b3">暂无坐标数据</div>'
    return
  }
  const lats = points.map((p) => Number(p.lat))
  const lngs = points.map((p) => Number(p.lng))
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const dLat = Math.max(maxLat - minLat, 0.01)
  const dLng = Math.max(maxLng - minLng, 0.01)
  map.innerHTML = points
    .map((p) => {
      const x = ((Number(p.lng) - minLng) / dLng) * 86 + 7
      const y = (1 - (Number(p.lat) - minLat) / dLat) * 80 + 10
      return `<span class="dot ${esc(p.role)}" style="left:${x}%;top:${y}%" title="${esc(p.name)} · 访问${p.visits}"></span>`
    })
    .join('')
  legend.innerHTML =
    points
      .slice(0, 8)
      .map(
        (p) =>
          `<div>● ${esc(p.name)} <span style="color:#7f97b3">(${esc(p.role)}) 访问 ${p.visits}</span></div>`
      )
      .join('') +
    `<div style="margin-top:8px">红=地摊 · 橙=异业 · 绿=供应链</div>`
}

function renderGoods(list) {
  const el = document.getElementById('goods')
  el.innerHTML = list
    .slice(0, 12)
    .map(
      (g) =>
        `<div class="item"><span>${esc(g.type)} · ${esc(g.name)} <code>${esc(g.sku || '')}</code></span><strong>销量 ${g.sales}</strong></div>`
    )
    .join('')
}

async function load() {
  tick()
  const data = await api('/admin/ops/screen')
  renderKpis(data.kpis)
  renderTrend(data.visitTrend || [])
  renderBars(document.getElementById('roleMix'), data.roleMix || [], 'label', 'count')
  renderBars(document.getElementById('cities'), data.hotCities || [], 'city', 'visits')
  renderMap(data.geoPoints || [])
  renderGoods(data.topGoods || [])
}

setInterval(tick, 1000)
load().catch((e) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<p style="color:#ff8a93;padding:16px">${esc(e.message)}</p>`
  )
})
setInterval(() => {
  load().catch(() => {})
}, 60000)

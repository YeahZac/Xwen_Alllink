const TOKEN_KEY = 'xwen_admin_token'
const PROFILE_KEY = 'xwen_admin_profile'

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  profile: JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'),
  page: 'dashboard',
  permissions: {}
}

const NAV_GROUPS = [
  {
    name: '数据洞察',
    items: [
      { id: 'screen', label: '数据大屏' },
      { id: 'dashboard', label: '概览' }
    ]
  },
  {
    name: '用户与门店',
    items: [
      { id: 'users_all', label: '用户总览' },
      { id: 'users_consumer', label: 'C端用户' },
      { id: 'stores_stall', label: '地摊门店' },
      { id: 'stores_cross', label: '异业门店' },
      { id: 'stores_supply', label: '供应链' },
      { id: 'applies', label: '入驻审核' }
    ]
  },
  {
    name: '内容管理',
    items: [
      { id: 'goods_sku', label: '商品SKU' },
      { id: 'goods', label: '商品目录' },
      { id: 'banners', label: 'Banner' },
      { id: 'orders', label: '订单中心' },
      { id: 'configs', label: '平台配置' },
      { id: 'withdraws', label: '提现审核' },
      { id: 'complaints', label: '投诉工单' },
      { id: 'needs', label: '供应需求' },
      { id: 'referrals', label: '推荐记录' }
    ]
  },
  {
    name: '系统管理',
    items: [
      { id: 'sys_roles', label: '角色权限' },
      { id: 'sys_accounts', label: '账号管理' },
      { id: 'sys_media', label: '媒体资源' }
    ]
  }
]

const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items)

function canView(page) {
  const p = state.permissions?.[page]
  if (!p && (state.profile?.roleCode === 'super_admin' || state.profile?.roleId === 1)) return true
  return !!(p && p.view)
}

function canEdit(page) {
  const p = state.permissions?.[page]
  if (!p && (state.profile?.roleCode === 'super_admin' || state.profile?.roleId === 1)) return true
  return !!(p && p.edit)
}

const $ = (id) => document.getElementById(id)
const content = () => $('content')

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (state.token) headers.Authorization = `Bearer ${state.token}`
  const res = await fetch(`/api${path}`, { ...options, headers })
  const json = await res.json().catch(() => ({}))
  if (res.status === 401) {
    logout(false)
    throw new Error('登录已失效，请重新登录')
  }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(json.message || `请求失败 ${res.status}`)
  }
  return json.data
}

function logout(reload = true) {
  state.token = ''
  state.profile = null
  state.permissions = {}
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(PROFILE_KEY)
  if (reload) location.reload()
}

function showLogin() {
  $('loginView').classList.remove('hidden')
  $('dashView').classList.add('hidden')
}

async function showDash() {
  $('loginView').classList.add('hidden')
  $('dashView').classList.remove('hidden')
  $('who').textContent =
    `${state.profile?.name || state.profile?.nickname || '运营'}` +
    (state.profile?.roleName ? ` · ${state.profile.roleName}` : '')
  state.permissions = state.profile?.permissions || {}
  try {
    const me = await api('/admin/rbac/me')
    state.permissions = me.permissions || state.permissions
    if (state.profile) {
      state.profile.permissions = state.permissions
      localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile))
    }
  } catch (_) {
    /* ignore if table not ready */
  }
  if (!canView(state.page)) {
    const first = ALL_NAV.find((n) => canView(n.id))
    state.page = first ? first.id : 'dashboard'
  }
  renderNav()
  go(state.page)
}

function renderNav() {
  const nav = $('nav')
  const html = []
  for (const g of NAV_GROUPS) {
    const items = g.items.filter((n) => canView(n.id))
    if (!items.length) continue
    html.push(`<div class="nav-group">${esc(g.name)}</div>`)
    for (const n of items) {
      html.push(
        `<button type="button" data-page="${n.id}" class="${state.page === n.id ? 'on' : ''}">${n.label}</button>`
      )
    }
  }
  nav.innerHTML = html.join('')
  nav.querySelectorAll('button[data-page]').forEach((btn) => {
    btn.onclick = () => go(btn.dataset.page)
  })
}

function go(page) {
  if (!canView(page)) {
    content().innerHTML = `<div class="empty">无权限访问该页面</div>`
    return
  }
  state.page = page
  $('pageTitle').textContent = ALL_NAV.find((n) => n.id === page)?.label || page
  renderNav()
  const map = {
    screen: () => {
      window.open('./screen.html', '_blank')
      return Promise.resolve()
    },
    dashboard: renderDashboard,
    users_all: () => renderIdentities('all'),
    users_consumer: () => renderIdentities('consumer'),
    stores_stall: () => renderStores('stall'),
    stores_cross: () => renderStores('cross'),
    stores_supply: () => renderStores('supply'),
    applies: renderApplies,
    merchants: () => renderStores(''),
    users: () => renderIdentities('consumer'),
    goods_sku: renderGoodsSku,
    goods: renderGoods,
    orders: renderOrders,
    banners: renderBanners,
    configs: renderConfigs,
    withdraws: renderWithdraws,
    complaints: renderComplaints,
    needs: renderNeeds,
    referrals: renderReferrals,
    sys_roles: renderSysRoles,
    sys_accounts: renderSysAccounts,
    sys_media: renderSysMedia
  }
  ;(map[page] || renderDashboard)().catch((e) => {
    content().innerHTML = `<div class="empty">${esc(e.message)}</div>`
  })
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`
}

function fmtTime(v) {
  if (!v) return '-'
  try {
    return new Date(v).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(v)
  }
}

function table(headers, rowsHtml) {
  return `<div class="table-wrap"><table><thead><tr>${headers
    .map((h) => `<th>${h}</th>`)
    .join('')}</tr></thead><tbody>${rowsHtml || `<tr><td colspan="${headers.length}" class="empty">暂无数据</td></tr>`}</tbody></table></div>`
}

function openModal(title, bodyHtml, onSave) {
  $('modal').classList.remove('hidden')
  $('modalTitle').textContent = title
  $('modalBody').innerHTML = bodyHtml
  bindMediaFields($('modalBody'))
  $('modalFoot').innerHTML = onSave
    ? `<button type="button" class="btn ghost" id="modalCancel">取消</button>
       <button type="button" class="btn primary" id="modalSave">保存</button>`
    : `<button type="button" class="btn" id="modalCancel">关闭</button>`
  $('modalClose').onclick = closeModal
  $('modalCancel').onclick = closeModal
  if (onSave) {
    $('modalSave').onclick = async () => {
      try {
        await onSave()
        closeModal()
      } catch (e) {
        alert(e.message)
      }
    }
  }
}

function closeModal() {
  $('modal').classList.add('hidden')
}

function field(name, label, value = '', type = 'text') {
  if (type === 'textarea') {
    return `<label>${label}<textarea name="${name}" rows="3">${esc(value)}</textarea></label>`
  }
  if (type === 'select') {
    return ''
  }
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" /></label>`
}

/** 图片/文件上传控件：压缩后上传云托管存储，支持删除 */
function mediaField(name, label, value = '', bizType = 'general') {
  const v = value || ''
  return `<div class="media-field" data-name="${esc(name)}" data-biz="${esc(bizType)}">
    <label>${esc(label)}</label>
    <div class="media-preview">${v ? `<img src="${esc(v)}" alt="" />` : '<span class="muted">未上传</span>'}</div>
    <input type="hidden" name="${esc(name)}" value="${esc(v)}" />
    <div class="media-actions">
      <label class="btn sm">选择文件<input type="file" accept="image/*,.pdf" hidden /></label>
      <button type="button" class="btn sm danger media-del" ${v ? '' : 'disabled'}>删除</button>
      <span class="muted media-tip">图片自动压到 ≤3MB，尽量保清晰</span>
    </div>
  </div>`
}

function bindMediaFields(root = document) {
  root.querySelectorAll('.media-field').forEach((box) => {
    const fileInput = box.querySelector('input[type=file]')
    const hidden = box.querySelector('input[type=hidden]')
    const preview = box.querySelector('.media-preview')
    const delBtn = box.querySelector('.media-del')
    const tip = box.querySelector('.media-tip')
    const bizType = box.dataset.biz || 'general'

    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0]
      if (!file) return
      tip.textContent = '上传中…'
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('bizType', bizType)
        const headers = {}
        if (state.token) headers.Authorization = `Bearer ${state.token}`
        const res = await fetch('/api/admin/media/upload', { method: 'POST', headers, body: fd })
        const json = await res.json()
        if (!res.ok || json.code !== 0) throw new Error(json.message || '上传失败')
        const data = json.data
        hidden.value = data.fileUrl
        preview.innerHTML = `<img src="${esc(data.fileUrl)}" alt="" />`
        delBtn.disabled = false
        tip.textContent = `完成 ${(data.size / 1024).toFixed(0)}KB${data.optimized ? ' · 已优化' : ''}`
      } catch (e) {
        tip.textContent = e.message
        alert(e.message)
      } finally {
        fileInput.value = ''
      }
    }

    delBtn.onclick = async () => {
      const url = hidden.value
      if (!url) return
      if (!confirm('确认删除该资源？')) return
      try {
        await api('/admin/media', {
          method: 'DELETE',
          body: JSON.stringify({ fileUrl: url })
        })
      } catch (_) {
        /* 即使远端删除失败也清空引用 */
      }
      hidden.value = ''
      preview.innerHTML = '<span class="muted">未上传</span>'
      delBtn.disabled = true
      tip.textContent = '已删除'
    }
  })
}

function formVal(name) {
  const el = $('modalBody').querySelector(`[name="${name}"]`)
  return el ? el.value : ''
}

/* ---------- pages ---------- */
async function renderDashboard() {
  const d = await api('/admin/dashboard')
  $('cashRate').textContent = `积分汇率 ${d.cashRate}`
  content().innerHTML = `
    <div class="toolbar">
      <a class="btn primary" href="./screen.html" target="_blank">打开数据大屏</a>
      <button class="btn" id="btnReloadDash">刷新</button>
    </div>
    <div class="stats">
      ${stat(d.users, '用户')}
      ${stat(d.merchants, '营业商户')}
      ${stat(d.pendingApplies, '待审入驻')}
      ${stat(d.poolTotal, '商户额度池')}
      ${stat(d.pointsTotal, '用户积分')}
      ${stat(d.pointsCashValue, '积分约合¥')}
      ${stat(d.consumerOrders, '点餐订单')}
      ${stat(d.crossOrders, '异业订单')}
      ${stat(d.purchaseOrders, '采购订单')}
      ${stat(d.pendingWithdraw, '待审提现')}
      ${stat(d.openComplaints, '未关闭投诉')}
      ${stat(d.openNeeds, '开放需求')}
    </div>
    <div class="panel">
      <h3>运营覆盖</h3>
      <p class="muted">支持分角色管理 C端/地摊/异业/供应链，商品 SKU 启停删除，以及数据大屏（访问、流水、门店、热点地图）。</p>
    </div>`
  $('btnReloadDash').onclick = () => renderDashboard()
}

function stat(n, l) {
  return `<div class="stat"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`
}

async function renderIdentities(role) {
  const editable = canEdit(role === 'consumer' ? 'users_consumer' : 'users_all')
  content().innerHTML = `
    <div class="toolbar">
      <input id="fq" placeholder="昵称/邀请码/手机/店名" />
      <button class="btn" id="btnReload">查询</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const q = $('fq').value.trim()
    const rows = await api(
      `/admin/ops/identities?role=${encodeURIComponent(role)}${q ? `&q=${encodeURIComponent(q)}` : ''}`
    )
    $('list').innerHTML = table(
      ['身份', '名称', '账号/邀请码', '电话', '城市', '状态', '注册', '操作'],
      rows
        .map((r) => {
          const isStore = !!r.merchantId
          return `<tr>
          <td><span class="badge">${esc(r.identityLabel)}</span></td>
          <td>${esc(r.name)}</td><td><code>${esc(r.code)}</code></td>
          <td>${esc(r.phone || '-')}</td><td>${esc(r.city || '-')}</td>
          <td>${r.status}</td><td>${fmtTime(r.createdAt)}</td>
          <td class="actions">
            ${
              isStore
                ? `<button class="btn sm" data-store="${r.merchantId}">资料/详情</button>
                   ${editable ? `<button class="btn ok sm" data-open="${r.merchantId}">营业</button>
                   <button class="btn warn sm" data-close="${r.merchantId}">停业</button>
                   <button class="btn danger sm" data-del-store="${r.merchantId}">删除</button>` : ''}`
                : `${editable ? `<button class="btn sm" data-on="${r.id}">启用</button>
                   <button class="btn warn sm" data-off="${r.id}">禁用</button>
                   <button class="btn danger sm" data-del-user="${r.id}">删除</button>` : '-'}`
            }
          </td></tr>`
        })
        .join('')
    )
    $('list').querySelectorAll('[data-store]').forEach((b) => {
      b.onclick = () => showStoreDetail(Number(b.dataset.store))
    })
    $('list').querySelectorAll('[data-open]').forEach((b) => {
      b.onclick = async () => {
        await api(`/admin/ops/stores/${b.dataset.open}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 1 })
        })
        load()
      }
    })
    $('list').querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = async () => {
        await api(`/admin/ops/stores/${b.dataset.close}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 2 })
        })
        load()
      }
    })
    $('list').querySelectorAll('[data-del-store]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('确认删除该门店？')) return
        await api(`/admin/ops/stores/${b.dataset.delStore}`, { method: 'DELETE' })
        load()
      }
    })
    $('list').querySelectorAll('[data-on]').forEach((b) => {
      b.onclick = async () => {
        await api(`/admin/ops/users/${b.dataset.on}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 1 })
        })
        load()
      }
    })
    $('list').querySelectorAll('[data-off]').forEach((b) => {
      b.onclick = async () => {
        await api(`/admin/ops/users/${b.dataset.off}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 0 })
        })
        load()
      }
    })
    $('list').querySelectorAll('[data-del-user]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('确认删除该用户？')) return
        await api(`/admin/ops/users/${b.dataset.delUser}`, { method: 'DELETE' })
        load()
      }
    })
  }
  $('btnReload').onclick = load
  await load()
}

async function renderStores(role) {
  return renderIdentities(role || 'all')
}

async function showStoreDetail(id) {
  const d = await api(`/admin/ops/stores/${id}`)
  const mats = d.materials || {}
  const matHtml = Object.keys(mats).length
    ? Object.entries(mats)
        .map(([k, v]) => {
          const url = typeof v === 'string' ? v : v?.url || ''
          const isImg = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) || String(url).includes('tcb.qcloud.la')
          return `<div class="perm-row"><span>${esc(k)}</span>
            ${url ? (isImg ? `<img class="thumb" src="${esc(url)}" />` : `<a href="${esc(url)}" target="_blank">查看文件</a>`) : '-'}
          </div>`
        })
        .join('')
    : '<p class="muted">暂无上传资料</p>'
  const goodsHtml = (d.goods || [])
    .slice(0, 20)
    .map((g) => `<div>${esc(g.name)} · SKU ${esc(g.sku_code || '-')} · 销量 ${g.sales_count || 0}</div>`)
    .join('')
  openModal(
    `${d.roleLabel} · ${d.name}`,
    `<p>邀请码 <code>${esc(d.inviteCode)}</code> · 状态 ${d.status} · 额度池 ${d.poolBalance}</p>
     <p class="muted">${esc(d.city)} ${esc(d.address)} · ${esc(d.contactName)} ${esc(d.contactPhone)}</p>
     ${d.coverUrl ? `<p><img class="thumb" src="${esc(d.coverUrl)}" /></p>` : ''}
     <h4>门店资料</h4>${matHtml}
     <h4>在售商品</h4>${goodsHtml || '<p class="muted">暂无商品</p>'}`
  )
}

async function renderGoodsSku() {
  const editable = canEdit('goods_sku')
  content().innerHTML = `
    <div class="toolbar">
      <label for="gType">供应商类型</label>
      <select id="gType">
        <option value="">全部</option>
        <option value="stall">地摊</option>
        <option value="cross">异业门店</option>
        <option value="supply">供应链门店</option>
      </select>
      <label for="gShop">店铺名称</label>
      <select id="gShop"><option value="">全部店铺</option></select>
      <input id="gShopName" placeholder="搜索店名" style="min-width:140px" />
      <button class="btn" id="btnReload">查询</button>
    </div>
    <div id="list"></div>`

  const refreshShops = async () => {
    const type = $('gType').value
    const prev = $('gShop').value
    const role = type || 'all'
    let shops = []
    try {
      if (type) {
        shops = await api(`/admin/ops/identities?role=${type}&limit=200`)
      } else {
        const [stall, cross, supply] = await Promise.all([
          api('/admin/ops/identities?role=stall&limit=100'),
          api('/admin/ops/identities?role=cross&limit=100'),
          api('/admin/ops/identities?role=supply&limit=100')
        ])
        shops = [...stall, ...cross, ...supply]
      }
    } catch (_) {
      shops = []
    }
    shops = shops.filter((s) => s.identity !== 'consumer')
    $('gShop').innerHTML =
      `<option value="">全部店铺</option>` +
      shops
        .map(
          (s) =>
            `<option value="${s.merchantId || s.id}">${esc(s.name)}（${esc(s.identityLabel || s.identity)}）</option>`
        )
        .join('')
    if (prev && [...$('gShop').options].some((o) => o.value === prev)) $('gShop').value = prev
    void role
  }

  const load = async () => {
    const type = $('gType').value
    const merchantId = $('gShop').value
    const shopName = ($('gShopName').value || '').trim()
    const qs = new URLSearchParams()
    if (type) qs.set('type', type)
    if (merchantId) qs.set('merchantId', merchantId)
    if (shopName) qs.set('shopName', shopName)
    const q = qs.toString()
    const rows = await api(`/admin/ops/skus${q ? `?${q}` : ''}`)
    $('list').innerHTML = table(
      ['供应商类型', '店铺名称', 'SKU', '品名', '价格', '销量', '库存', '上架', '操作'],
      rows
        .map(
          (g) => `<tr>
        <td>${esc(g.goodsTypeLabel || g.goodsType)}</td><td>${esc(g.shopName)}</td>
        <td><code>${esc(g.sku)}</code></td><td>${esc(g.name)}</td>
        <td>${g.price}</td><td>${g.sales}</td><td>${g.stock ?? '-'}</td><td>${g.onSale}</td>
        <td class="actions">
          ${
            editable
              ? `<button class="btn sm" data-edit='${encodeURIComponent(JSON.stringify(g))}'>编辑</button>
                 <button class="btn ok sm" data-open="${g.goodsType}:${g.id}">打开</button>
                 <button class="btn warn sm" data-close="${g.goodsType}:${g.id}">关闭</button>
                 <button class="btn danger sm" data-del="${g.goodsType}:${g.id}">删除</button>`
              : '-'
          }
        </td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const g = JSON.parse(decodeURIComponent(b.getAttribute('data-edit')))
        openModal(
          '编辑 SKU',
          field('name', '品名', g.name) +
            field('sku', 'SKU', g.sku || '') +
            field('price', '价格', g.price, 'number') +
            field('sales', '销量', g.sales, 'number') +
            field('stock', '库存', g.stock || 0, 'number') +
            field('onSale', '上架(1/0)', g.onSale ?? 1, 'number') +
            mediaField('imageUrl', '商品图', g.imageUrl || '', 'goods'),
          async () => {
            await api(`/admin/ops/skus/${g.goodsType}/${g.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                name: formVal('name'),
                sku: formVal('sku'),
                price: Number(formVal('price')),
                sales: Number(formVal('sales')),
                stock: Number(formVal('stock')),
                onSale: Number(formVal('onSale')),
                imageUrl: formVal('imageUrl'),
                pointsNeed: g.pointsNeed,
                pointsGrant: g.pointsGrant
              })
            })
            load()
          }
        )
      }
    })
    $('list').querySelectorAll('[data-open]').forEach((b) => {
      b.onclick = async () => {
        const [t, id] = b.dataset.open.split(':')
        await api(`/admin/ops/skus/${t}/${id}/open`, { method: 'POST', body: '{}' })
        load()
      }
    })
    $('list').querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = async () => {
        const [t, id] = b.dataset.close.split(':')
        await api(`/admin/ops/skus/${t}/${id}/close`, { method: 'POST', body: '{}' })
        load()
      }
    })
    $('list').querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('确认删除该商品？')) return
        const [t, id] = b.dataset.del.split(':')
        await api(`/admin/ops/skus/${t}/${id}`, { method: 'DELETE' })
        load()
      }
    })
  }
  $('btnReload').onclick = load
  $('gType').onchange = async () => {
    await refreshShops()
    await load()
  }
  $('gShop').onchange = load
  $('gShopName').onkeydown = (e) => {
    if (e.key === 'Enter') load()
  }
  await refreshShops()
  await load()
}

async function renderApplies() {
  content().innerHTML = `
    <div class="toolbar">
      <select id="fStatus">
        <option value="pending">审核中</option>
        <option value="">全部</option>
        <option value="approved">已通过</option>
        <option value="rejected">已驳回</option>
      </select>
      <button class="btn" id="btnReload">刷新</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const status = $('fStatus').value
    const rows = await api(`/admin/applies${status ? `?status=${status}` : ''}`)
    $('list').innerHTML = table(
      ['ID', '单号', '角色', '店名', '联系人', '城市', '状态', '时间', '操作'],
      rows
        .map(
          (r) => `<tr>
        <td>${r.id}</td><td>${esc(r.applyNo)}</td><td>${esc(r.roleLabel)}</td>
        <td>${esc(r.shopName)}</td><td>${esc(r.contactName)} ${esc(r.contactPhone)}</td>
        <td>${esc(r.city)}</td><td>${badge(r.status)}</td><td>${fmtTime(r.createdAt)}</td>
        <td class="actions">${
          r.status === 'pending'
            ? `<button class="btn ok sm" data-ok="${r.id}">通过</button>
               <button class="btn danger sm" data-no="${r.id}">驳回</button>`
            : '-'
        }</td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-ok]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('确认通过该入驻申请？')) return
        await api(`/admin/apply/${b.dataset.ok}/approve`, { method: 'POST', body: '{}' })
        load()
      }
    })
    $('list').querySelectorAll('[data-no]').forEach((b) => {
      b.onclick = async () => {
        const reason = prompt('驳回原因', '资料不完整')
        if (reason === null) return
        await api(`/admin/apply/${b.dataset.no}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        })
        load()
      }
    })
  }
  $('btnReload').onclick = load
  $('fStatus').onchange = load
  await load()
}

async function renderMerchants() {
  content().innerHTML = `
    <div class="toolbar">
      <select id="fRole">
        <option value="">全部角色</option>
        <option value="stall">地摊</option>
        <option value="cross">异业</option>
        <option value="supply">供应链</option>
      </select>
      <button class="btn" id="btnReload">刷新</button>
      <button class="btn primary" id="btnGrant">发放额度</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const role = $('fRole').value
    const rows = await api(`/admin/merchants${role ? `?role=${role}` : ''}`)
    $('list').innerHTML = table(
      ['ID', '编号', '角色', '名称', '城市', '邀请码', '状态', '额度池', '操作'],
      rows
        .map(
          (m) => `<tr>
        <td>${m.id}</td><td>${esc(m.merchantNo)}</td><td>${esc(m.roleLabel)}</td>
        <td>${esc(m.name)}</td><td>${esc(m.city)}</td><td><code>${esc(m.inviteCode)}</code></td>
        <td>${m.status}</td><td>${m.poolBalance}</td>
        <td class="actions">
          <button class="btn sm" data-detail="${m.id}">详情</button>
          <button class="btn sm" data-edit="${m.id}">编辑</button>
          <button class="btn sm" data-status="${m.id}" data-to="${m.status === 1 ? 2 : 1}">${
            m.status === 1 ? '停业' : '营业'
          }</button>
        </td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-detail]').forEach((b) => {
      b.onclick = async () => {
        const d = await api(`/admin/merchants/${b.dataset.detail}`)
        openModal(
          `商户 ${d.name}`,
          `<p>角色 ${esc(d.roleLabel)} · 邀请码 <code>${esc(d.inviteCode)}</code> · 额度 ${d.poolBalance}</p>
           <p class="muted">${esc(d.city)} ${esc(d.address)}</p>
           <h4>账户</h4>
           <pre>${esc(JSON.stringify(d.accounts, null, 2))}</pre>
           <h4>额度流水</h4>
           <pre>${esc(JSON.stringify(d.poolLedger, null, 2))}</pre>`
        )
      }
    })
    $('list').querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = async () => {
        const d = await api(`/admin/merchants/${b.dataset.edit}`)
        openModal(
          '编辑商户',
          field('name', '名称', d.name) +
            field('city', '城市', d.city) +
            field('address', '地址', d.address) +
            field('contactName', '联系人', d.contactName) +
            field('contactPhone', '电话', d.contactPhone) +
            mediaField('coverUrl', '门店封面图', d.coverUrl || '', 'merchant'),
          async () => {
            await api(`/admin/merchants/${d.id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                name: formVal('name'),
                city: formVal('city'),
                address: formVal('address'),
                contactName: formVal('contactName'),
                contactPhone: formVal('contactPhone'),
                coverUrl: formVal('coverUrl')
              })
            })
            load()
          }
        )
      }
    })
    $('list').querySelectorAll('[data-status]').forEach((b) => {
      b.onclick = async () => {
        await api(`/admin/merchants/${b.dataset.status}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: Number(b.dataset.to) })
        })
        load()
      }
    })
  }
  $('btnGrant').onclick = () => {
    openModal(
      '发放积分额度',
      field('merchantId', '商户 ID', '', 'number') +
        field('points', '积分数量', '500', 'number') +
        field('title', '备注', '后台发放'),
      async () => {
        await api('/admin/points-pool/grant', {
          method: 'POST',
          body: JSON.stringify({
            merchantId: Number(formVal('merchantId')),
            points: Number(formVal('points')),
            title: formVal('title')
          })
        })
        load()
      }
    )
  }
  $('btnReload').onclick = load
  $('fRole').onchange = load
  await load()
}

async function renderUsers() {
  content().innerHTML = `
    <div class="toolbar">
      <input id="fq" placeholder="昵称/邀请码/手机" />
      <button class="btn" id="btnReload">查询</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const q = $('fq').value.trim()
    const rows = await api(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`)
    $('list').innerHTML = table(
      ['ID', '昵称', '邀请码', '手机', '积分', '状态', '注册', '操作'],
      rows
        .map(
          (u) => `<tr>
        <td>${u.id}</td><td>${esc(u.nickname)}</td><td><code>${esc(u.inviteCode)}</code></td>
        <td>${esc(u.phone || '-')}</td><td>${u.points}</td><td>${u.status}</td>
        <td>${fmtTime(u.createdAt)}</td>
        <td class="actions">
          <button class="btn sm" data-pts="${u.id}">调积分</button>
          <button class="btn sm" data-toggle="${u.id}" data-to="${u.status === 1 ? 0 : 1}">${
            u.status === 1 ? '禁用' : '启用'
          }</button>
        </td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-pts]').forEach((b) => {
      b.onclick = () => {
        openModal(
          '调整用户积分',
          field('points', '变动量（可负）', '100', 'number') + field('title', '备注', '后台调整'),
          async () => {
            await api(`/admin/users/${b.dataset.pts}/points`, {
              method: 'POST',
              body: JSON.stringify({ points: Number(formVal('points')), title: formVal('title') })
            })
            load()
          }
        )
      }
    })
    $('list').querySelectorAll('[data-toggle]').forEach((b) => {
      b.onclick = async () => {
        await api(`/admin/users/${b.dataset.toggle}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: Number(b.dataset.to) })
        })
        load()
      }
    })
  }
  $('btnReload').onclick = load
  await load()
}

async function renderGoods() {
  content().innerHTML = `
    <div class="toolbar">
      <select id="gType">
        <option value="stall">地摊菜单</option>
        <option value="cross">异业兑换</option>
        <option value="supply">供应链货品</option>
      </select>
      <button class="btn" id="btnReload">刷新</button>
      <button class="btn primary" id="btnAdd">新建</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const type = $('gType').value
    const rows = await api(`/admin/goods/${type}`)
    if (type === 'stall') {
      $('list').innerHTML = table(
        ['ID', '商户', '店名', '品名', '价', '积分', '分类', '库存', '上架', '操作'],
        rows
          .map(
            (g) => `<tr>
          <td>${g.id}</td><td>${g.merchantId}</td><td>${esc(g.shopName)}</td><td>${esc(g.name)}</td>
          <td>${g.price}</td><td>${g.pointsGrant}</td><td>${esc(g.category)}</td><td>${g.stock}</td>
          <td>${g.onSale}</td>
          <td><button class="btn sm" data-edit="${encodeURIComponent(JSON.stringify(g))}">编辑</button></td></tr>`
          )
          .join('')
      )
    } else if (type === 'cross') {
      $('list').innerHTML = table(
        ['ID', '商户', '店名', '品名', '积分', '现金价', '上架', '操作'],
        rows
          .map(
            (g) => `<tr>
          <td>${g.id}</td><td>${g.merchantId}</td><td>${esc(g.shopName)}</td><td>${esc(g.name)}</td>
          <td>${g.pointsNeed}</td><td>${g.cashPrice}</td><td>${g.onSale}</td>
          <td><button class="btn sm" data-edit="${encodeURIComponent(JSON.stringify(g))}">编辑</button></td></tr>`
          )
          .join('')
      )
    } else {
      $('list').innerHTML = table(
        ['ID', '商户', '供应方', '品名', '价', '库存', '积分', '状态', '操作'],
        rows
          .map(
            (g) => `<tr>
          <td>${g.id}</td><td>${g.merchantId}</td><td>${esc(g.vendor)}</td><td>${esc(g.name)}</td>
          <td>${g.price}</td><td>${g.stock}</td><td>${g.pointsGrant}</td><td>${g.status}</td>
          <td><button class="btn sm" data-edit="${encodeURIComponent(JSON.stringify(g))}">编辑</button></td></tr>`
          )
          .join('')
      )
    }
    $('list').querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => editGoods(type, JSON.parse(decodeURIComponent(b.getAttribute('data-edit'))), load)
    })
  }
  $('btnAdd').onclick = () => editGoods($('gType').value, null, load)
  $('btnReload').onclick = load
  $('gType').onchange = load
  await load()
}

function editGoods(type, g, reload) {
  const isNew = !g
  g = g || { merchantId: '', name: '', onSale: 1, status: 1, imageUrl: '' }
  let fields = field('merchantId', '商户 ID', g.merchantId, 'number') + field('name', '品名', g.name)
  if (type === 'stall') {
    fields +=
      field('price', '价格', g.price || '', 'number') +
      field('pointsGrant', '划拨积分', g.pointsGrant || 0, 'number') +
      field('category', '分类', g.category || '主食') +
      field('stock', '库存', g.stock || 9999, 'number') +
      field('onSale', '上架(1/0)', g.onSale ?? 1, 'number') +
      field('description', '描述', g.description || '') +
      mediaField('imageUrl', '商品图片', g.imageUrl || '', 'goods')
  } else if (type === 'cross') {
    fields +=
      field('pointsNeed', '所需积分', g.pointsNeed || 0, 'number') +
      field('cashPrice', '现金价', g.cashPrice || 0, 'number') +
      field('onSale', '上架(1/0)', g.onSale ?? 1, 'number') +
      field('description', '描述', g.description || '') +
      mediaField('imageUrl', '商品图片', g.imageUrl || '', 'goods')
  } else {
    fields +=
      field('price', '采购价', g.price || '', 'number') +
      field('stock', '库存', g.stock || 0, 'number') +
      field('pointsGrant', '买方获积分', g.pointsGrant || 0, 'number') +
      field('pointsRatio', '积分说明', g.pointsRatio || '') +
      field('status', '状态(1/0)', g.status ?? 1, 'number') +
      mediaField('imageUrl', '商品图片', g.imageUrl || '', 'goods')
  }
  openModal(isNew ? '新建商品' : '编辑商品', fields, async () => {
    const body = {
      id: g.id,
      merchantId: Number(formVal('merchantId')),
      name: formVal('name'),
      price: Number(formVal('price') || 0),
      pointsGrant: Number(formVal('pointsGrant') || 0),
      category: formVal('category'),
      stock: Number(formVal('stock') || 0),
      onSale: Number(formVal('onSale') || 0),
      description: formVal('description'),
      pointsNeed: Number(formVal('pointsNeed') || 0),
      cashPrice: Number(formVal('cashPrice') || 0),
      pointsRatio: formVal('pointsRatio'),
      status: Number(formVal('status') || 0),
      imageUrl: formVal('imageUrl')
    }
    await api(`/admin/goods/${type}`, { method: 'POST', body: JSON.stringify(body) })
    reload()
  })
}

async function renderOrders() {
  content().innerHTML = `
    <div class="toolbar">
      <select id="oType">
        <option value="consumer">点餐订单</option>
        <option value="cross">异业订单</option>
        <option value="purchase">采购订单</option>
      </select>
      <button class="btn" id="btnReload">刷新</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const type = $('oType').value
    const rows = await api(`/admin/orders/${type}`)
    if (type === 'consumer') {
      $('list').innerHTML = table(
        ['单号', '用户', '门店', '金额', '积分', '支付', '状态', '时间'],
        rows
          .map(
            (o) => `<tr>
          <td>${esc(o.orderNo)}</td><td>${esc(o.userName)}</td><td>${esc(o.shopName)}</td>
          <td>${o.totalAmount}</td><td>${o.pointsAllocated}</td><td>${esc(o.payStatus)}</td>
          <td>${esc(o.orderStatus)}</td><td>${fmtTime(o.createdAt)}</td></tr>`
          )
          .join('')
      )
    } else if (type === 'cross') {
      $('list').innerHTML = table(
        ['单号', '用户', '门店', '商品', '方式', '积分', '现金', '状态', '时间'],
        rows
          .map(
            (o) => `<tr>
          <td>${esc(o.orderNo)}</td><td>${esc(o.userName)}</td><td>${esc(o.shopName)}</td>
          <td>${esc(o.goodsName)}</td><td>${esc(o.payMode)}</td><td>${o.pointsSpend}</td>
          <td>${o.cashAmount}</td><td>${esc(o.status)}</td><td>${fmtTime(o.createdAt)}</td></tr>`
          )
          .join('')
      )
    } else {
      $('list').innerHTML = table(
        ['单号', '买方', '卖方', '金额', '积分', '履约', '状态', '时间'],
        rows
          .map(
            (o) => `<tr>
          <td>${esc(o.orderNo)}</td><td>${esc(o.buyerName)}</td><td>${esc(o.sellerName)}</td>
          <td>${o.totalAmount}</td><td>${o.pointsGrant}</td><td>${esc(o.fulfillType)}</td>
          <td>${esc(o.status)}</td><td>${fmtTime(o.createdAt)}</td></tr>`
          )
          .join('')
      )
    }
  }
  $('btnReload').onclick = load
  $('oType').onchange = load
  await load()
}

async function renderBanners() {
  content().innerHTML = `
    <div class="toolbar">
      <button class="btn" id="btnReload">刷新</button>
      <button class="btn primary" id="btnAdd">新建 Banner</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const rows = await api('/admin/banners')
    $('list').innerHTML = table(
      ['ID', '范围', '标题', '副标', '排序', '状态', '操作'],
      rows
        .map(
          (b) => `<tr>
        <td>${b.id}</td><td>${esc(b.roleScope)}</td><td>${esc(b.title)}</td>
        <td>${esc(b.subTitle)}</td><td>${b.sortOrder}</td><td>${b.status}</td>
        <td class="actions">
          <button class="btn sm" data-edit="${encodeURIComponent(JSON.stringify(b))}">编辑</button>
          <button class="btn danger sm" data-del="${b.id}">删除</button>
        </td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-edit]').forEach((btn) => {
      btn.onclick = () => editBanner(JSON.parse(decodeURIComponent(btn.getAttribute('data-edit'))), load)
    })
    $('list').querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('确认删除？')) return
        await api(`/admin/banners/${btn.dataset.del}`, { method: 'DELETE' })
        load()
      }
    })
  }
  $('btnAdd').onclick = () => editBanner(null, load)
  $('btnReload').onclick = load
  await load()
}

function editBanner(b, reload) {
  b = b || { roleScope: 'consumer', title: '', subTitle: '', imageUrl: '', sortOrder: 0, status: 1 }
  openModal(
    b.id ? '编辑 Banner' : '新建 Banner',
    field('roleScope', '范围 consumer/stall/cross/supply/login', b.roleScope) +
      field('title', '标题', b.title) +
      field('subTitle', '副标题', b.subTitle) +
      mediaField('imageUrl', 'Banner 图片', b.imageUrl || '', 'banner') +
      field('linkUrl', '跳转', b.linkUrl || '') +
      field('linkType', '链接类型 navigate/switchTab/none', b.linkType || 'none') +
      field('sortOrder', '排序', b.sortOrder, 'number') +
      field('status', '状态(1/0)', b.status, 'number'),
    async () => {
      await api('/admin/banners', {
        method: 'POST',
        body: JSON.stringify({
          id: b.id,
          roleScope: formVal('roleScope'),
          title: formVal('title'),
          subTitle: formVal('subTitle'),
          imageUrl: formVal('imageUrl'),
          linkUrl: formVal('linkUrl'),
          linkType: formVal('linkType'),
          sortOrder: Number(formVal('sortOrder') || 0),
          status: Number(formVal('status') || 0)
        })
      })
      reload()
    }
  )
}

async function renderConfigs() {
  content().innerHTML = `
    <div class="toolbar">
      <button class="btn" id="btnReload">刷新</button>
      <button class="btn primary" id="btnAdd">新增配置</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const rows = await api('/admin/configs')
    $('list').innerHTML = table(
      ['键', '值', '备注', '更新', '操作'],
      rows
        .map(
          (c) => `<tr>
        <td><code>${esc(c.key)}</code></td><td>${esc(c.value)}</td>
        <td>${esc(c.remark || '')}</td><td>${fmtTime(c.updatedAt)}</td>
        <td><button class="btn sm" data-key="${esc(c.key)}" data-val="${esc(c.value)}" data-remark="${esc(
            c.remark || ''
          )}">修改</button></td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-key]').forEach((b) => {
      b.onclick = () => {
        openModal(
          `配置 ${b.dataset.key}`,
          field('value', '值', b.dataset.val) + field('remark', '备注', b.dataset.remark),
          async () => {
            await api(`/admin/configs/${encodeURIComponent(b.dataset.key)}`, {
              method: 'PUT',
              body: JSON.stringify({ value: formVal('value'), remark: formVal('remark') })
            })
            load()
          }
        )
      }
    })
  }
  $('btnAdd').onclick = () => {
    openModal(
      '新增配置',
      field('key', '键', 'points_cash_rate') + field('value', '值', '0.01') + field('remark', '备注', ''),
      async () => {
        await api(`/admin/configs/${encodeURIComponent(formVal('key'))}`, {
          method: 'PUT',
          body: JSON.stringify({ value: formVal('value'), remark: formVal('remark') })
        })
        load()
      }
    )
  }
  $('btnReload').onclick = load
  await load()
}

async function renderWithdraws() {
  content().innerHTML = `
    <div class="toolbar">
      <select id="fStatus">
        <option value="pending">待审</option>
        <option value="">全部</option>
        <option value="approved">已通过</option>
        <option value="paid">已打款</option>
        <option value="rejected">已驳回</option>
      </select>
      <button class="btn" id="btnReload">刷新</button>
      <button class="btn" id="btnDemo">演示申请</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const status = $('fStatus').value
    const rows = await api(`/admin/withdraws${status ? `?status=${status}` : ''}`)
    $('list').innerHTML = table(
      ['ID', '单号', '商户', '账户', '金额', '状态', '时间', '操作'],
      rows
        .map(
          (w) => `<tr>
        <td>${w.id}</td><td>${esc(w.requestNo)}</td><td>${esc(w.shopName)}</td>
        <td>${esc(w.accountType)}</td><td>${w.amount}</td><td>${badge(w.status)}</td>
        <td>${fmtTime(w.createdAt)}</td>
        <td class="actions">${
          w.status === 'pending'
            ? `<button class="btn ok sm" data-act="approve" data-id="${w.id}">通过</button>
               <button class="btn danger sm" data-act="reject" data-id="${w.id}">驳回</button>`
            : w.status === 'approved'
              ? `<button class="btn primary sm" data-act="paid" data-id="${w.id}">已打款</button>`
              : '-'
        }</td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        await api(`/admin/withdraws/${b.dataset.id}/review`, {
          method: 'POST',
          body: JSON.stringify({ action: b.dataset.act })
        })
        load()
      }
    })
  }
  $('btnDemo').onclick = () => {
    openModal(
      '创建演示提现',
      field('merchantId', '商户 ID', '1', 'number') +
        field('amount', '金额', '100', 'number') +
        field('accountType', '账户类型', 'cash_settlement'),
      async () => {
        await api('/admin/withdraws/demo', {
          method: 'POST',
          body: JSON.stringify({
            merchantId: Number(formVal('merchantId')),
            amount: Number(formVal('amount')),
            accountType: formVal('accountType')
          })
        })
        load()
      }
    )
  }
  $('btnReload').onclick = load
  $('fStatus').onchange = load
  await load()
}

async function renderComplaints() {
  content().innerHTML = `
    <div class="toolbar">
      <select id="fStatus">
        <option value="">全部</option>
        <option value="open">open</option>
        <option value="processing">processing</option>
        <option value="closed">closed</option>
      </select>
      <button class="btn" id="btnReload">刷新</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const status = $('fStatus').value
    const rows = await api(`/admin/complaints${status ? `?status=${status}` : ''}`)
    $('list').innerHTML = table(
      ['ID', '用户', '类型', '内容', '状态', '时间', '操作'],
      rows
        .map(
          (c) => `<tr>
        <td>${c.id}</td><td>${esc(c.userName)}</td><td>${esc(c.targetType)}</td>
        <td style="max-width:280px;white-space:normal">${esc(c.content)}</td>
        <td>${badge(c.status)}</td><td>${fmtTime(c.createdAt)}</td>
        <td class="actions">
          <button class="btn sm" data-id="${c.id}" data-s="processing">处理中</button>
          <button class="btn ok sm" data-id="${c.id}" data-s="closed">关闭</button>
        </td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-s]').forEach((b) => {
      b.onclick = async () => {
        await api(`/admin/complaints/${b.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: b.dataset.s })
        })
        load()
      }
    })
  }
  $('btnReload').onclick = load
  $('fStatus').onchange = load
  await load()
}

async function renderNeeds() {
  content().innerHTML = `
    <div class="toolbar">
      <select id="fStatus">
        <option value="">全部</option>
        <option value="open">open</option>
        <option value="quoted">quoted</option>
        <option value="closed">closed</option>
      </select>
      <button class="btn" id="btnReload">刷新</button>
    </div>
    <div id="list"></div>`
  const load = async () => {
    const status = $('fStatus').value
    const rows = await api(`/admin/supply-needs${status ? `?status=${status}` : ''}`)
    $('list').innerHTML = table(
      ['ID', '品名', '数量', '期望', '备注', '状态', '时间', '操作'],
      rows
        .map(
          (n) => `<tr>
        <td>${n.id}</td><td>${esc(n.goodsName)}</td><td>${esc(n.qtyText)}</td>
        <td>${esc(n.expectTime)}</td><td style="max-width:200px;white-space:normal">${esc(n.note)}</td>
        <td>${badge(n.status)}</td><td>${fmtTime(n.createdAt)}</td>
        <td class="actions">
          <button class="btn sm" data-id="${n.id}" data-s="quoted">已报价</button>
          <button class="btn ok sm" data-id="${n.id}" data-s="closed">关闭</button>
        </td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-s]').forEach((b) => {
      b.onclick = async () => {
        await api(`/admin/supply-needs/${b.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: b.dataset.s })
        })
        load()
      }
    })
  }
  $('btnReload').onclick = load
  $('fStatus').onchange = load
  await load()
}

async function renderReferrals() {
  content().innerHTML = `<div class="toolbar"><button class="btn" id="btnReload">刷新</button></div><div id="list"></div>`
  const load = async () => {
    const rows = await api('/admin/referrals')
    $('list').innerHTML = table(
      ['ID', '邀请人', '被邀请', '触发', '奖励积分', '时间'],
      rows
        .map(
          (r) => `<tr>
        <td>${r.id}</td>
        <td>${esc(r.inviterName)} <code>${esc(r.inviterCode)}</code></td>
        <td>${esc(r.inviteeName)} <code>${esc(r.inviteeCode)}</code></td>
        <td>${esc(r.triggerType)}</td><td>${r.rewardPoints}</td><td>${fmtTime(r.createdAt)}</td></tr>`
        )
        .join('')
    )
  }
  $('btnReload').onclick = load
  await load()
}

/* ---------- 系统管理 ---------- */
async function renderSysRoles() {
  const editable = canEdit('sys_roles')
  content().innerHTML = `
    <div class="toolbar">
      <button class="btn" id="btnReload">刷新</button>
      ${editable ? '<button class="btn primary" id="btnAdd">新建角色</button>' : ''}
    </div>
    <div id="list"></div>`
  const load = async () => {
    const rows = await api('/admin/rbac/roles')
    $('list').innerHTML = table(
      ['ID', '编码', '名称', '账号数', '系统', '状态', '操作'],
      rows
        .map(
          (r) => `<tr>
        <td>${r.id}</td><td><code>${esc(r.code)}</code></td><td>${esc(r.name)}</td>
        <td>${r.accountCount}</td><td>${r.isSystem ? '是' : '否'}</td><td>${r.status}</td>
        <td class="actions">
          <button class="btn sm" data-perm="${r.id}">配置权限</button>
          ${editable ? `<button class="btn sm" data-edit='${encodeURIComponent(JSON.stringify(r))}'>编辑</button>` : ''}
        </td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-perm]').forEach((b) => {
      b.onclick = () => editRolePermissions(Number(b.dataset.perm), editable)
    })
    $('list').querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const r = JSON.parse(decodeURIComponent(b.getAttribute('data-edit')))
        openModal(
          '编辑角色',
          field('name', '名称', r.name) +
            field('remark', '备注', r.remark || '') +
            field('status', '状态(1/0)', r.status, 'number'),
          async () => {
            await api('/admin/rbac/roles', {
              method: 'POST',
              body: JSON.stringify({
                id: r.id,
                name: formVal('name'),
                remark: formVal('remark'),
                status: Number(formVal('status'))
              })
            })
            load()
          }
        )
      }
    })
  }
  if ($('btnAdd')) {
    $('btnAdd').onclick = () => {
      openModal(
        '新建角色',
        field('code', '编码（英文）', 'operator') +
          field('name', '名称', '运营专员') +
          field('remark', '备注', ''),
        async () => {
          await api('/admin/rbac/roles', {
            method: 'POST',
            body: JSON.stringify({
              code: formVal('code'),
              name: formVal('name'),
              remark: formVal('remark'),
              status: 1
            })
          })
          load()
        }
      )
    }
  }
  $('btnReload').onclick = load
  await load()
}

async function editRolePermissions(roleId, editable) {
  const detail = await api(`/admin/rbac/roles/${roleId}`)
  const rows = detail.permissions || []
  const body = `
    <p class="muted">${esc(detail.name)}（${esc(detail.code)}）· 勾选浏览 / 编辑</p>
    <div class="perm-grid" id="permGrid">
      ${rows
        .map(
          (p) => `<div class="perm-row" data-key="${esc(p.pageKey)}">
        <span>${esc(p.groupName)} / ${esc(p.pageName)}</span>
        <label><input type="checkbox" data-v ${p.canView ? 'checked' : ''} ${editable ? '' : 'disabled'}/>浏览</label>
        <label><input type="checkbox" data-e ${p.canEdit ? 'checked' : ''} ${editable ? '' : 'disabled'}/>编辑</label>
      </div>`
        )
        .join('')}
    </div>`
  openModal(
    '配置权限',
    body,
    editable
      ? async () => {
          const permissions = [...$('permGrid').querySelectorAll('.perm-row')].map((row) => ({
            pageKey: row.dataset.key,
            canView: row.querySelector('[data-v]').checked,
            canEdit: row.querySelector('[data-e]').checked
          }))
          await api(`/admin/rbac/roles/${roleId}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({ permissions })
          })
        }
      : null
  )
}

async function renderSysAccounts() {
  const editable = canEdit('sys_accounts')
  const roles = await api('/admin/rbac/roles')
  content().innerHTML = `
    <div class="toolbar">
      <button class="btn" id="btnReload">刷新</button>
      ${editable ? '<button class="btn primary" id="btnAdd">新建账号</button>' : ''}
    </div>
    <div id="list"></div>`
  const roleOptions = roles
    .map((r) => `<option value="${r.id}">${esc(r.name)} (${esc(r.code)})</option>`)
    .join('')
  const load = async () => {
    const rows = await api('/admin/rbac/accounts')
    $('list').innerHTML = table(
      ['ID', '账号', '姓名', '角色', '状态', '最近登录', '操作'],
      rows
        .map(
          (a) => `<tr>
        <td>${a.id}</td><td><code>${esc(a.username)}</code></td><td>${esc(a.displayName)}</td>
        <td>${esc(a.roleName)}</td><td>${a.status}</td><td>${fmtTime(a.lastLoginAt)}</td>
        <td class="actions">
          ${editable ? `<button class="btn sm" data-edit='${encodeURIComponent(JSON.stringify(a))}'>编辑</button>` : '-'}
        </td></tr>`
        )
        .join('')
    )
    $('list').querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const a = JSON.parse(decodeURIComponent(b.getAttribute('data-edit')))
        openModal(
          '编辑账号',
          field('displayName', '显示名', a.displayName) +
            `<label>角色<select name="roleId">${roleOptions}</select></label>` +
            field('password', '新密码（留空不改）', '', 'password') +
            field('status', '状态(1/0)', a.status, 'number'),
          async () => {
            await api('/admin/rbac/accounts', {
              method: 'POST',
              body: JSON.stringify({
                id: a.id,
                username: a.username,
                displayName: formVal('displayName'),
                roleId: Number(formVal('roleId')),
                password: formVal('password') || undefined,
                status: Number(formVal('status'))
              })
            })
            load()
          }
        )
        $('modalBody').querySelector('[name="roleId"]').value = String(a.roleId)
      }
    })
  }
  if ($('btnAdd')) {
    $('btnAdd').onclick = () => {
      openModal(
        '新建账号',
        field('username', '登录账号', '') +
          field('displayName', '显示名', '') +
          field('password', '初始密码', '', 'password') +
          `<label>角色<select name="roleId">${roleOptions}</select></label>`,
        async () => {
          await api('/admin/rbac/accounts', {
            method: 'POST',
            body: JSON.stringify({
              username: formVal('username'),
              displayName: formVal('displayName'),
              password: formVal('password'),
              roleId: Number(formVal('roleId')),
              status: 1
            })
          })
          load()
        }
      )
    }
  }
  $('btnReload').onclick = load
  await load()
}

async function renderSysMedia() {
  const editable = canEdit('sys_media')
  content().innerHTML = `
    <div class="toolbar">
      <select id="fBiz">
        <option value="">全部类型</option>
        <option value="banner">banner</option>
        <option value="goods">goods</option>
        <option value="merchant">merchant</option>
        <option value="general">general</option>
      </select>
      <button class="btn" id="btnReload">刷新</button>
      ${editable ? '<label class="btn primary sm">上传<input id="mediaUpload" type="file" accept="image/*,.pdf" hidden /></label>' : ''}
    </div>
    <p class="muted">图片会自动压缩到 3MB 以内并上传到云托管存储桶，删除会同步清理对象存储。</p>
    <div id="list"></div>`
  const load = async () => {
    const biz = $('fBiz').value
    const rows = await api(`/admin/media${biz ? `?bizType=${biz}` : ''}`)
    $('list').innerHTML = table(
      ['预览', 'ID', '类型', '大小', '尺寸', 'URL', '时间', '操作'],
      rows
        .map((m) => {
          const isImg = String(m.mime || '').startsWith('image/')
          return `<tr>
          <td>${isImg ? `<img class="thumb" src="${esc(m.fileUrl)}" alt="" />` : '文件'}</td>
          <td>${m.id}</td><td>${esc(m.bizType)}</td>
          <td>${(m.size / 1024).toFixed(1)}KB</td>
          <td>${m.width || '-'}×${m.height || '-'}</td>
          <td style="max-width:220px;white-space:normal;word-break:break-all">${esc(m.fileUrl)}</td>
          <td>${fmtTime(m.createdAt)}</td>
          <td class="actions">
            <button class="btn sm" data-copy="${esc(m.fileUrl)}">复制</button>
            ${editable ? `<button class="btn danger sm" data-del="${m.id}" data-key="${esc(m.fileKey)}">删除</button>` : ''}
          </td></tr>`
        })
        .join('')
    )
    $('list').querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy)
          b.textContent = '已复制'
        } catch {
          prompt('复制链接', b.dataset.copy)
        }
      }
    })
    $('list').querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('确认删除该资源？')) return
        await api('/admin/media', {
          method: 'DELETE',
          body: JSON.stringify({ id: Number(b.dataset.del), fileKey: b.dataset.key })
        })
        load()
      }
    })
  }
  if ($('mediaUpload')) {
    $('mediaUpload').onchange = async () => {
      const file = $('mediaUpload').files[0]
      if (!file) return
      const fd = new FormData()
      fd.append('file', file)
      fd.append('bizType', $('fBiz').value || 'general')
      const headers = {}
      if (state.token) headers.Authorization = `Bearer ${state.token}`
      const res = await fetch('/api/admin/media/upload', { method: 'POST', headers, body: fd })
      const json = await res.json()
      if (!res.ok || json.code !== 0) {
        alert(json.message || '上传失败')
      }
      $('mediaUpload').value = ''
      load()
    }
  }
  $('btnReload').onclick = load
  $('fBiz').onchange = load
  await load()
}

/* ---------- boot ---------- */
$('btnLogin').onclick = async () => {
  $('loginErr').textContent = ''
  try {
    const username = $('loginUser').value.trim()
    const password = $('loginPass').value
    let data
    if (password) {
      data = await api('/auth/admin-login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
    } else {
      data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ code: username })
      })
    }
    if (data.role !== 'admin') throw new Error('请使用运营账号登录')
    state.token = data.token
    state.profile = data
    state.permissions = data.permissions || {}
    localStorage.setItem(TOKEN_KEY, data.token)
    localStorage.setItem(PROFILE_KEY, JSON.stringify(data))
    await showDash()
  } catch (e) {
    // 密码登录失败时，尝试邀请码
    try {
      const username = $('loginUser').value.trim()
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ code: username })
      })
      if (data.role !== 'admin') throw new Error(e.message)
      state.token = data.token
      state.profile = data
      state.permissions = data.permissions || {}
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(PROFILE_KEY, JSON.stringify(data))
      await showDash()
    } catch (e2) {
      $('loginErr').textContent = e.message || e2.message
    }
  }
}

$('btnLogout').onclick = () => logout()

if (state.token && state.profile?.role === 'admin') {
  showDash()
} else {
  showLogin()
}

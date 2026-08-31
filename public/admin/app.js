(() => {
  const TOKEN_KEY = 'wy_admin_token'
  const $ = (id) => document.getElementById(id)

  function apiBase() {
    return ''
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {})
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) headers.Authorization = 'Bearer ' + token
    const res = await fetch(apiBase() + path, Object.assign({}, options, { headers }))
    const json = await res.json().catch(() => ({}))
    if (!res.ok || (json.code !== undefined && json.code !== 0)) {
      throw new Error(json.message || ('请求失败 ' + res.status))
    }
    return json.data
  }

  function showLogin() {
    $('loginView').classList.remove('hidden')
    $('dashView').classList.add('hidden')
  }

  function showDash(profile) {
    $('loginView').classList.add('hidden')
    $('dashView').classList.remove('hidden')
    $('who').textContent = ' · ' + (profile.name || 'admin')
  }

  async function boot() {
    try {
      const rate = await api('/api/config/cash-rate')
      $('cashRate').textContent = '汇率：' + rate.example
    } catch (_) {}

    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      showLogin()
      return
    }
    try {
      const profile = await api('/api/auth/profile')
      if (profile.role !== 'admin') throw new Error('非运营账号')
      showDash(profile)
      loadApplies()
      loadMerchants()
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY)
      showLogin()
    }
  }

  $('btnLogin').onclick = async () => {
    $('loginErr').textContent = ''
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ code: $('loginCode').value.trim() })
      })
      if (data.role !== 'admin') throw new Error('请使用运营码 A001 登录')
      localStorage.setItem(TOKEN_KEY, data.token)
      showDash(data)
      loadApplies()
      loadMerchants()
    } catch (e) {
      $('loginErr').textContent = e.message
    }
  }

  $('btnLogout').onclick = () => {
    localStorage.removeItem(TOKEN_KEY)
    showLogin()
  }

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('on'))
      btn.classList.add('on')
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.add('hidden'))
      $('tab-' + btn.dataset.tab).classList.remove('hidden')
    }
  })

  async function loadApplies() {
    const status = $('applyStatus').value
    const list = await api('/api/admin/applies' + (status ? '?status=' + status : '?status=pending'))
    const box = $('applyList')
    if (!list.length) {
      box.innerHTML = '<div class="panel muted">暂无入驻申请</div>'
      return
    }
    box.innerHTML = list
      .map((a) => {
        const chip =
          a.status === 'pending' ? 'warn' : a.status === 'approved' ? 'ok' : ''
        const actions =
          a.status === 'pending'
            ? `<div class="actions">
                <button class="btn ok" data-approve="${a.id}">通过</button>
                <button class="btn danger" data-reject="${a.id}">驳回</button>
              </div>`
            : a.rejectReason
              ? `<p class="muted">原因：${escapeHtml(a.rejectReason)}</p>`
              : ''
        return `<div class="card">
          <div class="row">
            <h4>${escapeHtml(a.shopName)} <span class="chip">${escapeHtml(a.roleLabel)}</span></h4>
            <span class="chip ${chip}">${escapeHtml(a.statusText)}</span>
          </div>
          <p class="muted">${escapeHtml(a.applyNo)} · ${escapeHtml(a.contactName)} ${escapeHtml(a.contactPhone)} · ${escapeHtml(a.city || '')}</p>
          ${actions}
        </div>`
      })
      .join('')

    box.querySelectorAll('[data-approve]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('确认通过该入驻申请？')) return
        try {
          const r = await api('/api/admin/apply/' + btn.dataset.approve + '/approve', {
            method: 'POST',
            body: '{}'
          })
          alert('已通过，邀请码：' + r.inviteCode)
          loadApplies()
          loadMerchants()
        } catch (e) {
          alert(e.message)
        }
      }
    })
    box.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.onclick = async () => {
        const reason = prompt('驳回原因', '资料不符合要求')
        if (reason === null) return
        try {
          await api('/api/admin/apply/' + btn.dataset.reject + '/reject', {
            method: 'POST',
            body: JSON.stringify({ reason })
          })
          loadApplies()
        } catch (e) {
          alert(e.message)
        }
      }
    })
  }

  async function loadMerchants() {
    const role = $('merchantRole').value
    const list = await api('/api/admin/merchants' + (role ? '?role=' + role : ''))
    const box = $('merchantList')
    if (!list.length) {
      box.innerHTML = '<div class="panel muted">暂无商户</div>'
      return
    }
    box.innerHTML = list
      .map(
        (m) => `<div class="card">
        <div class="row">
          <h4>${escapeHtml(m.name)} <span class="chip">${escapeHtml(m.roleLabel)}</span></h4>
          <strong>额度池 ${m.poolBalance}</strong>
        </div>
        <p class="muted">ID ${m.id} · 邀请码 ${escapeHtml(m.inviteCode)} · ${escapeHtml(m.city || '')}</p>
      </div>`
      )
      .join('')
  }

  $('btnReloadApplies').onclick = () => loadApplies().catch((e) => alert(e.message))
  $('applyStatus').onchange = () => loadApplies().catch((e) => alert(e.message))
  $('btnReloadMerchants').onclick = () => loadMerchants().catch((e) => alert(e.message))
  $('merchantRole').onchange = () => loadMerchants().catch((e) => alert(e.message))

  $('btnGrant').onclick = async () => {
    $('grantMsg').textContent = ''
    try {
      const data = await api('/api/admin/points-pool/grant', {
        method: 'POST',
        body: JSON.stringify({
          merchantId: Number($('grantMerchantId').value),
          points: Number($('grantPoints').value) || 500,
          title: $('grantTitle').value || '后台发放'
        })
      })
      $('grantMsg').textContent = '发放成功，当前余额：' + (data.balance ?? data.poolBalance ?? JSON.stringify(data))
      loadMerchants()
    } catch (e) {
      $('grantMsg').textContent = e.message
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  boot()
})()

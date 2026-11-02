/**
 * 在云托管尚未发布最新代码前，用现有 Admin API 先落地：
 * 1) Banner / 门店封面切到 mp-static
 * 2) 创建创始人/合伙人/负责人角色与账号（密码 123456）
 *
 * 用法：node scripts/live-fix-backend-reqs.mjs
 */
const BASE = process.env.API_BASE || 'https://alllink-server-305818-11-1467541248.sh.run.tcloudbase.com'

const MP = 'https://7072-prod-d3g1vkrj3290d085e-1467541248.tcb.qcloud.la/admin/mp-static/20261102'
const COVERS = {
  supermarket: `${MP}/b348459d6195838b.webp`,
  noodles: `${MP}/26ff62910b5f2547.webp`,
  bbq: `${MP}/26d02cda44689532.webp`,
  flower: `${MP}/0168ba78d752f002.webp`,
  fruit: `${MP}/673e6599ea9a8f70.webp`,
  milktea: `${MP}/727fdce69c23d17a.webp`,
  warehouse: `${MP}/8904b797e9dc2b41.webp`,
  malatang: `${MP}/6f0506640cd043cc.webp`,
  jianbing: `${MP}/8534668a3d421afb.webp`,
  cake: `${MP}/e85759a7147886c8.webp`,
  tofu: `${MP}/768037b9e15b0223.webp`,
  carwash: `${MP}/4c20198e1c0cf66a.webp`
}
const BANNERS = {
  scan: `${MP}/3cdd06ea70c160cb.webp`,
  points: `${MP}/bcf4837bfb8f2347.webp`,
  mall: COVERS.supermarket,
  stall: `${MP}/809fc9e17ef933b6.webp`,
  cross: `${MP}/742baf46d2be8680.webp`,
  supply: `${MP}/821f8b62aeaa627a.webp`,
  login: `${MP}/8f773fae68a0ba0e.webp`
}

function pickCover(name, role) {
  const n = String(name || '')
  if (/超市|百货|便利|日用|邻里/.test(n)) return COVERS.supermarket
  if (/蛋糕|烘焙|甜品|奶油|云朵/.test(n)) return COVERS.cake
  if (/花|花艺|鲜花|花漾|拾光/.test(n)) return COVERS.flower
  if (/果|果切|鲜果/.test(n)) return COVERS.fruit
  if (/奶茶|茶饮|咖啡/.test(n)) return COVERS.milktea
  if (/洗车/.test(n)) return COVERS.carwash
  if (/烤串|烧烤|串/.test(n)) return COVERS.bbq
  if (/麻辣烫|冒菜|火锅/.test(n)) return COVERS.malatang
  if (/煎饼|灌饼|豆浆/.test(n)) return COVERS.jianbing
  if (/臭豆腐|豆腐/.test(n)) return COVERS.tofu
  if (/仓|供货|粮油|冻品|调味|包装|集配|供应链/.test(n)) return COVERS.warehouse
  if (role === 'supply') return COVERS.warehouse
  if (role === 'cross') return COVERS.supermarket
  if (/厨|餐|面|粉|小吃|轻食|餐厅|食堂/.test(n)) return COVERS.noodles
  return COVERS.noodles
}

function pickBanner(row) {
  const title = String(row.title || '')
  const role = String(row.roleScope || '')
  if (/扫码|点餐/.test(title)) return BANNERS.scan
  if (/积分|鲜花|蛋糕/.test(title)) return BANNERS.points
  if (/商场|好店|百货|附近可兑/.test(title)) return BANNERS.mall
  if (/采购|地摊|额度/.test(title)) return BANNERS.stall
  if (/核销|承接|积分客/.test(title) || role === 'cross') return BANNERS.cross
  if (/仓|供货|需求/.test(title) || role === 'supply') return BANNERS.supply
  if (/入驻/.test(title) || role === 'login') return BANNERS.login
  if (role === 'stall') return BANNERS.stall
  return BANNERS.mall
}

function needsReplace(url) {
  const s = String(url || '')
  if (!s) return true
  if (/\/admin\/mp-static\//i.test(s)) return false
  return true
}

async function api(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json()
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`${path} -> ${json.message || res.status}`)
  }
  return json.data
}

async function main() {
  const login = await api('', '/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: '123456' }
  }).catch(async () => {
    // api helper requires token; do raw for login
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' })
    })
    const json = await res.json()
    if (json.code !== 0) throw new Error(json.message)
    return json.data
  })
  const token = login.token
  console.log('logged in as', login.username)

  const banners = await api(token, '/admin/banners')
  let bUp = 0
  for (const b of banners) {
    if (!needsReplace(b.imageUrl)) continue
    const imageUrl = pickBanner(b)
    await api(token, '/admin/banners', {
      method: 'POST',
      body: {
        id: b.id,
        roleScope: b.roleScope,
        title: b.title,
        subTitle: b.subTitle,
        imageUrl,
        linkUrl: b.linkUrl,
        linkType: b.linkType,
        sortOrder: b.sortOrder,
        status: b.status,
        startAt: b.startAt,
        endAt: b.endAt
      }
    })
    bUp += 1
  }
  console.log('banners updated', bUp, '/', banners.length)

  const merchants = await api(token, '/admin/merchants?limit=200')
  const list = Array.isArray(merchants) ? merchants : merchants.list || []
  let mUp = 0
  for (const m of list) {
    if (!needsReplace(m.coverUrl)) continue
    const coverUrl = pickCover(m.name, m.role)
    await api(token, `/admin/merchants/${m.id}`, {
      method: 'PATCH',
      body: { coverUrl }
    })
    mUp += 1
  }
  console.log('merchants updated', mUp, '/', list.length)

  const roleDefs = [
    {
      code: 'founder_ops',
      name: '创始人',
      remark: '平台总控：入驻/合伙人审核、名单授权、订单积分与日志',
      username: 'founder',
      displayName: '创始人运营',
      pages: [
        'dashboard',
        'applies',
        'partner_ops',
        'identity_flags',
        'users_all',
        'users_consumer',
        'orders',
        'points',
        'withdraws',
        'partner_purchases',
        'op_logs',
        'complaints',
        'needs',
        'referrals'
      ]
    },
    {
      code: 'partner_ops',
      name: '合伙人',
      remark: '区域合伙人运营',
      username: 'partner',
      displayName: '合伙人运营',
      pages: ['dashboard', 'partner_ops', 'partner_purchases', 'referrals', 'orders', 'points']
    },
    {
      code: 'lead_ops',
      name: '负责人',
      remark: '创始人权限子集',
      username: 'lead',
      displayName: '负责人运营',
      pages: ['dashboard', 'applies', 'partner_ops', 'orders', 'points', 'withdraws', 'op_logs', 'needs']
    }
  ]

  const roles = await api(token, '/admin/rbac/roles')
  const accounts = await api(token, '/admin/rbac/accounts')
  const allPerms = await api(token, '/admin/rbac/permissions').catch(() => [])

  for (const def of roleDefs) {
    let role = roles.find((r) => r.code === def.code)
    if (!role) {
      const created = await api(token, '/admin/rbac/roles', {
        method: 'POST',
        body: { code: def.code, name: def.name, remark: def.remark, status: 1 }
      })
      role = { id: created.id, code: def.code }
      console.log('created role', def.code, role.id)
    } else {
      console.log('role exists', def.code, role.id)
    }

    const permissions = (Array.isArray(allPerms) ? allPerms : []).map((p) => {
      const key = p.pageKey || p.page_key
      const allow = def.pages.includes(key) && key !== 'screen' && !String(key).startsWith('sys_')
      return { pageKey: key, canView: allow, canEdit: allow }
    })
    // 若权限目录接口不完整，至少按 pages 写入
    const payload =
      permissions.length > 0
        ? permissions
        : def.pages.map((pageKey) => ({ pageKey, canView: true, canEdit: true }))
    await api(token, `/admin/rbac/roles/${role.id}/permissions`, {
      method: 'PUT',
      body: { permissions: payload }
    })

    const acc = accounts.find((a) => a.username === def.username)
    if (!acc) {
      await api(token, '/admin/rbac/accounts', {
        method: 'POST',
        body: {
          username: def.username,
          displayName: def.displayName,
          roleId: role.id,
          password: '123456',
          status: 1
        }
      })
      console.log('created account', def.username)
    } else {
      await api(token, '/admin/rbac/accounts', {
        method: 'POST',
        body: {
          id: acc.id,
          username: def.username,
          displayName: def.displayName,
          roleId: role.id,
          password: '123456',
          status: 1
        }
      })
      console.log('updated account', def.username)
    }
  }

  // 非超管角色去掉 screen
  for (const r of await api(token, '/admin/rbac/roles')) {
    if (r.code === 'super_admin') continue
    const detail = await api(token, `/admin/rbac/roles/${r.id}`)
    const permissions = (detail.permissions || [])
      .filter((p) => p.pageKey !== 'screen')
      .map((p) => ({
        pageKey: p.pageKey,
        canView: !!(p.canView || p.view),
        canEdit: !!(p.canEdit || p.edit)
      }))
    await api(token, `/admin/rbac/roles/${r.id}/permissions`, {
      method: 'PUT',
      body: { permissions }
    })
  }

  console.log('DONE. Note: 侧栏「数据大屏」需重新部署云托管静态后台才能消失。')
  console.log('Accounts: founder / partner / lead  密码 123456')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

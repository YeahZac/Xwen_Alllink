const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { parsePaging, pageResult } = require('../utils/paging')
const { enrichScreen } = require('./screenSim')
const { orderNo, shortCode } = require('../utils/id')
const { assertCanOnSale, assertGoodsCanOnSale, evaluateMerchantReady } = require('./merchantReady')
const { pickCoverFromLicenses, resolveMerchantCover, parseMaybeJson } = require('../utils/mediaPick')

const ROLE_LABEL = { stall: '地摊', cross: '异业', supply: '供应链', consumer: 'C端用户' }
const PLATFORM_ROLE_LABEL = { partner: '合伙人', founder: '创始人', lead: '负责人' }

async function resolveBizOwner(adminId) {
  const id = Number(adminId) || 0
  if (!id) return null
  try {
    const rows = await query(
      `SELECT a.id, a.username, a.display_name AS displayName, a.status
       FROM admin_accounts a WHERE a.id=:id LIMIT 1`,
      { id }
    )
    if (!rows.length) return null
    return {
      id: Number(rows[0].id),
      username: rows[0].username,
      displayName: rows[0].displayName || rows[0].username,
      status: Number(rows[0].status)
    }
  } catch (_) {
    return null
  }
}

async function assertBizOwnerAdminId(adminId) {
  if (adminId === undefined || adminId === null || adminId === '') return null
  const id = Number(adminId)
  if (!id || id < 0) throw new HttpError(400, '商务负责人无效')
  if (id === 0) return null
  const rows = await query(
    `SELECT id, status FROM admin_accounts WHERE id=:id LIMIT 1`,
    { id }
  )
  if (!rows.length) throw new HttpError(400, '商务负责人不存在，请从后台账号中选择')
  if (Number(rows[0].status) !== 1) throw new HttpError(400, '商务负责人账号已停用')
  return id
}

async function one(sql, params) {
  const rows = await query(sql, params || {})
  return rows[0] ? Number(Object.values(rows[0])[0]) : 0
}

/** 数据大屏聚合 */
async function bigScreen() {
  const [
    consumers,
    stalls,
    crosses,
    supplies,
    openStores,
    consumerGmv,
    crossGmv,
    purchaseGmv,
    visitsToday,
    visits7d,
    ordersToday
  ] = await Promise.all([
    one(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`),
    one(`SELECT COUNT(*) c FROM merchants WHERE role='stall' AND deleted_at IS NULL`),
    one(`SELECT COUNT(*) c FROM merchants WHERE role='cross' AND deleted_at IS NULL`),
    one(`SELECT COUNT(*) c FROM merchants WHERE role='supply' AND deleted_at IS NULL`),
    one(`SELECT COUNT(*) c FROM merchants WHERE status=1 AND deleted_at IS NULL`),
    one(`SELECT IFNULL(SUM(total_amount),0) c FROM consumer_orders WHERE pay_status='paid'`),
    one(`SELECT IFNULL(SUM(cash_amount),0) c FROM cross_orders`),
    one(`SELECT IFNULL(SUM(total_amount),0) c FROM purchase_orders WHERE status IN ('confirmed','shipped','pending')`),
    one(`SELECT COUNT(*) c FROM visit_logs WHERE created_at >= CURDATE()`),
    one(`SELECT COUNT(*) c FROM visit_logs WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`),
    one(
      `SELECT (
         (SELECT COUNT(*) FROM consumer_orders WHERE DATE(created_at)=CURDATE()) +
         (SELECT COUNT(*) FROM cross_orders WHERE DATE(created_at)=CURDATE()) +
         (SELECT COUNT(*) FROM purchase_orders WHERE DATE(created_at)=CURDATE())
       ) c`
    )
  ])

  const gmvTotal = Math.round((consumerGmv + crossGmv + purchaseGmv) * 100) / 100

  const hotCities = await query(
    `SELECT IFNULL(city,'(未知)') AS city, COUNT(*) AS visits
     FROM visit_logs
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY IFNULL(city,'(未知)')
     ORDER BY visits DESC LIMIT 10`
  )

  const geoPoints = await query(
    `SELECT m.id, m.name, m.role, m.city, m.latitude AS lat, m.longitude AS lng, m.status,
            (SELECT COUNT(*) FROM visit_logs v WHERE v.merchant_id=m.id) AS visits
     FROM merchants m
     WHERE m.deleted_at IS NULL AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
     ORDER BY visits DESC`
  )

  const visitTrend = await query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS visits
     FROM visit_logs
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(created_at)
     ORDER BY day ASC`
  )

  const roleMix = [
    { role: 'consumer', label: 'C端用户', count: consumers },
    { role: 'stall', label: '地摊', count: stalls },
    { role: 'cross', label: '异业', count: crosses },
    { role: 'supply', label: '供应链', count: supplies }
  ]

  const topGoods = await query(
    `(SELECT 'stall' AS type, name, sku_code AS sku, sales_count AS sales, price AS price
      FROM stall_goods WHERE deleted_at IS NULL ORDER BY sales_count DESC LIMIT 5)
     UNION ALL
     (SELECT 'cross' AS type, name, sku_code AS sku, sales_count AS sales, cash_price AS price
      FROM cross_goods WHERE deleted_at IS NULL ORDER BY sales_count DESC LIMIT 5)
     UNION ALL
     (SELECT 'supply' AS type, name, sku_code AS sku, sales_count AS sales, price AS price
      FROM supply_goods WHERE deleted_at IS NULL ORDER BY sales_count DESC LIMIT 5)`
  )

  let hourly = []
  try {
    hourly = await query(
      `SELECT HOUR(created_at) AS hour, COUNT(*) AS count
       FROM visit_logs WHERE created_at >= CURDATE()
       GROUP BY HOUR(created_at)`
    )
  } catch (_) {
    hourly = []
  }

  return enrichScreen(
    {
      updatedAt: new Date().toISOString(),
      kpis: {
        visitsToday,
        visits7d,
        ordersToday,
        gmvTotal,
        consumerGmv,
        crossGmv,
        purchaseGmv,
        openStores,
        consumers,
        stalls,
        crosses,
        supplies
      },
      roleMix,
      hotCities,
      geoPoints,
      visitTrend,
      topGoods
    },
    { hourly }
  )
}

async function trackVisit(body = {}) {
  await query(
    `INSERT INTO visit_logs (role_scope, page_key, merchant_id, user_id, city, latitude, longitude)
     VALUES (:role, :page, :mid, :uid, :city, :lat, :lng)`,
    {
      role: body.roleScope || 'consumer',
      page: body.pageKey || null,
      mid: body.merchantId ? Number(body.merchantId) : null,
      uid: body.userId ? Number(body.userId) : null,
      city: body.city || null,
      lat: body.latitude || null,
      lng: body.longitude || null
    }
  )
  return { ok: true }
}

function mapMerchantIdentity(m, _pickCoverFromLicenses, parseMaybeJsonFn) {
  const parse = parseMaybeJsonFn || parseMaybeJson
  const materials = parse(m.materials) || m.materials || {}
  const coverUrl = resolveMerchantCover(m.coverUrl, materials)
  return {
    id: m.merchantId,
    identity: m.identity,
    identityLabel: m.identityLabel,
    name: m.name,
    code: m.code,
    phone: m.phone,
    points: null,
    status: m.status,
    deletedAt: m.deletedAt,
    createdAt: m.createdAt,
    merchantId: m.merchantId,
    city: m.city,
    materials,
    coverUrl,
    avatarUrl: coverUrl,
    address: m.address,
    contactName: m.contactName,
    bizOwnerAdminId: m.bizOwnerAdminId != null ? Number(m.bizOwnerAdminId) : null,
    bizOwnerName: m.bizOwnerName || ''
  }
}

function mapUserIdentityRow(u) {
  const isPartner = Number(u.isPartner || u.is_partner) === 1
  const isFounder = Number(u.isFounder || u.is_founder) === 1
  const isLead = Number(u.isLead || u.is_lead) === 1
  let identity = 'consumer'
  let identityLabel = 'C端用户'
  if (isLead) {
    identity = 'lead'
    identityLabel = '负责人'
  } else if (isFounder) {
    identity = 'founder'
    identityLabel = '创始人'
  } else if (isPartner) {
    identity = 'partner'
    identityLabel = '合伙人'
  }
  return {
    id: u.id,
    identity,
    identityLabel,
    name: u.name || u.nickname,
    code: u.code || u.invite_code,
    phone: u.phone,
    points: u.points != null ? u.points : u.points_balance,
    status: u.status,
    deletedAt: u.deletedAt || u.deleted_at,
    createdAt: u.createdAt || u.created_at,
    avatarUrl: u.avatarUrl || u.avatar_url,
    merchantId: null,
    city: null,
    materials: null,
    coverUrl: null,
    isPartner,
    isFounder,
    isLead
  }
}

/** 用户总览：C端 + 商户身份（分页）；支持 partner/founder/lead 筛选 */
async function listAllIdentities({ role, q, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const { pickCoverFromLicenses, parseMaybeJson } = require('../utils/mediaPick')
  const platformRoles = ['partner', 'founder', 'lead']
  const wantUsers = !role || role === 'consumer' || role === 'all' || platformRoles.includes(role)
  const wantMerchants = !role || role === 'all' || ['stall', 'cross', 'supply'].includes(role)
  const onlyUsers = role === 'consumer' || platformRoles.includes(role)
  const onlyMerchants = ['stall', 'cross', 'supply'].includes(role)

  if (onlyUsers) {
    let where = ` WHERE u.deleted_at IS NULL`
    const params = {}
    if (role === 'partner') where += ` AND IFNULL(u.is_partner,0)=1`
    if (role === 'founder') where += ` AND IFNULL(u.is_founder,0)=1`
    if (role === 'lead') where += ` AND IFNULL(u.is_lead,0)=1`
    if (q) {
      where += ` AND (u.nickname LIKE :q OR u.invite_code LIKE :q OR u.phone LIKE :q)`
      params.q = `%${q}%`
    }
    let countRows
    let rows
    try {
      countRows = await query(`SELECT COUNT(*) AS c FROM users u${where}`, params)
      rows = await query(
        `SELECT u.id, u.nickname AS name, u.invite_code AS code, u.phone, u.points_balance AS points,
                u.status, u.deleted_at AS deletedAt, u.created_at AS createdAt,
                u.avatar_url AS avatarUrl,
                IFNULL(u.is_partner,0) AS isPartner,
                IFNULL(u.is_founder,0) AS isFounder,
                IFNULL(u.is_lead,0) AS isLead
         FROM users u${where}
         ORDER BY u.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
        params
      )
    } catch (e) {
      if (!/Unknown column.*is_(partner|founder|lead)/i.test(String(e.message || ''))) throw e
      if (platformRoles.includes(role)) return pageResult([], 0, paging)
      where = ` WHERE u.deleted_at IS NULL`
      if (q) {
        where += ` AND (u.nickname LIKE :q OR u.invite_code LIKE :q OR u.phone LIKE :q)`
      }
      countRows = await query(`SELECT COUNT(*) AS c FROM users u${where}`, params)
      rows = await query(
        `SELECT u.id, u.nickname AS name, u.invite_code AS code, u.phone, u.points_balance AS points,
                u.status, u.deleted_at AS deletedAt, u.created_at AS createdAt,
                u.avatar_url AS avatarUrl,
                0 AS isPartner, 0 AS isFounder, 0 AS isLead
         FROM users u${where}
         ORDER BY u.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
        params
      )
    }
    return pageResult(rows.map(mapUserIdentityRow), Number(countRows[0]?.c) || 0, paging)
  }

  if (onlyMerchants) {
    let where = ` WHERE m.deleted_at IS NULL AND m.role=:role`
    const params = { role }
    if (q) {
      where += ` AND (m.name LIKE :q OR m.invite_code LIKE :q OR m.contact_phone LIKE :q)`
      params.q = `%${q}%`
    }
    const countRows = await query(`SELECT COUNT(*) AS c FROM merchants m${where}`, params)
    let merchants
    try {
      merchants = await query(
        `SELECT m.id AS merchantId, m.role AS identity,
                CASE m.role WHEN 'stall' THEN '地摊' WHEN 'cross' THEN '异业' ELSE '供应链' END AS identityLabel,
                m.name, m.invite_code AS code, m.contact_phone AS phone, NULL AS points,
                m.status, m.deleted_at AS deletedAt, m.created_at AS createdAt,
                m.city, m.materials_json AS materials, m.cover_url AS coverUrl,
                m.address, m.contact_name AS contactName,
                m.biz_owner_admin_id AS bizOwnerAdminId,
                a.display_name AS bizOwnerName
         FROM merchants m
         LEFT JOIN admin_accounts a ON a.id = m.biz_owner_admin_id
         ${where}
         ORDER BY m.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
        params
      )
    } catch (e) {
      if (!/Unknown column.*biz_owner_admin_id/i.test(String(e.message || ''))) throw e
      merchants = await query(
        `SELECT m.id AS merchantId, m.role AS identity,
                CASE m.role WHEN 'stall' THEN '地摊' WHEN 'cross' THEN '异业' ELSE '供应链' END AS identityLabel,
                m.name, m.invite_code AS code, m.contact_phone AS phone, NULL AS points,
                m.status, m.deleted_at AS deletedAt, m.created_at AS createdAt,
                m.city, m.materials_json AS materials, m.cover_url AS coverUrl,
                m.address, m.contact_name AS contactName,
                NULL AS bizOwnerAdminId, '' AS bizOwnerName
         FROM merchants m${where}
         ORDER BY m.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
        params
      )
    }
    const list = merchants.map((m) => mapMerchantIdentity(m, pickCoverFromLicenses, parseMaybeJson))
    return pageResult(list, Number(countRows[0]?.c) || 0, paging)
  }

  // role=all：两侧各取 offset+pageSize 再合并切片，保证翻页可用
  const fetchLimit = paging.offset + paging.pageSize
  let userWhere = ` WHERE u.deleted_at IS NULL`
  let merchantWhere = ` WHERE m.deleted_at IS NULL`
  const userParams = {}
  const merchantParams = {}
  if (q) {
    userWhere += ` AND (u.nickname LIKE :q OR u.invite_code LIKE :q OR u.phone LIKE :q)`
    merchantWhere += ` AND (m.name LIKE :q OR m.invite_code LIKE :q OR m.contact_phone LIKE :q)`
    userParams.q = `%${q}%`
    merchantParams.q = `%${q}%`
  }
  const [userCountRows, merchantCountRows, users, merchants] = await Promise.all([
    wantUsers ? query(`SELECT COUNT(*) AS c FROM users u${userWhere}`, userParams) : Promise.resolve([{ c: 0 }]),
    wantMerchants
      ? query(`SELECT COUNT(*) AS c FROM merchants m${merchantWhere}`, merchantParams)
      : Promise.resolve([{ c: 0 }]),
    wantUsers
      ? query(
          `SELECT u.id, u.nickname AS name, u.invite_code AS code, u.phone, u.points_balance AS points,
                  u.status, u.deleted_at AS deletedAt, u.created_at AS createdAt,
                  u.avatar_url AS avatarUrl,
                  IFNULL(u.is_partner,0) AS isPartner,
                  IFNULL(u.is_founder,0) AS isFounder,
                  IFNULL(u.is_lead,0) AS isLead
           FROM users u${userWhere}
           ORDER BY u.id DESC LIMIT ${fetchLimit}`,
          userParams
        ).catch(async (e) => {
          if (!/Unknown column.*is_(partner|founder|lead)/i.test(String(e.message || ''))) throw e
          return query(
            `SELECT u.id, u.nickname AS name, u.invite_code AS code, u.phone, u.points_balance AS points,
                    u.status, u.deleted_at AS deletedAt, u.created_at AS createdAt,
                    u.avatar_url AS avatarUrl,
                    0 AS isPartner, 0 AS isFounder, 0 AS isLead
             FROM users u${userWhere}
             ORDER BY u.id DESC LIMIT ${fetchLimit}`,
            userParams
          )
        })
      : Promise.resolve([]),
    wantMerchants
      ? query(
          `SELECT m.id AS merchantId, m.role AS identity,
                  CASE m.role WHEN 'stall' THEN '地摊' WHEN 'cross' THEN '异业' ELSE '供应链' END AS identityLabel,
                  m.name, m.invite_code AS code, m.contact_phone AS phone, NULL AS points,
                  m.status, m.deleted_at AS deletedAt, m.created_at AS createdAt,
                  m.city, m.materials_json AS materials, m.cover_url AS coverUrl,
                  m.address, m.contact_name AS contactName,
                  m.biz_owner_admin_id AS bizOwnerAdminId,
                  a.display_name AS bizOwnerName
           FROM merchants m
           LEFT JOIN admin_accounts a ON a.id = m.biz_owner_admin_id
           ${merchantWhere}
           ORDER BY m.id DESC LIMIT ${fetchLimit}`,
          merchantParams
        ).catch(async (e) => {
          if (!/Unknown column.*biz_owner_admin_id/i.test(String(e.message || ''))) throw e
          return query(
            `SELECT m.id AS merchantId, m.role AS identity,
                    CASE m.role WHEN 'stall' THEN '地摊' WHEN 'cross' THEN '异业' ELSE '供应链' END AS identityLabel,
                    m.name, m.invite_code AS code, m.contact_phone AS phone, NULL AS points,
                    m.status, m.deleted_at AS deletedAt, m.created_at AS createdAt,
                    m.city, m.materials_json AS materials, m.cover_url AS coverUrl,
                    m.address, m.contact_name AS contactName,
                    NULL AS bizOwnerAdminId, '' AS bizOwnerName
             FROM merchants m${merchantWhere}
             ORDER BY m.id DESC LIMIT ${fetchLimit}`,
            merchantParams
          )
        })
      : Promise.resolve([])
  ])
  const merged = [
    ...users.map(mapUserIdentityRow),
    ...merchants.map((m) => mapMerchantIdentity(m, pickCoverFromLicenses, parseMaybeJson))
  ].sort((a, b) => Number(b.id || b.merchantId || 0) - Number(a.id || a.merchantId || 0))
  const total = (Number(userCountRows[0]?.c) || 0) + (Number(merchantCountRows[0]?.c) || 0)
  const list = merged.slice(paging.offset, paging.offset + paging.pageSize)
  return pageResult(list, total, paging)
}

async function getStoreDetail(merchantId) {
  let rows
  try {
    rows = await query(
      `SELECT m.*, IFNULL(p.balance,0) AS pool_balance,
              a.display_name AS biz_owner_name, a.username AS biz_owner_username
       FROM merchants m
       LEFT JOIN merchant_points_pool p ON p.merchant_id=m.id
       LEFT JOIN admin_accounts a ON a.id = m.biz_owner_admin_id
       WHERE m.id=:id AND m.deleted_at IS NULL`,
      { id: merchantId }
    )
  } catch (e) {
    if (!/Unknown column.*biz_owner_admin_id/i.test(String(e.message || ''))) throw e
    rows = await query(
      `SELECT m.*, IFNULL(p.balance,0) AS pool_balance
       FROM merchants m
       LEFT JOIN merchant_points_pool p ON p.merchant_id=m.id
       WHERE m.id=:id AND m.deleted_at IS NULL`,
      { id: merchantId }
    )
  }
  if (!rows.length) throw new HttpError(404, '门店不存在')
  const m = rows[0]
  let materials = m.materials_json
  if (materials && typeof materials === 'string') {
    try {
      materials = JSON.parse(materials)
    } catch (_) {}
  }
  if (!materials) {
    const apps = await query(
      `SELECT license_json FROM merchant_applications
       WHERE merchant_id=:id AND status='approved' ORDER BY id DESC LIMIT 1`,
      { id: merchantId }
    )
    if (apps.length) {
      materials = apps[0].license_json
      if (typeof materials === 'string') {
        try {
          materials = JSON.parse(materials)
        } catch (_) {}
      }
    }
  }

  const goodsTable =
    m.role === 'stall' ? 'stall_goods' : m.role === 'cross' ? 'cross_goods' : 'supply_goods'
  const goods = await query(
    `SELECT id, name, sku_code AS skuCode, image_url AS imageUrl, sales_count AS salesCount, stock,
            ${
              m.role === 'cross'
                ? 'cash_price AS price, points_need AS pointsNeed, on_sale AS onSale'
                : m.role === 'supply'
                  ? 'price, points_grant AS pointsGrant, status AS onSale'
                  : 'price, points_grant AS pointsGrant, on_sale AS onSale'
            }
     FROM ${goodsTable} WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC LIMIT 100`,
    { id: merchantId }
  )

  const coverUrl = resolveMerchantCover(m.cover_url, materials)
  const bizOwnerAdminId = m.biz_owner_admin_id != null ? Number(m.biz_owner_admin_id) : null
  const ready = evaluateMerchantReady(m)
  return {
    id: m.id,
    role: m.role,
    roleLabel: ROLE_LABEL[m.role],
    name: m.name,
    merchantNo: m.merchant_no,
    inviteCode: m.invite_code,
    legalPerson: m.legal_person || '',
    contactName: m.contact_name,
    contactPhone: m.contact_phone,
    creditCode: m.credit_code || '',
    city: m.city,
    address: m.address,
    latitude: m.latitude,
    longitude: m.longitude,
    bizType: m.biz_type || '',
    coverUrl,
    storePhotoUrl: pickCoverFromLicenses(materials) || '',
    status: m.status,
    poolBalance: m.pool_balance,
    materials: materials || {},
    bizOwnerAdminId,
    bizOwnerName: m.biz_owner_name || '',
    bizOwnerUsername: m.biz_owner_username || '',
    wxSubMchId: m.wx_sub_mch_id || '',
    wxApplyState: m.wx_apply_state || '',
    catalogReady: ready.catalogReady,
    homeEligible: ready.homeEligible,
    platformPayReady: ready.platformPayReady,
    goods: (goods || []).map((g) => ({
      ...g,
      goodsType: m.role,
      merchantId: m.id,
      sku: g.skuCode,
      sales: g.salesCount,
      onSale: g.onSale,
      imageUrl: g.imageUrl
    }))
  }
}

/** 运营台编辑门店基础信息（可含封面、类目、商务负责人） */
async function updateStore(id, body = {}) {
  const rows = await query('SELECT id, role FROM merchants WHERE id=:id AND deleted_at IS NULL', { id })
  if (!rows.length) throw new HttpError(404, '门店不存在')
  const fields = []
  const params = { id: Number(id) }
  const map = {
    name: 'name',
    city: 'city',
    address: 'address',
    legalPerson: 'legal_person',
    contactName: 'contact_name',
    contactPhone: 'contact_phone',
    status: 'status',
    coverUrl: 'cover_url',
    bizType: 'biz_type',
    latitude: 'latitude',
    longitude: 'longitude',
    creditCode: 'credit_code'
  }
  for (const [k, col] of Object.entries(map)) {
    if (body[k] === undefined) continue
    fields.push(`${col} = :${k}`)
    params[k] =
      k === 'latitude' || k === 'longitude' || k === 'status'
        ? body[k] === '' || body[k] == null
          ? null
          : Number(body[k])
        : body[k]
  }
  if (body.bizOwnerAdminId !== undefined) {
    const ownerId = await assertBizOwnerAdminId(body.bizOwnerAdminId)
    fields.push('biz_owner_admin_id = :bizOwnerAdminId')
    params.bizOwnerAdminId = ownerId
  }
  if (body.materials && typeof body.materials === 'object') {
    fields.push('materials_json = CAST(:materialsJson AS JSON)')
    params.materialsJson = JSON.stringify(body.materials)
    if (body.coverUrl === undefined) {
      const { pickCoverFromLicenses } = require('../utils/mediaPick')
      const picked = pickCoverFromLicenses(body.materials)
      if (picked) {
        fields.push('cover_url = :autoCover')
        params.autoCover = picked
      }
    }
  }
  if (!fields.length) throw new HttpError(400, '没有可更新字段')
  try {
    await query(`UPDATE merchants SET ${fields.join(', ')} WHERE id=:id`, params)
  } catch (e) {
    if (/Unknown column.*biz_owner_admin_id/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/34_merchant_biz_owner.sql 增加商务负责人字段')
    }
    throw e
  }
  return getStoreDetail(Number(id))
}

/** 运营台直接新建门店 —— 默认关闭，统一走「商家入驻审核」 */
async function createStore(body = {}) {
  if (String(process.env.ALLOW_DIRECT_STORE_CREATE || '0') !== '1') {
    throw new HttpError(
      400,
      '请从「商家入驻审核」新建门店：小程序入驻或运营台代客入驻，审核通过后进入对应门店列表'
    )
  }
  const role = String(body.role || '').trim()
  if (!['stall', 'cross', 'supply'].includes(role)) {
    throw new HttpError(400, '请选择门店类型：地摊/异业/供应链')
  }
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写店铺名称')
  const contactName = String(body.contactName || body.legalPerson || name).trim()
  const contactPhone = String(body.contactPhone || '').trim()
  if (!contactPhone) throw new HttpError(400, '请填写联系电话')
  {
    const roleLabel = { stall: '地摊', cross: '异业', supply: '供应链' }[role] || role
    const exist = await query(
      `SELECT id, name FROM merchants
       WHERE role=:role AND deleted_at IS NULL AND contact_phone=:phone
       ORDER BY id DESC LIMIT 1`,
      { role, phone: contactPhone }
    )
    if (exist.length) {
      throw new HttpError(
        400,
        `该手机号已有${roleLabel}门店「${exist[0].name}」，一人仅可经营一个${roleLabel}；请先删除旧店后再新建`
      )
    }
  }
  const city = String(body.city || '').trim()
  if (!city) throw new HttpError(400, '请填写城市')
  const address = String(body.address || '').trim()
  const legalPerson = String(body.legalPerson || contactName).trim()
  const creditCode = String(body.creditCode || '').trim()
  if (role !== 'stall' && !creditCode) {
    throw new HttpError(400, '异业/供应链请填写统一社会信用代码')
  }
  const bizOwnerAdminId = await assertBizOwnerAdminId(body.bizOwnerAdminId)
  const status = body.status === 2 ? 2 : 1
  const inviteCode = shortCode(role === 'stall' ? 'D' : role === 'cross' ? 'Y' : 'G')
  const merchantNo = orderNo('M')
  const coverUrl = String(body.coverUrl || '').trim() || null
  const bizType = String(body.bizType || '').trim() || null
  const lat =
    body.latitude === '' || body.latitude == null ? null : Number(body.latitude)
  const lng =
    body.longitude === '' || body.longitude == null ? null : Number(body.longitude)

  const baseParams = [
    merchantNo,
    role,
    name,
    creditCode || null,
    legalPerson,
    contactName,
    contactPhone,
    city,
    address || null,
    lat,
    lng,
    status,
    inviteCode,
    coverUrl
  ]

  const merchantId = await withTransaction(async (conn) => {
    async function insertMerchant(withBizOwner, withExtras) {
      if (withExtras && withBizOwner) {
        const [r] = await conn.execute(
          `INSERT INTO merchants
            (merchant_no, role, name, credit_code, legal_person, contact_name, contact_phone,
             city, address, latitude, longitude, status, invite_code, cover_url, biz_type,
             biz_owner_admin_id, level_code, trial_end_at, service_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal',
                   DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 'trial')`,
          [...baseParams, bizType, bizOwnerAdminId]
        )
        return r
      }
      if (withExtras && !withBizOwner) {
        const [r] = await conn.execute(
          `INSERT INTO merchants
            (merchant_no, role, name, credit_code, legal_person, contact_name, contact_phone,
             city, address, latitude, longitude, status, invite_code, cover_url, biz_type,
             level_code, trial_end_at, service_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal',
                   DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 'trial')`,
          [...baseParams, bizType]
        )
        return r
      }
      if (withBizOwner) {
        const [r] = await conn.execute(
          `INSERT INTO merchants
            (merchant_no, role, name, credit_code, legal_person, contact_name, contact_phone,
             city, address, latitude, longitude, status, invite_code, cover_url, biz_owner_admin_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...baseParams, bizOwnerAdminId]
        )
        return r
      }
      const [r] = await conn.execute(
        `INSERT INTO merchants
          (merchant_no, role, name, credit_code, legal_person, contact_name, contact_phone,
           city, address, latitude, longitude, status, invite_code, cover_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        baseParams
      )
      return r
    }

    let ins
    try {
      ins = await insertMerchant(true, true)
    } catch (e) {
      const msg = String(e.message || '')
      if (/Unknown column.*biz_owner_admin_id/i.test(msg)) {
        if (bizOwnerAdminId) {
          throw new HttpError(503, '请先执行 sql/34_merchant_biz_owner.sql 增加商务负责人字段')
        }
        try {
          ins = await insertMerchant(false, true)
        } catch (e2) {
          if (/Unknown column.*(level_code|trial_end_at|service_status|biz_type)/i.test(String(e2.message || ''))) {
            ins = await insertMerchant(false, false)
          } else throw e2
        }
      } else if (/Unknown column.*(level_code|trial_end_at|service_status|biz_type)/i.test(msg)) {
        try {
          ins = await insertMerchant(true, false)
        } catch (e2) {
          if (/Unknown column.*biz_owner_admin_id/i.test(String(e2.message || ''))) {
            if (bizOwnerAdminId) {
              throw new HttpError(503, '请先执行 sql/34_merchant_biz_owner.sql 增加商务负责人字段')
            }
            ins = await insertMerchant(false, false)
          } else throw e2
        }
      } else {
        throw e
      }
    }
    const mid = ins.insertId
    await conn.execute(`INSERT INTO merchant_points_pool (merchant_id, balance) VALUES (?, 0)`, [mid])
    if (role === 'supply') {
      await conn.execute(
        `INSERT INTO merchant_accounts (merchant_id, account_type, balance) VALUES
         (?, 'cash_goods', 0), (?, 'points_redeem', 0)`,
        [mid, mid]
      )
    } else {
      await conn.execute(
        `INSERT INTO merchant_accounts (merchant_id, account_type, balance)
         VALUES (?, 'cash_settlement', 0)`,
        [mid]
      )
    }

    let ownerUserId = 0
    try {
      const [byPhone] = await conn.execute(
        'SELECT id FROM users WHERE phone=? AND status=1 AND deleted_at IS NULL LIMIT 1',
        [contactPhone]
      )
      if (byPhone.length) ownerUserId = Number(byPhone[0].id)
    } catch (e) {
      if (!/deleted_at|Unknown column/i.test(String(e.message || ''))) throw e
      const [byPhone] = await conn.execute(
        'SELECT id FROM users WHERE phone=? AND status=1 LIMIT 1',
        [contactPhone]
      )
      if (byPhone.length) ownerUserId = Number(byPhone[0].id)
    }
    if (!ownerUserId) {
      const ownerInvite = `${inviteCode}_U`
      const [uins] = await conn.execute(
        `INSERT INTO users (invite_code, nickname, phone, points_balance, status)
         VALUES (?, ?, ?, 0, 1)`,
        [ownerInvite, contactName || name, contactPhone]
      )
      ownerUserId = Number(uins.insertId) || 0
    }
    if (ownerUserId) {
      await conn.execute('UPDATE merchants SET owner_user_id=? WHERE id=?', [ownerUserId, mid])
    }
    return mid
  })

  return getStoreDetail(merchantId)
}

/** 运营台直接开通合伙人/创始人/负责人（非 C 端身份） */
async function createPlatformIdentity(body = {}) {
  const role = String(body.role || '').trim()
  if (!['partner', 'founder', 'lead'].includes(role)) {
    throw new HttpError(400, '请选择身份：合伙人/创始人/负责人')
  }
  const nickname = String(body.nickname || body.name || '').trim()
  const phone = String(body.phone || '').trim()
  if (!nickname) throw new HttpError(400, '请填写姓名/昵称')
  if (!phone) throw new HttpError(400, '请填写手机号')

  let userId = Number(body.userId) || 0
  if (userId) {
    const exists = await query(
      'SELECT id FROM users WHERE id=:id AND deleted_at IS NULL LIMIT 1',
      { id: userId }
    ).catch(async (e) => {
      if (!/deleted_at|Unknown column/i.test(String(e.message || ''))) throw e
      return query('SELECT id FROM users WHERE id=:id LIMIT 1', { id: userId })
    })
    if (!exists.length) throw new HttpError(404, '用户不存在')
  } else {
    const byPhone = await query(
      'SELECT id FROM users WHERE phone=:p AND deleted_at IS NULL ORDER BY id DESC LIMIT 1',
      { p: phone }
    ).catch(async (e) => {
      if (!/deleted_at|Unknown column/i.test(String(e.message || ''))) throw e
      return query('SELECT id FROM users WHERE phone=:p ORDER BY id DESC LIMIT 1', { p: phone })
    })
    if (byPhone.length) {
      userId = Number(byPhone[0].id)
      await query('UPDATE users SET nickname=:n, phone=:p, status=1 WHERE id=:id', {
        n: nickname,
        p: phone,
        id: userId
      })
    } else {
      const invite = shortCode(role === 'partner' ? 'P' : role === 'founder' ? 'F' : 'L')
      const r = await query(
        `INSERT INTO users (invite_code, nickname, phone, points_balance, status)
         VALUES (:c, :n, :p, 0, 1)`,
        { c: invite, n: nickname, p: phone }
      )
      userId = Number(r.insertId)
    }
  }

  const col = role === 'partner' ? 'is_partner' : role === 'founder' ? 'is_founder' : 'is_lead'
  try {
    await query(`UPDATE users SET ${col}=1 WHERE id=:id`, { id: userId })
    if (role === 'founder') {
      try {
        await query(`UPDATE users SET is_lead=1 WHERE id=:id`, { id: userId })
      } catch (_) {}
    }
  } catch (e) {
    if (/Unknown column/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/26_user_identities.sql')
    }
    throw e
  }

  let opsAccount = null
  try {
    const rbacService = require('./rbacService')
    const roleCode = role === 'partner' ? 'partner_ops' : role === 'founder' ? 'founder_ops' : 'lead_ops'
    opsAccount = await rbacService.provisionLinkedOpsAccount({
      userId,
      roleCode,
      password: String(body.password || '123456'),
      displayName: nickname
    })
  } catch (e) {
    console.warn('[ops] provision platform identity account', e.message)
  }

  return {
    ok: true,
    userId,
    role,
    roleLabel: PLATFORM_ROLE_LABEL[role],
    opsAccount
  }
}

async function setMerchantStatus(id, status) {
  const rows = await query('SELECT id FROM merchants WHERE id=:id AND deleted_at IS NULL', { id })
  if (!rows.length) throw new HttpError(404, '门店不存在')
  await query('UPDATE merchants SET status=:s WHERE id=:id', { id, s: Number(status) })
  return { id: Number(id), status: Number(status) }
}

async function softDeleteMerchant(id, { hideApplies = true } = {}) {
  const mid = Number(id)
  const rows = await query(
    'SELECT id, role, name FROM merchants WHERE id=:id AND deleted_at IS NULL',
    { id: mid }
  )
  if (!rows.length) throw new HttpError(404, '门店不存在')
  await query(`UPDATE merchants SET status=2, deleted_at=NOW() WHERE id=:id`, { id: mid })
  // 下架商品，避免前台残留
  const goodsTable =
    rows[0].role === 'cross' ? 'cross_goods' : rows[0].role === 'supply' ? 'supply_goods' : 'stall_goods'
  try {
    await query(
      `UPDATE ${goodsTable} SET deleted_at=NOW() WHERE merchant_id=:id AND deleted_at IS NULL`,
      { id: mid }
    )
  } catch (_) {
    /* 表或列缺失时忽略 */
  }
  // 关联入驻单：默认软删隐藏；改驳回场景可 keep 以保留审核列表
  try {
    if (hideApplies) {
      await query(
        `UPDATE merchant_applications
         SET status='rejected',
             reject_reason=IFNULL(NULLIF(reject_reason,''), '门店已由平台删除，可重新提交入驻'),
             reviewed_at=NOW(),
             deleted_at=IFNULL(deleted_at, NOW())
         WHERE merchant_id=:id AND (deleted_at IS NULL OR status IN ('approved','pending'))`,
        { id: mid }
      )
    } else {
      await query(
        `UPDATE merchant_applications
         SET status='rejected',
             reject_reason=IFNULL(NULLIF(reject_reason,''), '门店已停用，可重新提交入驻'),
             reviewed_at=NOW()
         WHERE merchant_id=:id AND status IN ('approved','pending')`,
        { id: mid }
      )
    }
  } catch (e) {
    if (/Unknown column.*deleted_at/i.test(String(e.message || ''))) {
      try {
        await query(
          `UPDATE merchant_applications
           SET status='rejected',
               reject_reason=IFNULL(NULLIF(reject_reason,''), '门店已由平台删除，可重新提交入驻'),
               reviewed_at=NOW()
           WHERE merchant_id=:id AND status IN ('approved','pending')`,
          { id: mid }
        )
      } catch (_) {
        /* 忽略 */
      }
    }
  }
  return {
    id: mid,
    deleted: true,
    role: rows[0].role,
    name: rows[0].name,
    reapplyAllowed: true
  }
}

async function updateMerchantMaterials(id, materials) {
  const { pickCoverFromLicenses } = require('../utils/mediaPick')
  const mats = materials || {}
  const cover = pickCoverFromLicenses(mats)
  await query(
    `UPDATE merchants SET materials_json=CAST(:j AS JSON),
     cover_url = IF(:cover = '', cover_url, :cover)
     WHERE id=:id`,
    {
      id,
      j: JSON.stringify(mats),
      cover: cover || ''
    }
  )
  return getStoreDetail(Number(id))
}

/** 新建门店商品（运营台从门店详情创建） */
async function createSku(type, body = {}) {
  const merchantId = Number(body.merchantId)
  if (!merchantId) throw new HttpError(400, '缺少商户ID')
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写商品名称')
  const mrows = await query(
    'SELECT id, role FROM merchants WHERE id=:id AND deleted_at IS NULL',
    { id: merchantId }
  )
  if (!mrows.length) throw new HttpError(404, '门店不存在')
  if (type && type !== mrows[0].role) {
    throw new HttpError(400, '商品类型与门店角色不一致')
  }
  const role = mrows[0].role
  const sku = String(body.sku || '').trim() || null
  const img = body.imageUrl || null
  const onSale = body.onSale === 0 ? 0 : 1
  if (onSale) await assertCanOnSale(merchantId)
  let insertId = 0
  if (role === 'stall') {
    const r = await query(
      `INSERT INTO stall_goods
        (merchant_id, name, sku_code, price, points_grant, category, desc_text, image_url, stock, on_sale)
       VALUES (:mid, :name, :sku, :price, :pg, :cat, :desc, :img, :stock, :onSale)`,
      {
        mid: merchantId,
        name,
        sku,
        price: Number(body.price) || 0,
        pg: Number(body.pointsGrant) || 0,
        cat: body.category || '主食',
        desc: body.desc || '',
        img,
        stock: Number(body.stock) || 9999,
        onSale
      }
    )
    insertId = r.insertId
    if (!sku && insertId) {
      await query(`UPDATE stall_goods SET sku_code=CONCAT('ST', LPAD(id,6,'0')) WHERE id=:id`, {
        id: insertId
      })
    }
  } else if (role === 'cross') {
    const r = await query(
      `INSERT INTO cross_goods
        (merchant_id, name, sku_code, points_need, cash_price, desc_text, image_url, stock, on_sale)
       VALUES (:mid, :name, :sku, :pn, :cp, :desc, :img, :stock, :onSale)`,
      {
        mid: merchantId,
        name,
        sku,
        pn: Number(body.pointsNeed) || 0,
        cp: Number(body.price || body.cashPrice) || 0,
        desc: body.desc || '',
        img,
        stock: Number(body.stock) || 9999,
        onSale
      }
    )
    insertId = r.insertId
    if (!sku && insertId) {
      await query(`UPDATE cross_goods SET sku_code=CONCAT('CR', LPAD(id,6,'0')) WHERE id=:id`, {
        id: insertId
      })
    }
  } else {
    const r = await query(
      `INSERT INTO supply_goods
        (merchant_id, name, sku_code, price, stock, points_grant, image_url, status)
       VALUES (:mid, :name, :sku, :price, :stock, :pg, :img, :st)`,
      {
        mid: merchantId,
        name,
        sku,
        price: Number(body.price) || 0,
        stock: Number(body.stock) || 0,
        pg: Number(body.pointsGrant) || 0,
        img,
        st: onSale
      }
    )
    insertId = r.insertId
    if (!sku && insertId) {
      await query(`UPDATE supply_goods SET sku_code=CONCAT('SP', LPAD(id,6,'0')) WHERE id=:id`, {
        id: insertId
      })
    }
  }
  return { id: insertId, merchantId, role }
}

async function softDeleteUser(id) {
  await query(`UPDATE users SET status=0, deleted_at=NOW() WHERE id=:id`, { id })
  return { id: Number(id), deleted: true }
}

async function setUserStatus(id, status) {
  await query(`UPDATE users SET status=:s WHERE id=:id AND deleted_at IS NULL`, {
    id,
    s: Number(status)
  })
  return { id: Number(id), status: Number(status) }
}

function mapSkuRow(g, t, typeLabel) {
  return {
    id: g.id,
    goodsType: t,
    goodsTypeLabel: typeLabel[t] || t,
    merchantId: g.merchant_id,
    shopName: g.shopName,
    name: g.name,
    sku: g.sku_code,
    price: g.price != null ? g.price : g.cash_price,
    pointsNeed: g.points_need,
    pointsGrant: g.points_grant,
    stock: g.stock,
    sales: g.sales_count || 0,
    onSale: g.on_sale != null ? g.on_sale : g.status,
    imageUrl: g.image_url,
    deletedAt: g.deleted_at
  }
}

/** 商品 SKU 列表（三类，分页） */
async function listSkus({ type, merchantId, shopName, includeDeleted, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const types = type ? [type] : ['stall', 'cross', 'supply']
  const typeLabel = { stall: '地摊', cross: '异业门店', supply: '供应链门店' }

  async function queryType(t, lim, off) {
    const table = t === 'stall' ? 'stall_goods' : t === 'cross' ? 'cross_goods' : 'supply_goods'
    let where = ` WHERE 1=1`
    const params = {}
    if (!includeDeleted) where += ` AND g.deleted_at IS NULL`
    where += ` AND m.deleted_at IS NULL AND m.role='${t}'`
    if (merchantId) {
      where += ` AND g.merchant_id=:mid`
      params.mid = Number(merchantId)
    }
    if (shopName && String(shopName).trim()) {
      where += ` AND m.name LIKE :shopName`
      params.shopName = `%${String(shopName).trim()}%`
    }
    const countRows = await query(
      `SELECT COUNT(*) AS c FROM ${table} g JOIN merchants m ON m.id=g.merchant_id${where}`,
      params
    )
    const rows = await query(
      `SELECT g.*, m.name AS shopName, '${t}' AS goodsType
       FROM ${table} g JOIN merchants m ON m.id=g.merchant_id${where}
       ORDER BY g.id DESC LIMIT ${lim} OFFSET ${off}`,
      params
    )
    return {
      total: Number(countRows[0]?.c) || 0,
      list: rows.map((g) => mapSkuRow(g, t, typeLabel))
    }
  }

  if (types.length === 1) {
    const result = await queryType(types[0], paging.limit, paging.offset)
    return pageResult(result.list, result.total, paging)
  }

  const fetchLimit = paging.offset + paging.pageSize
  const parts = await Promise.all(types.map((t) => queryType(t, fetchLimit, 0)))
  const total = parts.reduce((s, p) => s + p.total, 0)
  const merged = parts
    .flatMap((p) => p.list)
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(paging.offset, paging.offset + paging.pageSize)
  return pageResult(merged, total, paging)
}

async function setGoodsOpen(type, id, open) {
  if (open) await assertGoodsCanOnSale(type, id)
  const table = type === 'stall' ? 'stall_goods' : type === 'cross' ? 'cross_goods' : 'supply_goods'
  const col = type === 'supply' ? 'status' : 'on_sale'
  await query(`UPDATE ${table} SET ${col}=:v WHERE id=:id AND deleted_at IS NULL`, {
    id,
    v: open ? 1 : 0
  })
  return { id: Number(id), open: !!open }
}

async function softDeleteGoods(type, id) {
  const table = type === 'stall' ? 'stall_goods' : type === 'cross' ? 'cross_goods' : 'supply_goods'
  const col = type === 'supply' ? 'status' : 'on_sale'
  await query(`UPDATE ${table} SET ${col}=0, deleted_at=NOW() WHERE id=:id`, { id })
  return { id: Number(id), deleted: true }
}

async function saveSku(type, body) {
  const table = type === 'stall' ? 'stall_goods' : type === 'cross' ? 'cross_goods' : 'supply_goods'
  if (!body.id) throw new HttpError(400, '缺少商品ID')
  const onSale = body.onSale === 0 ? 0 : 1
  if (onSale) await assertGoodsCanOnSale(type, body.id)
  if (type === 'stall') {
    await query(
      `UPDATE stall_goods SET name=:n, sku_code=:sku, price=:p, points_grant=:pg, stock=:s,
       sales_count=:sales, image_url=:img, on_sale=:onSale WHERE id=:id`,
      {
        id: body.id,
        n: body.name,
        sku: body.sku || null,
        p: Number(body.price),
        pg: Number(body.pointsGrant) || 0,
        s: Number(body.stock) || 0,
        sales: Number(body.sales) || 0,
        img: body.imageUrl || null,
        onSale
      }
    )
  } else if (type === 'cross') {
    await query(
      `UPDATE cross_goods SET name=:n, sku_code=:sku, points_need=:pn, cash_price=:cp,
       stock=:s, sales_count=:sales, image_url=:img, on_sale=:onSale WHERE id=:id`,
      {
        id: body.id,
        n: body.name,
        sku: body.sku || null,
        pn: Number(body.pointsNeed) || 0,
        cp: Number(body.price || body.cashPrice) || 0,
        s: Number(body.stock) || 0,
        sales: Number(body.sales) || 0,
        img: body.imageUrl || null,
        onSale
      }
    )
  } else {
    await query(
      `UPDATE supply_goods SET name=:n, sku_code=:sku, price=:p, stock=:s, points_grant=:pg,
       sales_count=:sales, image_url=:img, status=:st WHERE id=:id`,
      {
        id: body.id,
        n: body.name,
        sku: body.sku || null,
        p: Number(body.price),
        s: Number(body.stock) || 0,
        pg: Number(body.pointsGrant) || 0,
        sales: Number(body.sales) || 0,
        img: body.imageUrl || null,
        st: onSale
      }
    )
  }
  return { id: Number(body.id) }
}

module.exports = {
  bigScreen,
  trackVisit,
  listAllIdentities,
  getStoreDetail,
  updateStore,
  createStore,
  createPlatformIdentity,
  setMerchantStatus,
  softDeleteMerchant,
  updateMerchantMaterials,
  createSku,
  softDeleteUser,
  setUserStatus,
  listSkus,
  setGoodsOpen,
  softDeleteGoods,
  saveSku,
  resolveBizOwner,
  ROLE_LABEL
}

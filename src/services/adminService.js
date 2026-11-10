const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { parsePaging, pageResult } = require('../utils/paging')
const orderService = require('./orderService')
const accountService = require('./accountService')
const catalogService = require('./catalogService')
const { getCashRate, pointsToCash, listConfigs, setConfig } = require('./configService')
const { assertCanOnSale } = require('./merchantReady')
const { assertProductionGoodsName } = require('../utils/goodsName')
const { provenanceFields } = require('../utils/goodsProvenance')
const categoryService = require('./categoryService')

const ROLE_LABEL = { stall: '地摊', cross: '异业', supply: '供应链' }

async function bindGoodsCategory(role, body, { allowEmpty = false } = {}) {
  return categoryService.resolveActiveCategory(role, {
    categoryId: body.categoryId,
    category: body.category,
    categoryName: body.categoryName,
    allowEmpty
  })
}

async function dashboard() {
  const one = async (sql) => {
    const rows = await query(sql)
    return rows[0] ? Number(Object.values(rows[0])[0]) : 0
  }
  const [
    users,
    merchants,
    pendingApplies,
    pendingPartnerApplies,
    pendingPartnerWithdraws,
    pendingPlatformApplies,
    consumerOrders,
    crossOrders,
    purchaseOrders,
    poolTotal,
    pointsTotal,
    openComplaints,
    openNeeds,
    pendingWithdraw
  ] = await Promise.all([
    one('SELECT COUNT(*) c FROM users WHERE status=1 AND deleted_at IS NULL').catch(() =>
      one('SELECT COUNT(*) c FROM users WHERE status=1')
    ),
    one('SELECT COUNT(*) c FROM merchants WHERE status=1 AND deleted_at IS NULL').catch(() =>
      one('SELECT COUNT(*) c FROM merchants WHERE status=1')
    ),
    one(
      `SELECT COUNT(*) c FROM merchant_applications WHERE status='pending' AND deleted_at IS NULL`
    ).catch(() => one(`SELECT COUNT(*) c FROM merchant_applications WHERE status='pending'`)),
    one(`SELECT COUNT(*) c FROM partner_applications WHERE status='pending'`).catch(() => 0),
    one(`SELECT COUNT(*) c FROM partner_withdraw_requests WHERE status='pending'`).catch(() => 0),
    one(`SELECT COUNT(*) c FROM platform_role_applications WHERE status='pending'`).catch(() => 0),
    one('SELECT COUNT(*) c FROM consumer_orders'),
    one('SELECT COUNT(*) c FROM cross_orders'),
    one('SELECT COUNT(*) c FROM purchase_orders'),
    one(
      `SELECT IFNULL(SUM(p.balance),0) c FROM merchant_points_pool p
       JOIN merchants m ON m.id=p.merchant_id WHERE m.deleted_at IS NULL`
    ).catch(() => one('SELECT IFNULL(SUM(balance),0) c FROM merchant_points_pool')),
    one('SELECT IFNULL(SUM(points_balance),0) c FROM users WHERE deleted_at IS NULL').catch(() =>
      one('SELECT IFNULL(SUM(points_balance),0) c FROM users')
    ),
    one(`SELECT COUNT(*) c FROM complaints WHERE status!='closed'`),
    one(`SELECT COUNT(*) c FROM supply_needs WHERE status='open'`),
    one(`SELECT COUNT(*) c FROM withdraw_requests WHERE status='pending'`)
  ])
  const rate = await getCashRate()
  const partnerOpsPending = pendingPartnerApplies + pendingPartnerWithdraws
  return {
    users,
    merchants,
    pendingApplies,
    pendingPartnerApplies,
    pendingPartnerWithdraws,
    pendingPlatformApplies,
    partnerOpsPending,
    identityFlagsPending: pendingPlatformApplies,
    navBadges: {
      applies: pendingApplies,
      partner_ops: partnerOpsPending,
      identity_flags: pendingPlatformApplies,
      withdraws: pendingWithdraw,
      complaints: openComplaints,
      needs: openNeeds
    },
    consumerOrders,
    crossOrders,
    purchaseOrders,
    poolTotal,
    pointsTotal,
    pointsCashValue: pointsToCash(pointsTotal, rate),
    openComplaints,
    openNeeds,
    pendingWithdraw,
    cashRate: rate
  }
}

/* ---------- merchants ---------- */
async function updateMerchant(id, body) {
  const rows = await query('SELECT id FROM merchants WHERE id=:id AND deleted_at IS NULL', { id })
  if (!rows.length) throw new HttpError(404, '商户不存在或已删除')
  const fields = []
  const params = { id }
  const map = {
    name: 'name',
    city: 'city',
    address: 'address',
    legalPerson: 'legal_person',
    contactName: 'contact_name',
    contactPhone: 'contact_phone',
    status: 'status',
    coverHue: 'cover_hue',
    coverUrl: 'cover_url',
    bizType: 'biz_type',
    latitude: 'latitude',
    longitude: 'longitude'
  }
  for (const [k, col] of Object.entries(map)) {
    if (body[k] === undefined || body[k] === null) continue
    if (body[k] === '' && !['coverUrl', 'address', 'bizType'].includes(k)) continue
    fields.push(`${col} = :${k}`)
    params[k] = k === 'latitude' || k === 'longitude' || k === 'status' ? Number(body[k]) : body[k]
  }
  if (!fields.length) throw new HttpError(400, '没有可更新字段')
  await query(`UPDATE merchants SET ${fields.join(', ')} WHERE id=:id`, params)
  return { id: Number(id) }
}

async function getMerchantDetail(id) {
  const rows = await query(
    `SELECT m.*, IFNULL(p.balance,0) AS pool_balance
     FROM merchants m
     LEFT JOIN merchant_points_pool p ON p.merchant_id=m.id
     WHERE m.id=:id AND m.deleted_at IS NULL`,
    { id }
  )
  if (!rows.length) throw new HttpError(404, '商户不存在或已删除')
  const m = rows[0]
  const { pickCoverFromLicenses } = require('../utils/mediaPick')
  const coverUrl = m.cover_url || pickCoverFromLicenses(m.materials_json) || ''
  const accounts = await query(
    `SELECT account_type AS type, balance, frozen FROM merchant_accounts WHERE merchant_id=:id`,
    { id }
  )
  const poolLedger = await query(
    `SELECT id, change_amount AS changeAmount, balance_after AS balanceAfter, biz_type AS bizType,
            title, created_at AS createdAt
     FROM merchant_pool_ledger WHERE merchant_id=:id ORDER BY id DESC LIMIT 30`,
    { id }
  )
  return {
    id: m.id,
    merchantNo: m.merchant_no,
    role: m.role,
    roleLabel: ROLE_LABEL[m.role] || m.role,
    name: m.name,
    city: m.city,
    address: m.address,
    contactName: m.contact_name,
    contactPhone: m.contact_phone,
    inviteCode: m.invite_code,
    status: m.status,
    coverUrl,
    coverHue: m.cover_hue,
    poolBalance: m.pool_balance,
    accounts,
    poolLedger
  }
}

/* ---------- users ---------- */
async function listUsers({ q, page, pageSize, limit } = {}) {
  const { parsePaging, pageResult } = require('../utils/paging')
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = 'WHERE deleted_at IS NULL'
  const params = {}
  if (q) {
    where += ` AND (nickname LIKE :q OR invite_code LIKE :q OR phone LIKE :q)`
    params.q = `%${q}%`
  }
  const countRows = await query(`SELECT COUNT(*) AS c FROM users ${where}`, params)
  const total = Number(countRows[0]?.c) || 0
  const rows = await query(
    `SELECT id, nickname, invite_code, phone, points_balance, status, avatar_url, created_at
     FROM users ${where}
     ORDER BY id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
    params
  )
  const list = rows.map((u) => ({
    id: u.id,
    nickname: u.nickname,
    inviteCode: u.invite_code,
    phone: u.phone,
    points: u.points_balance,
    status: u.status,
    avatarUrl: u.avatar_url,
    createdAt: u.created_at
  }))
  return pageResult(list, total, paging)
}

async function updateUser(id, body) {
  const rows = await query('SELECT id, points_balance FROM users WHERE id=:id', { id })
  if (!rows.length) throw new HttpError(404, '用户不存在')
  if (body.status !== undefined) {
    await query('UPDATE users SET status=:s WHERE id=:id', { id, s: Number(body.status) })
  }
  if (body.nickname !== undefined) {
    await query('UPDATE users SET nickname=:n WHERE id=:id', { id, n: body.nickname })
  }
  return { id: Number(id) }
}

async function adjustUserPoints(id, { points, title } = {}) {
  const delta = Number(points)
  if (!delta || Number.isNaN(delta)) throw new HttpError(400, '积分变动量无效')
  const cur = await query('SELECT points_balance FROM users WHERE id=:id', { id })
  if (!cur.length) throw new HttpError(404, '用户不存在')
  const next = Math.max(0, Number(cur[0].points_balance) + delta)
  await query('UPDATE users SET points_balance=:p WHERE id=:id', { id, p: next })
  await query(
    `INSERT INTO user_points_ledger (user_id, change_amount, balance_after, biz_type, title)
     VALUES (:id, :d, :b, 'adjust', :t)`,
    { id, d: delta, b: next, t: title || '后台调整积分' }
  )
  return { userId: Number(id), points: next, change: delta }
}

/* ---------- goods ---------- */
async function assertMerchantForGoods(merchantId, expectedRole) {
  const mid = Number(merchantId)
  if (!mid) throw new HttpError(400, '缺少商户ID')
  const rows = await query(
    `SELECT id, role, status, name FROM merchants WHERE id=:id AND deleted_at IS NULL LIMIT 1`,
    { id: mid }
  )
  if (!rows.length) throw new HttpError(404, '门店不存在或已删除')
  if (expectedRole && rows[0].role !== expectedRole) {
    throw new HttpError(400, `该门店是「${rows[0].role}」，不能挂到${expectedRole}商品`)
  }
  return rows[0]
}

function parseGoodsId(raw) {
  if (raw === undefined || raw === null || raw === '') return 0
  const id = Number(raw)
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, '商品ID无效')
  return id
}

/**
 * 快捷改积分/价格/上下架：只更新指定字段，品名/类目一律以库内为准，禁止走新建。
 */
async function patchGoods(type, id, body = {}) {
  const role = String(type || '')
  if (!['stall', 'cross', 'supply'].includes(role)) throw new HttpError(400, '商品类型无效')
  const gid = parseGoodsId(id)
  const table = role === 'stall' ? 'stall_goods' : role === 'cross' ? 'cross_goods' : 'supply_goods'
  const rows = await query(
    `SELECT * FROM ${table} WHERE id=:id AND deleted_at IS NULL LIMIT 1`,
    { id: gid }
  )
  if (!rows.length) throw new HttpError(404, '商品不存在')
  const row = rows[0]
  const merchantId = Number(row.merchant_id)
  await assertMerchantForGoods(merchantId, role)

  const sets = []
  const params = { id: gid, mid: merchantId }

  if (body.pointsGrant !== undefined) {
    const pg = Math.floor(Number(body.pointsGrant))
    if (!Number.isFinite(pg) || pg < 0) throw new HttpError(400, '积分数量无效')
    if (role === 'cross') throw new HttpError(400, '异业商品请改所需积分')
    sets.push('points_grant=:pg')
    params.pg = pg
  }
  if (body.pointsUsable !== undefined) {
    if (role !== 'stall') throw new HttpError(400, '仅点餐商品可改可用积分')
    const { clampPointsUsable } = require('../utils/pointsUsable')
    const priceForCap = body.price !== undefined ? Number(body.price) : Number(row.price)
    const pu = clampPointsUsable(body.pointsUsable, priceForCap)
    if (!Number.isFinite(pu) || pu < 0) throw new HttpError(400, '可用积分无效')
    sets.push('points_usable=:pu')
    params.pu = pu
  }
  if (body.mixEnabled !== undefined) {
    if (role !== 'stall') throw new HttpError(400, '仅点餐商品可改积分抵现开关')
    const mix = body.mixEnabled === 0 || body.mixEnabled === '0' ? 0 : 1
    sets.push('mix_enabled=:mix')
    params.mix = mix
    if (mix === 0 && body.pointsUsable === undefined) {
      sets.push('points_usable=:puOff')
      params.puOff = 0
    }
  }
  if (body.pointsNeed !== undefined) {
    const pn = Math.floor(Number(body.pointsNeed))
    if (!Number.isFinite(pn) || pn < 0) throw new HttpError(400, '积分数量无效')
    if (role !== 'cross') throw new HttpError(400, '仅异业商品可改所需积分')
    sets.push('points_need=:pn')
    params.pn = pn
  }
  if (body.price !== undefined) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, '价格无效')
    if (role === 'cross') throw new HttpError(400, '异业商品请改现金价')
    if (role === 'stall' && price > 0 && price < 0.01) throw new HttpError(400, '售价须至少 ¥0.01')
    sets.push('price=:price')
    params.price = price
  }
  if (body.cashPrice !== undefined) {
    const cash = Number(body.cashPrice)
    if (!Number.isFinite(cash) || cash < 0) throw new HttpError(400, '现金价无效')
    if (role !== 'cross') throw new HttpError(400, '仅异业商品可改现金价')
    sets.push('cash_price=:cashPrice')
    params.cashPrice = cash
  }
  if (body.stock !== undefined) {
    const stock = Number(body.stock)
    if (!Number.isFinite(stock) || stock < 0) throw new HttpError(400, '库存无效')
    sets.push('stock=:stock')
    params.stock = stock
  }
  if (body.onSale !== undefined || body.status !== undefined) {
    const on =
      body.onSale !== undefined ? (body.onSale === 0 || body.onSale === '0' ? 0 : 1) : body.status === 0 || body.status === '0' ? 0 : 1
    if (on) await assertCanOnSale(merchantId)
    if (role === 'supply') {
      sets.push('status=:onSale')
    } else {
      sets.push('on_sale=:onSale')
    }
    params.onSale = on
  }

  if (!sets.length) throw new HttpError(400, '没有可更新的字段')

  const sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL`
  let result
  try {
    result = await query(sql, params)
  } catch (e) {
    if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
    // 兼容缺列的旧库：去掉 stock/on_sale 以外的可选列后不应到这里；直接抛出可读错误
    throw new HttpError(500, '商品表结构不完整，请先执行最新 SQL 迁移')
  }
  if (!result || Number(result.affectedRows) === 0) {
    throw new HttpError(404, '商品不存在或无权更新')
  }
  return {
    id: gid,
    merchantId,
    role,
    patched: Object.keys(body).filter((k) =>
      [
        'pointsGrant',
        'pointsUsable',
        'mixEnabled',
        'pointsNeed',
        'price',
        'cashPrice',
        'stock',
        'onSale',
        'status'
      ].includes(k)
    )
  }
}

async function listStallGoods({ merchantId, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = ` WHERE g.deleted_at IS NULL AND m.deleted_at IS NULL AND m.role='stall'`
  const params = {}
  if (merchantId) {
    where += ` AND g.merchant_id=:merchantId`
    params.merchantId = Number(merchantId)
  }
  const countRows = await query(
    `SELECT COUNT(*) AS c FROM stall_goods g JOIN merchants m ON m.id=g.merchant_id${where}`,
    params
  )
  let list
  try {
    list = await query(
      `SELECT g.id, g.merchant_id AS merchantId, m.name AS shopName, g.name, g.price,
              g.points_grant AS pointsGrant, g.category, g.category_id AS categoryId, g.unit,
              g.desc_text AS description, g.image_url AS imageUrl, g.stock, g.on_sale AS onSale,
              g.sku_code AS sku, g.sales_count AS sales, IFNULL(g.mix_enabled,1) AS mixEnabled,
              IFNULL(g.points_usable, 0) AS pointsUsable,
              IFNULL(g.allow_remark, 1) AS allowRemark,
              (SELECT COUNT(*) FROM stall_goods_option_groups og WHERE og.goods_id = g.id) AS optionGroupCount
       FROM stall_goods g JOIN merchants m ON m.id=g.merchant_id${where}
       ORDER BY g.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  } catch (e) {
    if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
    list = await query(
      `SELECT g.id, g.merchant_id AS merchantId, m.name AS shopName, g.name, g.price,
              g.points_grant AS pointsGrant, g.category, g.desc_text AS description,
              g.image_url AS imageUrl, g.stock, g.on_sale AS onSale, g.sku_code AS sku,
              g.sales_count AS sales, 1 AS mixEnabled, 0 AS pointsUsable, 1 AS allowRemark, 0 AS optionGroupCount
       FROM stall_goods g JOIN merchants m ON m.id=g.merchant_id${where}
       ORDER BY g.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  }
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

async function saveStallGoods(body, auth = null) {
  const merchantId = Number(body.merchantId)
  await assertMerchantForGoods(merchantId, 'stall')
  const id = parseGoodsId(body.id)
  if (id) {
    const existed = await query(
      `SELECT id FROM stall_goods WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL LIMIT 1`,
      { id, mid: merchantId }
    )
    if (!existed.length) throw new HttpError(404, '商品不存在，无法更新（已阻止误新建）')
  }
  const name = assertProductionGoodsName(body.name)
  const bound = await bindGoodsCategory('stall', body)
  const { clampPointsUsable, maxPointsUsableForPrice } = require('../utils/pointsUsable')
  const priceNum = Number(body.price)
  const priceCap = maxPointsUsableForPrice(priceNum)
  let mixOn = body.mixEnabled === 0 ? 0 : 1
  if (mixOn && priceCap <= 0) {
    throw new HttpError(400, '售价过低无法开启积分抵现（须留至少 ¥0.01 现金）')
  }
  let pointsUsable = clampPointsUsable(body.pointsUsable, priceNum)
  if (mixOn && pointsUsable <= 0) {
    throw new HttpError(400, '已开启积分抵现，请填写「最大可抵扣积分」（须大于 0）')
  }
  if (!mixOn) pointsUsable = 0
  const payload = {
    id,
    mid: merchantId,
    name,
    price: priceNum,
    pg: Number(body.pointsGrant) || 0,
    pu: pointsUsable,
    cat: bound.category,
    categoryId: bound.categoryId,
    unit: body.unit || '份',
    desc: body.description || body.desc || '',
    img: body.imageUrl || null,
    stock: Number(body.stock) || 9999,
    sku: String(body.sku || '').trim() || null,
    onSale: body.onSale === 0 ? 0 : 1,
    mix: mixOn,
    allowRemark: body.allowRemark === 0 ? 0 : 1
  }
  if (payload.onSale) await assertCanOnSale(merchantId)
  if (!Number.isFinite(payload.price) || payload.price < 0) {
    throw new HttpError(400, '请填写正确的售价')
  }
  if (payload.onSale && payload.price < 0.01) {
    throw new HttpError(400, '上架商品售价须至少 ¥0.01（组合支付需保留现金）')
  }
  if (payload.id) {
    try {
      const r = await query(
        `UPDATE stall_goods SET name=:name, price=:price, points_grant=:pg, points_usable=:pu,
         category=:cat, category_id=:categoryId,
         unit=:unit, desc_text=:desc, image_url=:img, stock=:stock, sku_code=IFNULL(:sku, sku_code),
         on_sale=:onSale, mix_enabled=:mix, allow_remark=:allowRemark
         WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL`,
        payload
      )
      if (!r || Number(r.affectedRows) === 0) {
        throw new HttpError(404, '商品不存在，无法更新（已阻止误新建）')
      }
    } catch (e) {
      if (e instanceof HttpError) throw e
      if (e && e.code === 'ER_BAD_FIELD_ERROR') {
        const r = await query(
          `UPDATE stall_goods SET name=:name, price=:price, points_grant=:pg, category=:cat,
           desc_text=:desc, image_url=:img, stock=:stock, on_sale=:onSale
           WHERE id=:id AND merchant_id=:mid`,
          payload
        )
        if (!r || Number(r.affectedRows) === 0) {
          throw new HttpError(404, '商品不存在，无法更新（已阻止误新建）')
        }
      } else {
        throw e
      }
    }
    return { id: payload.id, categoryId: payload.categoryId, category: payload.cat }
  }
  const prov = provenanceFields({
    source: body.dataSource || 'manual',
    name,
    sku: payload.sku,
    auth
  })
  Object.assign(payload, {
    dataSource: prov.dataSource,
    createdByType: prov.createdByType,
    createdById: prov.createdById,
    createdByName: prov.createdByName
  })
  let r
  try {
    r = await query(
      `INSERT INTO stall_goods
        (merchant_id, name, sku_code, price, points_grant, category, category_id, unit, desc_text, image_url, stock, on_sale,
         mix_enabled, points_usable, allow_remark, data_source, created_by_type, created_by_id, created_by_name)
       VALUES (:mid, :name, :sku, :price, :pg, :cat, :categoryId, :unit, :desc, :img, :stock, :onSale,
         :mix, :pu, :allowRemark, :dataSource, :createdByType, :createdById, :createdByName)`,
      payload
    )
  } catch (e) {
    if (e && e.code === 'ER_BAD_FIELD_ERROR') {
      r = await query(
        `INSERT INTO stall_goods (merchant_id, name, price, points_grant, category, desc_text, image_url, stock, on_sale)
         VALUES (:mid, :name, :price, :pg, :cat, :desc, :img, :stock, :onSale)`,
        payload
      )
    } else {
      throw e
    }
  }
  const insertId = r.insertId
  if (!payload.sku && insertId) {
    await query(`UPDATE stall_goods SET sku_code = CONCAT('ST', LPAD(id, 6, '0')) WHERE id=:id AND (sku_code IS NULL OR sku_code='')`, {
      id: insertId
    })
  }
  return { id: insertId, categoryId: payload.categoryId, category: payload.cat }
}

async function listCrossGoods({ merchantId, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = ` WHERE g.deleted_at IS NULL AND m.deleted_at IS NULL AND m.role='cross'`
  const params = {}
  if (merchantId) {
    where += ` AND g.merchant_id=:merchantId`
    params.merchantId = Number(merchantId)
  }
  const countRows = await query(
    `SELECT COUNT(*) AS c FROM cross_goods g JOIN merchants m ON m.id=g.merchant_id${where}`,
    params
  )
  let list
  try {
    list = await query(
      `SELECT g.id, g.merchant_id AS merchantId, m.name AS shopName, g.name,
              g.points_need AS pointsNeed, g.cash_price AS cashPrice, g.stock,
              g.category, g.category_id AS categoryId, IFNULL(g.allow_mix,1) AS allowMix,
              g.desc_text AS description, g.image_url AS imageUrl, g.on_sale AS onSale,
              g.sku_code AS sku, g.sales_count AS sales
       FROM cross_goods g JOIN merchants m ON m.id=g.merchant_id${where}
       ORDER BY g.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  } catch (e) {
    if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
    list = await query(
      `SELECT g.id, g.merchant_id AS merchantId, m.name AS shopName, g.name,
              g.points_need AS pointsNeed, g.cash_price AS cashPrice,
              g.desc_text AS description, g.image_url AS imageUrl, g.on_sale AS onSale,
              g.sku_code AS sku, g.sales_count AS sales, 1 AS allowMix
       FROM cross_goods g JOIN merchants m ON m.id=g.merchant_id${where}
       ORDER BY g.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  }
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

async function saveCrossGoods(body, auth = null) {
  const merchantId = Number(body.merchantId)
  await assertMerchantForGoods(merchantId, 'cross')
  const id = parseGoodsId(body.id)
  if (id) {
    const existed = await query(
      `SELECT id FROM cross_goods WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL LIMIT 1`,
      { id, mid: merchantId }
    )
    if (!existed.length) throw new HttpError(404, '商品不存在，无法更新（已阻止误新建）')
  }
  const name = assertProductionGoodsName(body.name)
  const bound = await bindGoodsCategory('cross', body)
  const payload = {
    id,
    mid: merchantId,
    name,
    pn: Number(body.pointsNeed) || 0,
    cp: Number(body.cashPrice) || 0,
    cat: bound.category,
    categoryId: bound.categoryId,
    desc: body.description || body.desc || '',
    img: body.imageUrl || null,
    stock: Number(body.stock) || 9999,
    sku: String(body.sku || '').trim() || null,
    onSale: body.onSale === 0 ? 0 : 1,
    mix: body.allowMix === 0 ? 0 : 1
  }
  if (payload.onSale) await assertCanOnSale(merchantId)
  if (payload.pn < 0 || payload.cp < 0) throw new HttpError(400, '请填写正确的积分价/现金价')
  if (payload.id) {
    try {
      const r = await query(
        `UPDATE cross_goods SET name=:name, points_need=:pn, cash_price=:cp, category=:cat, category_id=:categoryId,
         desc_text=:desc, image_url=:img, stock=:stock, sku_code=IFNULL(:sku, sku_code),
         on_sale=:onSale, allow_mix=:mix
         WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL`,
        payload
      )
      if (!r || Number(r.affectedRows) === 0) {
        throw new HttpError(404, '商品不存在，无法更新（已阻止误新建）')
      }
    } catch (e) {
      if (e instanceof HttpError) throw e
      if (e && e.code === 'ER_BAD_FIELD_ERROR') {
        const r = await query(
          `UPDATE cross_goods SET name=:name, points_need=:pn, cash_price=:cp, category=:cat, desc_text=:desc,
           image_url=:img, on_sale=:onSale
           WHERE id=:id AND merchant_id=:mid`,
          payload
        )
        if (!r || Number(r.affectedRows) === 0) {
          throw new HttpError(404, '商品不存在，无法更新（已阻止误新建）')
        }
      } else {
        throw e
      }
    }
    return { id: payload.id, categoryId: payload.categoryId, category: payload.cat }
  }
  const prov = provenanceFields({ source: body.dataSource || 'manual', name, sku: payload.sku, auth })
  Object.assign(payload, {
    dataSource: prov.dataSource,
    createdByType: prov.createdByType,
    createdById: prov.createdById,
    createdByName: prov.createdByName
  })
  let r
  try {
    r = await query(
      `INSERT INTO cross_goods
        (merchant_id, name, sku_code, category, category_id, points_need, cash_price, desc_text, image_url, stock, on_sale, allow_mix,
         data_source, created_by_type, created_by_id, created_by_name)
       VALUES (:mid, :name, :sku, :cat, :categoryId, :pn, :cp, :desc, :img, :stock, :onSale, :mix,
         :dataSource, :createdByType, :createdById, :createdByName)`,
      payload
    )
  } catch (e) {
    if (e && e.code === 'ER_BAD_FIELD_ERROR') {
      r = await query(
        `INSERT INTO cross_goods (merchant_id, name, points_need, cash_price, desc_text, image_url, on_sale)
         VALUES (:mid, :name, :pn, :cp, :desc, :img, :onSale)`,
        payload
      )
    } else {
      throw e
    }
  }
  const insertId = r.insertId
  if (!payload.sku && insertId) {
    await query(
      `UPDATE cross_goods SET sku_code = CONCAT('CR', LPAD(id, 6, '0')) WHERE id=:id AND (sku_code IS NULL OR sku_code='')`,
      { id: insertId }
    )
  }
  return { id: insertId, categoryId: payload.categoryId, category: payload.cat }
}

async function listSupplyGoodsAdmin({ merchantId, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = ` WHERE g.deleted_at IS NULL AND m.deleted_at IS NULL AND m.role='supply'`
  const params = {}
  if (merchantId) {
    where += ` AND g.merchant_id=:merchantId`
    params.merchantId = Number(merchantId)
  }
  const countRows = await query(
    `SELECT COUNT(*) AS c FROM supply_goods g JOIN merchants m ON m.id=g.merchant_id${where}`,
    params
  )
  let list
  try {
    list = await query(
      `SELECT g.id, g.merchant_id AS merchantId, m.name AS vendor, g.name, g.price, g.stock,
              g.points_grant AS pointsGrant, g.points_ratio_text AS pointsRatio,
              g.category, g.category_id AS categoryId, g.desc_text AS description,
              g.image_url AS imageUrl, g.status, g.status AS onSale, g.sku_code AS sku, g.sales_count AS sales
       FROM supply_goods g JOIN merchants m ON m.id=g.merchant_id${where}
       ORDER BY g.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  } catch (e) {
    if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
    list = await query(
      `SELECT g.id, g.merchant_id AS merchantId, m.name AS vendor, g.name, g.price, g.stock,
              g.points_grant AS pointsGrant, g.points_ratio_text AS pointsRatio,
              g.image_url AS imageUrl, g.status, g.status AS onSale, g.sku_code AS sku, g.sales_count AS sales
       FROM supply_goods g JOIN merchants m ON m.id=g.merchant_id${where}
       ORDER BY g.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  }
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

async function saveSupplyGoods(body, auth = null) {
  const merchantId = Number(body.merchantId)
  await assertMerchantForGoods(merchantId, 'supply')
  const id = parseGoodsId(body.id)
  if (id) {
    const existed = await query(
      `SELECT id FROM supply_goods WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL LIMIT 1`,
      { id, mid: merchantId }
    )
    if (!existed.length) throw new HttpError(404, '商品不存在，无法更新（已阻止误新建）')
  }
  const name = assertProductionGoodsName(body.name)
  const bound = await bindGoodsCategory('supply', body)
  const payload = {
    id,
    mid: merchantId,
    name,
    price: Number(body.price),
    stock: Number(body.stock) || 0,
    pg: Number(body.pointsGrant) || 0,
    ratio: body.pointsRatio || '',
    cat: bound.category,
    categoryId: bound.categoryId,
    desc: body.description || body.desc || '',
    img: body.imageUrl || null,
    sku: String(body.sku || '').trim() || null,
    status: body.status === 0 || body.onSale === 0 ? 0 : 1
  }
  if (payload.status) await assertCanOnSale(merchantId)
  if (!Number.isFinite(payload.price) || payload.price < 0) {
    throw new HttpError(400, '请填写正确的供货价')
  }
  if (payload.id) {
    try {
      const r = await query(
        `UPDATE supply_goods SET name=:name, price=:price, stock=:stock, points_grant=:pg,
         points_ratio_text=:ratio, category=:cat, category_id=:categoryId, desc_text=:desc, image_url=:img,
         sku_code=IFNULL(:sku, sku_code), status=:status
         WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL`,
        payload
      )
      if (!r || Number(r.affectedRows) === 0) {
        throw new HttpError(404, '商品不存在，无法更新（已阻止误新建）')
      }
    } catch (e) {
      if (e instanceof HttpError) throw e
      if (e && e.code === 'ER_BAD_FIELD_ERROR') {
        const r = await query(
          `UPDATE supply_goods SET name=:name, price=:price, stock=:stock, points_grant=:pg,
           points_ratio_text=:ratio, category=:cat, image_url=:img, status=:status WHERE id=:id AND merchant_id=:mid`,
          payload
        )
        if (!r || Number(r.affectedRows) === 0) {
          throw new HttpError(404, '商品不存在，无法更新（已阻止误新建）')
        }
      } else {
        throw e
      }
    }
    return { id: payload.id, categoryId: payload.categoryId, category: payload.cat }
  }
  const prov = provenanceFields({ source: body.dataSource || 'manual', name, sku: payload.sku, auth })
  Object.assign(payload, {
    dataSource: prov.dataSource,
    createdByType: prov.createdByType,
    createdById: prov.createdById,
    createdByName: prov.createdByName
  })
  let r
  try {
    r = await query(
      `INSERT INTO supply_goods
        (merchant_id, name, sku_code, category, category_id, price, stock, points_grant, points_ratio_text, desc_text, image_url, status,
         data_source, created_by_type, created_by_id, created_by_name)
       VALUES (:mid, :name, :sku, :cat, :categoryId, :price, :stock, :pg, :ratio, :desc, :img, :status,
         :dataSource, :createdByType, :createdById, :createdByName)`,
      payload
    )
  } catch (e) {
    if (e && e.code === 'ER_BAD_FIELD_ERROR') {
      r = await query(
        `INSERT INTO supply_goods (merchant_id, name, price, stock, points_grant, points_ratio_text, image_url, status)
         VALUES (:mid, :name, :price, :stock, :pg, :ratio, :img, :status)`,
        payload
      )
    } else {
      throw e
    }
  }
  const insertId = r.insertId
  if (!payload.sku && insertId) {
    await query(
      `UPDATE supply_goods SET sku_code = CONCAT('SP', LPAD(id, 6, '0')) WHERE id=:id AND (sku_code IS NULL OR sku_code='')`,
      { id: insertId }
    )
  }
  return { id: insertId, categoryId: payload.categoryId, category: payload.cat }
}

/* ---------- orders ---------- */
async function listConsumerOrders({ page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const countRows = await query('SELECT COUNT(*) AS c FROM consumer_orders')
  let list
  try {
    list = await query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_allocated AS pointsAllocated,
              o.pay_status AS payStatus, o.order_status AS orderStatus, o.buyer_remark AS buyerRemark,
              o.created_at AS createdAt, u.nickname AS userName, m.name AS shopName
       FROM consumer_orders o
       JOIN users u ON u.id=o.user_id
       JOIN merchants m ON m.id=o.merchant_id
       ORDER BY o.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`
    )
  } catch (e) {
    if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
    list = await query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_allocated AS pointsAllocated,
              o.pay_status AS payStatus, o.order_status AS orderStatus, o.created_at AS createdAt,
              u.nickname AS userName, m.name AS shopName
       FROM consumer_orders o
       JOIN users u ON u.id=o.user_id
       JOIN merchants m ON m.id=o.merchant_id
       ORDER BY o.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`
    )
  }
  if (list.length) {
    const ids = list.map((r) => r.id)
    const ph = ids.map((_, i) => `:id${i}`).join(',')
    const params = {}
    ids.forEach((id, i) => {
      params[`id${i}`] = id
    })
    let items = []
    try {
      items = await query(
        `SELECT order_id AS orderId, goods_name AS goodsName, qty, options_text AS optionsText,
                item_remark AS itemRemark, price
         FROM consumer_order_items WHERE order_id IN (${ph}) ORDER BY id ASC`,
        params
      )
    } catch (e) {
      if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
      items = await query(
        `SELECT order_id AS orderId, goods_name AS goodsName, qty, options_text AS optionsText, price
         FROM consumer_order_items WHERE order_id IN (${ph}) ORDER BY id ASC`,
        params
      )
    }
    const byOrder = new Map()
    for (const it of items) {
      if (!byOrder.has(it.orderId)) byOrder.set(it.orderId, [])
      byOrder.get(it.orderId).push(it)
    }
    list.forEach((row) => {
      row.items = byOrder.get(row.id) || []
      row.itemsText = (row.items || [])
        .map((it) => {
          const bits = [it.goodsName]
          if (it.optionsText) bits.push(it.optionsText)
          if (it.itemRemark) bits.push(`备注:${it.itemRemark}`)
          bits.push(`x${it.qty}`)
          return bits.join(' ')
        })
        .join('；')
    })
  }
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

async function listCrossOrders({ page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const countRows = await query('SELECT COUNT(*) AS c FROM cross_orders')
  const list = await query(
    `SELECT o.id, o.order_no AS orderNo, o.pay_mode AS payMode, o.points_spend AS pointsSpend,
            o.cash_amount AS cashAmount, o.status, o.goods_name AS goodsName, o.created_at AS createdAt,
            u.nickname AS userName, m.name AS shopName
     FROM cross_orders o
     JOIN users u ON u.id=o.user_id
     JOIN merchants m ON m.id=o.merchant_id
     ORDER BY o.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`
  )
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

async function listPurchaseOrders({ page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const countRows = await query('SELECT COUNT(*) AS c FROM purchase_orders')
  const list = await query(
    `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_grant AS pointsGrant,
            o.fulfill_type AS fulfillType, o.status, o.created_at AS createdAt,
            b.name AS buyerName, s.name AS sellerName
     FROM purchase_orders o
     JOIN merchants b ON b.id=o.buyer_merchant_id
     JOIN merchants s ON s.id=o.seller_merchant_id
     ORDER BY o.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`
  )
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

/* ---------- banners ---------- */
const BANNER_ROLES = {
  consumer: 'C端消费者',
  stall: '地摊商家',
  cross: '异业商家',
  supply: '供应链商家',
  partner: '合伙人',
  founder: '创始人',
  login: '入驻/登录'
}

const BANNER_PAGES = {
  consumer: [
    { key: 'index', label: '首页顶部' },
    { key: 'cross', label: '分类兑换顶' },
    { key: 'points', label: '饭票积分顶' },
    { key: 'mine', label: '我的页顶' }
  ],
  stall: [{ key: 'home', label: '商家工作台顶' }],
  cross: [{ key: 'home', label: '商家工作台顶' }],
  supply: [{ key: 'home', label: '商家工作台顶' }],
  partner: [{ key: 'home', label: '合伙人首页顶' }],
  founder: [{ key: 'home', label: '创始人首页顶' }],
  login: [{ key: 'apply', label: '入驻申请页顶' }]
}

const BANNER_LINK_TYPES = {
  none: '不跳转',
  image_detail: '跳转图片（二级页打开）',
  page: '跳转路径-到具体界面',
  miniprogram: '其他小程序路径',
  url: '外链网址'
}

/** 可选跳转目标：中文名 + 路径 + 在哪里找 */
const BANNER_JUMP_TARGETS = {
  consumer: [
    {
      path: '/pages/index/index',
      label: '首页',
      hint: '底部 Tab「首页」'
    },
    {
      path: '/pages/cross/cross',
      label: '分类兑换',
      hint: '底部 Tab「分类」'
    },
    {
      path: '/pages/points/points',
      label: '饭票/积分',
      hint: '底部 Tab「饭票/积分」'
    },
    {
      path: '/pages/mine/mine',
      label: '我的',
      hint: '底部 Tab「我的」'
    },
    {
      path: '/pages/orders/orders',
      label: '我的订单',
      hint: '我的 → 订单入口'
    },
    {
      path: '/pages/apply/apply',
      label: '入驻申请',
      hint: '登录/我的 → 申请入驻'
    },
    {
      path: '/pages/recommend/recommend',
      label: '推荐页',
      hint: '运营推广落地页'
    },
    {
      path: '/pages/service/service',
      label: '客服服务',
      hint: '我的 → 客服/帮助'
    },
    {
      path: '/pages/identity/identity',
      label: '身份中心',
      hint: '我的 → 切换身份'
    },
    {
      path: '/pages/legal/legal',
      label: '协议列表',
      hint: '我的 / 入驻流程中的协议入口'
    },
    {
      path: '/pages/scan-pay/scan-pay',
      label: '扫码收款页',
      hint: '扫商家收款码进入（一般需带门店参数）'
    }
  ],
  stall: [
    { path: '/merchant/home/home', label: '商家工作台', hint: '商家端首页' },
    { path: '/merchant/orders/orders', label: '商家订单', hint: '工作台 → 订单' },
    { path: '/merchant/goods/goods', label: '本店商品', hint: '工作台 → 物料/商品' },
    { path: '/merchant/assets/assets', label: '财务资产', hint: '工作台 → 财务' },
    { path: '/merchant/wx-sub/wx-sub', label: '进件/结算', hint: '工作台 → 进件资料' },
    { path: '/pages/identity/identity', label: '身份中心', hint: '我的 → 切换身份' }
  ],
  cross: [
    { path: '/merchant/home/home', label: '商家工作台', hint: '商家端首页' },
    { path: '/merchant/orders/orders', label: '商家订单', hint: '工作台 → 订单' },
    { path: '/merchant/goods/goods', label: '本店商品', hint: '工作台 → 商品' },
    { path: '/merchant/assets/assets', label: '财务资产', hint: '工作台 → 财务' },
    { path: '/pages/identity/identity', label: '身份中心', hint: '我的 → 切换身份' }
  ],
  supply: [
    { path: '/merchant/home/home', label: '商家工作台', hint: '商家端首页' },
    { path: '/merchant/goods/goods', label: '供货商品', hint: '工作台 → 商品' },
    { path: '/merchant/orders/orders', label: '采购/订单', hint: '工作台 → 订单' },
    { path: '/merchant/supply-list/supply-list', label: '供应列表', hint: '工作台 → 供应' },
    { path: '/pages/identity/identity', label: '身份中心', hint: '我的 → 切换身份' }
  ],
  partner: [
    { path: '/partner/home/home', label: '合伙人首页', hint: '合伙人工作台' },
    { path: '/partner/books/books', label: '账目', hint: '合伙人 → 账目' },
    { path: '/partner/orders/orders', label: '订单', hint: '合伙人 → 订单' },
    { path: '/partner/supply/supply', label: '供应链', hint: '合伙人 → 供应' },
    { path: '/pages/identity/identity', label: '身份中心', hint: '切换身份' }
  ],
  founder: [
    { path: '/founder/home/home', label: '创始人首页', hint: '创始人工作台' },
    { path: '/founder/applies/applies', label: '入驻审核', hint: '创始人 → 申请审核' },
    { path: '/founder/members/members', label: '成员', hint: '创始人 → 成员' },
    { path: '/founder/perms/perms', label: '权限', hint: '创始人 → 权限' },
    { path: '/pages/identity/identity', label: '身份中心', hint: '切换身份' }
  ],
  login: [
    { path: '/pages/login/login', label: '登录页', hint: '未登录入口' },
    { path: '/pages/apply/apply', label: '入驻申请', hint: '登录后申请入驻' },
    { path: '/pages/identity-apply/identity-apply', label: '身份申请', hint: '申请合伙人/创始人等' },
    { path: '/pages/legal/legal', label: '协议列表', hint: '入驻前协议' }
  ]
}

function normalizeBannerLinkType(raw) {
  const t = String(raw || '').trim()
  if (t === 'navigate' || t === 'switchTab') return 'page'
  if (['image_detail', 'page', 'miniprogram', 'url', 'none'].includes(t)) return t
  return 'none'
}

function normalizeBannerPagePath(raw) {
  let p = String(raw || '').trim()
  if (!p) return ''
  if (p.charAt(0) !== '/') p = `/${p}`
  return p
}

/** 展平全部可选展示槽位：端 + 位置 */
function listBannerPlacementSlots() {
  const slots = []
  Object.keys(BANNER_PAGES).forEach((roleScope) => {
    ;(BANNER_PAGES[roleScope] || []).forEach((p) => {
      slots.push({
        key: `${roleScope}:${p.key}`,
        roleScope,
        pageKey: p.key,
        roleLabel: BANNER_ROLES[roleScope] || roleScope,
        pageLabel: p.label,
        label: `${BANNER_ROLES[roleScope] || roleScope} · ${p.label}`
      })
    })
  })
  return slots
}

function placementLabel(roleScope, pageKey) {
  const pages = BANNER_PAGES[roleScope] || []
  const pageMeta = pages.find((p) => p.key === pageKey)
  const roleLabel = BANNER_ROLES[roleScope] || roleScope
  const pageLabel = pageMeta ? pageMeta.label : pageKey || '—'
  return `${roleLabel} · ${pageLabel}`
}

function parseBannerPlacements(body) {
  const slots = listBannerPlacementSlots()
  const slotMap = new Map(slots.map((s) => [s.key, s]))
  let raw = body.placements
  if (!Array.isArray(raw) || !raw.length) {
    // 兼容 placementKeys: ['consumer:index', ...]
    if (Array.isArray(body.placementKeys) && body.placementKeys.length) {
      raw = body.placementKeys.map((k) => {
        const key = String(k || '').trim()
        const hit = slotMap.get(key)
        return hit
          ? { roleScope: hit.roleScope, pageKey: hit.pageKey }
          : { roleScope: key.split(':')[0], pageKey: key.split(':').slice(1).join(':') }
      })
    } else if (body.roleScope && body.pageKey) {
      // 兼容旧单选
      raw = [{ roleScope: body.roleScope, pageKey: body.pageKey }]
    } else {
      raw = []
    }
  }
  const seen = new Set()
  const placements = []
  raw.forEach((item) => {
    const roleScope = String((item && item.roleScope) || '').trim()
    const pageKey = String((item && item.pageKey) || '').trim()
    const key = `${roleScope}:${pageKey}`
    if (!slotMap.has(key) || seen.has(key)) return
    seen.add(key)
    placements.push({
      key,
      roleScope,
      pageKey,
      roleLabel: BANNER_ROLES[roleScope] || roleScope,
      pageLabel: (BANNER_PAGES[roleScope] || []).find((p) => p.key === pageKey)?.label || pageKey,
      label: placementLabel(roleScope, pageKey)
    })
  })
  if (!placements.length) throw new HttpError(400, '请至少选择一个展示位置')
  return placements
}

async function replaceBannerPlacements(bannerId, placements) {
  const bid = Number(bannerId)
  if (!bid) return
  await query('DELETE FROM banner_placements WHERE banner_id=:id', { id: bid })
  for (const p of placements) {
    await query(
      `INSERT INTO banner_placements (banner_id, role_scope, page_key)
       VALUES (:bid, :role, :page)`,
      { bid, role: p.roleScope, page: p.pageKey }
    )
  }
}

async function loadBannerPlacementsMap(bannerIds) {
  const ids = (bannerIds || []).map(Number).filter(Boolean)
  if (!ids.length) return new Map()
  try {
    const rows = await query(
      `SELECT banner_id AS bannerId, role_scope AS roleScope, page_key AS pageKey
       FROM banner_placements
       WHERE banner_id IN (${ids.map((_, i) => `:id${i}`).join(',')})
       ORDER BY role_scope, page_key, id`,
      Object.fromEntries(ids.map((id, i) => [`id${i}`, id]))
    )
    const map = new Map()
    rows.forEach((r) => {
      const list = map.get(Number(r.bannerId)) || []
      list.push({
        key: `${r.roleScope}:${r.pageKey}`,
        roleScope: r.roleScope,
        pageKey: r.pageKey,
        roleLabel: BANNER_ROLES[r.roleScope] || r.roleScope,
        pageLabel: (BANNER_PAGES[r.roleScope] || []).find((p) => p.key === r.pageKey)?.label || r.pageKey,
        label: placementLabel(r.roleScope, r.pageKey)
      })
      map.set(Number(r.bannerId), list)
    })
    return map
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR')) return new Map()
    throw e
  }
}

function assertBannerPayload(body) {
  const placements = parseBannerPlacements(body)
  // 兼容旧列：取第一个位置写入 banners.role_scope / page_key
  const roleScope = placements[0].roleScope
  const pageKey = placements[0].pageKey
  // 跳转名称可选；未填则存空串（Banner 遮罩不显示标题）
  const title = String(body.title || body.jumpName || '').trim().slice(0, 64)
  const imageUrl = String(body.imageUrl || '').trim()
  if (!imageUrl) throw new HttpError(400, '请上传 Banner 图片')
  const linkType = normalizeBannerLinkType(body.linkType)
  let linkUrl = normalizeBannerPagePath(body.linkUrl)
  const linkAppid = String(body.linkAppid || '').trim()
  let linkImageUrl = String(body.linkImageUrl || '').trim()
  if (linkType === 'none') {
    linkUrl = ''
    linkImageUrl = ''
  } else if (linkType === 'image_detail') {
    // 详情图可选：未单独上传时，用 Banner 主图在二级页打开
    if (!linkImageUrl) linkImageUrl = imageUrl
    linkUrl = ''
  } else if (linkType === 'page') {
    if (!linkUrl) throw new HttpError(400, '请选择或填写要跳转的界面路径')
  } else if (linkType === 'miniprogram') {
    if (!linkAppid) throw new HttpError(400, '请填写其他小程序 AppID')
    if (!linkUrl) throw new HttpError(400, '请填写其他小程序页面路径')
  } else if (linkType === 'url') {
    linkUrl = String(body.linkUrl || '').trim()
    if (!/^https?:\/\//i.test(linkUrl)) {
      throw new HttpError(400, '外链须以 http:// 或 https:// 开头')
    }
  }
  return {
    roleScope,
    pageKey,
    placements,
    title,
    imageUrl,
    linkType,
    linkUrl: linkType === 'image_detail' || linkType === 'none' ? '' : linkUrl,
    linkAppid: linkType === 'miniprogram' ? linkAppid : '',
    linkImageUrl: linkType === 'image_detail' ? linkImageUrl : '',
    remark: String(body.remark || '').trim(),
    sortOrder: Number(body.sortOrder) || 0,
    status: body.status === 0 ? 0 : 1
  }
}

async function listAllBanners({ roleScope, pageKey } = {}) {
  const role = String(roleScope || '').trim()
  const page = String(pageKey || '').trim()
  let rows
  try {
    // 有 placements 表：按「包含该位置」筛选；无筛选项则列出全部 Banner
    if (role || page) {
      rows = await query(
        `SELECT DISTINCT b.id, b.role_scope AS roleScope, b.page_key AS pageKey, b.title, b.title AS jumpName,
                b.sub_title AS subTitle, b.image_url AS imageUrl, b.link_url AS linkUrl,
                b.link_type AS linkType, b.link_appid AS linkAppid, b.link_image_url AS linkImageUrl,
                b.remark, b.sort_order AS sortOrder, b.status,
                b.start_at AS startAt, b.end_at AS endAt
         FROM banners b
         LEFT JOIN banner_placements p ON p.banner_id = b.id
         WHERE (
           (p.id IS NOT NULL AND (:role = '' OR p.role_scope = :role) AND (:page = '' OR p.page_key = :page))
           OR (p.id IS NULL AND (:role = '' OR b.role_scope = :role) AND (:page = '' OR b.page_key = :page))
         )
         ORDER BY b.sort_order, b.id`,
        { role, page }
      )
    } else {
      rows = await query(
        `SELECT id, role_scope AS roleScope, page_key AS pageKey, title, title AS jumpName,
                sub_title AS subTitle, image_url AS imageUrl, link_url AS linkUrl,
                link_type AS linkType, link_appid AS linkAppid, link_image_url AS linkImageUrl,
                remark, sort_order AS sortOrder, status,
                start_at AS startAt, end_at AS endAt
         FROM banners
         ORDER BY sort_order, id`
      )
    }
  } catch (e) {
    if (!(e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR'))) throw e
    const params = {}
    let where = 'WHERE 1=1'
    if (role) {
      where += ' AND role_scope=:role'
      params.role = role
    }
    if (page) {
      where += ' AND page_key=:page'
      params.page = page
    }
    rows = await query(
      `SELECT id, role_scope AS roleScope, page_key AS pageKey, title, title AS jumpName,
              sub_title AS subTitle, image_url AS imageUrl, link_url AS linkUrl,
              link_type AS linkType, sort_order AS sortOrder, status
       FROM banners ${where}
       ORDER BY sort_order, id`,
      params
    )
  }
  const placeMap = await loadBannerPlacementsMap(rows.map((r) => r.id))
  return rows.map((r) => {
    const linkType = normalizeBannerLinkType(r.linkType)
    let placements = placeMap.get(Number(r.id)) || []
    if (!placements.length && r.roleScope && r.pageKey) {
      placements = [
        {
          key: `${r.roleScope}:${r.pageKey}`,
          roleScope: r.roleScope,
          pageKey: r.pageKey,
          roleLabel: BANNER_ROLES[r.roleScope] || r.roleScope,
          pageLabel: (BANNER_PAGES[r.roleScope] || []).find((p) => p.key === r.pageKey)?.label || r.pageKey,
          label: placementLabel(r.roleScope, r.pageKey)
        }
      ]
    }
    return {
      ...r,
      linkType,
      placements,
      placementKeys: placements.map((p) => p.key),
      placementLabels: placements.map((p) => p.label),
      roleLabel: BANNER_ROLES[r.roleScope] || r.roleScope,
      pageLabel: placements.length
        ? placements.map((p) => p.label).join('、')
        : placementLabel(r.roleScope, r.pageKey),
      linkTypeLabel: BANNER_LINK_TYPES[linkType] || linkType,
      remark: r.remark || r.subTitle || '',
      linkAppid: r.linkAppid || '',
      linkImageUrl: r.linkImageUrl || ''
    }
  })
}

function bannerMeta() {
  return {
    roles: Object.keys(BANNER_ROLES).map((key) => ({ key, label: BANNER_ROLES[key] })),
    pages: BANNER_PAGES,
    placementSlots: listBannerPlacementSlots(),
    linkTypes: Object.keys(BANNER_LINK_TYPES).map((key) => ({
      key,
      label: BANNER_LINK_TYPES[key]
    })),
    jumpTargets: BANNER_JUMP_TARGETS
  }
}

async function saveBanner(body) {
  const p = assertBannerPayload(body)
  let bannerId = body.id ? Number(body.id) : 0
  if (bannerId) {
    try {
      await query(
        `UPDATE banners SET role_scope=:role, page_key=:page, title=:title, sub_title=:remark,
         image_url=:img, link_url=:link, link_type=:lt, link_appid=:appid, link_image_url=:limg,
         remark=:remark, sort_order=:sort, status=:status, start_at=NULL, end_at=NULL
         WHERE id=:id`,
        {
          id: bannerId,
          role: p.roleScope,
          page: p.pageKey,
          title: p.title,
          remark: p.remark,
          img: p.imageUrl,
          link: p.linkUrl,
          lt: p.linkType,
          appid: p.linkAppid || null,
          limg: p.linkImageUrl || null,
          sort: p.sortOrder,
          status: p.status
        }
      )
    } catch (e) {
      if (!e || e.code !== 'ER_BAD_FIELD_ERROR') throw e
      await query(
        `UPDATE banners SET role_scope=:role, page_key=:page, title=:title, sub_title=:remark,
         image_url=:img, link_url=:link, link_type=:lt, sort_order=:sort, status=:status
         WHERE id=:id`,
        {
          id: bannerId,
          role: p.roleScope,
          page: p.pageKey,
          title: p.title,
          remark: p.remark,
          img: p.imageUrl,
          link: p.linkUrl,
          lt: p.linkType,
          sort: p.sortOrder,
          status: p.status
        }
      )
    }
  } else {
    try {
      const r = await query(
        `INSERT INTO banners
          (role_scope, page_key, title, sub_title, image_url, link_url, link_type, link_appid,
           link_image_url, remark, sort_order, status)
         VALUES
          (:role, :page, :title, :remark, :img, :link, :lt, :appid, :limg, :remark, :sort, :status)`,
        {
          role: p.roleScope,
          page: p.pageKey,
          title: p.title,
          remark: p.remark,
          img: p.imageUrl,
          link: p.linkUrl,
          lt: p.linkType,
          appid: p.linkAppid || null,
          limg: p.linkImageUrl || null,
          sort: p.sortOrder,
          status: p.status
        }
      )
      bannerId = r.insertId
    } catch (e) {
      if (!e || e.code !== 'ER_BAD_FIELD_ERROR') throw e
      const r = await query(
        `INSERT INTO banners
          (role_scope, page_key, title, sub_title, image_url, link_url, link_type, sort_order, status)
         VALUES
          (:role, :page, :title, :remark, :img, :link, :lt, :sort, :status)`,
        {
          role: p.roleScope,
          page: p.pageKey,
          title: p.title,
          remark: p.remark,
          img: p.imageUrl,
          link: p.linkUrl,
          lt: p.linkType,
          sort: p.sortOrder,
          status: p.status
        }
      )
      bannerId = r.insertId
    }
  }
  try {
    await replaceBannerPlacements(bannerId, p.placements)
  } catch (e) {
    if (!(e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR'))) throw e
  }
  return { id: Number(bannerId), placements: p.placements }
}

async function deleteBanner(id) {
  const bid = Number(id)
  try {
    await query('DELETE FROM banner_placements WHERE banner_id=:id', { id: bid })
  } catch (e) {
    if (!(e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR'))) throw e
  }
  await query('DELETE FROM banners WHERE id=:id', { id: bid })
  return { id: bid }
}

async function setBannerStatus(id, status) {
  const sid = Number(id)
  if (!sid) throw new HttpError(400, '缺少 Banner ID')
  const on = Number(status) === 1 ? 1 : 0
  const rows = await query('SELECT id FROM banners WHERE id=:id LIMIT 1', { id: sid })
  if (!rows.length) throw new HttpError(404, 'Banner 不存在')
  await query('UPDATE banners SET status=:s WHERE id=:id', { id: sid, s: on })
  return { id: sid, status: on }
}

/* ---------- withdraw ---------- */
async function listWithdraws({ status, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = ''
  const params = {}
  if (status) {
    where = ` WHERE w.status=:status`
    params.status = status
  }
  const countRows = await query(
    `SELECT COUNT(*) AS c FROM withdraw_requests w JOIN merchants m ON m.id=w.merchant_id${where}`,
    params
  )
  const list = await query(
    `SELECT w.id, w.request_no AS requestNo, w.account_type AS accountType, w.amount,
            w.status, w.remark, w.created_at AS createdAt, m.name AS shopName, m.role
     FROM withdraw_requests w
     JOIN merchants m ON m.id=w.merchant_id${where}
     ORDER BY w.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
    params
  )
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

async function reviewWithdraw(id, { action, remark } = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM withdraw_requests WHERE id=? FOR UPDATE', [id])
    if (!rows.length) throw new HttpError(404, '提现单不存在')
    const w = rows[0]
    if (action === 'approve') {
      if (w.status !== 'pending') throw new HttpError(400, '当前状态不可审核')
      await conn.execute(
        `UPDATE withdraw_requests SET status='approved', remark=? WHERE id=?`,
        [remark || '审核通过', id]
      )
      return { id: Number(id), status: 'approved' }
    }
    if (action === 'paid') {
      if (!['pending', 'approved'].includes(w.status)) throw new HttpError(400, '当前状态不可打款')
      await accountService.settleWithdrawPaid(conn, {
        merchantId: w.merchant_id,
        accountType: w.account_type,
        amount: w.amount,
        bizId: w.request_no,
        title: `提现打款 · ${w.request_no}`
      })
      await conn.execute(
        `UPDATE withdraw_requests SET status='paid', remark=? WHERE id=?`,
        [remark || '已打款', id]
      )
      return { id: Number(id), status: 'paid' }
    }
    if (action === 'reject') {
      if (!['pending', 'approved'].includes(w.status)) throw new HttpError(400, '当前状态不可驳回')
      const reason = String(remark || '').trim()
      if (!reason) throw new HttpError(400, '请填写驳回原因')
      await accountService.unfreezeWithdraw(conn, {
        merchantId: w.merchant_id,
        accountType: w.account_type,
        amount: w.amount,
        bizId: w.request_no,
        title: `提现驳回 · ${w.request_no}`
      })
      await conn.execute(
        `UPDATE withdraw_requests SET status='rejected', remark=? WHERE id=?`,
        [reason.slice(0, 255), id]
      )
      return { id: Number(id), status: 'rejected' }
    }
    throw new HttpError(400, 'action 应为 approve/paid/reject')
  })
}

async function createDemoWithdraw({ merchantId, accountType, amount } = {}) {
  return orderService.applyWithdraw({
    merchantId: Number(merchantId),
    accountType: accountType || 'cash_settlement',
    amount: Number(amount)
  })
}

/* ---------- complaints / needs / referrals ---------- */
async function listComplaints({ status, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = ''
  const params = {}
  if (status) {
    where = ` WHERE c.status=:status`
    params.status = status
  }
  const countRows = await query(
    `SELECT COUNT(*) AS c FROM complaints c LEFT JOIN users u ON u.id=c.user_id${where}`,
    params
  )
  let list
  try {
    list = await query(
      `SELECT c.id, c.target_type AS targetType, c.target_id AS targetId, c.content,
              c.status, c.handle_remark AS handleRemark, c.created_at AS createdAt, u.nickname AS userName
       FROM complaints c LEFT JOIN users u ON u.id=c.user_id${where}
       ORDER BY c.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('handle_remark')))) {
      throw e
    }
    list = await query(
      `SELECT c.id, c.target_type AS targetType, c.target_id AS targetId, c.content,
              c.status, c.created_at AS createdAt, u.nickname AS userName
       FROM complaints c LEFT JOIN users u ON u.id=c.user_id${where}
       ORDER BY c.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  }
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

async function updateComplaint(id, { status, handleRemark } = {}) {
  if (!['open', 'processing', 'closed'].includes(status)) {
    throw new HttpError(400, '状态无效')
  }
  const remark = handleRemark != null ? String(handleRemark).slice(0, 512) : null
  try {
    if (remark != null && remark !== '') {
      await query('UPDATE complaints SET status=:s, handle_remark=:r WHERE id=:id', {
        id,
        s: status,
        r: remark
      })
    } else {
      await query('UPDATE complaints SET status=:s WHERE id=:id', { id, s: status })
    }
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('handle_remark')))) {
      throw e
    }
    await query('UPDATE complaints SET status=:s WHERE id=:id', { id, s: status })
  }
  return { id: Number(id), status, handleRemark: remark }
}

async function listSupplyNeeds({ status, page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = ''
  const params = {}
  if (status) {
    where = ` WHERE status=:status`
    params.status = status
  }
  const countRows = await query(`SELECT COUNT(*) AS c FROM supply_needs${where}`, params)
  let list
  try {
    list = await query(
      `SELECT id, goods_name AS goodsName, qty_text AS qtyText, expect_time AS expectTime,
              note, status, created_at AS createdAt, user_id AS userId,
              quote_price AS quotePrice, quote_note AS quoteNote,
              quoted_merchant_id AS quotedMerchantId, quoted_at AS quotedAt
       FROM supply_needs${where}
       ORDER BY id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('quote_')))) throw e
    list = await query(
      `SELECT id, goods_name AS goodsName, qty_text AS qtyText, expect_time AS expectTime,
              note, status, created_at AS createdAt, user_id AS userId
       FROM supply_needs${where}
       ORDER BY id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
      params
    )
  }
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

async function updateSupplyNeed(id, { status, quotePrice, quoteNote, quoteAmount, quoteRemark, merchantId } = {}) {
  const price = quotePrice != null ? quotePrice : quoteAmount
  const note = quoteNote != null ? quoteNote : quoteRemark
  if (['quoted', 'closed'].includes(status) || price != null) {
    return catalogService.quoteSupplyNeed(id, {
      merchantId,
      status: status || 'quoted',
      quotePrice: price,
      quoteNote: note
    })
  }
  if (!['open', 'quoted', 'closed'].includes(status)) throw new HttpError(400, '状态无效')
  await query('UPDATE supply_needs SET status=:s WHERE id=:id', { id, s: status })
  return { id: Number(id), status }
}

async function listReferrals({ page, pageSize, limit } = {}) {
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const countRows = await query('SELECT COUNT(*) AS c FROM referral_records')
  const list = await query(
    `SELECT r.id, r.trigger_type AS triggerType, r.reward_points AS rewardPoints, r.created_at AS createdAt,
            r.biz_id AS bizId,
            IFNULL(t.name, r.trigger_type) AS triggerName,
            a.nickname AS inviterName, a.invite_code AS inviterCode,
            b.nickname AS inviteeName, b.invite_code AS inviteeCode,
            m.name AS inviteeMerchantName
     FROM referral_records r
     LEFT JOIN users a ON a.id=r.inviter_user_id
     LEFT JOIN users b ON b.id=r.invitee_user_id AND r.invitee_user_id > 0
     LEFT JOIN merchants m ON m.id=r.invitee_merchant_id
     LEFT JOIN referral_triggers t ON t.trigger_key=r.trigger_type
     ORDER BY r.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`
  )
  return pageResult(list, Number(countRows[0]?.c) || 0, paging)
}

async function grantPool(body) {
  return orderService.adminGrantPool({
    merchantId: Number(body.merchantId),
    points: Number(body.points) || 500,
    title: body.title || '后台发放'
  })
}

async function getOrderDetail(type, id) {
  if (type === 'consumer') {
    let rows
    try {
      rows = await query(
        `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_want AS pointsWant,
                o.points_allocated AS pointsAllocated, o.pay_status AS payStatus, o.order_status AS orderStatus,
                o.buyer_remark AS buyerRemark, o.created_at AS createdAt, u.nickname AS userName, u.phone AS userPhone,
                m.name AS shopName, m.cover_url AS shopCover
         FROM consumer_orders o
         JOIN users u ON u.id=o.user_id
         JOIN merchants m ON m.id=o.merchant_id
         WHERE o.id=:id`,
        { id }
      )
    } catch (e) {
      if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
      rows = await query(
        `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_want AS pointsWant,
                o.points_allocated AS pointsAllocated, o.pay_status AS payStatus, o.order_status AS orderStatus,
                o.created_at AS createdAt, u.nickname AS userName, u.phone AS userPhone,
                m.name AS shopName, m.cover_url AS shopCover
         FROM consumer_orders o
         JOIN users u ON u.id=o.user_id
         JOIN merchants m ON m.id=o.merchant_id
         WHERE o.id=:id`,
        { id }
      )
    }
    if (!rows.length) throw new HttpError(404, '订单不存在')
    let items
    try {
      items = await query(
        `SELECT goods_id AS goodsId, goods_name AS goodsName, price, points_grant AS pointsGrant, qty,
                options_text AS optionsText, item_remark AS itemRemark, options_json AS optionsJson
         FROM consumer_order_items WHERE order_id=:id`,
        { id }
      )
    } catch (e) {
      if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
      items = await query(
        `SELECT goods_id AS goodsId, goods_name AS goodsName, price, points_grant AS pointsGrant, qty
         FROM consumer_order_items WHERE order_id=:id`,
        { id }
      )
    }
    return { ...rows[0], type: 'consumer', items }
  }
  if (type === 'cross') {
    const rows = await query(
      `SELECT o.id, o.order_no AS orderNo, o.pay_mode AS payMode, o.points_spend AS pointsSpend,
              o.cash_amount AS cashAmount, o.status, o.goods_name AS goodsName, o.goods_id AS goodsId,
              o.created_at AS createdAt, u.nickname AS userName, m.name AS shopName,
              m.cover_url AS shopCover, g.image_url AS goodsImage
       FROM cross_orders o
       JOIN users u ON u.id=o.user_id
       JOIN merchants m ON m.id=o.merchant_id
       LEFT JOIN cross_goods g ON g.id=o.goods_id
       WHERE o.id=:id`,
      { id }
    )
    if (!rows.length) throw new HttpError(404, '订单不存在')
    return {
      ...rows[0],
      type: 'cross',
      items: [
        {
          goodsId: rows[0].goodsId,
          goodsName: rows[0].goodsName,
          imageUrl: rows[0].goodsImage,
          qty: 1,
          pointsSpend: rows[0].pointsSpend,
          cashAmount: rows[0].cashAmount
        }
      ]
    }
  }
  if (type === 'purchase') {
    const rows = await query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_grant AS pointsGrant,
              o.fulfill_type AS fulfillType, o.status, o.created_at AS createdAt,
              b.name AS buyerName, s.name AS sellerName, s.cover_url AS sellerCover
       FROM purchase_orders o
       JOIN merchants b ON b.id=o.buyer_merchant_id
       JOIN merchants s ON s.id=o.seller_merchant_id
       WHERE o.id=:id`,
      { id }
    )
    if (!rows.length) throw new HttpError(404, '订单不存在')
    const items = await query(
      `SELECT goods_id AS goodsId, goods_name AS goodsName, price, qty, points_grant AS pointsGrant
       FROM purchase_order_items WHERE order_id=:id`,
      { id }
    )
    return { ...rows[0], type: 'purchase', items }
  }
  throw new HttpError(400, '订单类型无效')
}

async function listCommissions({ page, pageSize, limit } = {}) {
  const { parsePaging, pageResult } = require('../utils/paging')
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  const countRows = await query(`SELECT COUNT(*) AS c FROM commission_ledger`)
  const total = Number(countRows[0]?.c) || 0
  const list = await query(
    `SELECT c.id, c.biz_type AS bizType, c.biz_id AS bizId, c.amount_gross AS amountGross,
            c.rate, c.commission, c.rule_version AS ruleVersion, c.created_at AS createdAt,
            m.name AS payerName
     FROM commission_ledger c
     LEFT JOIN merchants m ON m.id=c.payer_merchant_id
     ORDER BY c.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`
  )
  return pageResult(list, total, paging)
}

async function listAccountLedgers({ page, pageSize, limit, merchantId } = {}) {
  const { parsePaging, pageResult } = require('../utils/paging')
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = 'WHERE 1=1'
  const params = {}
  if (merchantId) {
    where += ` AND l.merchant_id=:mid`
    params.mid = Number(merchantId)
  }
  const countRows = await query(
    `SELECT COUNT(*) AS c FROM merchant_account_ledger l ${where}`,
    params
  )
  const total = Number(countRows[0]?.c) || 0
  const list = await query(
    `SELECT l.id, l.account_type AS accountType, l.change_amount AS changeAmount,
            l.balance_after AS balanceAfter, l.biz_type AS bizType, l.biz_id AS bizId,
            l.title, l.created_at AS createdAt, m.name AS shopName, m.role
     FROM merchant_account_ledger l
     JOIN merchants m ON m.id=l.merchant_id ${where}
     ORDER BY l.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
    params
  )
  return pageResult(list, total, paging)
}

async function listUserPointsLedger({ page, pageSize, limit, userId } = {}) {
  const { parsePaging, pageResult } = require('../utils/paging')
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = 'WHERE 1=1'
  const params = {}
  if (userId) {
    where += ` AND l.user_id=:uid`
    params.uid = Number(userId)
  }
  const countRows = await query(`SELECT COUNT(*) AS c FROM user_points_ledger l ${where}`, params)
  const total = Number(countRows[0]?.c) || 0
  const list = await query(
    `SELECT l.id, l.change_amount AS changeAmount, l.balance_after AS balanceAfter,
            l.biz_type AS bizType, l.title, l.created_at AS createdAt,
            u.nickname AS userName, u.invite_code AS inviteCode, u.avatar_url AS avatarUrl
     FROM user_points_ledger l
     JOIN users u ON u.id=l.user_id ${where}
     ORDER BY l.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
    params
  )
  return pageResult(list, total, paging)
}

async function listPoolLedger({ page, pageSize, limit, merchantId } = {}) {
  const { parsePaging, pageResult } = require('../utils/paging')
  const paging = parsePaging({ page, pageSize, limit }, { pageSize: 20, maxPageSize: 100 })
  let where = 'WHERE 1=1'
  const params = {}
  if (merchantId) {
    where += ` AND l.merchant_id=:mid`
    params.mid = Number(merchantId)
  }
  const countRows = await query(
    `SELECT COUNT(*) AS c FROM merchant_pool_ledger l ${where}`,
    params
  )
  const total = Number(countRows[0]?.c) || 0
  const list = await query(
    `SELECT l.id, l.change_amount AS changeAmount, l.balance_after AS balanceAfter,
            l.biz_type AS bizType, l.title, l.created_at AS createdAt,
            m.name AS shopName, m.role, m.cover_url AS coverUrl
     FROM merchant_pool_ledger l
     JOIN merchants m ON m.id=l.merchant_id ${where}
     ORDER BY l.id DESC LIMIT ${paging.limit} OFFSET ${paging.offset}`,
    params
  )
  return pageResult(list, total, paging)
}

module.exports = {
  dashboard,
  updateMerchant,
  getMerchantDetail,
  listUsers,
  updateUser,
  adjustUserPoints,
  listStallGoods,
  saveStallGoods,
  patchGoods,
  listCrossGoods,
  saveCrossGoods,
  listSupplyGoodsAdmin,
  saveSupplyGoods,
  listConsumerOrders,
  listCrossOrders,
  listPurchaseOrders,
  getOrderDetail,
  listAllBanners,
  bannerMeta,
  saveBanner,
  deleteBanner,
  setBannerStatus,
  listWithdraws,
  reviewWithdraw,
  createDemoWithdraw,
  listComplaints,
  updateComplaint,
  listSupplyNeeds,
  updateSupplyNeed,
  listReferrals,
  grantPool,
  listCommissions,
  listAccountLedgers,
  listUserPointsLedger,
  listPoolLedger,
  listConfigs,
  setConfig
}

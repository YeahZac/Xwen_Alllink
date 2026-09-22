const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const orderService = require('./orderService')
const accountService = require('./accountService')
const catalogService = require('./catalogService')
const { getCashRate, pointsToCash, listConfigs, setConfig } = require('./configService')

const ROLE_LABEL = { stall: '地摊', cross: '异业', supply: '供应链' }

async function dashboard() {
  const one = async (sql) => {
    const rows = await query(sql)
    return rows[0] ? Number(Object.values(rows[0])[0]) : 0
  }
  const [
    users,
    merchants,
    pendingApplies,
    consumerOrders,
    crossOrders,
    purchaseOrders,
    poolTotal,
    pointsTotal,
    openComplaints,
    openNeeds,
    pendingWithdraw
  ] = await Promise.all([
    one('SELECT COUNT(*) c FROM users WHERE status=1'),
    one('SELECT COUNT(*) c FROM merchants WHERE status=1'),
    one(`SELECT COUNT(*) c FROM merchant_applications WHERE status='pending'`),
    one('SELECT COUNT(*) c FROM consumer_orders'),
    one('SELECT COUNT(*) c FROM cross_orders'),
    one('SELECT COUNT(*) c FROM purchase_orders'),
    one('SELECT IFNULL(SUM(balance),0) c FROM merchant_points_pool'),
    one('SELECT IFNULL(SUM(points_balance),0) c FROM users'),
    one(`SELECT COUNT(*) c FROM complaints WHERE status!='closed'`),
    one(`SELECT COUNT(*) c FROM supply_needs WHERE status='open'`),
    one(`SELECT COUNT(*) c FROM withdraw_requests WHERE status='pending'`)
  ])
  const rate = await getCashRate()
  return {
    users,
    merchants,
    pendingApplies,
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
  const rows = await query('SELECT id FROM merchants WHERE id=:id', { id })
  if (!rows.length) throw new HttpError(404, '商户不存在')
  const fields = []
  const params = { id }
  const map = {
    name: 'name',
    city: 'city',
    address: 'address',
    contactName: 'contact_name',
    contactPhone: 'contact_phone',
    status: 'status',
    coverHue: 'cover_hue',
    coverUrl: 'cover_url',
    latitude: 'latitude',
    longitude: 'longitude'
  }
  for (const [k, col] of Object.entries(map)) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') {
      fields.push(`${col} = :${k}`)
      params[k] = k === 'latitude' || k === 'longitude' ? Number(body[k]) : body[k]
    }
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
     WHERE m.id=:id`,
    { id }
  )
  if (!rows.length) throw new HttpError(404, '商户不存在')
  const m = rows[0]
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
    coverUrl: m.cover_url || '',
    coverHue: m.cover_hue,
    poolBalance: m.pool_balance,
    accounts,
    poolLedger
  }
}

/* ---------- users ---------- */
async function listUsers({ q, limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  let sql = `SELECT id, nickname, invite_code, phone, points_balance, status, avatar_url, created_at
             FROM users WHERE deleted_at IS NULL`
  const params = {}
  if (q) {
    sql += ` AND (nickname LIKE :q OR invite_code LIKE :q OR phone LIKE :q)`
    params.q = `%${q}%`
  }
  sql += ` ORDER BY id DESC LIMIT ${lim}`
  const rows = await query(sql, params)
  return rows.map((u) => ({
    id: u.id,
    nickname: u.nickname,
    inviteCode: u.invite_code,
    phone: u.phone,
    points: u.points_balance,
    status: u.status,
    avatarUrl: u.avatar_url,
    createdAt: u.created_at
  }))
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
async function listStallGoods({ merchantId, limit = 200 } = {}) {
  const lim = Math.min(Number(limit) || 200, 500)
  let sql = `SELECT g.id, g.merchant_id AS merchantId, m.name AS shopName, g.name, g.price,
                    g.points_grant AS pointsGrant, g.category, g.desc_text AS description,
                    g.image_url AS imageUrl, g.stock, g.on_sale AS onSale, g.sku_code AS sku,
                    g.sales_count AS sales
             FROM stall_goods g JOIN merchants m ON m.id=g.merchant_id
             WHERE g.deleted_at IS NULL`
  const params = {}
  if (merchantId) {
    sql += ` AND g.merchant_id=:merchantId`
    params.merchantId = Number(merchantId)
  }
  sql += ` ORDER BY g.id DESC LIMIT ${lim}`
  return query(sql, params)
}

async function saveStallGoods(body) {
  const merchantId = Number(body.merchantId)
  if (!merchantId) throw new HttpError(400, '缺少商户ID')
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写商品名称')
  const payload = {
    id: body.id ? Number(body.id) : 0,
    mid: merchantId,
    name,
    price: Number(body.price),
    pg: Number(body.pointsGrant) || 0,
    cat: body.category || '主食',
    unit: body.unit || '份',
    desc: body.description || body.desc || '',
    img: body.imageUrl || null,
    stock: Number(body.stock) || 9999,
    sku: String(body.sku || '').trim() || null,
    onSale: body.onSale === 0 ? 0 : 1,
    mix: body.mixEnabled === 0 ? 0 : 1
  }
  if (!Number.isFinite(payload.price) || payload.price < 0) {
    throw new HttpError(400, '请填写正确的售价')
  }
  if (payload.id) {
    try {
      await query(
        `UPDATE stall_goods SET name=:name, price=:price, points_grant=:pg, category=:cat,
         unit=:unit, desc_text=:desc, image_url=:img, stock=:stock, sku_code=IFNULL(:sku, sku_code),
         on_sale=:onSale, mix_enabled=:mix
         WHERE id=:id AND merchant_id=:mid`,
        payload
      )
    } catch (e) {
      if (e && e.code === 'ER_BAD_FIELD_ERROR') {
        await query(
          `UPDATE stall_goods SET name=:name, price=:price, points_grant=:pg, category=:cat,
           desc_text=:desc, image_url=:img, stock=:stock, on_sale=:onSale
           WHERE id=:id AND merchant_id=:mid`,
          payload
        )
      } else {
        throw e
      }
    }
    return { id: payload.id }
  }
  let r
  try {
    r = await query(
      `INSERT INTO stall_goods
        (merchant_id, name, sku_code, price, points_grant, category, unit, desc_text, image_url, stock, on_sale, mix_enabled)
       VALUES (:mid, :name, :sku, :price, :pg, :cat, :unit, :desc, :img, :stock, :onSale, :mix)`,
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
  const id = r.insertId
  if (!payload.sku && id) {
    await query(`UPDATE stall_goods SET sku_code = CONCAT('ST', LPAD(id, 6, '0')) WHERE id=:id AND (sku_code IS NULL OR sku_code='')`, {
      id
    })
  }
  return { id }
}

async function listCrossGoods({ merchantId, limit = 200 } = {}) {
  const lim = Math.min(Number(limit) || 200, 500)
  let sql = `SELECT g.id, g.merchant_id AS merchantId, m.name AS shopName, g.name,
                    g.points_need AS pointsNeed, g.cash_price AS cashPrice,
                    g.desc_text AS description, g.image_url AS imageUrl, g.on_sale AS onSale,
                    g.sku_code AS sku, g.sales_count AS sales
             FROM cross_goods g JOIN merchants m ON m.id=g.merchant_id
             WHERE g.deleted_at IS NULL`
  const params = {}
  if (merchantId) {
    sql += ` AND g.merchant_id=:merchantId`
    params.merchantId = Number(merchantId)
  }
  sql += ` ORDER BY g.id DESC LIMIT ${lim}`
  return query(sql, params)
}

async function saveCrossGoods(body) {
  const merchantId = Number(body.merchantId)
  if (!merchantId) throw new HttpError(400, '缺少商户ID')
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写商品名称')
  const payload = {
    id: body.id ? Number(body.id) : 0,
    mid: merchantId,
    name,
    pn: Number(body.pointsNeed) || 0,
    cp: Number(body.cashPrice) || 0,
    cat: body.category || '服务',
    desc: body.description || body.desc || '',
    img: body.imageUrl || null,
    stock: Number(body.stock) || 9999,
    sku: String(body.sku || '').trim() || null,
    onSale: body.onSale === 0 ? 0 : 1,
    mix: body.allowMix === 0 ? 0 : 1
  }
  if (payload.pn < 0 || payload.cp < 0) throw new HttpError(400, '请填写正确的积分价/现金价')
  if (payload.id) {
    try {
      await query(
        `UPDATE cross_goods SET name=:name, points_need=:pn, cash_price=:cp, category=:cat,
         desc_text=:desc, image_url=:img, stock=:stock, sku_code=IFNULL(:sku, sku_code),
         on_sale=:onSale, allow_mix=:mix
         WHERE id=:id AND merchant_id=:mid`,
        payload
      )
    } catch (e) {
      if (e && e.code === 'ER_BAD_FIELD_ERROR') {
        await query(
          `UPDATE cross_goods SET name=:name, points_need=:pn, cash_price=:cp, desc_text=:desc,
           image_url=:img, on_sale=:onSale
           WHERE id=:id AND merchant_id=:mid`,
          payload
        )
      } else {
        throw e
      }
    }
    return { id: payload.id }
  }
  let r
  try {
    r = await query(
      `INSERT INTO cross_goods
        (merchant_id, name, sku_code, category, points_need, cash_price, desc_text, image_url, stock, on_sale, allow_mix)
       VALUES (:mid, :name, :sku, :cat, :pn, :cp, :desc, :img, :stock, :onSale, :mix)`,
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
  const id = r.insertId
  if (!payload.sku && id) {
    await query(
      `UPDATE cross_goods SET sku_code = CONCAT('CR', LPAD(id, 6, '0')) WHERE id=:id AND (sku_code IS NULL OR sku_code='')`,
      { id }
    )
  }
  return { id }
}

async function listSupplyGoodsAdmin({ merchantId, limit = 200 } = {}) {
  const lim = Math.min(Number(limit) || 200, 500)
  let sql = `SELECT g.id, g.merchant_id AS merchantId, m.name AS vendor, g.name, g.price, g.stock,
                    g.points_grant AS pointsGrant, g.points_ratio_text AS pointsRatio,
                    g.image_url AS imageUrl, g.status, g.sku_code AS sku, g.sales_count AS sales
             FROM supply_goods g JOIN merchants m ON m.id=g.merchant_id
             WHERE g.deleted_at IS NULL`
  const params = {}
  if (merchantId) {
    sql += ` AND g.merchant_id=:merchantId`
    params.merchantId = Number(merchantId)
  }
  sql += ` ORDER BY g.id DESC LIMIT ${lim}`
  return query(sql, params)
}

async function saveSupplyGoods(body) {
  const merchantId = Number(body.merchantId)
  if (!merchantId) throw new HttpError(400, '缺少供应链商户ID')
  const name = String(body.name || '').trim()
  if (!name) throw new HttpError(400, '请填写商品名称')
  const payload = {
    id: body.id ? Number(body.id) : 0,
    mid: merchantId,
    name,
    price: Number(body.price),
    stock: Number(body.stock) || 0,
    pg: Number(body.pointsGrant) || 0,
    ratio: body.pointsRatio || '',
    cat: body.category || '原料',
    desc: body.description || body.desc || '',
    img: body.imageUrl || null,
    sku: String(body.sku || '').trim() || null,
    status: body.status === 0 || body.onSale === 0 ? 0 : 1
  }
  if (!Number.isFinite(payload.price) || payload.price < 0) {
    throw new HttpError(400, '请填写正确的供货价')
  }
  if (payload.id) {
    try {
      await query(
        `UPDATE supply_goods SET name=:name, price=:price, stock=:stock, points_grant=:pg,
         points_ratio_text=:ratio, category=:cat, desc_text=:desc, image_url=:img,
         sku_code=IFNULL(:sku, sku_code), status=:status
         WHERE id=:id AND merchant_id=:mid`,
        payload
      )
    } catch (e) {
      if (e && e.code === 'ER_BAD_FIELD_ERROR') {
        await query(
          `UPDATE supply_goods SET name=:name, price=:price, stock=:stock, points_grant=:pg,
           points_ratio_text=:ratio, image_url=:img, status=:status WHERE id=:id AND merchant_id=:mid`,
          payload
        )
      } else {
        throw e
      }
    }
    return { id: payload.id }
  }
  let r
  try {
    r = await query(
      `INSERT INTO supply_goods
        (merchant_id, name, sku_code, category, price, stock, points_grant, points_ratio_text, desc_text, image_url, status)
       VALUES (:mid, :name, :sku, :cat, :price, :stock, :pg, :ratio, :desc, :img, :status)`,
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
  const id = r.insertId
  if (!payload.sku && id) {
    await query(
      `UPDATE supply_goods SET sku_code = CONCAT('SP', LPAD(id, 6, '0')) WHERE id=:id AND (sku_code IS NULL OR sku_code='')`,
      { id }
    )
  }
  return { id }
}

/* ---------- orders ---------- */
async function listConsumerOrders({ limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  return query(
    `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_allocated AS pointsAllocated,
            o.pay_status AS payStatus, o.order_status AS orderStatus, o.created_at AS createdAt,
            u.nickname AS userName, m.name AS shopName
     FROM consumer_orders o
     JOIN users u ON u.id=o.user_id
     JOIN merchants m ON m.id=o.merchant_id
     ORDER BY o.id DESC LIMIT ${lim}`
  )
}

async function listCrossOrders({ limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  return query(
    `SELECT o.id, o.order_no AS orderNo, o.pay_mode AS payMode, o.points_spend AS pointsSpend,
            o.cash_amount AS cashAmount, o.status, o.goods_name AS goodsName, o.created_at AS createdAt,
            u.nickname AS userName, m.name AS shopName
     FROM cross_orders o
     JOIN users u ON u.id=o.user_id
     JOIN merchants m ON m.id=o.merchant_id
     ORDER BY o.id DESC LIMIT ${lim}`
  )
}

async function listPurchaseOrders({ limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  return query(
    `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_grant AS pointsGrant,
            o.fulfill_type AS fulfillType, o.status, o.created_at AS createdAt,
            b.name AS buyerName, s.name AS sellerName
     FROM purchase_orders o
     JOIN merchants b ON b.id=o.buyer_merchant_id
     JOIN merchants s ON s.id=o.seller_merchant_id
     ORDER BY o.id DESC LIMIT ${lim}`
  )
}

/* ---------- banners ---------- */
async function listAllBanners() {
  return query(
    `SELECT id, role_scope AS roleScope, title, sub_title AS subTitle, image_url AS imageUrl,
            link_url AS linkUrl, link_type AS linkType, sort_order AS sortOrder, status,
            start_at AS startAt, end_at AS endAt
     FROM banners ORDER BY role_scope, sort_order, id`
  )
}

async function saveBanner(body) {
  if (body.id) {
    await query(
      `UPDATE banners SET role_scope=:role, title=:title, sub_title=:sub, image_url=:img,
       link_url=:link, link_type=:lt, sort_order=:sort, status=:status,
       start_at=:startAt, end_at=:endAt WHERE id=:id`,
      {
        id: Number(body.id),
        role: body.roleScope || 'consumer',
        title: body.title,
        sub: body.subTitle || '',
        img: body.imageUrl || '',
        link: body.linkUrl || '',
        lt: body.linkType || 'none',
        sort: Number(body.sortOrder) || 0,
        status: body.status === 0 ? 0 : 1,
        startAt: body.startAt || null,
        endAt: body.endAt || null
      }
    )
    return { id: Number(body.id) }
  }
  const r = await query(
    `INSERT INTO banners (role_scope, title, sub_title, image_url, link_url, link_type, sort_order, status, start_at, end_at)
     VALUES (:role, :title, :sub, :img, :link, :lt, :sort, :status, :startAt, :endAt)`,
    {
      role: body.roleScope || 'consumer',
      title: body.title,
      sub: body.subTitle || '',
      img: body.imageUrl || '',
      link: body.linkUrl || '',
      lt: body.linkType || 'none',
      sort: Number(body.sortOrder) || 0,
      status: body.status === 0 ? 0 : 1,
      startAt: body.startAt || null,
      endAt: body.endAt || null
    }
  )
  return { id: r.insertId }
}

async function deleteBanner(id) {
  await query('DELETE FROM banners WHERE id=:id', { id })
  return { id: Number(id) }
}

/* ---------- withdraw ---------- */
async function listWithdraws({ status, limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  let sql = `SELECT w.id, w.request_no AS requestNo, w.account_type AS accountType, w.amount,
                    w.status, w.remark, w.created_at AS createdAt, m.name AS shopName, m.role
             FROM withdraw_requests w
             JOIN merchants m ON m.id=w.merchant_id`
  const params = {}
  if (status) {
    sql += ` WHERE w.status=:status`
    params.status = status
  }
  sql += ` ORDER BY w.id DESC LIMIT ${lim}`
  return query(sql, params)
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
      await accountService.unfreezeWithdraw(conn, {
        merchantId: w.merchant_id,
        accountType: w.account_type,
        amount: w.amount,
        bizId: w.request_no,
        title: `提现驳回 · ${w.request_no}`
      })
      await conn.execute(
        `UPDATE withdraw_requests SET status='rejected', remark=? WHERE id=?`,
        [remark || '已驳回', id]
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
async function listComplaints({ status, limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  let sql = `SELECT c.id, c.target_type AS targetType, c.target_id AS targetId, c.content,
                    c.status, c.created_at AS createdAt, u.nickname AS userName
             FROM complaints c LEFT JOIN users u ON u.id=c.user_id`
  const params = {}
  if (status) {
    sql += ` WHERE c.status=:status`
    params.status = status
  }
  sql += ` ORDER BY c.id DESC LIMIT ${lim}`
  return query(sql, params)
}

async function updateComplaint(id, { status } = {}) {
  if (!['open', 'processing', 'closed'].includes(status)) {
    throw new HttpError(400, '状态无效')
  }
  await query('UPDATE complaints SET status=:s WHERE id=:id', { id, s: status })
  return { id: Number(id), status }
}

async function listSupplyNeeds({ status, limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  let sql = `SELECT id, goods_name AS goodsName, qty_text AS qtyText, expect_time AS expectTime,
                    note, status, created_at AS createdAt, user_id AS userId,
                    quote_price AS quotePrice, quote_note AS quoteNote,
                    quoted_merchant_id AS quotedMerchantId, quoted_at AS quotedAt
             FROM supply_needs`
  const params = {}
  if (status) {
    sql += ` WHERE status=:status`
    params.status = status
  }
  sql += ` ORDER BY id DESC LIMIT ${lim}`
  try {
    return await query(sql, params)
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || String(e.message || '').includes('quote_')))) throw e
    let fallback = `SELECT id, goods_name AS goodsName, qty_text AS qtyText, expect_time AS expectTime,
                    note, status, created_at AS createdAt, user_id AS userId
             FROM supply_needs`
    if (status) fallback += ` WHERE status=:status`
    fallback += ` ORDER BY id DESC LIMIT ${lim}`
    return query(fallback, params)
  }
}

async function updateSupplyNeed(id, { status, quotePrice, quoteNote, merchantId } = {}) {
  if (['quoted', 'closed'].includes(status) || quotePrice != null) {
    return catalogService.quoteSupplyNeed(id, { merchantId, status: status || 'quoted', quotePrice, quoteNote })
  }
  if (!['open', 'quoted', 'closed'].includes(status)) throw new HttpError(400, '状态无效')
  await query('UPDATE supply_needs SET status=:s WHERE id=:id', { id, s: status })
  return { id: Number(id), status }
}

async function listReferrals({ limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  return query(
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
     ORDER BY r.id DESC LIMIT ${lim}`
  )
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
    const rows = await query(
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
    if (!rows.length) throw new HttpError(404, '订单不存在')
    const items = await query(
      `SELECT goods_id AS goodsId, goods_name AS goodsName, price, points_grant AS pointsGrant, qty
       FROM consumer_order_items WHERE order_id=:id`,
      { id }
    )
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

async function listCommissions({ limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  return query(
    `SELECT c.id, c.biz_type AS bizType, c.biz_id AS bizId, c.amount_gross AS amountGross,
            c.rate, c.commission, c.rule_version AS ruleVersion, c.created_at AS createdAt,
            m.name AS payerName
     FROM commission_ledger c
     LEFT JOIN merchants m ON m.id=c.payer_merchant_id
     ORDER BY c.id DESC LIMIT ${lim}`
  )
}

async function listAccountLedgers({ limit = 100, merchantId } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  let sql = `SELECT l.id, l.account_type AS accountType, l.change_amount AS changeAmount,
                    l.balance_after AS balanceAfter, l.biz_type AS bizType, l.biz_id AS bizId,
                    l.title, l.created_at AS createdAt, m.name AS shopName, m.role
             FROM merchant_account_ledger l
             JOIN merchants m ON m.id=l.merchant_id WHERE 1=1`
  const params = {}
  if (merchantId) {
    sql += ` AND l.merchant_id=:mid`
    params.mid = Number(merchantId)
  }
  sql += ` ORDER BY l.id DESC LIMIT ${lim}`
  return query(sql, params)
}

async function listUserPointsLedger({ limit = 100, userId } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  let sql = `SELECT l.id, l.change_amount AS changeAmount, l.balance_after AS balanceAfter,
                    l.biz_type AS bizType, l.title, l.created_at AS createdAt,
                    u.nickname AS userName, u.invite_code AS inviteCode, u.avatar_url AS avatarUrl
             FROM user_points_ledger l
             JOIN users u ON u.id=l.user_id WHERE 1=1`
  const params = {}
  if (userId) {
    sql += ` AND l.user_id=:uid`
    params.uid = Number(userId)
  }
  sql += ` ORDER BY l.id DESC LIMIT ${lim}`
  return query(sql, params)
}

async function listPoolLedger({ limit = 100, merchantId } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  let sql = `SELECT l.id, l.change_amount AS changeAmount, l.balance_after AS balanceAfter,
                    l.biz_type AS bizType, l.title, l.created_at AS createdAt,
                    m.name AS shopName, m.role, m.cover_url AS coverUrl
             FROM merchant_pool_ledger l
             JOIN merchants m ON m.id=l.merchant_id WHERE 1=1`
  const params = {}
  if (merchantId) {
    sql += ` AND l.merchant_id=:mid`
    params.mid = Number(merchantId)
  }
  sql += ` ORDER BY l.id DESC LIMIT ${lim}`
  return query(sql, params)
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
  listCrossGoods,
  saveCrossGoods,
  listSupplyGoodsAdmin,
  saveSupplyGoods,
  listConsumerOrders,
  listCrossOrders,
  listPurchaseOrders,
  getOrderDetail,
  listAllBanners,
  saveBanner,
  deleteBanner,
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

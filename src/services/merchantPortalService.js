const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const adminService = require('./adminService')
const orderService = require('./orderService')
const stallOptionsService = require('./stallOptionsService')
const feeService = require('./feeService')
const { applyGeo } = require('../utils/geo')

const ROLE_LABEL = { stall: '地摊', cross: '异业', supply: '供应链' }

async function dashboard(merchantId, role) {
  const mid = Number(merchantId)
  if (!mid) throw new HttpError(400, '缺少商户')

  const poolRows = await query(
    'SELECT IFNULL(balance,0) AS balance FROM merchant_points_pool WHERE merchant_id=:id',
    { id: mid }
  )
  const poolBalance = poolRows[0] ? Number(poolRows[0].balance) : 0

  const accounts = await query(
    `SELECT account_type AS type, balance, frozen FROM merchant_accounts WHERE merchant_id=:id`,
    { id: mid }
  )

  let todayOrders = 0
  let todayAmount = 0
  let monthOrders = 0
  let monthAmount = 0
  let goodsCount = 0
  let todayPointsAllocated = 0
  let monthPointsAllocated = 0
  let todayPointsOrders = 0
  let todayCashOrders = 0

  if (role === 'stall') {
    const [t] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a,
              IFNULL(SUM(CASE WHEN order_status='completed' THEN points_allocated ELSE 0 END),0) p
       FROM consumer_orders
       WHERE merchant_id=:id AND pay_status='paid' AND DATE(created_at)=CURDATE()`,
      { id: mid }
    )
    const [m] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a,
              IFNULL(SUM(CASE WHEN order_status='completed' THEN points_allocated ELSE 0 END),0) p
       FROM consumer_orders
       WHERE merchant_id=:id AND pay_status='paid' AND created_at>=DATE_FORMAT(NOW(),'%Y-%m-01')`,
      { id: mid }
    )
    todayOrders = Number(t.c)
    todayAmount = Number(t.a)
    monthOrders = Number(m.c)
    monthAmount = Number(m.a)
    todayPointsAllocated = Number(t.p) || 0
    monthPointsAllocated = Number(m.p) || 0
    const [g] = await query(
      `SELECT COUNT(*) c FROM stall_goods
       WHERE merchant_id=:id AND IFNULL(on_sale,0)=1 AND deleted_at IS NULL`,
      { id: mid }
    )
    goodsCount = Number(g.c)
  } else if (role === 'cross') {
    const [t] = await query(
      `SELECT COUNT(*) c,
              IFNULL(SUM(cash_amount),0) a,
              SUM(CASE WHEN pay_mode='points' THEN 1 ELSE 0 END) pts,
              SUM(CASE WHEN pay_mode='cash' THEN 1 ELSE 0 END) cash
       FROM cross_orders
       WHERE merchant_id=:id AND status='completed' AND DATE(created_at)=CURDATE()`,
      { id: mid }
    )
    const [m] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(cash_amount),0) a
       FROM cross_orders
       WHERE merchant_id=:id AND status='completed'
         AND created_at>=DATE_FORMAT(NOW(),'%Y-%m-01')`,
      { id: mid }
    )
    todayOrders = Number(t.c)
    todayAmount = Number(t.a)
    monthOrders = Number(m.c)
    monthAmount = Number(m.a)
    todayPointsOrders = Number(t.pts) || 0
    todayCashOrders = Number(t.cash) || 0
    const [g] = await query(
      `SELECT COUNT(*) c FROM cross_goods
       WHERE merchant_id=:id AND IFNULL(on_sale,0)=1 AND deleted_at IS NULL`,
      { id: mid }
    )
    goodsCount = Number(g.c)
  } else {
    const [t] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a FROM purchase_orders
       WHERE seller_merchant_id=:id AND status IN ('confirmed','shipped','completed')
         AND DATE(created_at)=CURDATE()`,
      { id: mid }
    )
    const [m] = await query(
      `SELECT COUNT(*) c, IFNULL(SUM(total_amount),0) a FROM purchase_orders
       WHERE seller_merchant_id=:id AND status IN ('confirmed','shipped','completed')
         AND created_at>=DATE_FORMAT(NOW(),'%Y-%m-01')`,
      { id: mid }
    )
    todayOrders = Number(t.c)
    todayAmount = Number(t.a)
    monthOrders = Number(m.c)
    monthAmount = Number(m.a)
    const [g] = await query(
      `SELECT COUNT(*) c FROM supply_goods
       WHERE merchant_id=:id AND IFNULL(status,0)=1 AND deleted_at IS NULL`,
      { id: mid }
    )
    goodsCount = Number(g.c)
  }

  let merchantRows
  try {
    merchantRows = await query(
      `SELECT id, name, role, cover_url AS coverUrl, materials_json AS materialsJson,
              city, invite_code AS inviteCode, status,
              service_status AS serviceStatus, trial_end_at AS trialEndAt,
              wx_sub_mch_id AS wxSubMchId, wx_apply_state AS wxApplyState
       FROM merchants WHERE id=:id`,
      { id: mid }
    )
  } catch (e) {
    if (!/Unknown column.*wx_/i.test(String(e.message || ''))) throw e
    merchantRows = await query(
      `SELECT id, name, role, cover_url AS coverUrl, materials_json AS materialsJson,
              city, invite_code AS inviteCode, status,
              service_status AS serviceStatus, trial_end_at AS trialEndAt
       FROM merchants WHERE id=:id`,
      { id: mid }
    )
  }
  if (merchantRows[0]) {
    const { enrichCoverRow } = require('../utils/mediaPick')
    enrichCoverRow(merchantRows[0], 'coverUrl', 'materialsJson')
  }
  const merchant = merchantRows[0] || null
  let ready = {
    catalogReady: false,
    homeEligible: false,
    platformPayReady: false,
    applyState: '',
    hasSubMchId: false
  }
  try {
    const { evaluateMerchantReady } = require('./merchantReady')
    ready = evaluateMerchantReady({
      wx_sub_mch_id: merchant && merchant.wxSubMchId,
      wx_apply_state: merchant && merchant.wxApplyState
    })
  } catch (_) {}

  let fee = null
  try {
    fee = await feeService.merchantFeeStatus(mid)
  } catch (_) {
    fee = null
  }

  return {
    merchant,
    poolBalance,
    accounts,
    todayOrders,
    todayAmount,
    monthOrders,
    monthAmount,
    todayPointsAllocated,
    monthPointsAllocated,
    todayPointsOrders,
    todayCashOrders,
    goodsCount,
    fee,
    catalogReady: ready.catalogReady,
    homeEligible: ready.homeEligible,
    platformPayReady: ready.platformPayReady,
    wxApplyState: (merchant && merchant.wxApplyState) || '',
    wxSubMchId: (merchant && merchant.wxSubMchId) || ''
  }
}

async function listOrders(merchantId, role, { type, limit = 50 } = {}) {
  const mid = Number(merchantId)
  const lim = Math.min(Number(limit) || 50, 100)

  if (type === 'buy') {
    return query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_grant AS pointsGrant,
              o.fulfill_type AS fulfillType, o.status, o.created_at AS time,
              s.name AS peerName, 'purchase_buy' AS type
       FROM purchase_orders o
       JOIN merchants s ON s.id=o.seller_merchant_id
       WHERE o.buyer_merchant_id=:id
       ORDER BY o.id DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  if (type === 'sell' || role === 'supply') {
    return query(
      `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount, o.points_grant AS pointsGrant,
              o.fulfill_type AS fulfillType, o.status, o.created_at AS time,
              b.name AS peerName, 'purchase_sell' AS type
       FROM purchase_orders o
       JOIN merchants b ON b.id=o.buyer_merchant_id
       WHERE o.seller_merchant_id=:id
       ORDER BY o.id DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  if (type === 'cross' || role === 'cross') {
    return query(
      `SELECT o.id, o.order_no AS orderNo, o.goods_name AS goodsName, o.pay_mode AS payMode,
              o.points_spend AS pointsSpend, o.cash_amount AS cashAmount, o.status,
              o.created_at AS time, u.nickname AS userName, 'cross' AS type
       FROM cross_orders o
       JOIN users u ON u.id=o.user_id
       WHERE o.merchant_id=:id
       ORDER BY o.id DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  // stall consumer / type=consumer
  return query(
    `SELECT o.id, o.order_no AS orderNo, o.total_amount AS totalAmount,
            o.points_allocated AS pointsAllocated, o.pay_status AS payStatus,
            o.order_status AS status, o.created_at AS time,
            u.nickname AS userName, 'stall' AS type
     FROM consumer_orders o
     JOIN users u ON u.id=o.user_id
     WHERE o.merchant_id=:id
     ORDER BY o.id DESC LIMIT ${lim}`,
    { id: mid }
  )
}

async function completeStallOrder(merchantId, orderId) {
  return orderService.completeStallOrder({ merchantId: Number(merchantId), orderId: Number(orderId) })
}

async function setMerchantOpen(merchantId, open) {
  // schema: 0待审 1营业 2停业 — 歇业必须写 2，避免与待审混淆
  const status = open ? 1 : 2
  const result = await query('UPDATE merchants SET status=:s WHERE id=:id AND deleted_at IS NULL', {
    s: status,
    id: Number(merchantId)
  })
  if (!result.affectedRows) throw new HttpError(404, '商户不存在')
  return { merchantId: Number(merchantId), status, open: status === 1 }
}

async function getMerchantGoodsOptions(merchantId, goodsId) {
  const rows = await query(
    'SELECT id FROM stall_goods WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL',
    { id: Number(goodsId), mid: Number(merchantId) }
  )
  if (!rows.length) throw new HttpError(404, '商品不存在')
  return stallOptionsService.getGoodsOptionGroups(Number(goodsId))
}

async function saveMerchantGoodsOptions(merchantId, goodsId, groups) {
  const rows = await query(
    'SELECT id FROM stall_goods WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL',
    { id: Number(goodsId), mid: Number(merchantId) }
  )
  if (!rows.length) throw new HttpError(404, '商品不存在')
  return stallOptionsService.saveGoodsOptionGroups(Number(goodsId), groups || [])
}

async function listGoods(merchantId, role) {
  const mid = Number(merchantId)
  if (role === 'stall') {
    try {
      return await query(
        `SELECT id, name, price, points_grant AS pointsGrant, category, unit, stock, on_sale AS onSale,
                mix_enabled AS mixEnabled, IFNULL(allow_remark,1) AS allowRemark,
                image_url AS imageUrl, sku_code AS sku, sales_count AS sales,
                desc_text AS description,
                (SELECT COUNT(*) FROM stall_goods_option_groups og WHERE og.goods_id = stall_goods.id) AS optionGroupCount
         FROM stall_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
        { id: mid }
      )
    } catch (e) {
      if (e && e.code !== 'ER_BAD_FIELD_ERROR') throw e
      return query(
        `SELECT id, name, price, points_grant AS pointsGrant, category, stock, on_sale AS onSale,
                image_url AS imageUrl, sku_code AS sku, sales_count AS sales, desc_text AS description,
                1 AS allowRemark, 0 AS optionGroupCount
         FROM stall_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
        { id: mid }
      )
    }
  }
  if (role === 'cross') {
    try {
      return await query(
        `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice, on_sale AS onSale,
                allow_mix AS allowMix, category, stock, image_url AS imageUrl, sku_code AS sku,
                sales_count AS sales, desc_text AS description
         FROM cross_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
        { id: mid }
      )
    } catch (e) {
      if (e && e.code !== 'ER_BAD_FIELD_ERROR') throw e
      return query(
        `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice, on_sale AS onSale,
                image_url AS imageUrl, sku_code AS sku, sales_count AS sales, desc_text AS description
         FROM cross_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
        { id: mid }
      )
    }
  }
  try {
    return await query(
      `SELECT id, name, price, stock, points_grant AS pointsGrant, points_ratio_text AS pointsRatio,
              category, desc_text AS description, status AS onSale, image_url AS imageUrl,
              sku_code AS sku, sales_count AS sales
       FROM supply_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
      { id: mid }
    )
  } catch (e) {
    if (e && e.code !== 'ER_BAD_FIELD_ERROR') throw e
    return query(
      `SELECT id, name, price, stock, points_grant AS pointsGrant, points_ratio_text AS pointsRatio,
              status AS onSale, image_url AS imageUrl, sku_code AS sku, sales_count AS sales
       FROM supply_goods WHERE merchant_id=:id AND deleted_at IS NULL ORDER BY id DESC`,
      { id: mid }
    )
  }
}

async function saveGoods(merchantId, role, body, auth = null) {
  const mid = Number(merchantId)
  if (!mid) throw new HttpError(400, '缺少商户ID')
  const rows = await query(
    `SELECT id, role, status, name FROM merchants WHERE id=:id AND deleted_at IS NULL LIMIT 1`,
    { id: mid }
  )
  if (!rows.length) throw new HttpError(404, '门店不存在或已删除')
  if (Number(rows[0].status) !== 1) throw new HttpError(400, '门店已停业，无法维护商品')
  if (role && rows[0].role !== role) throw new HttpError(400, '门店角色与当前身份不符')
  const payload = { ...body, merchantId: mid }
  const actor = {
    ...(auth || {}),
    merchantId: mid,
    role: rows[0].role,
    shopName: rows[0].name
  }
  if (rows[0].role === 'stall') return adminService.saveStallGoods(payload, actor)
  if (rows[0].role === 'cross') return adminService.saveCrossGoods(payload, actor)
  return adminService.saveSupplyGoods(
    {
      ...payload,
      status: body.onSale === 0 ? 0 : body.status === 0 ? 0 : 1
    },
    actor
  )
}

async function getGoods(merchantId, role, id) {
  const list = await listGoods(merchantId, role)
  const item = (list || []).find((g) => String(g.id) === String(id))
  if (!item) throw new HttpError(404, '商品不存在')
  return item
}

async function deleteGoods(merchantId, role, id) {
  const mid = Number(merchantId)
  const gid = Number(id)
  if (!mid || !gid) throw new HttpError(400, '参数无效')
  const table = role === 'stall' ? 'stall_goods' : role === 'cross' ? 'cross_goods' : 'supply_goods'
  const rows = await query(
    `SELECT id FROM ${table} WHERE id=:id AND merchant_id=:mid AND deleted_at IS NULL LIMIT 1`,
    { id: gid, mid }
  )
  if (!rows.length) throw new HttpError(404, '商品不存在或无权操作')
  const opsService = require('./opsService')
  return opsService.softDeleteGoods(role === 'stall' ? 'stall' : role === 'cross' ? 'cross' : 'supply', gid)
}

async function listCustomers(merchantId, role, { limit = 50 } = {}) {
  const mid = Number(merchantId)
  const lim = Math.min(Number(limit) || 50, 100)
  if (role === 'stall') {
    return query(
      `SELECT u.id, u.nickname AS name, u.avatar_url AS avatarUrl,
              COUNT(*) AS orders, IFNULL(SUM(o.total_amount),0) AS spend,
              MAX(o.created_at) AS last
       FROM consumer_orders o
       JOIN users u ON u.id=o.user_id
       WHERE o.merchant_id=:id AND o.pay_status='paid'
       GROUP BY u.id
       ORDER BY last DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  if (role === 'cross') {
    return query(
      `SELECT u.id, u.nickname AS name, u.avatar_url AS avatarUrl,
              COUNT(*) AS orders,
              IFNULL(SUM(o.cash_amount),0) AS spend,
              SUM(CASE WHEN o.pay_mode='points' THEN 1 ELSE 0 END) AS pointsOrders,
              SUM(CASE WHEN o.pay_mode='cash' THEN 1 ELSE 0 END) AS cashOrders,
              MAX(o.created_at) AS last
       FROM cross_orders o
       JOIN users u ON u.id=o.user_id
       WHERE o.merchant_id=:id
       GROUP BY u.id
       ORDER BY last DESC LIMIT ${lim}`,
      { id: mid }
    )
  }
  return query(
    `SELECT m.id, m.name, m.role AS type, m.cover_url AS avatarUrl,
            COUNT(*) AS orders, IFNULL(SUM(o.total_amount),0) AS spend,
            MAX(o.created_at) AS last
     FROM purchase_orders o
     JOIN merchants m ON m.id=o.buyer_merchant_id
     WHERE o.seller_merchant_id=:id
     GROUP BY m.id
     ORDER BY last DESC LIMIT ${lim}`,
    { id: mid }
  )
}

async function listFlow(merchantId, { limit = 50 } = {}) {
  const mid = Number(merchantId)
  const lim = Math.min(Number(limit) || 50, 100)
  const account = await query(
    `SELECT id, account_type AS accountType, change_amount AS amount, title,
            biz_type AS type, created_at AS time, 'cash' AS unit
     FROM merchant_account_ledger WHERE merchant_id=:id
     ORDER BY id DESC LIMIT ${lim}`,
    { id: mid }
  )
  const pool = await query(
    `SELECT id, 'pool' AS accountType, change_amount AS amount, title,
            biz_type AS type, created_at AS time, 'points' AS unit
     FROM merchant_pool_ledger WHERE merchant_id=:id
     ORDER BY id DESC LIMIT ${lim}`,
    { id: mid }
  )
  return [...account, ...pool]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, lim)
}

async function listSupplyMerchants(opts = {}) {
  const { enrichCoverRow } = require('../utils/mediaPick')
  const { HOME_VISIBLE_SQL } = require('./merchantReady')
  let rows
  try {
    rows = await query(
      `SELECT m.id, m.name, m.city, m.cover_url AS coverImage, m.cover_hue AS coverHue,
              m.materials_json AS materialsJson,
              m.address, m.latitude, m.longitude, LEFT(m.name,1) AS initial,
              IFNULL(NULLIF(m.biz_type,''), '百货商店') AS category,
              IFNULL(NULLIF(m.biz_type,''), '百货商店') AS tag,
              (SELECT COUNT(*) FROM supply_goods g WHERE g.merchant_id=m.id AND g.status=1 AND g.deleted_at IS NULL) AS goodsCount,
              (SELECT IFNULL(SUM(g.sales_count),0) FROM supply_goods g WHERE g.merchant_id=m.id) AS monthSales
       FROM merchants m
       WHERE m.role='supply' AND m.status=1 AND m.deleted_at IS NULL
         AND ${HOME_VISIBLE_SQL}
       ORDER BY m.id DESC`
    )
  } catch (e) {
    // 缺 wx_sub / operating_cities 列时 fail-closed，避免未进件供应链误上架
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_TABLE'))) throw e
    rows = []
  }
  return applyGeo(rows.map((r) => enrichCoverRow(r)), opts)
}

async function getCrossStoreDetail(id) {
  const { enrichCoverRow } = require('../utils/mediaPick')
  const { HOME_VISIBLE_SQL } = require('./merchantReady')
  let stores
  try {
    stores = await query(
      `SELECT m.id, m.name, m.city, m.address, m.latitude, m.longitude, m.cover_url AS coverImage,
              m.materials_json AS materialsJson,
              m.cover_hue AS coverHue, LEFT(m.name,1) AS initial,
              IFNULL(NULLIF(m.biz_type,''), '百货商店') AS category
       FROM merchants m
       WHERE m.id=:id AND m.role='cross' AND m.status=1 AND m.deleted_at IS NULL
         AND ${HOME_VISIBLE_SQL}`,
      { id }
    )
  } catch (e) {
    if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_TABLE'))) throw e
    stores = []
  }
  if (!stores.length) throw new HttpError(404, '异业门店不存在或尚未对外开放')
  const s = enrichCoverRow(stores[0])
  try {
    s.items = await query(
      `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice,
              desc_text AS \`desc\`, image_url AS coverImage, sku_code AS sku,
              IFNULL(allow_mix,1) AS allowMix, IFNULL(stock,9999) AS stock, category
       FROM cross_goods WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL`,
      { id }
    )
  } catch (e) {
    s.items = await query(
      `SELECT id, name, points_need AS pointsNeed, cash_price AS cashPrice,
              desc_text AS \`desc\`, image_url AS coverImage, sku_code AS sku, 1 AS allowMix
       FROM cross_goods WHERE merchant_id=:id AND on_sale=1 AND deleted_at IS NULL`,
      { id }
    )
  }
  return s
}

/**
 * 生成/缓存门店点餐码、收款码（微信 getwxacodeunlimit）
 * kind: menu | pay
 */
async function getOrCreateStoreQrcode(merchantId, { kind = 'menu', force = false } = {}) {
  const wxService = require('./wxService')
  const storageService = require('./storageService')

  const mid = Number(merchantId)
  if (!mid) throw new HttpError(400, '缺少门店')
  const k = kind === 'pay' ? 'pay' : 'menu'
  let rows
  try {
    rows = await query(
      `SELECT id, role, name, menu_qrcode_url AS menuUrl, pay_qrcode_url AS payUrl
       FROM merchants WHERE id=:id AND deleted_at IS NULL LIMIT 1`,
      { id: mid }
    )
  } catch (e) {
    if (/Unknown column.*menu_qrcode|Unknown column.*pay_qrcode/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/37_flow_automation.sql')
    }
    throw e
  }
  if (!rows.length) throw new HttpError(404, '门店不存在')
  const m = rows[0]
  const cached = k === 'pay' ? String(m.payUrl || '').trim() : String(m.menuUrl || '').trim()
  if (k === 'menu' && m.role === 'supply') {
    throw new HttpError(400, '供应链暂不支持点餐码，请使用供应链货品列表')
  }
  if (k === 'pay' && m.role !== 'stall') {
    throw new HttpError(400, '仅地摊支持收款码')
  }
  const page =
    k === 'pay'
      ? 'pages/scan-pay/scan-pay'
      : m.role === 'cross'
        ? 'pages/cross-detail/cross-detail'
        : 'pages/stall-menu/stall-menu'
  const pathHint = `/${page}?id=${mid}`
  if (cached && !force) {
    return {
      kind: k,
      merchantId: mid,
      shopName: m.name,
      page,
      path: pathHint,
      scene: `id=${mid}`,
      qrcodeUrl: cached,
      cached: true
    }
  }
  const scene = `id=${mid}`.slice(0, 32)
  const png = await wxService.getUnlimitedQrCode({ scene, page })
  const uploaded = await storageService.uploadBuffer({
    buffer: png,
    mime: 'image/png',
    originalName: `store-${k}-${mid}.png`,
    bizType: 'store_qr',
    skipOptimize: true
  })
  const url = uploaded.fileUrl || uploaded.url || ''
  if (!url) throw new HttpError(502, '门店码上传失败')
  if (k === 'pay') {
    await query('UPDATE merchants SET pay_qrcode_url=:u WHERE id=:id', { u: url, id: mid })
  } else {
    await query('UPDATE merchants SET menu_qrcode_url=:u WHERE id=:id', { u: url, id: mid })
  }
  return {
    kind: k,
    merchantId: mid,
    shopName: m.name,
    page,
    path: pathHint,
    scene,
    qrcodeUrl: url,
    cached: false
  }
}

module.exports = {
  ROLE_LABEL,
  dashboard,
  listOrders,
  completeStallOrder,
  setMerchantOpen,
  getMerchantGoodsOptions,
  saveMerchantGoodsOptions,
  listGoods,
  getGoods,
  saveGoods,
  deleteGoods,
  listCustomers,
  listFlow,
  listSupplyMerchants,
  getCrossStoreDetail,
  getOrCreateStoreQrcode
}

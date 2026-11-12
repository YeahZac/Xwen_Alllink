/**
 * 门店 C 端可见 / SKU 上架就绪判定
 * 标准链路：入驻审核通过 → 二级商户进件 FINISH + 二级商户号 → 平台支付就绪 → 上架 SKU → 首页展示
 *
 * 呈现模式（临时）：可通过 platform_config.home_presentation_relax=1 放宽 C 端列表进件门槛，
 * 正式上线用 POST /admin/ops/presentation/mode {enabled:false, confirm:'REVERT_PRESENTATION'} 一键改回。
 */
const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const wxPayService = require('./wxPayService')

/** 商户侧：已有二级商户号，且进件状态为空（人工回填兼容）或 FINISH */
const MERCHANT_PAY_READY_SQL = `NULLIF(TRIM(IFNULL(m.wx_sub_mch_id,'')), '') IS NOT NULL
       AND IFNULL(NULLIF(TRIM(IFNULL(m.wx_apply_state,'')), ''), 'FINISH') = 'FINISH'`

/** 经营城市仍处于开通状态（关城后不得出现在 C 端列表） */
const CITY_OPEN_SQL = `EXISTS (
         SELECT 1 FROM operating_cities oc
         WHERE oc.name = m.city AND oc.status = 1
       )`

/** 至少有一个上架商品，才进入小程序首页/分类 */
function merchantHasOnSaleGoodsSql(alias = 'm') {
  return `(
    (${alias}.role='stall' AND EXISTS (
      SELECT 1 FROM stall_goods g
      WHERE g.merchant_id=${alias}.id AND IFNULL(g.on_sale,0)=1 AND g.deleted_at IS NULL
    ))
    OR (${alias}.role='cross' AND EXISTS (
      SELECT 1 FROM cross_goods g
      WHERE g.merchant_id=${alias}.id AND IFNULL(g.on_sale,0)=1 AND g.deleted_at IS NULL
    ))
    OR (${alias}.role='supply' AND EXISTS (
      SELECT 1 FROM supply_goods g
      WHERE g.merchant_id=${alias}.id AND IFNULL(g.status,0)=1 AND g.deleted_at IS NULL
    ))
  )`
}

/** 正式规则：进件完成 + 城市开通 + 有上架商品 */
const HOME_VISIBLE_STRICT_SQL = `${MERCHANT_PAY_READY_SQL}
       AND ${CITY_OPEN_SQL}
       AND ${merchantHasOnSaleGoodsSql('m')}`

/**
 * 呈现放宽：不卡二级商户进件；仍要求城市开通。
 * 有上架商品优先，但允许无商品门店也露出（方便演示空店壳）。
 */
const HOME_VISIBLE_RELAXED_SQL = `${CITY_OPEN_SQL}`

/** @deprecated 请改用 getHomeVisibleSql()；默认导出正式规则，避免误用 */
const HOME_VISIBLE_SQL = HOME_VISIBLE_STRICT_SQL

let _relaxCache = { at: 0, enabled: null }

async function isHomePresentationRelaxed() {
  const now = Date.now()
  if (_relaxCache.enabled != null && now - _relaxCache.at < 5000) return _relaxCache.enabled
  try {
    const { isPresentationRelaxEnabled } = require('./presentationCatalogService')
    const enabled = await isPresentationRelaxEnabled()
    _relaxCache = { at: now, enabled }
    return enabled
  } catch (_) {
    return true
  }
}

function clearHomeVisibleCache() {
  _relaxCache = { at: 0, enabled: null }
}

async function getHomeVisibleSql() {
  const relaxed = await isHomePresentationRelaxed()
  return relaxed ? HOME_VISIBLE_RELAXED_SQL : HOME_VISIBLE_STRICT_SQL
}

function evaluateMerchantReady(row = {}) {
  const sub = String(row.wx_sub_mch_id || row.wxSubMchId || '').trim()
  const state = String(row.wx_apply_state || row.wxApplyState || '').trim()
  const applyFinished = !state || state === 'FINISH'
  const merchantFinished = Boolean(sub) && applyFinished
  const platformPayReady = wxPayService.wxPayConfigured()
  return {
    hasSubMchId: Boolean(sub),
    applyState: state,
    applyFinished,
    merchantFinished,
    platformPayReady,
    /** 可上架 SKU（进件完成 + 平台支付配置就绪） */
    catalogReady: merchantFinished && platformPayReady,
    /** 门店具备上首页资格（仍需有上架商品；呈现模式另见 getHomeVisibleSql） */
    homeEligible: merchantFinished
  }
}

async function getMerchantReady(merchantId) {
  const id = Number(merchantId)
  if (!id) throw new HttpError(400, '缺少门店ID')
  let rows
  try {
    rows = await query(
      `SELECT id, role, wx_sub_mch_id, wx_apply_state
       FROM merchants WHERE id=:id AND deleted_at IS NULL`,
      { id }
    )
  } catch (e) {
    if (!/Unknown column.*wx_/i.test(String(e.message || ''))) throw e
    rows = await query(`SELECT id, role FROM merchants WHERE id=:id AND deleted_at IS NULL`, { id })
  }
  if (!rows.length) throw new HttpError(404, '门店不存在')
  return {
    merchantId: Number(rows[0].id),
    role: rows[0].role,
    ...evaluateMerchantReady(rows[0])
  }
}

async function assertCanOnSale(merchantId) {
  const r = await getMerchantReady(merchantId)
  if (!r.hasSubMchId) {
    throw new HttpError(
      400,
      '门店尚未完成二级商户进件（无二级商户号）。请先到「二级商户进件」完成进件并同步为「已完成」后，再上架商品。'
    )
  }
  if (!r.applyFinished) {
    throw new HttpError(
      400,
      `门店进件状态为「${r.applyState}」，需变为「已完成」后才能上架。请到「二级商户进件」同步状态或完成签约。`
    )
  }
  if (!r.platformPayReady) {
    throw new HttpError(400, '平台微信支付配置未就绪，暂不能上架。请先在「二级商户进件」页检查支付配置。')
  }
  return r
}

async function assertGoodsCanOnSale(type, goodsId) {
  const table = type === 'stall' ? 'stall_goods' : type === 'cross' ? 'cross_goods' : 'supply_goods'
  const rows = await query(
    `SELECT merchant_id AS merchantId FROM ${table} WHERE id=:id AND deleted_at IS NULL`,
    { id: Number(goodsId) }
  )
  if (!rows.length) throw new HttpError(404, '商品不存在')
  return assertCanOnSale(rows[0].merchantId)
}

/**
 * 历史：进件完成后自动上架「到店消费」占位 SKU。
 * 现已改为纯人工建品/上架：删除或下架后不得被进件同步重新上架，故固定 no-op。
 */
async function activateStallPlaceholderOnFinish(_merchantId) {
  return { updated: 0 }
}

module.exports = {
  MERCHANT_PAY_READY_SQL,
  CITY_OPEN_SQL,
  HOME_VISIBLE_SQL,
  HOME_VISIBLE_STRICT_SQL,
  HOME_VISIBLE_RELAXED_SQL,
  getHomeVisibleSql,
  clearHomeVisibleCache,
  isHomePresentationRelaxed,
  merchantHasOnSaleGoodsSql,
  evaluateMerchantReady,
  getMerchantReady,
  assertCanOnSale,
  assertGoodsCanOnSale,
  activateStallPlaceholderOnFinish
}

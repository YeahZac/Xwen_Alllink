/**
 * 平台收费（BRD §4.6.3、§9 已确认 #8）
 *
 * ① 软件服务费：入驻后免费体验 trial_months 个月，之后按月/年出账
 * ② 成交服务费：每笔成交在 commission_ledger 已计提，账单侧只做周期汇总展示
 * ③ 等级定制服务费：按 merchant_levels.level_fee 随周期出账
 *
 * 欠费策略由 platform_config.overdue_policy 决定：readonly 只读 / block 禁止新单。
 */
const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { orderNo } = require('../utils/id')
const { getConfig } = require('./configService')

const BILL_TYPE_LABEL = {
  subscription: '软件服务费',
  level: '等级定制服务费',
  transaction: '成交服务费'
}

const STATUS_LABEL = {
  pending: '待缴',
  paid: '已缴',
  waived: '已减免',
  overdue: '已逾期'
}

async function feeEnabled() {
  return String(await getConfig('service_fee_enabled', '1')) === '1'
}

async function overduePolicy() {
  return String(await getConfig('overdue_policy', 'readonly'))
}

/** 商户服务费视图：体验期剩余、待缴金额、是否欠费 */
async function merchantFeeStatus(merchantId) {
  const rows = await query(
    `SELECT m.id, m.name, m.role, m.level_code AS levelCode, m.trial_end_at AS trialEndAt,
            m.service_status AS serviceStatus,
            l.name AS levelName, l.monthly_fee AS monthlyFee, l.yearly_fee AS yearlyFee,
            l.level_fee AS levelFee, l.trial_months AS trialMonths,
            l.commission_discount AS commissionDiscount
     FROM merchants m
     LEFT JOIN merchant_levels l ON l.code = m.level_code
     WHERE m.id = :id`,
    { id: merchantId }
  )
  if (!rows.length) throw new HttpError(404, '商户不存在')
  const m = rows[0]

  const agg = await query(
    `SELECT
       IFNULL(SUM(CASE WHEN status IN ('pending','overdue') THEN amount ELSE 0 END), 0) AS dueAmount,
       SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdueCount,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingCount
     FROM service_fee_bills WHERE merchant_id = :id`,
    { id: merchantId }
  )
  const commission = await query(
    `SELECT IFNULL(SUM(commission), 0) AS total
     FROM commission_ledger WHERE payer_merchant_id = :id`,
    { id: merchantId }
  )

  const trialEnd = m.trialEndAt ? new Date(m.trialEndAt) : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const inTrial = !!(trialEnd && trialEnd >= today)
  const trialDaysLeft = inTrial
    ? Math.ceil((trialEnd - today) / 86400000)
    : 0
  const overdueCount = Number(agg[0].overdueCount) || 0

  return {
    merchantId: Number(m.id),
    merchantName: m.name,
    levelCode: m.levelCode,
    levelName: m.levelName || '普通',
    monthlyFee: Number(m.monthlyFee) || 0,
    yearlyFee: Number(m.yearlyFee) || 0,
    levelFee: Number(m.levelFee) || 0,
    commissionDiscount: Number(m.commissionDiscount) || 1,
    trialEndAt: m.trialEndAt,
    inTrial,
    trialDaysLeft,
    dueAmount: Number(agg[0].dueAmount) || 0,
    pendingCount: Number(agg[0].pendingCount) || 0,
    overdueCount,
    transactionFeeTotal: Number(commission[0].total) || 0,
    serviceStatus: inTrial ? 'trial' : overdueCount > 0 ? 'overdue' : 'active',
    policy: await overduePolicy()
  }
}

/**
 * 出账：为指定商户生成一个周期的订阅费 + 等级费账单。
 * 体验期内不出订阅费。周期口径 monthly / yearly。
 * uk_merchant_period 保证同周期同类型不重复出账。
 */
async function generateBills({ merchantId, cycle, periodStart } = {}) {
  if (!(await feeEnabled())) throw new HttpError(400, '平台服务费账单未启用')
  const cyc = cycle === 'yearly' ? 'yearly' : 'monthly'
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT m.id, m.trial_end_at, l.monthly_fee, l.yearly_fee, l.level_fee
       FROM merchants m
       LEFT JOIN merchant_levels l ON l.code = m.level_code
       WHERE m.id = ? AND m.deleted_at IS NULL`,
      [merchantId]
    )
    if (!rows.length) throw new HttpError(404, '商户不存在')
    const m = rows[0]

    // 起算日：体验期结束次日，或调用方指定
    const [d] = await conn.execute(
      `SELECT
         IFNULL(?, GREATEST(CURDATE(), IFNULL(DATE_ADD(?, INTERVAL 1 DAY), CURDATE()))) AS ps`,
      [periodStart || null, m.trial_end_at]
    )
    const ps = d[0].ps
    const interval = cyc === 'yearly' ? 'INTERVAL 1 YEAR' : 'INTERVAL 1 MONTH'

    const created = []
    const subAmount = cyc === 'yearly' ? Number(m.yearly_fee) || 0 : Number(m.monthly_fee) || 0
    const items = [
      { type: 'subscription', amount: subAmount },
      { type: 'level', amount: Number(m.level_fee) || 0 }
    ]
    for (const it of items) {
      if (it.amount <= 0) continue
      const no = orderNo('SF')
      const [r] = await conn.execute(
        `INSERT INTO service_fee_bills
          (bill_no, merchant_id, bill_type, period_start, period_end, amount, status, due_date, remark)
         VALUES (?, ?, ?, ?, DATE_SUB(DATE_ADD(?, ${interval}), INTERVAL 1 DAY), ?, 'pending',
                 DATE_ADD(?, INTERVAL 7 DAY), ?)
         ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
        [no, merchantId, it.type, ps, ps, it.amount, ps, `${BILL_TYPE_LABEL[it.type]} · ${cyc === 'yearly' ? '年付' : '月付'}`]
      )
      if (r.affectedRows === 1) created.push({ billNo: no, type: it.type, amount: it.amount })
    }
    return { merchantId: Number(merchantId), cycle: cyc, periodStart: ps, created }
  })
}

/** 到期未缴转逾期，并同步 merchants.service_status */
async function refreshOverdue() {
  await query(
    `UPDATE service_fee_bills
     SET status = 'overdue'
     WHERE status = 'pending' AND due_date IS NOT NULL AND due_date < CURDATE()`
  )
  await query(
    `UPDATE merchants m
     SET m.service_status = CASE
       WHEN m.trial_end_at IS NOT NULL AND m.trial_end_at >= CURDATE() THEN 'trial'
       WHEN EXISTS (
         SELECT 1 FROM service_fee_bills b
         WHERE b.merchant_id = m.id AND b.status = 'overdue'
       ) THEN 'overdue'
       ELSE 'active'
     END
     WHERE m.deleted_at IS NULL`
  )
  const rows = await query(
    `SELECT COUNT(*) AS overdueMerchants FROM merchants
     WHERE service_status = 'overdue' AND deleted_at IS NULL`
  )
  return { overdueMerchants: Number(rows[0].overdueMerchants) || 0 }
}

/**
 * 成交阻断：仅当 overdue_policy=block 且商户处于逾费状态时拒绝新单。
 * 同时兜住「未审核/停业商户不得成交」（BRD §4.1 验收口径）。
 */
async function assertCanTransact(merchantId, { action = '成交' } = {}) {
  const rows = await query(
    `SELECT status, service_status AS serviceStatus, name FROM merchants
     WHERE id = :id AND deleted_at IS NULL`,
    { id: merchantId }
  )
  if (!rows.length) throw new HttpError(404, '商户不存在')
  const m = rows[0]
  if (Number(m.status) !== 1) {
    throw new HttpError(400, `「${m.name}」当前不在营业状态，无法${action}`)
  }
  if (m.serviceStatus === 'overdue' && (await overduePolicy()) === 'block') {
    throw new HttpError(400, `「${m.name}」平台服务费逾期，已暂停${action}，请先结清账单`)
  }
  return true
}

function mapBill(r) {
  return {
    id: r.id,
    billNo: r.billNo,
    merchantId: r.merchantId,
    merchantName: r.merchantName || '',
    billType: r.billType,
    billTypeLabel: BILL_TYPE_LABEL[r.billType] || r.billType,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    amount: Number(r.amount) || 0,
    status: r.status,
    statusText: STATUS_LABEL[r.status] || r.status,
    dueDate: r.dueDate,
    paidAt: r.paidAt,
    remark: r.remark
  }
}

async function listBills({ merchantId, status, limit = 100 } = {}) {
  const lim = Math.min(Number(limit) || 100, 300)
  let sql = `SELECT b.id, b.bill_no AS billNo, b.merchant_id AS merchantId, m.name AS merchantName,
                    b.bill_type AS billType, b.period_start AS periodStart, b.period_end AS periodEnd,
                    b.amount, b.status, b.due_date AS dueDate, b.paid_at AS paidAt, b.remark
             FROM service_fee_bills b
             LEFT JOIN merchants m ON m.id = b.merchant_id
             WHERE 1=1`
  const params = {}
  if (merchantId) {
    sql += ' AND b.merchant_id = :mid'
    params.mid = Number(merchantId)
  }
  if (status && ['pending', 'paid', 'waived', 'overdue'].includes(status)) {
    sql += ' AND b.status = :status'
    params.status = status
  }
  sql += ` ORDER BY b.id DESC LIMIT ${lim}`
  const rows = await query(sql, params)
  return rows.map(mapBill)
}

/** 财务操作：标记已缴 / 减免 */
async function reviewBill(id, { status, remark } = {}) {
  if (!['paid', 'waived', 'pending'].includes(status)) throw new HttpError(400, '状态无效')
  await query(
    `UPDATE service_fee_bills
     SET status = :status,
         paid_at = IF(:status = 'paid', NOW(), NULL),
         remark = IFNULL(:remark, remark)
     WHERE id = :id`,
    { id, status, remark: remark || null }
  )
  await refreshOverdue()
  return { id, status }
}

async function listLevels() {
  return query(
    `SELECT id, code, name, monthly_fee AS monthlyFee, yearly_fee AS yearlyFee,
            level_fee AS levelFee, trial_months AS trialMonths,
            commission_discount AS commissionDiscount, sort_order AS sortOrder, remark
     FROM merchant_levels ORDER BY sort_order, id`
  )
}

async function saveLevel(body = {}) {
  const code = String(body.code || '').trim()
  if (!code) throw new HttpError(400, '缺少等级标识')
  await query(
    `INSERT INTO merchant_levels
      (code, name, monthly_fee, yearly_fee, level_fee, trial_months, commission_discount, sort_order, remark)
     VALUES (:code, :name, :monthly, :yearly, :levelFee, :trial, :discount, :sort, :remark)
     ON DUPLICATE KEY UPDATE
       name=VALUES(name), monthly_fee=VALUES(monthly_fee), yearly_fee=VALUES(yearly_fee),
       level_fee=VALUES(level_fee), trial_months=VALUES(trial_months),
       commission_discount=VALUES(commission_discount), sort_order=VALUES(sort_order),
       remark=VALUES(remark)`,
    {
      code,
      name: String(body.name || code).slice(0, 64),
      monthly: Math.max(0, Number(body.monthlyFee) || 0),
      yearly: Math.max(0, Number(body.yearlyFee) || 0),
      levelFee: Math.max(0, Number(body.levelFee) || 0),
      trial: Math.min(12, Math.max(0, Number(body.trialMonths) || 0)),
      discount: Math.min(1, Math.max(0.1, Number(body.commissionDiscount) || 1)),
      sort: Number(body.sortOrder) || 0,
      remark: body.remark || null
    }
  )
  return { code }
}

module.exports = {
  BILL_TYPE_LABEL,
  merchantFeeStatus,
  generateBills,
  refreshOverdue,
  assertCanTransact,
  listBills,
  reviewBill,
  listLevels,
  saveLevel
}

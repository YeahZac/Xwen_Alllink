/**
 * 抽成计费：角色 × 价格区间 × 规则版本（BRD §4.6.2、§9 已确认 #4）
 *
 * - 区间口径：amount_min 含、amount_max 不含；amount_max IS NULL 表示无上限
 * - 版本口径：取 platform_config.commission_rule_version 指定的版本中已生效的规则；
 *   计费时把命中的 rule_version 落到 commission_ledger，历史订单据此可复算
 * - 等级折扣：merchant_levels.commission_discount 叠加在区间费率之上
 */
const { query } = require('../utils/db')
const { getConfig } = require('./configService')

async function currentRuleVersion() {
  return String(await getConfig('commission_rule_version', 'v1')) || 'v1'
}

async function defaultRate() {
  return Number(await getConfig('commission_rate_default', '0.001')) || 0.001
}

/** 命中区间规则；未命中时退回全局默认费率并标记版本为 default */
async function resolveRule({ role, amount }) {
  const gross = Number(amount) || 0
  const version = await currentRuleVersion()
  const rows = await query(
    `SELECT rate, rule_version AS ruleVersion, amount_min AS amountMin, amount_max AS amountMax
     FROM commission_rules
     WHERE role = :role AND status = 1 AND rule_version = :version
       AND effective_from <= NOW()
       AND amount_min <= :gross
       AND (amount_max IS NULL OR :gross < amount_max)
     ORDER BY amount_min DESC
     LIMIT 1`,
    { role, version, gross }
  )
  if (rows.length) {
    return {
      baseRate: Number(rows[0].rate),
      ruleVersion: rows[0].ruleVersion,
      band: {
        min: Number(rows[0].amountMin),
        max: rows[0].amountMax == null ? null : Number(rows[0].amountMax)
      }
    }
  }
  return { baseRate: await defaultRate(), ruleVersion: 'default', band: null }
}

async function levelDiscount(merchantId) {
  if (!merchantId) return 1
  const rows = await query(
    `SELECT IFNULL(l.commission_discount, 1) AS discount
     FROM merchants m
     LEFT JOIN merchant_levels l ON l.code = m.level_code
     WHERE m.id = :id`,
    { id: merchantId }
  )
  const d = rows.length ? Number(rows[0].discount) : 1
  return d > 0 && d <= 1 ? d : 1
}

/**
 * 计算并落一条抽成流水。
 * role 为计费角色；payerMerchantId 为承担抽成的商户（用于取等级折扣）
 */
async function charge(conn, { bizType, bizId, role, payerMerchantId, amountGross }) {
  const gross = Math.round((Number(amountGross) || 0) * 100) / 100
  const { baseRate, ruleVersion, band } = await resolveRule({ role, amount: gross })
  const discount = await levelDiscount(payerMerchantId)
  const rate = Math.round(baseRate * discount * 1000000) / 1000000
  const commission = Math.round(gross * rate * 100) / 100
  await conn.execute(
    `INSERT INTO commission_ledger
      (biz_type, biz_id, payer_merchant_id, amount_gross, rate, commission, rule_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [bizType, bizId, payerMerchantId || null, gross, rate, commission, ruleVersion]
  )
  return { commission, rate, baseRate, discount, ruleVersion, band }
}

/** 退款/拒收冲正：按原单反向记一条负额抽成 */
async function reverse(conn, { bizType, bizId, reason }) {
  const [rows] = await conn.execute(
    `SELECT payer_merchant_id, amount_gross, rate, commission, rule_version
     FROM commission_ledger
     WHERE biz_type=? AND biz_id=? AND commission > 0
     ORDER BY id ASC`,
    [bizType, bizId]
  )
  let reversed = 0
  for (const r of rows) {
    await conn.execute(
      `INSERT INTO commission_ledger
        (biz_type, biz_id, payer_merchant_id, amount_gross, rate, commission, rule_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `${bizType}_reverse`,
        bizId,
        r.payer_merchant_id,
        -Number(r.amount_gross),
        r.rate,
        -Number(r.commission),
        r.rule_version
      ]
    )
    reversed += Number(r.commission)
  }
  return { reversed: Math.round(reversed * 100) / 100, count: rows.length, reason: reason || '' }
}

async function listRules({ role } = {}) {
  let sql = `SELECT id, role, amount_min AS amountMin, amount_max AS amountMax, rate,
                    rule_version AS ruleVersion, effective_from AS effectiveFrom, status, remark
             FROM commission_rules`
  const params = {}
  if (role && ['stall', 'cross', 'supply'].includes(role)) {
    sql += ' WHERE role = :role'
    params.role = role
  }
  sql += ' ORDER BY rule_version DESC, role, amount_min'
  return query(sql, params)
}

async function saveRule(body = {}) {
  const role = body.role
  if (!['stall', 'cross', 'supply'].includes(role)) {
    throw new Error('角色无效')
  }
  const amountMin = Math.max(0, Number(body.amountMin) || 0)
  const amountMax =
    body.amountMax === '' || body.amountMax == null ? null : Number(body.amountMax)
  if (amountMax != null && amountMax <= amountMin) throw new Error('区间上限需大于下限')
  const rate = Number(body.rate)
  if (!(rate >= 0 && rate <= 1)) throw new Error('费率应在 0-1 之间')
  const version = String(body.ruleVersion || 'v1').slice(0, 32)
  const effectiveFrom = body.effectiveFrom || new Date()
  if (body.id) {
    await query(
      `UPDATE commission_rules
       SET role=:role, amount_min=:amountMin, amount_max=:amountMax, rate=:rate,
           rule_version=:version, effective_from=:eff, status=:status, remark=:remark
       WHERE id=:id`,
      {
        id: Number(body.id),
        role,
        amountMin,
        amountMax,
        rate,
        version,
        eff: effectiveFrom,
        status: body.status === 0 ? 0 : 1,
        remark: body.remark || null
      }
    )
    return { id: Number(body.id) }
  }
  const r = await query(
    `INSERT INTO commission_rules
      (role, amount_min, amount_max, rate, rule_version, effective_from, status, remark)
     VALUES (:role, :amountMin, :amountMax, :rate, :version, :eff, :status, :remark)
     ON DUPLICATE KEY UPDATE rate=VALUES(rate), amount_max=VALUES(amount_max),
       effective_from=VALUES(effective_from), status=VALUES(status), remark=VALUES(remark)`,
    {
      role,
      amountMin,
      amountMax,
      rate,
      version,
      eff: effectiveFrom,
      status: body.status === 0 ? 0 : 1,
      remark: body.remark || null
    }
  )
  return { id: Number(r.insertId) || null }
}

module.exports = {
  currentRuleVersion,
  resolveRule,
  levelDiscount,
  charge,
  reverse,
  listRules,
  saveRule
}

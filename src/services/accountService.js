/**
 * 商户资金账户：入账 / 冻结 / 解冻 / 打款扣减
 */
const { HttpError } = require('../utils/response')

async function ensureAccount(conn, merchantId, accountType) {
  await conn.execute(
    `INSERT IGNORE INTO merchant_accounts (merchant_id, account_type, balance, frozen)
     VALUES (?, ?, 0, 0)`,
    [merchantId, accountType]
  )
}

async function getAccount(conn, merchantId, accountType, forUpdate = true) {
  await ensureAccount(conn, merchantId, accountType)
  const sql = forUpdate
    ? `SELECT id, balance, frozen FROM merchant_accounts
       WHERE merchant_id=? AND account_type=? FOR UPDATE`
    : `SELECT id, balance, frozen FROM merchant_accounts
       WHERE merchant_id=? AND account_type=?`
  const [rows] = await conn.execute(sql, [merchantId, accountType])
  return rows[0]
}

async function writeLedger(conn, { merchantId, accountType, changeAmount, balanceAfter, frozenAfter, bizType, bizId, title }) {
  await conn.execute(
    `INSERT INTO merchant_account_ledger
      (merchant_id, account_type, change_amount, balance_after, frozen_after, biz_type, biz_id, title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      merchantId,
      accountType,
      changeAmount,
      balanceAfter,
      frozenAfter,
      bizType,
      bizId || null,
      title
    ]
  )
}

async function creditAccount(conn, { merchantId, accountType, amount, bizType, bizId, title }) {
  const amt = Math.round(Number(amount) * 100) / 100
  if (!amt || amt <= 0) return null
  const acc = await getAccount(conn, merchantId, accountType)
  const next = Math.round((Number(acc.balance) + amt) * 100) / 100
  await conn.execute(
    `UPDATE merchant_accounts SET balance=? WHERE merchant_id=? AND account_type=?`,
    [next, merchantId, accountType]
  )
  await writeLedger(conn, {
    merchantId,
    accountType,
    changeAmount: amt,
    balanceAfter: next,
    frozenAfter: Number(acc.frozen),
    bizType,
    bizId,
    title
  })
  return next
}

/**
 * 冲正扣减（拒收 / 退款 / 缺货回滚）。
 * 已结算的货款可能已被提现，冲正后允许出现负余额并如实记账，
 * 由运营在提现审核环节兜住，不能靠静默不扣来掩盖。
 */
async function debitAccount(conn, { merchantId, accountType, amount, bizType, bizId, title }) {
  const amt = Math.round(Number(amount) * 100) / 100
  if (!amt || amt <= 0) return null
  const acc = await getAccount(conn, merchantId, accountType)
  const next = Math.round((Number(acc.balance) - amt) * 100) / 100
  await conn.execute(
    `UPDATE merchant_accounts SET balance=? WHERE merchant_id=? AND account_type=?`,
    [next, merchantId, accountType]
  )
  await writeLedger(conn, {
    merchantId,
    accountType,
    changeAmount: -amt,
    balanceAfter: next,
    frozenAfter: Number(acc.frozen),
    bizType,
    bizId,
    title
  })
  return next
}

/** 提现申请：可用余额 → 冻结 */
async function freezeForWithdraw(conn, { merchantId, accountType, amount, bizId, title }) {
  const amt = Math.round(Number(amount) * 100) / 100
  if (!amt || amt <= 0) throw new HttpError(400, '提现金额无效')
  const acc = await getAccount(conn, merchantId, accountType)
  if (Number(acc.balance) < amt) throw new HttpError(400, '账户可用余额不足')
  const bal = Math.round((Number(acc.balance) - amt) * 100) / 100
  const frz = Math.round((Number(acc.frozen) + amt) * 100) / 100
  await conn.execute(
    `UPDATE merchant_accounts SET balance=?, frozen=? WHERE merchant_id=? AND account_type=?`,
    [bal, frz, merchantId, accountType]
  )
  await writeLedger(conn, {
    merchantId,
    accountType,
    changeAmount: -amt,
    balanceAfter: bal,
    frozenAfter: frz,
    bizType: 'withdraw_freeze',
    bizId,
    title: title || '提现冻结'
  })
  return { balance: bal, frozen: frz }
}

/** 驳回：冻结退回可用 */
async function unfreezeWithdraw(conn, { merchantId, accountType, amount, bizId, title }) {
  const amt = Math.round(Number(amount) * 100) / 100
  const acc = await getAccount(conn, merchantId, accountType)
  if (Number(acc.frozen) < amt) throw new HttpError(400, '冻结余额不足，无法解冻')
  const bal = Math.round((Number(acc.balance) + amt) * 100) / 100
  const frz = Math.round((Number(acc.frozen) - amt) * 100) / 100
  await conn.execute(
    `UPDATE merchant_accounts SET balance=?, frozen=? WHERE merchant_id=? AND account_type=?`,
    [bal, frz, merchantId, accountType]
  )
  await writeLedger(conn, {
    merchantId,
    accountType,
    changeAmount: amt,
    balanceAfter: bal,
    frozenAfter: frz,
    bizType: 'withdraw_unfreeze',
    bizId,
    title: title || '提现驳回解冻'
  })
  return { balance: bal, frozen: frz }
}

/** 打款完成：扣减冻结 */
async function settleWithdrawPaid(conn, { merchantId, accountType, amount, bizId, title }) {
  const amt = Math.round(Number(amount) * 100) / 100
  const acc = await getAccount(conn, merchantId, accountType)
  if (Number(acc.frozen) < amt) throw new HttpError(400, '冻结余额不足，无法打款核销')
  const frz = Math.round((Number(acc.frozen) - amt) * 100) / 100
  await conn.execute(
    `UPDATE merchant_accounts SET frozen=? WHERE merchant_id=? AND account_type=?`,
    [frz, merchantId, accountType]
  )
  await writeLedger(conn, {
    merchantId,
    accountType,
    changeAmount: 0,
    balanceAfter: Number(acc.balance),
    frozenAfter: frz,
    bizType: 'withdraw_paid',
    bizId,
    title: title || '提现已打款'
  })
  return { balance: Number(acc.balance), frozen: frz }
}

module.exports = {
  ensureAccount,
  getAccount,
  creditAccount,
  debitAccount,
  freezeForWithdraw,
  unfreezeWithdraw,
  settleWithdrawPaid
}

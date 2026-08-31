/**
 * 积分额度核心服务
 * 采购获额 / 后台发放 / 消费划拨 / 消费者扣减
 */
const { pointsToCash, getCashRate, getConfig } = require('./configService')
const { HttpError } = require('../utils/response')

async function ensurePool(conn, merchantId) {
  await conn.execute(
    `INSERT IGNORE INTO merchant_points_pool (merchant_id, balance) VALUES (?, 0)`,
    [merchantId]
  )
}

async function getPoolBalance(conn, merchantId) {
  const [rows] = await conn.execute(
    'SELECT balance FROM merchant_points_pool WHERE merchant_id = ? FOR UPDATE',
    [merchantId]
  )
  return rows.length ? rows[0].balance : 0
}

async function grantPool(conn, { merchantId, points, bizType, bizId, title }) {
  await ensurePool(conn, merchantId)
  await conn.execute(
    'UPDATE merchant_points_pool SET balance = balance + ? WHERE merchant_id = ?',
    [points, merchantId]
  )
  const balance = await getPoolBalance(conn, merchantId)
  await conn.execute(
    `INSERT INTO merchant_pool_ledger
      (merchant_id, change_amount, balance_after, biz_type, biz_id, title)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [merchantId, points, balance, bizType, bizId || null, title]
  )
  return balance
}

/**
 * 从商家额度池划拨给消费者
 * pool_shortage_policy=block 时额度不足抛错；默认 partial 部分划拨
 */
async function allocateToConsumer(conn, { merchantId, userId, wantPoints, shopName, orderNo }) {
  await ensurePool(conn, merchantId)
  const pool = await getPoolBalance(conn, merchantId)
  const want = Number(wantPoints) || 0
  const policy = String(await getConfig('pool_shortage_policy', 'partial'))
  if (policy === 'block' && pool < want) {
    throw new HttpError(400, '商家积分额度不足，暂无法完单划拨')
  }
  const allocated = Math.min(want, pool)
  if (allocated > 0) {
    await conn.execute(
      'UPDATE merchant_points_pool SET balance = balance - ? WHERE merchant_id = ?',
      [allocated, merchantId]
    )
    const poolLeft = pool - allocated
    await conn.execute(
      `INSERT INTO merchant_pool_ledger
        (merchant_id, change_amount, balance_after, biz_type, biz_id, title)
       VALUES (?, ?, ?, 'allocate', ?, ?)`,
      [merchantId, -allocated, poolLeft, orderNo, `划拨给消费者 · ${orderNo}`]
    )

    await conn.execute(
      'UPDATE users SET points_balance = points_balance + ? WHERE id = ?',
      [allocated, userId]
    )
    const [urows] = await conn.execute(
      'SELECT points_balance FROM users WHERE id = ?',
      [userId]
    )
    const rate = await getCashRate()
    await conn.execute(
      `INSERT INTO user_points_ledger
        (user_id, change_amount, balance_after, biz_type, biz_id, title, cash_value)
       VALUES (?, ?, ?, 'grant', ?, ?, ?)`,
      [
        userId,
        allocated,
        urows[0].points_balance,
        orderNo,
        `${shopName || '门店'} · 消费划拨`,
        pointsToCash(allocated, rate)
      ]
    )
  }
  return {
    allocated,
    poolLeft: pool - allocated,
    shortage: allocated < want
  }
}

async function spendConsumerPoints(conn, { userId, points, title, bizId }) {
  const [rows] = await conn.execute(
    'SELECT points_balance FROM users WHERE id = ? FOR UPDATE',
    [userId]
  )
  if (!rows.length) throw new HttpError(404, '用户不存在')
  if (rows[0].points_balance < points) {
    throw new HttpError(400, '积分不足')
  }
  await conn.execute(
    'UPDATE users SET points_balance = points_balance - ? WHERE id = ?',
    [points, userId]
  )
  const left = rows[0].points_balance - points
  const rate = await getCashRate()
  await conn.execute(
    `INSERT INTO user_points_ledger
      (user_id, change_amount, balance_after, biz_type, biz_id, title, cash_value)
     VALUES (?, ?, ?, 'spend', ?, ?, ?)`,
    [userId, -points, left, bizId || null, title, pointsToCash(points, rate)]
  )
  return left
}

module.exports = {
  ensurePool,
  getPoolBalance,
  grantPool,
  allocateToConsumer,
  spendConsumerPoints
}

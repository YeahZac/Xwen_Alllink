const { pool } = require('./db')

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  )
  return rows.length > 0
}

async function addColumn(table, column, ddl) {
  if (await columnExists(table, column)) return false
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`)
  return true
}

async function ensureEnumContains(table, column, value) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  )
  if (!rows.length) return
  const type = String(rows[0].COLUMN_TYPE || '')
  if (type.includes(`'${value}'`)) return
  if (!/^enum\(/i.test(type)) return
  const inner = type.replace(/^enum\(/i, '').replace(/\)$/i, '')
  await pool.query(
    `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${inner}, '${value}') NOT NULL`
  )
}

async function ensureSchema() {
  const jobs = [
    addColumn(
      'consumer_orders',
      'points_spend',
      "`points_spend` INT NOT NULL DEFAULT 0 COMMENT '支付抵扣积分' AFTER `points_allocated`"
    ),
    addColumn(
      'consumer_orders',
      'cash_paid',
      "`cash_paid` DECIMAL(10,2) DEFAULT NULL COMMENT '实付现金' AFTER `points_spend`"
    ),
    addColumn(
      'consumer_orders',
      'pay_channel',
      "`pay_channel` VARCHAR(32) DEFAULT NULL COMMENT 'wxpay/wxpay_sim/points' AFTER `cash_paid`"
    ),
    addColumn(
      'stall_goods',
      'unit',
      "`unit` VARCHAR(16) DEFAULT '份' COMMENT '计价单位' AFTER `category`"
    ),
    addColumn(
      'stall_goods',
      'mix_enabled',
      '`mix_enabled` TINYINT NOT NULL DEFAULT 1 COMMENT \'允许积分抵现\' AFTER `on_sale`'
    ),
    addColumn(
      'cross_goods',
      'category',
      "`category` VARCHAR(32) DEFAULT '服务' COMMENT '分类' AFTER `name`"
    ),
    addColumn(
      'cross_goods',
      'stock',
      '`stock` INT NOT NULL DEFAULT 9999 AFTER `cash_price`'
    ),
    addColumn(
      'cross_goods',
      'allow_mix',
      '`allow_mix` TINYINT NOT NULL DEFAULT 1 COMMENT \'允许积分+微信组合\' AFTER `on_sale`'
    ),
    addColumn(
      'supply_goods',
      'category',
      "`category` VARCHAR(32) DEFAULT '原料' COMMENT '分类' AFTER `name`"
    ),
    addColumn(
      'supply_goods',
      'desc_text',
      '`desc_text` VARCHAR(255) DEFAULT NULL AFTER `points_ratio_text`'
    ),
    addColumn(
      'users',
      'gender',
      "`gender` TINYINT NOT NULL DEFAULT 0 COMMENT '0不展示 1男 2女' AFTER `phone`"
    ),
    addColumn(
      'banners',
      'page_key',
      "`page_key` VARCHAR(32) DEFAULT NULL COMMENT 'C端页面 index/cross/points/mine' AFTER `role_scope`"
    )
  ]
  for (const job of jobs) {
    try {
      await job
    } catch (e) {
      console.warn('[schema]', e.message)
    }
  }
  try {
    await ensureEnumContains('cross_orders', 'pay_mode', 'mix')
  } catch (e) {
    console.warn('[schema] pay_mode mix', e.message)
  }
  try {
    await seedMerchantGeo()
  } catch (e) {
    console.warn('[schema] merchant geo', e.message)
  }
}

/** 缺坐标门店按城市中心散点，保证按用户 GPS 可排序 */
async function seedMerchantGeo() {
  await pool.query(`
    UPDATE merchants m
    JOIN (
      SELECT '九江·瑞昌' AS city, 29.6761 AS lat, 115.681 AS lng
      UNION ALL SELECT '九江·浔阳', 29.7054, 116.0015
      UNION ALL SELECT '九江·柴桑', 29.6712, 115.9918
      UNION ALL SELECT '九江·庐山', 29.4478, 116.0452
    ) c ON c.city = m.city
    SET
      m.latitude = ROUND(
        c.lat + ((MOD(m.id * 17, 21) - 10) * 0.0018)
          + (CASE m.role WHEN 'cross' THEN 0.004 WHEN 'supply' THEN 0.012 ELSE 0 END),
        6
      ),
      m.longitude = ROUND(
        c.lng + ((MOD(m.id * 31, 21) - 10) * 0.0018)
          + (CASE m.role WHEN 'cross' THEN 0.003 WHEN 'supply' THEN 0.01 ELSE 0 END),
        6
      )
    WHERE m.deleted_at IS NULL
      AND (m.latitude IS NULL OR m.longitude IS NULL)
  `)
}

module.exports = { ensureSchema }

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
    ),
    addColumn(
      'merchants',
      'biz_type',
      "`biz_type` VARCHAR(32) DEFAULT NULL COMMENT '餐饮/鲜花/蛋糕/百货商店' AFTER `role`"
    ),
    addColumn(
      'merchants',
      'cover_url',
      "`cover_url` VARCHAR(1024) DEFAULT NULL COMMENT '门店封面图' AFTER `cover_hue`"
    ),
    addColumn(
      'merchants',
      'materials_json',
      "`materials_json` JSON DEFAULT NULL COMMENT '门店资料文件' AFTER `cover_url`"
    ),
    addColumn(
      'merchants',
      'deleted_at',
      "`deleted_at` DATETIME DEFAULT NULL COMMENT '软删除' AFTER `status`"
    ),
    addColumn(
      'users',
      'deleted_at',
      "`deleted_at` DATETIME DEFAULT NULL COMMENT '软删除' AFTER `status`"
    ),
    addColumn(
      'complaints',
      'handle_remark',
      "`handle_remark` VARCHAR(512) DEFAULT NULL COMMENT '处理备注' AFTER `status`"
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
    await seedShenzhenMalls()
  } catch (e) {
    console.warn('[schema] shenzhen malls', e.message)
  }
  try {
    await runSqlStatements('20_goods_categories.sql', 'goods categories')
  } catch (e) {
    console.warn('[schema] goods categories', e.message)
  }
  try {
    await runSqlStatements('21_admin_rbac_expand.sql', 'admin rbac expand')
  } catch (e) {
    console.warn('[schema] admin rbac expand', e.message)
  }
  try {
    await runSqlStatements('22_apply_applicant_user.sql', 'apply applicant user')
  } catch (e) {
    console.warn('[schema] apply applicant user', e.message)
  }
  try {
    await runSqlStatements('23_retail_biz_types.sql', 'retail biz types')
  } catch (e) {
    console.warn('[schema] retail biz types', e.message)
  }
  try {
    await runSqlStatements('24_backfill_merchant_cover.sql', 'merchant cover backfill')
  } catch (e) {
    console.warn('[schema] merchant cover backfill', e.message)
  }
  try {
    await runSqlStatements('25_admin_rbac_harden.sql', 'admin rbac harden')
  } catch (e) {
    console.warn('[schema] admin rbac harden', e.message)
  }
  try {
    await runSqlStatements('26_user_identities.sql', 'user identities')
  } catch (e) {
    console.warn('[schema] user identities', e.message)
  }
  try {
    await runSqlStatements('27_partner_founder_ops.sql', 'partner founder ops')
  } catch (e) {
    console.warn('[schema] partner founder ops', e.message)
  }
  try {
    await runSqlStatements('28_ops_roles_and_platform_applies.sql', 'ops roles platform applies')
  } catch (e) {
    console.warn('[schema] ops roles platform applies', e.message)
  }
  try {
    await runSqlStatements('29_cdn_media_backfill.sql', 'cdn media backfill')
  } catch (e) {
    console.warn('[schema] cdn media backfill', e.message)
  }
  try {
    await runSqlStatements('31_apply_review_logs.sql', 'apply review logs')
  } catch (e) {
    console.warn('[schema] apply review logs', e.message)
  }
  try {
    await pool.query(
      "ALTER TABLE `banners` MODIFY COLUMN `role_scope` VARCHAR(32) NOT NULL COMMENT '端 consumer/stall/cross/supply/partner/founder/login'"
    )
  } catch (e) {
    console.warn('[schema] banners role_scope', e.message)
  }
  try {
    await pool.query(
      "ALTER TABLE `banners` MODIFY COLUMN `link_type` VARCHAR(32) NOT NULL DEFAULT 'page' COMMENT 'image_detail|page|miniprogram|url|none'"
    )
  } catch (e) {
    console.warn('[schema] banners link_type', e.message)
  }
  try {
    await addColumn(
      'banners',
      'link_appid',
      "`link_appid` VARCHAR(64) DEFAULT NULL COMMENT '其他小程序 AppID' AFTER `link_url`"
    )
    await addColumn(
      'banners',
      'link_image_url',
      "`link_image_url` VARCHAR(1024) DEFAULT NULL COMMENT '图片详情' AFTER `link_appid`"
    )
    await addColumn(
      'banners',
      'remark',
      "`remark` VARCHAR(255) DEFAULT NULL COMMENT '备注' AFTER `link_image_url`"
    )
    await pool.query(
      `UPDATE banners SET link_type='page' WHERE link_type IN ('navigate','switchTab')`
    )
    await pool.query(
      `UPDATE banners SET remark=sub_title
       WHERE (remark IS NULL OR remark='') AND sub_title IS NOT NULL AND sub_title<>''`
    )
  } catch (e) {
    console.warn('[schema] banner link fields', e.message)
  }
  try {
    await runSqlStatements('32_banner_fields.sql', 'banner fields')
  } catch (e) {
    console.warn('[schema] banner fields sql', e.message)
  }
  try {
    await runSqlStatements('33_ensure_open_ops_content.sql', 'ensure open ops content')
  } catch (e) {
    console.warn('[schema] ensure open ops content', e.message)
  }
  try {
    await runSqlStatements('44_goods_categories_trim_image.sql', 'goods categories trim+image')
  } catch (e) {
    console.warn('[schema] goods categories trim', e.message)
  }
  try {
    await runSqlStatements('45_purge_seed_categories.sql', 'purge seed goods categories')
  } catch (e) {
    console.warn('[schema] purge seed categories', e.message)
  }
  try {
    const added = await addColumn(
      'stall_goods',
      'points_usable',
      "`points_usable` INT NOT NULL DEFAULT 0 COMMENT '单件可用积分（抵现上限）' AFTER `mix_enabled`"
    )
    if (added) {
      await pool.query(
        `UPDATE stall_goods
         SET points_usable = GREATEST(0, FLOOR(price / 0.01) - 1)
         WHERE IFNULL(mix_enabled, 1) = 1
           AND IFNULL(points_usable, 0) = 0
           AND price >= 0.01
           AND deleted_at IS NULL`
      )
    }
  } catch (e) {
    console.warn('[schema] stall_goods.points_usable', e.message)
  }
  try {
    await runSqlStatements('50_banner_placements.sql', 'banner placements')
  } catch (e) {
    console.warn('[schema] banner placements', e.message)
  }
  try {
    await addColumn(
      'admin_accounts',
      'user_id',
      "`user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 users.id' AFTER `role_id`"
    )
    await addColumn(
      'admin_accounts',
      'openid',
      "`openid` VARCHAR(64) DEFAULT NULL COMMENT '关联微信 openid' AFTER `user_id`"
    )
  } catch (e) {
    console.warn('[schema] admin accounts user link', e.message)
  }
  try {
    const rbacService = require('../services/rbacService')
    await rbacService.ensureRbacBootstrap()
  } catch (e) {
    console.warn('[schema] rbac bootstrap', e.message)
  }
  try {
    await runSqlStatements('51_purge_test_placeholder_goods.sql', 'purge test/placeholder goods')
  } catch (e) {
    console.warn('[schema] purge test goods', e.message)
  }
  // 禁止在 ensureSchema / 服务启动时自动改写 Banner/门店/商品图或复活软删商品：
  // - 旧 29_cdn_media_backfill 曾用「非 mp-static 一律替换」冲掉运营上传 Banner
  // - 旧 33_ensure_open_ops_content 曾复活测试 SKU / 种子门店
  // 需要时请走运营台显式接口 POST /admin/sys/sync-mp-media（仅空图/占位图）。
}

/** 开通深圳，并把门店迁到真实商场坐标 */
async function seedShenzhenMalls() {
  await runSqlStatements('19_shenzhen_mall_geo.sql', 'shenzhen malls')
}

async function runSqlStatements(relative, label) {
  const fs = require('fs')
  const path = require('path')
  const file = path.join(__dirname, '../../sql', relative)
  if (!fs.existsSync(file)) return
  const sql = fs.readFileSync(file, 'utf8')
  const parts = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter((s) => s && !s.startsWith('--'))
  for (const stmt of parts) {
    try {
      await pool.query(stmt)
    } catch (e) {
      console.warn(`[schema] ${label} stmt`, e.message)
    }
  }
}

module.exports = { ensureSchema }

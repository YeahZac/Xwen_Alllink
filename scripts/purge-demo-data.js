/**
 * 清除演示/自动生成业务数据，保留基础配置与后台账号权限。
 *
 * 保留：
 *   platform_config / commission_rules / referral_triggers /
 *   operating_cities / merchant_levels / goods_categories /
 *   admin_roles / admin_permissions / admin_role_permissions / admin_accounts
 *
 * 清除：门店、商品/SKU/规格、订单、用户、流水、入驻单、媒体、Banner、访问日志等
 *
 * 用法：
 *   node scripts/purge-demo-data.js --dry-run
 *   node scripts/purge-demo-data.js --yes
 */
const path = require('path')
const mysql = require('mysql2/promise')
require('dotenv').config({ path: path.join(__dirname, '../.env') })

const KEEP = new Set([
  'platform_config',
  'commission_rules',
  'referral_triggers',
  'operating_cities',
  'merchant_levels',
  'goods_categories',
  'admin_roles',
  'admin_permissions',
  'admin_role_permissions',
  'admin_accounts'
])

/** 优先清空顺序（子表在前）；其余表随后扫到也会清 */
const PURGE_ORDER = [
  'stall_goods_options',
  'stall_goods_option_groups',
  'consumer_order_items',
  'consumer_orders',
  'cross_orders',
  'purchase_order_items',
  'purchase_orders',
  'partner_purchase_orders',
  'partner_withdraw_requests',
  'partner_applications',
  'platform_role_applications',
  'apply_review_logs',
  'merchant_applications',
  'stall_goods',
  'cross_goods',
  'supply_goods',
  'merchant_pool_ledger',
  'merchant_points_pool',
  'merchant_account_ledger',
  'merchant_accounts',
  'commission_ledger',
  'withdraw_requests',
  'service_fee_bills',
  'user_points_ledger',
  'referral_records',
  'complaints',
  'supply_needs',
  'wx_profit_share_orders',
  'wx_sub_applyments',
  'auth_sessions',
  'visit_logs',
  'operation_logs',
  'banners',
  'media_assets',
  'merchants',
  'users'
]

function dbConf() {
  const addr = process.env.MYSQL_ADDRESS || ''
  let host = process.env.DB_HOST || '127.0.0.1'
  let port = Number(process.env.DB_PORT || 3306)
  if (addr.includes(':')) {
    const [h, p] = addr.split(':')
    host = h
    port = Number(p) || 3306
  } else if (addr) {
    host = addr
  }
  return {
    host,
    port,
    user: process.env.DB_USER || process.env.MYSQL_USERNAME || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'wanyehulian',
    multipleStatements: true,
    connectTimeout: 20000
  }
}

async function tableNames(conn) {
  const [rows] = await conn.query('SHOW TABLES')
  if (!rows.length) return []
  const key = Object.keys(rows[0])[0]
  return rows.map((r) => r[key])
}

async function countOf(conn, table) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS c FROM \`${table}\``)
  return Number(rows[0].c) || 0
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const yes = process.argv.includes('--yes')
  if (!dryRun && !yes) {
    console.error('请显式传入 --dry-run 或 --yes')
    process.exit(1)
  }

  const conf = dbConf()
  console.log(
    `[purge] host=${conf.host} db=${conf.database} mode=${dryRun ? 'dry-run' : 'EXECUTE'}`
  )
  const conn = await mysql.createConnection(conf)
  const errors = []
  const report = []

  try {
    const existing = await tableNames(conn)
    const existingSet = new Set(existing)

    const beforeKeep = {}
    for (const t of KEEP) {
      if (!existingSet.has(t)) continue
      beforeKeep[t] = await countOf(conn, t)
    }

    const purgeList = []
    for (const t of PURGE_ORDER) {
      if (existingSet.has(t) && !KEEP.has(t)) purgeList.push(t)
    }
    for (const t of existing) {
      if (KEEP.has(t)) continue
      if (!purgeList.includes(t)) purgeList.push(t)
    }

    for (const t of purgeList) {
      const before = await countOf(conn, t).catch((e) => {
        errors.push({ table: t, phase: 'count', message: e.message })
        return null
      })
      if (before == null) continue
      if (dryRun) {
        report.push({ table: t, before, after: before, action: 'would_purge' })
        continue
      }
      try {
        await conn.query('SET FOREIGN_KEY_CHECKS=0')
        await conn.query(`TRUNCATE TABLE \`${t}\``)
        await conn.query('SET FOREIGN_KEY_CHECKS=1')
        const after = await countOf(conn, t)
        report.push({ table: t, before, after, action: 'truncated' })
      } catch (e) {
        try {
          await conn.query(`DELETE FROM \`${t}\``)
          try {
            await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT=1`)
          } catch (_) {
            /* ignore AI reset */
          }
          const after = await countOf(conn, t)
          report.push({ table: t, before, after, action: 'delete_fallback' })
        } catch (e2) {
          errors.push({ table: t, phase: 'purge', message: e2.message || e.message })
          report.push({ table: t, before, after: before, action: 'failed' })
        } finally {
          try {
            await conn.query('SET FOREIGN_KEY_CHECKS=1')
          } catch (_) {
            /* ignore */
          }
        }
      }
    }

    console.log('\n--- purged ---')
    for (const r of report) {
      console.log(
        `${String(r.before).padStart(6)} → ${String(r.after).padStart(6)}  ${r.action.padEnd(16)} ${r.table}`
      )
    }

    console.log('\n--- kept ---')
    for (const t of [...KEEP].sort()) {
      if (!existingSet.has(t)) {
        console.log(`  (missing) ${t}`)
        continue
      }
      const after = await countOf(conn, t)
      console.log(
        `${String(beforeKeep[t] ?? '?').padStart(6)} → ${String(after).padStart(6)}  keep             ${t}`
      )
    }

    if (errors.length) {
      console.log('\n--- errors (non-fatal) ---')
      for (const e of errors) console.log(`  ${e.table} [${e.phase}] ${e.message}`)
    }

    if (!dryRun) {
      const [stalls] = await conn.query(
        "SELECT COUNT(*) c FROM merchants WHERE deleted_at IS NULL"
      ).catch(() => [{ c: 0 }])
      const [goods] = await conn.query('SELECT COUNT(*) c FROM stall_goods').catch(() => [{ c: 0 }])
      const [media] = await conn.query('SELECT COUNT(*) c FROM media_assets').catch(() => [{ c: 0 }])
      const [users] = await conn.query('SELECT COUNT(*) c FROM users').catch(() => [{ c: 0 }])
      console.log('\n[purge] summary check', {
        merchants: Number(stalls[0]?.c || stalls.c || 0),
        stall_goods: Number(goods[0]?.c || goods.c || 0),
        media_assets: Number(media[0]?.c || media.c || 0),
        users: Number(users[0]?.c || users.c || 0),
        platform_config: beforeKeep.platform_config,
        admin_accounts: beforeKeep.admin_accounts
      })
    }

    console.log(dryRun ? '\n[purge] dry-run done (no writes)' : '\n[purge] done')
    if (errors.length) process.exitCode = 2
  } finally {
    await conn.end()
  }
}

main().catch((e) => {
  console.error('[purge] fatal:', e.message || e)
  process.exit(1)
})

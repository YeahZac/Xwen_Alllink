/**
 * 执行单个（或多个）SQL 补丁。需本机可达的 MySQL（本地或已开公网的云库）。
 *
 * 用法：
 *   node scripts/run-sql.js 08_stall_options.sql
 *   node scripts/run-sql.js 08_stall_options.sql 03_patch.sql
 *
 * 凭证：backend/.env 中的 DB_* 或 MYSQL_*（与云托管一致亦可）
 */
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')
require('dotenv').config({ path: path.join(__dirname, '../.env') })

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
    connectTimeout: 15000
  }
}

async function run() {
  const files = process.argv.slice(2)
  if (!files.length) {
    console.error('用法: node scripts/run-sql.js <sql文件名...>')
    process.exit(1)
  }
  const conf = dbConf()
  console.log(
    `[run-sql] connecting host=${conf.host} port=${conf.port} db=${conf.database} user=${conf.user}`
  )
  const conn = await mysql.createConnection(conf)
  try {
    for (const file of files) {
      const full = path.isAbsolute(file)
        ? file
        : path.join(__dirname, '../sql', file)
      if (!fs.existsSync(full)) throw new Error(`文件不存在: ${full}`)
      const sql = fs.readFileSync(full, 'utf8')
      console.log('Executing', path.basename(full), '...')
      await conn.query(sql)
      console.log('OK', path.basename(full))
    }
    console.log('All patches done.')
  } finally {
    await conn.end()
  }
}

run().catch((e) => {
  console.error('[run-sql] failed:', e.message || e)
  process.exit(1)
})

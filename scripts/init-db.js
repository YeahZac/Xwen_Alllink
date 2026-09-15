/**
 * 简易初始化：读取 sql 文件并执行（需本机/云 MySQL 可达）
 * 用法：DB_* 环境变量就绪后 npm run db:init
 */
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')
require('dotenv').config()

async function run() {
  const conf = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  }
  const conn = await mysql.createConnection(conf)
  for (const file of [
    '01_schema.sql',
    '03_patch.sql',
    '02_seed.sql',
    '04_admin_rbac.sql',
    '05_media.sql',
    '06_ops_extend.sql',
    '07_admin_product.sql',
    '08_stall_options.sql',
    '09_admin_password.sql'
  ]) {
    const sql = fs.readFileSync(path.join(__dirname, '../sql', file), 'utf8')
    console.log('Executing', file, '...')
    await conn.query(sql)
  }
  await conn.end()
  console.log('DB init done.')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

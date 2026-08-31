require('dotenv').config({ override: false })

/** 微信云托管模板变量 MYSQL_ADDRESS 形如 host:port */
function parseMysqlAddress(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const idx = s.lastIndexOf(':')
  if (idx > 0 && /^\d+$/.test(s.slice(idx + 1))) {
    return { host: s.slice(0, idx), port: Number(s.slice(idx + 1)) }
  }
  return { host: s, port: Number(process.env.DB_PORT || 3306) }
}

function isLoopback(host) {
  return !host || host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

const fromCloud = parseMysqlAddress(process.env.MYSQL_ADDRESS)
const envHost = process.env.DB_HOST
// 云托管里若误填 DB_HOST=127.0.0.1，优先改用 MYSQL_ADDRESS
const host =
  fromCloud && isLoopback(envHost)
    ? fromCloud.host
    : envHost || (fromCloud && fromCloud.host) || '127.0.0.1'
const port = Number(
  process.env.DB_PORT || (fromCloud && fromCloud.port) || 3306
)

const db = {
  host,
  port,
  user: process.env.DB_USER || process.env.MYSQL_USERNAME || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'wanyehulian',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  connectTimeout: 15000
}

if (require.main === module || process.env.LOG_DB_TARGET === '1') {
  console.log(
    `[db-config] host=${db.host} port=${db.port} database=${db.database} user=${db.user} hasPassword=${Boolean(db.password)} mysqlAddress=${process.env.MYSQL_ADDRESS || ''}`
  )
}

module.exports = {
  port: Number(process.env.PORT || 80),
  env: process.env.NODE_ENV || 'production',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  db,
  wx: {
    appId: process.env.WX_APPID || '',
    appSecret: process.env.WX_APP_SECRET || '',
    cloudEnv: process.env.WX_CLOUD_ENV || process.env.CBR_ENV_ID || 'prod-d3g1vkrj3290d085e'
  },
  cos: {
    bucket:
      process.env.COS_BUCKET ||
      process.env.WX_COS_BUCKET ||
      '7072-prod-d3g1vkrj3290d085e-1467541248',
    region: process.env.COS_REGION || process.env.WX_COS_REGION || 'ap-shanghai',
    secretId: process.env.COS_SECRET_ID || '',
    secretKey: process.env.COS_SECRET_KEY || '',
    // local = 开发落盘；cloud = 云托管 COS（默认）
    mode: process.env.COS_MODE || (process.env.NODE_ENV === 'development' ? 'local' : 'cloud')
  }
}

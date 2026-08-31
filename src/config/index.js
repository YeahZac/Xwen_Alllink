require('dotenv').config()

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

const fromCloud = parseMysqlAddress(process.env.MYSQL_ADDRESS)

module.exports = {
  port: Number(process.env.PORT || 80),
  env: process.env.NODE_ENV || 'production',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  db: {
    // 优先 DB_*；其次云托管 MYSQL_*；最后本机默认（仅本地开发）
    host: process.env.DB_HOST || (fromCloud && fromCloud.host) || '127.0.0.1',
    port: Number(process.env.DB_PORT || (fromCloud && fromCloud.port) || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USERNAME || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'wanyehulian',
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    connectTimeout: 10000
  },
  wx: {
    appId: process.env.WX_APPID || '',
    appSecret: process.env.WX_APP_SECRET || ''
  }
}

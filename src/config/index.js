require('dotenv').config()

module.exports = {
  port: Number(process.env.PORT || 80),
  env: process.env.NODE_ENV || 'production',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wanyehulian',
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true
  },
  wx: {
    appId: process.env.WX_APPID || '',
    appSecret: process.env.WX_APP_SECRET || ''
  }
}

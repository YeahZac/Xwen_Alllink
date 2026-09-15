const path = require('path')
const express = require('express')
const cors = require('cors')
const config = require('./config')
const routes = require('./routes')
const { notFound, errorHandler } = require('./middleware/error')

const app = express()

app.use(cors())
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

app.get('/', (_req, res) => {
  res.json({
    name: '万业互联云 API',
    version: '1.0.0',
    health: '/api/health',
    admin: '/admin/',
    docs: '运营后台请打开 /admin/ ，账号 admin / 密码 123456'
  })
})

app.use('/admin', express.static(path.join(__dirname, '../public/admin'), { index: 'index.html' }))
app.get('/admin', (_req, res) => {
  res.redirect(302, '/admin/')
})
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')))

app.use('/api', routes)
app.use(notFound)
app.use(errorHandler)

if (require.main === module) {
  const db = config.db
  console.log(
    `[xwen-alllink-api] db target: ${db.host}:${db.port}/${db.database} user=${db.user}`
  )
  if (db.host === '127.0.0.1' || db.host === 'localhost') {
    console.warn(
      '[xwen-alllink-api] WARNING: DB host is localhost. On WeChat Cloud Hosting set MYSQL_ADDRESS / MYSQL_USERNAME / MYSQL_PASSWORD (or DB_HOST) in service env, then republish.'
    )
  }
  app.listen(config.port, () => {
    console.log(`[xwen-alllink-api] listening on :${config.port}`)
    console.log(`[xwen-alllink-api] admin UI: http://127.0.0.1:${config.port}/admin/`)
  })
}

module.exports = app

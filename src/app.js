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
    docs: '运营后台请打开 /admin/ ，使用邀请码 A001 登录'
  })
})

app.use('/admin', express.static(path.join(__dirname, '../public/admin'), { index: 'index.html' }))
app.get('/admin', (_req, res) => {
  res.redirect(302, '/admin/')
})

app.use('/api', routes)
app.use(notFound)
app.use(errorHandler)

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[xwen-alllink-api] listening on :${config.port}`)
    console.log(`[xwen-alllink-api] admin UI: http://127.0.0.1:${config.port}/admin/`)
  })
}

module.exports = app

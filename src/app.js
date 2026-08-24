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
    health: '/api/health'
  })
})

app.use('/api', routes)
app.use(notFound)
app.use(errorHandler)

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[xwen-alllink-api] listening on :${config.port}`)
  })
}

module.exports = app

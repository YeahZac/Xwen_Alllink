const path = require('path')
const express = require('express')
const cors = require('cors')
const config = require('./config')
const routes = require('./routes')
const { notFound, errorHandler } = require('./middleware/error')
const { ensureSchema } = require('./utils/migrate')

const app = express()
const adminDir = path.join(__dirname, '../public/admin')
const adminStatic = express.static(adminDir, {
  index: 'index.html',
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    // 运营台 JS/CSS/HTML 禁止长缓存，避免线上仍见「打开/关闭」双按钮旧版
    if (/\.(html?|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
    }
  }
})

// 云托管 / 自定义域名经反向代理终止 TLS
app.set('trust proxy', true)

app.use(cors())
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

function requestHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .split(':')[0]
}

/** 运营台域名：admin 子域，或已绑定的 apex（如 wanye.cloud） */
function isAdminHost(req) {
  const host = requestHost(req)
  if (!host) return false
  if (config.adminHost && host === config.adminHost) return true
  if (host.startsWith('admin.')) return true
  // 云托管若只绑了 apex（截图常见 wanye.cloud），根路径也出运营台，避免只开 /admin 才可用
  const apex = String(config.adminHost || '')
    .replace(/^admin\./i, '')
    .toLowerCase()
  if (apex && (host === apex || host === `www.${apex}`)) return true
  return false
}

function publicOrigin(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim()
  const host = requestHost(req)
  if (!host) return ''
  return `${proto}://${host}`
}

app.get('/', (req, res, next) => {
  // 运营台域名：根路径直接出 index.html
  if (isAdminHost(req)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    return res.sendFile(path.join(adminDir, 'index.html'))
  }
  const accept = String(req.headers.accept || '')
  if (accept.includes('text/html')) {
    return res.redirect(302, '/admin/')
  }
  const origin = publicOrigin(req)
  res.json({
    name: '万业互联云 API',
    version: '1.0.0',
    health: '/api/health',
    admin: '/admin/',
    adminHost: config.adminHost || null,
    publicBaseUrl: origin || null,
    adminUrl: config.adminHost ? `https://${config.adminHost}/` : origin ? `${origin}/admin/` : '/admin/',
    legal: '/legal/',
    docs: '运营后台请使用 https://admin.wanye.cloud/ ，账号 admin / 密码 123456'
  })
})

// 运营台域名：静态资源挂在根路径（/styles.css、/app.js 等）
app.use((req, res, next) => {
  if (!isAdminHost(req)) return next()
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/uploads') ||
    req.path.startsWith('/banners') ||
    req.path.startsWith('/legal') ||
    req.path.startsWith('/admin')
  ) {
    return next()
  }
  return adminStatic(req, res, next)
})

// 兼容旧路径 /admin/
app.use('/admin', adminStatic)
app.get('/admin', (req, res) => {
  if (isAdminHost(req)) return res.redirect(302, '/')
  return res.redirect(302, '/admin/')
})

app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')))
app.use('/banners', express.static(path.join(__dirname, '../public/banners')))
/** 小程序云端静态资源备份（COS 为主；此处便于自建域名回源） */
app.use('/static/mp', express.static(path.join(__dirname, '../public/static/mp')))
/** 平台协议 PDF（审核 / 用户查看） */
app.use(
  '/legal',
  express.static(path.join(__dirname, '../public/legal'), {
    index: 'index.html',
    setHeaders(res, filePath) {
      if (String(filePath).toLowerCase().endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', 'inline')
      }
    }
  })
)

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
    const adminUrl = config.adminHost
      ? `https://${config.adminHost}/`
      : `${config.publicBaseUrl || `http://127.0.0.1:${config.port}`}/admin/`
    console.log(`[xwen-alllink-api] admin UI: ${adminUrl}`)
    ensureSchema().catch((e) => console.warn('[schema]', e.message))
  })
}

module.exports = app

/**
 * 微信云托管对象存储 + 图片智能压缩（目标 ≤ 3MB，优先保清晰度）
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const http = require('http')
const https = require('https')
const { URL } = require('url')
const COS = require('cos-nodejs-sdk-v5')
const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const config = require('../config')

const MAX_BYTES = 3 * 1024 * 1024
const MAX_EDGE = 2560

let sharp
try {
  sharp = require('sharp')
} catch (e) {
  console.warn('[storage] sharp unavailable, uploads will skip image compress:', e.message)
}

function requestJson(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const data = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          ...(data
            ? { 'Content-Type': 'application/json', 'Content-Length': data.length }
            : {}),
          ...headers
        },
        timeout: 15000
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve({ status: res.statusCode, data: JSON.parse(text), raw: text })
          } catch {
            resolve({ status: res.statusCode, data: null, raw: text })
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('request timeout'))
    })
    if (data) req.write(data)
    req.end()
  })
}

async function getCosTempAuth() {
  // 云托管容器内开放接口（无需 token）
  try {
    const r = await requestJson('http://api.weixin.qq.com/_/cos/getauth')
    const d = r.data || {}
    if (d.TmpSecretId || d.secretId || d.credentials) {
      const cred = d.credentials || d
      return {
        TmpSecretId: cred.TmpSecretId || cred.secretId || d.TmpSecretId,
        TmpSecretKey: cred.TmpSecretKey || cred.secretKey || d.TmpSecretKey,
        SecurityToken: cred.Token || cred.sessionToken || d.Token || d.SecurityToken,
        ExpiredTime: d.ExpiredTime || d.expiredTime || Math.floor(Date.now() / 1000) + 1800
      }
    }
  } catch (e) {
    console.warn('[storage] getauth failed:', e.message)
  }
  return null
}

function createCosClient() {
  const { bucket, region, secretId, secretKey } = config.cos
  if (secretId && secretKey) {
    return new COS({ SecretId: secretId, SecretKey: secretKey })
  }
  return new COS({
    getAuthorization: async (_options, callback) => {
      const auth = await getCosTempAuth()
      if (!auth || !auth.TmpSecretId) {
        callback(new Error('无法获取云托管 COS 临时密钥，请确认服务部署在微信云托管且开通对象存储'))
        return
      }
      callback({
        TmpSecretId: auth.TmpSecretId,
        TmpSecretKey: auth.TmpSecretKey,
        SecurityToken: auth.SecurityToken,
        ExpiredTime: auth.ExpiredTime
      })
    }
  })
}

async function encodeMetaFileId(cloudPath) {
  try {
    const r = await requestJson('http://api.weixin.qq.com/_/cos/metaid/encode', {
      method: 'POST',
      body: {
        openid: '',
        bucket: config.cos.bucket,
        paths: [cloudPath]
      }
    })
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
    if (d && d.errcode && d.errcode !== 0) return null
    return (d && (d.x_cos_meta_field_strs || d.list || d.data)) || null
  } catch (e) {
    console.warn('[storage] metaid encode failed:', e.message)
    return null
  }
}

/**
 * 智能压缩：先高画质编码，仅在超 3MB 时逐步降质/轻缩放，避免无谓糊化
 */
async function optimizeImageBuffer(input, originalMime = '') {
  if (!sharp) {
    if (input.length > MAX_BYTES) {
      throw new HttpError(400, '图片超过 3MB 且服务器未启用压缩组件，请先压缩后上传')
    }
    return {
      buffer: input,
      mime: originalMime || 'application/octet-stream',
      ext: guessExt(originalMime, 'bin'),
      width: null,
      height: null
    }
  }

  const img = sharp(input, { failOn: 'none' }).rotate()
  const meta = await img.metadata()
  let width = meta.width || 0
  let height = meta.height || 0
  let pipeline = sharp(input, { failOn: 'none' }).rotate()

  const maxSide = Math.max(width, height)
  if (maxSide > MAX_EDGE) {
    pipeline = pipeline.resize({
      width: width >= height ? MAX_EDGE : null,
      height: height > width ? MAX_EDGE : null,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3
    })
  }

  // 小程序/Web 均支持 webp，同等清晰度体积更小
  const tryEncode = async (quality, edge) => {
    let p = sharp(input, { failOn: 'none' }).rotate()
    if (edge && Math.max(width, height) > edge) {
      p = p.resize({
        width: width >= height ? edge : null,
        height: height > width ? edge : null,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3
      })
    } else if (maxSide > MAX_EDGE) {
      p = p.resize({
        width: width >= height ? MAX_EDGE : null,
        height: height > width ? MAX_EDGE : null,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3
      })
    }
    const buffer = await p
      .webp({ quality, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true })
    return buffer
  }

  // 质量从高到低；仍超限再缩小边长
  const qualities = [86, 80, 74, 68, 62]
  const edges = [null, 2200, 1920, 1600]
  let best = null
  for (const edge of edges) {
    for (const q of qualities) {
      const out = await tryEncode(q, edge)
      best = out
      if (out.data.length <= MAX_BYTES) {
        return {
          buffer: out.data,
          mime: 'image/webp',
          ext: 'webp',
          width: out.info.width,
          height: out.info.height,
          quality: q,
          edge: edge || MAX_EDGE
        }
      }
    }
  }

  if (best && best.data.length <= MAX_BYTES) {
    return {
      buffer: best.data,
      mime: 'image/webp',
      ext: 'webp',
      width: best.info.width,
      height: best.info.height
    }
  }
  throw new HttpError(400, '图片无法压缩到 3MB 以内，请更换更小尺寸原图')
}

function guessExt(mime, fallback = 'bin') {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf'
  }
  return map[mime] || fallback
}

function buildPublicUrl(fileKey) {
  // 云托管对象存储默认域名形态
  const bucket = config.cos.bucket
  return `https://${bucket}.tcb.qcloud.la/${fileKey.replace(/^\//, '')}`
}

function cosPut(cos, params) {
  return new Promise((resolve, reject) => {
    cos.putObject(params, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

function cosDelete(cos, params) {
  return new Promise((resolve, reject) => {
    cos.deleteObject(params, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

function isImageMime(mime) {
  return String(mime || '').startsWith('image/')
}

async function uploadBuffer({
  buffer,
  mime,
  originalName,
  bizType = 'general',
  adminId = null,
  skipOptimize = false
}) {
  if (!buffer || !buffer.length) throw new HttpError(400, '空文件')
  if (buffer.length > 25 * 1024 * 1024) throw new HttpError(400, '单文件不能超过 25MB')

  let outBuf = buffer
  let outMime = mime || 'application/octet-stream'
  let ext = guessExt(outMime, path.extname(originalName || '').replace('.', '') || 'bin')
  let width = null
  let height = null
  let optimized = false

  if (isImageMime(outMime) && !skipOptimize) {
    const opt = await optimizeImageBuffer(buffer, outMime)
    outBuf = opt.buffer
    outMime = opt.mime
    ext = opt.ext
    width = opt.width
    height = opt.height
    optimized = true
  } else if (outBuf.length > MAX_BYTES && isImageMime(outMime)) {
    throw new HttpError(400, '图片超过 3MB')
  }

  const day = new Date()
  const y = day.getFullYear()
  const m = String(day.getMonth() + 1).padStart(2, '0')
  const d = String(day.getDate()).padStart(2, '0')
  const rand = crypto.randomBytes(8).toString('hex')
  const fileKey = `admin/${bizType}/${y}${m}${d}/${rand}.${ext}`

  // 本地/无 COS 时落盘到 public/uploads（仅开发兜底）
  if (config.cos.mode === 'local') {
    const localDir = path.join(__dirname, '../../public/uploads', bizType, `${y}${m}${d}`)
    fs.mkdirSync(localDir, { recursive: true })
    const localPath = path.join(localDir, `${rand}.${ext}`)
    fs.writeFileSync(localPath, outBuf)
    const fileUrl = `/uploads/${bizType}/${y}${m}${d}/${rand}.${ext}`
    const r = await query(
      `INSERT INTO media_assets
        (file_key, file_url, mime, size_bytes, width, height, biz_type, original_name, created_by)
       VALUES (:k, :u, :m, :s, :w, :h, :b, :o, :c)`,
      {
        k: fileKey,
        u: fileUrl,
        m: outMime,
        s: outBuf.length,
        w: width,
        h: height,
        b: bizType,
        o: originalName || null,
        c: adminId
      }
    )
    return {
      id: r.insertId,
      fileKey,
      fileUrl,
      mime: outMime,
      size: outBuf.length,
      width,
      height,
      optimized
    }
  }

  const cos = createCosClient()
  const metaList = await encodeMetaFileId(fileKey)
  const metaFileId = Array.isArray(metaList) ? metaList[0] : metaList
  const headers = {}
  if (metaFileId) headers['x-cos-meta-fileid'] = metaFileId

  await cosPut(cos, {
    Bucket: config.cos.bucket,
    Region: config.cos.region,
    Key: fileKey,
    Body: outBuf,
    ContentLength: outBuf.length,
    ContentType: outMime,
    Headers: headers
  })

  const fileUrl = buildPublicUrl(fileKey)
  const r = await query(
    `INSERT INTO media_assets
      (file_key, file_url, cloud_file_id, mime, size_bytes, width, height, biz_type, original_name, created_by)
     VALUES (:k, :u, :cf, :m, :s, :w, :h, :b, :o, :c)`,
    {
      k: fileKey,
      u: fileUrl,
      cf: metaFileId || null,
      m: outMime,
      s: outBuf.length,
      w: width,
      h: height,
      b: bizType,
      o: originalName || null,
      c: adminId
    }
  )

  return {
    id: r.insertId,
    fileKey,
    fileUrl,
    cloudFileId: metaFileId || null,
    mime: outMime,
    size: outBuf.length,
    width,
    height,
    optimized
  }
}

async function deleteByKeyOrUrl({ fileKey, fileUrl, id }) {
  let row = null
  if (id) {
    const rows = await query('SELECT * FROM media_assets WHERE id=:id', { id })
    row = rows[0]
  } else if (fileKey) {
    const rows = await query('SELECT * FROM media_assets WHERE file_key=:k', { k: fileKey })
    row = rows[0]
  } else if (fileUrl) {
    const rows = await query('SELECT * FROM media_assets WHERE file_url=:u LIMIT 1', { u: fileUrl })
    row = rows[0]
    if (!row) {
      // 尝试从 URL 解析 key
      const m = String(fileUrl).match(/\.tcb\.qcloud\.la\/(.+)$/)
      if (m) fileKey = decodeURIComponent(m[1])
    }
  }
  const key = (row && row.file_key) || fileKey
  if (!key) throw new HttpError(400, '缺少文件标识')

  if (config.cos.mode === 'local') {
    const localPath = path.join(__dirname, '../../public', key.replace(/^admin\//, 'uploads/').replace(/^uploads\//, 'uploads/'))
    // local keys are admin/... but files under public/uploads
    const maybe = path.join(__dirname, '../../public/uploads', key.replace(/^admin\//, ''))
    if (fs.existsSync(maybe)) fs.unlinkSync(maybe)
  } else {
    const cos = createCosClient()
    try {
      await cosDelete(cos, {
        Bucket: config.cos.bucket,
        Region: config.cos.region,
        Key: key
      })
    } catch (e) {
      console.warn('[storage] cos delete:', e.message || e)
    }
  }

  if (row) {
    await query('DELETE FROM media_assets WHERE id=:id', { id: row.id })
  } else {
    await query('DELETE FROM media_assets WHERE file_key=:k', { k: key })
  }
  return { deleted: true, fileKey: key }
}

async function listMedia({ bizType, limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 200)
  let sql = `SELECT id, file_key AS fileKey, file_url AS fileUrl, mime, size_bytes AS size,
                    width, height, biz_type AS bizType, original_name AS originalName,
                    created_at AS createdAt
             FROM media_assets`
  const params = {}
  if (bizType) {
    sql += ` WHERE biz_type=:b`
    params.b = bizType
  }
  sql += ` ORDER BY id DESC LIMIT ${lim}`
  return query(sql, params)
}

module.exports = {
  MAX_BYTES,
  optimizeImageBuffer,
  uploadBuffer,
  deleteByKeyOrUrl,
  listMedia,
  buildPublicUrl
}

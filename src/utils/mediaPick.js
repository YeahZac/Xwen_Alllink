/** 从入驻证照 / materials_json 中解析可用图片 URL */

function parseMaybeJson(v) {
  if (v == null) return null
  if (typeof v === 'object') return v
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch (_) {
      return null
    }
  }
  return null
}

function licenseUrl(v) {
  if (!v) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'object') {
    return String(v.url || v.fileUrl || v.path || v.src || '').trim()
  }
  return ''
}

function isMediaUrl(u) {
  const s = String(u || '').trim()
  if (!s) return false
  return /^(https?:\/\/|wxfile:\/\/|cloud:\/\/|\/uploads\/|\/static\/)/i.test(s)
}

const LICENSE_META_KEYS = new Set([
  'adminRemark',
  'stallCommitment',
  'stallCommitmentAt',
  'stallPath'
])

/** 优先门店/摊位/仓库封面，其次证照图（跳过承诺书等非图片元数据） */
function pickCoverFromLicenses(licenses) {
  const L = parseMaybeJson(licenses) || {}
  const preferred = [
    'storePhoto',
    'stallPhoto',
    'warehousePhoto',
    'shopCover',
    'cover',
    'coverUrl',
    'foodLicense',
    'businessLicense'
  ]
  for (const k of preferred) {
    const u = licenseUrl(L[k])
    if (isMediaUrl(u)) return u
  }
  for (const [k, v] of Object.entries(L)) {
    if (LICENSE_META_KEYS.has(k)) continue
    const u = licenseUrl(v)
    if (isMediaUrl(u)) return u
  }
  return ''
}

function isSeedOrEmptyCover(url) {
  const s = String(url || '').trim()
  if (!s) return true
  // 平台演示素材 / 旧模拟封面，不应压过商户上传的店招
  return /\/admin\/mp-static\/|\/admin\/(cover|banner)\//i.test(s)
}

/**
 * 对外展示封面：摊位/门店场景照优先；cover_url 若是 mp-static 演示图则丢弃。
 */
function resolveMerchantCover(coverUrl, materials) {
  const picked = pickCoverFromLicenses(materials)
  if (picked) return picked
  const cur = String(coverUrl || '').trim()
  if (cur && !isSeedOrEmptyCover(cur)) return cur
  return ''
}

/** 列表行：优先真实店招；演示封面可被 materials 店招覆盖 */
function enrichCoverRow(row, coverKey = 'coverImage', materialsKey = 'materialsJson') {
  if (!row) return row
  const mats = row[materialsKey] || row.materials
  const resolved = resolveMerchantCover(row[coverKey] || row.coverUrl || '', mats)
  if (resolved) {
    row[coverKey] = resolved
    row.coverUrl = resolved
    row.coverImage = resolved
  } else if (row.coverUrl || row.coverImage) {
    if (!row.coverImage && row.coverUrl) row.coverImage = row.coverUrl
    if (!row.coverUrl && row.coverImage) row.coverUrl = row.coverImage
  }
  delete row[materialsKey]
  return row
}

module.exports = {
  parseMaybeJson,
  licenseUrl,
  pickCoverFromLicenses,
  resolveMerchantCover,
  isSeedOrEmptyCover,
  enrichCoverRow
}

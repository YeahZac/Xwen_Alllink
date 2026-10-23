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

/** 优先门店/摊位/仓库封面，其次证照图 */
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
    if (u) return u
  }
  for (const v of Object.values(L)) {
    const u = licenseUrl(v)
    if (u) return u
  }
  return ''
}

/** 列表行：cover 为空时从 materials 回填 */
function enrichCoverRow(row, coverKey = 'coverImage', materialsKey = 'materialsJson') {
  if (!row) return row
  const cur = row[coverKey] || row.coverUrl || ''
  if (cur) {
    if (!row.coverImage && row.coverUrl) row.coverImage = row.coverUrl
    if (!row.coverUrl && row.coverImage) row.coverUrl = row.coverImage
    delete row[materialsKey]
    return row
  }
  const picked = pickCoverFromLicenses(row[materialsKey] || row.materials)
  if (picked) {
    row[coverKey] = picked
    row.coverUrl = picked
    row.coverImage = picked
  }
  delete row[materialsKey]
  return row
}

module.exports = {
  parseMaybeJson,
  licenseUrl,
  pickCoverFromLicenses,
  enrichCoverRow
}

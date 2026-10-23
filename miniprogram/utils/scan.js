const PENDING_KEY = 'wy_pending_pay'
const TTL_MS = 30 * 60 * 1000

function extractStallId(scanResult) {
  const q = scanResult && scanResult.query
  if (q && typeof q === 'object') {
    const fromObj = String(q.id || q.stallId || q.mid || '').trim()
    if (fromObj) return fromObj
  }
  const raw = [
    scanResult && scanResult.path,
    typeof q === 'string' ? q : '',
    scanResult && scanResult.result,
    typeof scanResult === 'string' ? scanResult : ''
  ]
    .filter(Boolean)
    .join('&')
  const hay = raw && raw.charAt(0) !== '?' && raw.charAt(0) !== '&' ? `?${raw}` : raw
  let match = String(hay).match(/[?&](?:id|stallId|mid)=([^&#]+)/i)
  if (match) return decodeURIComponent(match[1])
  match = String(hay).match(/[?&]scene=([^&#]+)/i)
  if (match) {
    const scene = decodeURIComponent(match[1])
    const sceneMatch = scene.match(/(?:^|[&;,])(?:id|stallId|mid)[=:]([^&;,]+)/i)
    if (sceneMatch) return String(sceneMatch[1])
    if (/^\d+$/.test(scene)) return scene
  }
  if (/^\d+$/.test(String(raw).trim())) return String(raw).trim()
  return ''
}

function extractFromLaunch(options) {
  const opt = options || {}
  const query = opt.query || {}
  const fromQuery = String(query.id || query.stallId || query.mid || '').trim()
  if (fromQuery) return fromQuery
  const path = String(opt.path || opt.page || '')
  const fromPath = extractStallId({ path: path.indexOf('?') >= 0 ? path : `${path}?` })
  if (fromPath) return fromPath
  const scene = opt.scene != null ? String(opt.scene) : ''
  if (/^\d+$/.test(scene) && Number(scene) > 0 && Number(scene) < 1e12) {
    /* 微信启动 scene 码不是摊位 id；只接受 query/path */
  }
  if (opt.query && opt.query.scene) {
    const decoded = extractStallId({ result: `scene=${opt.query.scene}` })
    if (decoded) return decoded
  }
  return ''
}

function savePendingPay(payload) {
  const next = {
    stallId: String((payload && payload.stallId) || '').trim(),
    amount: String((payload && payload.amount) || '').trim(),
    resume: payload && payload.resume === false ? false : true,
    ts: Date.now()
  }
  if (!next.stallId) return null
  try {
    wx.setStorageSync(PENDING_KEY, next)
  } catch (_) {}
  return next
}

function getPendingPay() {
  try {
    const v = wx.getStorageSync(PENDING_KEY)
    if (!v || !v.stallId) return null
    if (Date.now() - Number(v.ts || 0) > TTL_MS) {
      clearPendingPay()
      return null
    }
    return v
  } catch (_) {
    return null
  }
}

function clearPendingPay() {
  try {
    wx.removeStorageSync(PENDING_KEY)
  } catch (_) {}
}

function scanPayUrl(stallId, amount) {
  const id = encodeURIComponent(String(stallId || '').trim())
  const amt = String(amount || '').trim()
  let url = `/pages/scan-pay/scan-pay?id=${id}`
  if (amt) url += `&amount=${encodeURIComponent(amt)}`
  return url
}

module.exports = {
  PENDING_KEY,
  extractStallId,
  extractFromLaunch,
  savePendingPay,
  getPendingPay,
  clearPendingPay,
  scanPayUrl
}

/** 解析小程序码 scene / 页面 query，得到门店 id */
function merchantIdFromQuery(query) {
  const q = query || {}
  let raw = q.id || q.stallId || q.mid || q.merchantId || ''
  if (!raw && q.scene) {
    try {
      const scene = decodeURIComponent(String(q.scene))
      const m = scene.match(/(?:^|[?&])id=(\d+)/i) || scene.match(/^(\d+)$/)
      if (m) raw = m[1]
      else if (scene.indexOf('=') > -1) {
        const parts = {}
        scene.split('&').forEach((pair) => {
          const [k, v] = pair.split('=')
          if (k) parts[k] = v
        })
        raw = parts.id || parts.mid || parts.stallId || ''
      }
    } catch (_) {}
  }
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

module.exports = { merchantIdFromQuery }

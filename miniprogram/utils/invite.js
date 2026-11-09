/** 从扫码结果 / 启动参数里解析邀请码 */

function extractInviteCode(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''

  // 纯邀请码（字母数字下划线，较短）
  if (/^[A-Za-z0-9_]{3,32}$/.test(s) && !/^https?:/i.test(s)) {
    return s
  }

  let text = s
  try {
    text = decodeURIComponent(s)
  } catch (_) {}

  // scene=ref%3DXXXX 或 scene=XXXX
  let m = text.match(/(?:^|[?&#])scene=([^&#]+)/i)
  if (m) {
    let scene = m[1]
    try {
      scene = decodeURIComponent(scene)
    } catch (_) {}
    const fromScene = extractInviteCode(scene)
    if (fromScene) return fromScene
  }

  m = text.match(/(?:^|[?&#;,/])ref=([^&#;,\s/]+)/i)
  if (m) {
    try {
      return decodeURIComponent(m[1]).trim()
    } catch (_) {
      return String(m[1] || '').trim()
    }
  }

  // 小程序码 scene 原始：ref=CODE
  m = text.match(/^ref=([A-Za-z0-9_]{3,32})$/i)
  if (m) return m[1]

  return ''
}

function savePendingRef(code) {
  const c = String(code || '').trim()
  if (!c) return
  try {
    wx.setStorageSync('wy_pending_ref', c)
  } catch (_) {}
}

function readPendingRef() {
  try {
    return String(wx.getStorageSync('wy_pending_ref') || '').trim()
  } catch (_) {
    return ''
  }
}

module.exports = {
  extractInviteCode,
  savePendingRef,
  readPendingRef
}

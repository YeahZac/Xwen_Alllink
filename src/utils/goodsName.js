/**
 * 正式商品名校验：拦截联调/自动化测试残留品名，避免污染 C 端与运营台。
 */
const { HttpError } = require('./response')

/** 测试占位品名（Agent QA / sql 联调脚本） */
const TEST_GOODS_NAME_RE =
  /^(?:__|gate[-_]?draft$|paytest|测试小食)|(?:^|[\s_\-])(?:audit[_-]?draft|t_off)(?:$|[\s_\-])/i

function normalizeGoodsName(name) {
  return String(name || '').trim()
}

function isTestGoodsName(name) {
  const n = normalizeGoodsName(name)
  if (!n) return false
  if (n.startsWith('__')) return true
  if (TEST_GOODS_NAME_RE.test(n)) return true
  if (/^paytest/i.test(n)) return true
  if (/^测试小食/.test(n)) return true
  return false
}

function assertProductionGoodsName(name) {
  const n = normalizeGoodsName(name)
  if (!n) throw new HttpError(400, '请填写商品名称')
  if (isTestGoodsName(n)) {
    throw new HttpError(400, '商品名称不可用（疑似测试占位名），请使用正式品名')
  }
  return n
}

/** SQL：排除测试占位名（C 端菜单兜底） */
const C_END_EXCLUDE_TEST_NAME_SQL = `(
  name NOT LIKE '\\_\\_%' ESCAPE '\\\\'
  AND LOWER(name) NOT IN ('gate-draft', 'gate_draft', '__audit_draft__', '__t_off__')
  AND name NOT LIKE 'PAYTEST%'
  AND name NOT LIKE '测试小食%'
)`

module.exports = {
  isTestGoodsName,
  assertProductionGoodsName,
  C_END_EXCLUDE_TEST_NAME_SQL
}

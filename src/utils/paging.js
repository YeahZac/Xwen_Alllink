/**
 * 管理端列表统一分页：page / pageSize → { list, total, page, pageSize }
 */

function parsePaging(input = {}, defaults = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const page = Math.max(1, parseInt(raw.page, 10) || 1)
  const fallbackSize = parseInt(raw.pageSize, 10) || parseInt(raw.limit, 10) || defaults.pageSize || 20
  const maxSize = defaults.maxPageSize || 100
  const pageSize = Math.min(maxSize, Math.max(1, fallbackSize))
  const offset = (page - 1) * pageSize
  return { page, pageSize, offset, limit: pageSize }
}

function pageResult(list, total, paging) {
  const page = paging?.page || 1
  const pageSize = paging?.pageSize || paging?.limit || 20
  return {
    list: Array.isArray(list) ? list : [],
    total: Number(total) || 0,
    page,
    pageSize
  }
}

module.exports = { parsePaging, pageResult }

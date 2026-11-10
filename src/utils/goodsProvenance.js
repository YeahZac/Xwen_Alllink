/**
 * 商品数据来源 / 创建人
 * data_source: manual | placeholder | system | test
 * created_by_type: admin | merchant | system | script
 */
const { isTestGoodsName } = require('./goodsName')

const SOURCE_LABEL = {
  manual: '人工维护',
  placeholder: '系统占位',
  system: '系统自动',
  test: '测试数据'
}

const ACTOR_TYPE_LABEL = {
  admin: '运营账号',
  merchant: '商家账号',
  system: '系统',
  script: '脚本',
  unknown: '未知'
}

function normalizeSource(raw, { name, sku } = {}) {
  const s = String(raw || '').trim().toLowerCase()
  if (['manual', 'placeholder', 'system', 'test'].includes(s)) return s
  if (isTestGoodsName(name)) return 'test'
  const n = String(name || '').trim()
  const code = String(sku || '').trim()
  if (n === '到店消费' || /^SCAN\d+$/i.test(code)) return 'placeholder'
  return 'manual'
}

function pickActor(auth, fallbackType = 'system') {
  if (!auth || typeof auth !== 'object') {
    return { createdByType: fallbackType, createdById: null, createdByName: '系统' }
  }
  if (auth.adminId || auth.role === 'admin' || auth.roles?.includes?.('admin')) {
    const name =
      auth.displayName ||
      auth.display_name ||
      auth.username ||
      auth.name ||
      (auth.adminId ? `admin#${auth.adminId}` : '运营账号')
    return {
      createdByType: 'admin',
      createdById: Number(auth.adminId || auth.userId) || null,
      createdByName: String(name).slice(0, 64)
    }
  }
  if (auth.merchantId || auth.role === 'stall' || auth.role === 'cross' || auth.role === 'supply') {
    const name =
      auth.shopName ||
      auth.merchantName ||
      auth.nickname ||
      auth.name ||
      (auth.userId ? `user#${auth.userId}` : '商家账号')
    return {
      createdByType: 'merchant',
      createdById: Number(auth.userId || auth.merchantId) || null,
      createdByName: String(name).slice(0, 64)
    }
  }
  return {
    createdByType: fallbackType,
    createdById: Number(auth.userId || auth.adminId) || null,
    createdByName: String(auth.username || auth.nickname || auth.name || '系统').slice(0, 64)
  }
}

function provenanceFields({ source, name, sku, auth, actorType } = {}) {
  const dataSource = normalizeSource(source, { name, sku })
  const actor = pickActor(auth, actorType || (dataSource === 'manual' ? 'unknown' : 'system'))
  return {
    dataSource,
    createdByType: actor.createdByType,
    createdById: actor.createdById,
    createdByName: actor.createdByName,
    dataSourceLabel: SOURCE_LABEL[dataSource] || dataSource,
    createdByTypeLabel: ACTOR_TYPE_LABEL[actor.createdByType] || actor.createdByType
  }
}

function formatCreator(row = {}) {
  const type = row.created_by_type || row.createdByType || ''
  const name = String(row.created_by_name || row.createdByName || '').trim()
  const id = row.created_by_id || row.createdById
  const typeLabel = ACTOR_TYPE_LABEL[type] || type || '未知'
  if (!name && !id) return typeLabel
  if (type === 'system' && (!name || name === '系统' || name.startsWith('系统'))) {
    return name || '系统'
  }
  if (type === 'admin') {
    return id ? `${name || '运营账号'}（账号#${id}）` : `${name || '运营账号'}（运营账号）`
  }
  if (type === 'merchant') {
    return id ? `${name || '商家账号'}（商家#${id}）` : `${name || '商家账号'}（商家账号）`
  }
  return id ? `${name || typeLabel}（${typeLabel}#${id}）` : `${name}（${typeLabel}）`
}

module.exports = {
  SOURCE_LABEL,
  ACTOR_TYPE_LABEL,
  normalizeSource,
  pickActor,
  provenanceFields,
  formatCreator
}

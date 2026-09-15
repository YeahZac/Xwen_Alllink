const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')

const TYPE_LABEL = {
  flavor: '口味',
  portion: '分量',
  topping: '配料',
  custom: '选项'
}

async function loadOptionTree(goodsIds) {
  const ids = [...new Set((goodsIds || []).map(Number).filter(Boolean))]
  if (!ids.length) return new Map()
  const placeholders = ids.map((_, i) => `:id${i}`).join(',')
  const params = {}
  ids.forEach((id, i) => {
    params[`id${i}`] = id
  })
  const groups = await query(
    `SELECT id, goods_id AS goodsId, name, type, required, multi_select AS multiSelect,
            min_select AS minSelect, max_select AS maxSelect, sort_order AS sortOrder
     FROM stall_goods_option_groups
     WHERE goods_id IN (${placeholders})
     ORDER BY sort_order ASC, id ASC`,
    params
  )
  if (!groups.length) return new Map()
  const gids = groups.map((g) => g.id)
  const ph2 = gids.map((_, i) => `:g${i}`).join(',')
  const p2 = {}
  gids.forEach((id, i) => {
    p2[`g${i}`] = id
  })
  const options = await query(
    `SELECT id, group_id AS groupId, name, price_delta AS priceDelta, points_delta AS pointsDelta,
            is_default AS isDefault, sort_order AS sortOrder, status
     FROM stall_goods_options
     WHERE group_id IN (${ph2}) AND status=1
     ORDER BY sort_order ASC, id ASC`,
    p2
  )
  const byGroup = new Map()
  for (const o of options) {
    if (!byGroup.has(o.groupId)) byGroup.set(o.groupId, [])
    byGroup.get(o.groupId).push({
      id: o.id,
      name: o.name,
      priceDelta: Number(o.priceDelta) || 0,
      pointsDelta: Number(o.pointsDelta) || 0,
      isDefault: !!o.isDefault
    })
  }
  const map = new Map()
  for (const g of groups) {
    const row = {
      id: g.id,
      name: g.name,
      type: g.type,
      typeLabel: TYPE_LABEL[g.type] || g.name,
      required: !!g.required,
      multiSelect: !!g.multiSelect,
      minSelect: Number(g.minSelect) || 0,
      maxSelect: Number(g.maxSelect) || 1,
      options: byGroup.get(g.id) || []
    }
    if (!map.has(g.goodsId)) map.set(g.goodsId, [])
    map.get(g.goodsId).push(row)
  }
  return map
}

async function attachMenuOptions(menu) {
  const tree = await loadOptionTree((menu || []).map((g) => g.id))
  return (menu || []).map((g) => {
    const optionGroups = tree.get(g.id) || []
    return {
      ...g,
      hasOptions: optionGroups.length > 0,
      optionGroups
    }
  })
}

async function getGoodsOptionGroups(goodsId) {
  const tree = await loadOptionTree([Number(goodsId)])
  return tree.get(Number(goodsId)) || []
}

async function saveGoodsOptionGroups(goodsId, groups) {
  const gid = Number(goodsId)
  if (!gid) throw new HttpError(400, '缺少商品ID')
  const list = Array.isArray(groups) ? groups : []
  return withTransaction(async (conn) => {
    const [oldGroups] = await conn.execute(
      'SELECT id FROM stall_goods_option_groups WHERE goods_id=?',
      [gid]
    )
    if (oldGroups.length) {
      const ids = oldGroups.map((r) => r.id)
      await conn.execute(
        `DELETE FROM stall_goods_options WHERE group_id IN (${ids.map(() => '?').join(',')})`,
        ids
      )
      await conn.execute('DELETE FROM stall_goods_option_groups WHERE goods_id=?', [gid])
    }
    for (let i = 0; i < list.length; i++) {
      const g = list[i]
      const type = ['flavor', 'portion', 'topping', 'custom'].includes(g.type) ? g.type : 'custom'
      const multi = g.multiSelect ? 1 : 0
      const required = g.required ? 1 : 0
      const maxSelect = multi ? Number(g.maxSelect) || 9 : 1
      const minSelect = required ? Math.max(1, Number(g.minSelect) || 1) : Number(g.minSelect) || 0
      const [ins] = await conn.execute(
        `INSERT INTO stall_goods_option_groups
          (goods_id, name, type, required, multi_select, min_select, max_select, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          gid,
          g.name || TYPE_LABEL[type] || '选项',
          type,
          required,
          multi,
          minSelect,
          maxSelect,
          Number(g.sortOrder) || (i + 1) * 10
        ]
      )
      const groupId = ins.insertId
      const opts = Array.isArray(g.options) ? g.options : []
      for (let j = 0; j < opts.length; j++) {
        const o = opts[j]
        if (!o || !String(o.name || '').trim()) continue
        await conn.execute(
          `INSERT INTO stall_goods_options
            (group_id, name, price_delta, points_delta, is_default, sort_order, status)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [
            groupId,
            String(o.name).trim(),
            Number(o.priceDelta) || 0,
            Number(o.pointsDelta) || 0,
            o.isDefault ? 1 : 0,
            Number(o.sortOrder) || j + 1
          ]
        )
      }
    }
    return { goodsId: gid, groupCount: list.length }
  })
}

/** 校验选项并计算单价/积分；返回行快照 */
async function resolveStallLine(conn, { merchantId, goodsId, optionIds, qty }) {
  const [grows] = await conn.execute(
    `SELECT id, name, price, points_grant FROM stall_goods
     WHERE id=? AND merchant_id=? AND on_sale=1 AND deleted_at IS NULL`,
    [goodsId, merchantId]
  )
  if (!grows.length) throw new HttpError(400, '商品无效')
  const g = grows[0]
  const [groups] = await conn.execute(
    `SELECT id, name, type, required, multi_select AS multiSelect,
            min_select AS minSelect, max_select AS maxSelect
     FROM stall_goods_option_groups WHERE goods_id=? ORDER BY sort_order, id`,
    [g.id]
  )
  const selectedIds = [...new Set((optionIds || []).map(Number).filter(Boolean))]
  let selected = []
  if (groups.length) {
    const [opts] = await conn.execute(
      `SELECT o.id, o.group_id AS groupId, o.name, o.price_delta AS priceDelta,
              o.points_delta AS pointsDelta, o.is_default AS isDefault, o.status,
              g.name AS groupName, g.type AS groupType, g.required, g.multi_select AS multiSelect,
              g.min_select AS minSelect, g.max_select AS maxSelect
       FROM stall_goods_options o
       JOIN stall_goods_option_groups g ON g.id=o.group_id
       WHERE g.goods_id=? AND o.status=1`,
      [g.id]
    )
    const byId = new Map(opts.map((o) => [o.id, o]))
    // 若未传选项，自动带上默认项
    let ids = selectedIds
    if (!ids.length) {
      ids = opts.filter((o) => o.isDefault).map((o) => o.id)
    }
    selected = ids.map((id) => {
      const o = byId.get(id)
      if (!o) throw new HttpError(400, '规格选项无效')
      return o
    })
    for (const gr of groups) {
      const picked = selected.filter((o) => o.groupId === gr.id)
      const min = Number(gr.minSelect) || 0
      const max = Number(gr.maxSelect) || (gr.multiSelect ? 9 : 1)
      if (gr.required && picked.length < Math.max(1, min)) {
        throw new HttpError(400, `请选择${gr.name}`)
      }
      if (!gr.multiSelect && picked.length > 1) {
        throw new HttpError(400, `${gr.name}只能选一项`)
      }
      if (picked.length > max) {
        throw new HttpError(400, `${gr.name}最多选${max}项`)
      }
      if (picked.length < min) {
        throw new HttpError(400, `${gr.name}至少选${min}项`)
      }
    }
  } else if (selectedIds.length) {
    throw new HttpError(400, '该商品不支持规格选项')
  }

  let unitPrice = Number(g.price)
  let unitPoints = Number(g.points_grant) || 0
  for (const o of selected) {
    unitPrice += Number(o.priceDelta) || 0
    unitPoints += Number(o.pointsDelta) || 0
  }
  unitPrice = Math.round(unitPrice * 100) / 100
  unitPoints = Math.max(0, Math.floor(unitPoints))
  const q = Math.max(1, Number(qty) || 1)
  const optionsText = selected.map((o) => o.name).join(' / ')
  const optionsJson = selected.map((o) => ({
    id: o.id,
    groupId: o.groupId,
    groupName: o.groupName,
    type: o.groupType,
    name: o.name,
    priceDelta: Number(o.priceDelta) || 0,
    pointsDelta: Number(o.pointsDelta) || 0
  }))
  return {
    goodsId: g.id,
    name: g.name,
    price: unitPrice,
    pointsGrant: unitPoints,
    qty: q,
    optionsText,
    optionsJson,
    optionIds: selected.map((o) => o.id)
  }
}

module.exports = {
  TYPE_LABEL,
  loadOptionTree,
  attachMenuOptions,
  getGoodsOptionGroups,
  saveGoodsOptionGroups,
  resolveStallLine
}

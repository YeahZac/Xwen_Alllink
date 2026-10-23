/** 地摊菜品规格：价格/积分汇总与校验 */

function calcUnit(basePrice, basePts, groups, selectedMap) {
  let price = Number(basePrice) || 0
  let points = Number(basePts) || 0
  const names = []
  const optionIds = []
  ;(groups || []).forEach((g) => {
    const ids = selectedMap[g.id] || []
    ;(g.options || []).forEach((o) => {
      if (ids.indexOf(o.id) >= 0) {
        price += Number(o.priceDelta) || 0
        points += Number(o.pointsDelta) || 0
        names.push(o.name)
        optionIds.push(o.id)
      }
    })
  })
  return {
    price: Math.round(price * 100) / 100,
    pointsGrant: Math.max(0, Math.floor(points)),
    optionsText: names.join(' / '),
    optionIds: optionIds.sort((a, b) => a - b)
  }
}

function buildFlags(selected) {
  const flags = {}
  Object.keys(selected || {}).forEach((gid) => {
    ;(selected[gid] || []).forEach((oid) => {
      flags[`${gid}_${oid}`] = true
    })
  })
  return flags
}

function defaultSelected(groups) {
  const map = {}
  ;(groups || []).forEach((g) => {
    const defs = (g.options || []).filter((o) => o.isDefault).map((o) => o.id)
    if (defs.length) map[g.id] = g.multiSelect ? defs : [defs[0]]
    else if (g.required && g.options && g.options[0]) map[g.id] = [g.options[0].id]
    else map[g.id] = []
  })
  return map
}

function decorateGroups(groups) {
  return (groups || []).map((g) => ({
    ...g,
    options: (g.options || []).map((o) => ({
      ...o,
      flagKey: `${g.id}_${o.id}`,
      deltaText:
        Number(o.priceDelta) > 0
          ? `+¥${Number(o.priceDelta)}`
          : Number(o.priceDelta) < 0
            ? `¥${Number(o.priceDelta)}`
            : ''
    }))
  }))
}

function validateSelected(groups, selected) {
  for (const gr of groups || []) {
    const n = (selected[gr.id] || []).length
    const min = gr.required ? Math.max(1, gr.minSelect || 1) : gr.minSelect || 0
    const max = gr.multiSelect ? gr.maxSelect || 9 : 1
    if (n < min) return { ok: false, message: `请选择${gr.name}` }
    if (n > max) return { ok: false, message: `${gr.name}最多选${max}项` }
  }
  return { ok: true }
}

/**
 * 后端未配置规格时的演示规格（仅前端加价展示；optionIds 为空，下单按原价，文案带规格说明）
 * 真实规格请在运营后台配置。
 */
function demoOptionGroups(goodsId) {
  const gid = Number(goodsId) || 0
  const base = 900000 + gid * 10
  return [
    {
      id: base + 1,
      name: '分量',
      required: true,
      multiSelect: false,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: base + 11, name: '小份', priceDelta: 0, pointsDelta: 0, isDefault: true },
        { id: base + 12, name: '中份', priceDelta: 3, pointsDelta: 1, isDefault: false },
        { id: base + 13, name: '大份', priceDelta: 6, pointsDelta: 2, isDefault: false }
      ]
    },
    {
      id: base + 2,
      name: '口味',
      required: true,
      multiSelect: false,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: base + 21, name: '微辣', priceDelta: 0, pointsDelta: 0, isDefault: true },
        { id: base + 22, name: '中辣', priceDelta: 0, pointsDelta: 0, isDefault: false },
        { id: base + 23, name: '特辣', priceDelta: 1, pointsDelta: 0, isDefault: false }
      ]
    },
    {
      id: base + 3,
      name: '配料',
      required: false,
      multiSelect: true,
      minSelect: 0,
      maxSelect: 3,
      options: [
        { id: base + 31, name: '加蛋', priceDelta: 2, pointsDelta: 1, isDefault: false },
        { id: base + 32, name: '加肠', priceDelta: 3, pointsDelta: 1, isDefault: false },
        { id: base + 33, name: '加香菜', priceDelta: 0, pointsDelta: 0, isDefault: false }
      ]
    }
  ]
}

module.exports = {
  calcUnit,
  buildFlags,
  defaultSelected,
  decorateGroups,
  validateSelected,
  demoOptionGroups
}

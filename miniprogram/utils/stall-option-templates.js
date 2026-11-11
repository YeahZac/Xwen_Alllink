/** 地摊点餐规格模板（与后台 / C 端弹层一致） */

function mealTemplate() {
  return [
    {
      name: '口味',
      type: 'flavor',
      required: true,
      multiSelect: false,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { name: '微辣', priceDelta: 0, isDefault: true },
        { name: '中辣', priceDelta: 0, isDefault: false },
        { name: '特辣', priceDelta: 0.5, isDefault: false }
      ]
    },
    {
      name: '分量',
      type: 'portion',
      required: true,
      multiSelect: false,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { name: '标准', priceDelta: 0, isDefault: true },
        { name: '大份', priceDelta: 2, isDefault: false },
        { name: '小份', priceDelta: 0, isDefault: false }
      ]
    },
    {
      name: '配料',
      type: 'topping',
      required: false,
      multiSelect: true,
      minSelect: 0,
      maxSelect: 5,
      options: [
        { name: '加蛋', priceDelta: 1.5, isDefault: false },
        { name: '加肠', priceDelta: 2, isDefault: false },
        { name: '加豆皮', priceDelta: 1, isDefault: false }
      ]
    }
  ]
}

function drinkTemplate() {
  return [
    {
      name: '甜度',
      type: 'custom',
      required: true,
      multiSelect: false,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { name: '正常糖', priceDelta: 0, isDefault: true },
        { name: '少糖', priceDelta: 0, isDefault: false },
        { name: '无糖', priceDelta: 0, isDefault: false }
      ]
    },
    {
      name: '温度',
      type: 'custom',
      required: true,
      multiSelect: false,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { name: '热饮', priceDelta: 0, isDefault: true },
        { name: '常温', priceDelta: 0, isDefault: false },
        { name: '冰', priceDelta: 0, isDefault: false }
      ]
    },
    {
      name: '加料',
      type: 'topping',
      required: false,
      multiSelect: true,
      minSelect: 0,
      maxSelect: 4,
      options: [
        { name: '珍珠', priceDelta: 2, isDefault: false },
        { name: '椰果', priceDelta: 1.5, isDefault: false }
      ]
    }
  ]
}

function cloneTemplate(kind) {
  const src = kind === 'drink' ? drinkTemplate() : mealTemplate()
  return JSON.parse(JSON.stringify(src))
}

module.exports = {
  mealTemplate,
  drinkTemplate,
  cloneTemplate
}

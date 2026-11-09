/**
 * 首屏本地运营底包：云托管冷启动 / 网络未返回时立刻有可体验门店，
 * 避免审核看到「正在加载」空页。网络数据到达后会被替换。
 */
const coverPack = require('./cover-pack')

function stamp(row) {
  return {
    ...row,
    initial: (row.name || '').slice(0, 1),
    coverImage: coverPack.resolveCover(row),
    open: 1,
    bootstrap: true
  }
}

const STALLS = [
  stamp({
    id: 1,
    role: 'stall',
    name: '张记夜市炒面',
    city: '深圳·罗湖',
    address: '深圳市罗湖区宝安南路1881号万象城 B1',
    latitude: 22.5378,
    longitude: 114.1116,
    category: '餐饮',
    tag: '餐饮',
    desc: '现炒现卖 · 扫码点餐积分到账',
    sales: 1286
  }),
  stamp({
    id: 2,
    role: 'stall',
    name: '阿姐烤串档',
    city: '深圳·罗湖',
    address: '深圳市罗湖区人民南路2002号金光华广场 3F',
    latitude: 22.5445,
    longitude: 114.1148,
    category: '餐饮',
    tag: '餐饮',
    desc: '秘制烤串 · 积分立返',
    sales: 986
  }),
  stamp({
    id: 6,
    role: 'stall',
    name: '老周臭豆腐',
    city: '深圳·福田',
    address: '深圳市福田区福华三路 COCO Park 负一楼美食街',
    latitude: 22.534,
    longitude: 114.0555,
    category: '餐饮',
    tag: '餐饮',
    desc: '外酥里嫩 · 夜宵常备',
    sales: 760
  }),
  stamp({
    id: 8,
    role: 'stall',
    name: '阿强煎饼果子',
    city: '深圳·宝安',
    address: '深圳市宝安区新湖路99号壹方城 B1',
    latitude: 22.5605,
    longitude: 113.8872,
    category: '餐饮',
    tag: '餐饮',
    desc: '早餐现摊 · 积分可兑',
    sales: 1120
  })
]

const CROSS = [
  stamp({
    id: 3,
    role: 'cross',
    roleLabel: '兑换',
    name: '瑞昌果切小屋',
    city: '深圳·福田',
    address: '深圳市福田区益田路4068号益田假日广场 L1',
    latitude: 22.5352,
    longitude: 114.0531,
    category: '百货商店',
    tag: '百货',
    desc: '鲜切水果 · 积分兑换'
  }),
  stamp({
    id: 5,
    role: 'cross',
    roleLabel: '兑换',
    name: '老街奶茶铺',
    city: '深圳·南山',
    address: '深圳市南山区文心五路33号海岸城 2F',
    latitude: 22.5172,
    longitude: 113.9348,
    category: '餐饮',
    tag: '餐饮',
    desc: '茶饮甜品 · 积分抵现'
  }),
  stamp({
    id: 9,
    role: 'cross',
    roleLabel: '兑换',
    name: '浔阳花艺馆',
    city: '深圳·福田',
    address: '深圳市福田区福华一路3号中心城花艺区',
    latitude: 22.541,
    longitude: 114.0598,
    category: '鲜花',
    tag: '鲜花',
    desc: '鲜花礼盒 · 积分专兑'
  }),
  stamp({
    id: 11,
    role: 'cross',
    roleLabel: '兑换',
    name: '庐山足道馆',
    city: '深圳·龙华',
    address: '深圳市龙华区民塘路壹方天地 4F 足道',
    latitude: 22.657,
    longitude: 114.036,
    category: '百货商店',
    tag: '百货',
    desc: '足浴养生 · 积分核销'
  })
]

const SUPPLY = [
  stamp({
    id: 4,
    role: 'supply',
    name: '赣北粮油供应链',
    city: '深圳·南山',
    address: '深圳市南山区科苑南路2888号深圳湾万象城 B2 仓储通道',
    latitude: 22.5175,
    longitude: 113.9415,
    category: '供货',
    tag: '供货',
    desc: '粮油调味 · 门店采购'
  }),
  stamp({
    id: 12,
    role: 'supply',
    name: '鄱阳湖冻品仓',
    city: '深圳·宝安',
    address: '深圳市宝安区桂湾四路前海壹方中心冷链仓',
    latitude: 22.5248,
    longitude: 113.8895,
    category: '供货',
    tag: '供货',
    desc: '冻品冷链 · 次日达'
  })
]

function homePayload() {
  return {
    stalls: STALLS.slice(),
    crossStores: CROSS.slice(),
    supplyMerchants: SUPPLY.slice(),
    points: 0,
    cashValue: 0,
    bootstrap: true
  }
}

function crossStores() {
  return CROSS.concat(
    STALLS.map((s) => ({
      ...s,
      role: 'stall',
      roleLabel: '点餐'
    }))
  )
}

module.exports = {
  homePayload,
  crossStores,
  STALLS,
  CROSS,
  SUPPLY
}

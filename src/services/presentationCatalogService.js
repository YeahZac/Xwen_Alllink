/**
 * 首页呈现模式（临时）：
 * - 放宽 C 端列表「二级商户进件」门槛，让未进件门店/商品也能展示
 * - 写入一批 data_source=presentation 的演示门店/商品（可一键清除）
 *
 * 一键改回进件门槛：POST /admin/ops/presentation/mode { enabled:false, confirm:'REVERT_PRESENTATION' }
 * 一键清演示数据：POST /admin/ops/presentation/purge { confirm:'PURGE_PRESENTATION' }
 * 一键重种演示：POST /admin/ops/presentation/seed { confirm:'SEED_PRESENTATION' }
 */
const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')

const MP_STATIC =
  'https://7072-prod-d3g1vkrj3290d085e-1467541248.tcb.qcloud.la/admin/mp-static/20261102'

/** 云托管已上传的实景素材；门店封面与菜品尽量错开，避免整页同图 */
const IMG = {
  supermarket: `${MP_STATIC}/b348459d6195838b.webp`,
  noodles: `${MP_STATIC}/26ff62910b5f2547.webp`,
  bbq: `${MP_STATIC}/26d02cda44689532.webp`,
  flower: `${MP_STATIC}/0168ba78d752f002.webp`,
  fruit: `${MP_STATIC}/673e6599ea9a8f70.webp`,
  milktea: `${MP_STATIC}/727fdce69c23d17a.webp`,
  warehouse: `${MP_STATIC}/8904b797e9dc2b41.webp`,
  malatang: `${MP_STATIC}/6f0506640cd043cc.webp`,
  jianbing: `${MP_STATIC}/8534668a3d421afb.webp`,
  cake: `${MP_STATIC}/e85759a7147886c8.webp`,
  tofu: `${MP_STATIC}/768037b9e15b0223.webp`,
  carwash: `${MP_STATIC}/4c20198e1c0cf66a.webp`,
  stallNight: `${MP_STATIC}/809fc9e17ef933b6.webp`,
  mall: `${MP_STATIC}/c24ce20a00c6790e.webp`,
  points: `${MP_STATIC}/bcf4837bfb8f2347.webp`,
  scan: `${MP_STATIC}/3cdd06ea70c160cb.webp`,
  crossShop: `${MP_STATIC}/742baf46d2be8680.webp`,
  supplyBay: `${MP_STATIC}/821f8b62aeaa627a.webp`,
  login: `${MP_STATIC}/8f773fae68a0ba0e.webp`
}

const CONFIG_KEY = 'home_presentation_relax'
const CATALOG_VERSION_KEY = 'home_presentation_catalog_version'
/** 升版本会在启动/播种时刷新店名与图片 */
const CATALOG_VERSION = '3'
const MERCHANT_NO_PREFIX = 'PRES_'

/**
 * 演示门店：每店独立封面；店内菜品图尽量与封面不同、彼此不同。
 * 坐标落在已开通深圳商场附近。
 */
const DEMO_MERCHANTS = [
  {
    merchantNo: 'PRES_STALL_01',
    invite: 'PRES01',
    role: 'stall',
    name: '阿彪深夜烧烤档',
    bizType: '餐饮',
    city: '深圳·南山',
    address: '海岸城负一美食区外摆 18 号',
    lat: 22.5172,
    lng: 113.9345,
    cover: IMG.bbq,
    hue: '#C45A2A',
    goods: [
      { name: '秘制羊肉串（5 串）', price: 28, pts: 28, usable: 10, cat: '烧烤', desc: '现烤孜然味', img: IMG.stallNight },
      { name: '蒜蓉生蚝（4 只）', price: 32, pts: 32, usable: 10, cat: '烧烤', desc: '带壳现烤', img: IMG.scan },
      { name: '烤茄子', price: 14, pts: 14, usable: 4, cat: '烧烤', desc: '蒜香酱', img: IMG.tofu },
      { name: '冰镇扎啤 500ml', price: 12, pts: 12, usable: 3, cat: '酒水', desc: '冰杯', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_STALL_02',
    invite: 'PRES02',
    role: 'stall',
    name: '老周豆浆油条铺',
    bizType: '餐饮',
    city: '深圳·罗湖',
    address: '万象城 B1 早市档口',
    lat: 22.5398,
    lng: 114.1112,
    cover: IMG.jianbing,
    hue: '#B86A1C',
    goods: [
      { name: '现磨热豆浆', price: 5, pts: 5, usable: 2, cat: '饮品', desc: '无糖/微甜', img: IMG.points },
      { name: '现炸油条（2 根）', price: 6, pts: 6, usable: 2, cat: '主食', desc: '外脆里软', img: IMG.tofu },
      { name: '鸡蛋灌饼', price: 10, pts: 10, usable: 3, cat: '主食', desc: '加薄脆', img: IMG.noodles },
      { name: '茶叶蛋', price: 3, pts: 3, usable: 1, cat: '小吃', desc: '卤香入味', img: IMG.cake }
    ]
  },
  {
    merchantNo: 'PRES_STALL_03',
    invite: 'PRES03',
    role: 'stall',
    name: '渝味麻辣烫',
    bizType: '餐饮',
    city: '深圳·宝安',
    address: '壹方城 B2 小吃街 07',
    lat: 22.5601,
    lng: 113.8872,
    cover: IMG.malatang,
    hue: '#D4532B',
    goods: [
      { name: '麻辣烫小份（自选）', price: 22, pts: 22, usable: 8, cat: '主食', desc: '微辣起步', img: IMG.noodles },
      { name: '麻辣烫大份（加料）', price: 32, pts: 32, usable: 10, cat: '主食', desc: '含宽粉', img: IMG.stallNight },
      { name: '关东煮三件套', price: 12, pts: 12, usable: 3, cat: '小吃', desc: '萝卜/蛋/鱼饼', img: IMG.tofu },
      { name: '酸梅汤', price: 8, pts: 8, usable: 2, cat: '饮品', desc: '解辣', img: IMG.fruit }
    ]
  },
  {
    merchantNo: 'PRES_STALL_04',
    invite: 'PRES04',
    role: 'stall',
    name: '港记干炒牛河',
    bizType: '餐饮',
    city: '深圳·龙华',
    address: '大悦城 L1 餐饮走廊 22',
    lat: 22.6575,
    lng: 114.0368,
    cover: IMG.noodles,
    hue: '#E08A1E',
    goods: [
      { name: '干炒牛河', price: 26, pts: 26, usable: 8, cat: '主食', desc: '镬气足 · 少油', img: IMG.bbq },
      { name: '滑蛋牛肉饭', price: 24, pts: 24, usable: 7, cat: '主食', desc: '配时蔬', img: IMG.jianbing },
      { name: '姜葱炒通菜', price: 14, pts: 14, usable: 4, cat: '小菜', desc: '时令', img: IMG.fruit },
      { name: '冻柠茶大杯', price: 9, pts: 9, usable: 2, cat: '饮品', desc: '少冰', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_STALL_05',
    invite: 'PRES05',
    role: 'stall',
    name: '巷口臭豆腐',
    bizType: '餐饮',
    city: '深圳·龙岗',
    address: '星河 COCO 一层外摆',
    lat: 22.7204,
    lng: 114.2471,
    cover: IMG.tofu,
    hue: '#8A6A2F',
    goods: [
      { name: '香辣臭豆腐', price: 12, pts: 12, usable: 4, cat: '小吃', desc: '外酥内嫩', img: IMG.malatang },
      { name: '原味臭豆腐', price: 10, pts: 10, usable: 3, cat: '小吃', desc: '配辣酱', img: IMG.bbq },
      { name: '炸年糕', price: 8, pts: 8, usable: 2, cat: '小吃', desc: '甜辣酱', img: IMG.cake },
      { name: '豆浆一杯', price: 4, pts: 4, usable: 1, cat: '饮品', desc: '热', img: IMG.jianbing }
    ]
  },
  {
    merchantNo: 'PRES_STALL_06',
    invite: 'PRES06',
    role: 'stall',
    name: '夜市灯笼炸串',
    bizType: '餐饮',
    city: '深圳·宝安',
    address: '前海合作区夜市 C06',
    lat: 22.5268,
    lng: 113.8915,
    cover: IMG.stallNight,
    hue: '#A33B1F',
    goods: [
      { name: '炸鸡翅（2 只）', price: 16, pts: 16, usable: 5, cat: '炸物', desc: '香辣', img: IMG.bbq },
      { name: '炸鱿鱼圈', price: 18, pts: 18, usable: 6, cat: '炸物', desc: '椒盐', img: IMG.scan },
      { name: '薯条大份', price: 10, pts: 10, usable: 3, cat: '炸物', desc: '番茄酱', img: IMG.noodles },
      { name: '可乐听装', price: 5, pts: 5, usable: 1, cat: '饮品', desc: '冰镇', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_STALL_07',
    invite: 'PRES07',
    role: 'stall',
    name: '川妹子酸辣粉',
    bizType: '餐饮',
    city: '深圳·罗湖',
    address: '东门步行街美食城 2F',
    lat: 22.5456,
    lng: 114.1208,
    cover: IMG.scan,
    hue: '#C23B22',
    goods: [
      { name: '招牌酸辣粉', price: 15, pts: 15, usable: 5, cat: '主食', desc: '红薯粉 · 中辣', img: IMG.malatang },
      { name: '肥肠酸辣粉', price: 22, pts: 22, usable: 7, cat: '主食', desc: '加肥肠', img: IMG.bbq },
      { name: '麻酱凉皮', price: 13, pts: 13, usable: 4, cat: '小吃', desc: '黄瓜丝', img: IMG.tofu },
      { name: '冰粉（红糖）', price: 8, pts: 8, usable: 2, cat: '小吃', desc: '夏季限定', img: IMG.fruit }
    ]
  },
  {
    merchantNo: 'PRES_STALL_08',
    invite: 'PRES08',
    role: 'stall',
    name: '湾区轻食碗',
    bizType: '餐饮',
    city: '深圳·南山',
    address: '深圳湾万象城 L2-09',
    lat: 22.4856,
    lng: 113.9452,
    cover: IMG.fruit,
    hue: '#2F8F6B',
    goods: [
      { name: '鸡胸藜麦碗', price: 34, pts: 34, usable: 12, cat: '轻食', desc: '低脂酱', img: IMG.noodles },
      { name: '牛油果虾仁沙拉', price: 38, pts: 38, usable: 12, cat: '轻食', desc: '油醋汁', img: IMG.cake },
      { name: '鲜榨橙汁 400ml', price: 18, pts: 18, usable: 5, cat: '饮品', desc: '现榨', img: IMG.milktea },
      { name: '希腊酸奶杯', price: 16, pts: 16, usable: 5, cat: '小吃', desc: '坚果燕麦', img: IMG.jianbing }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_01',
    invite: 'PRES21',
    role: 'cross',
    name: '花间集花艺',
    bizType: '鲜花',
    city: '深圳·南山',
    address: '海岸城 L3-12',
    lat: 22.5181,
    lng: 113.9358,
    cover: IMG.flower,
    hue: '#3D8B4A',
    goods: [
      { name: '当季混搭花束', pointsNeed: 880, cash: 78, cat: '鲜花', desc: '含包装袋', img: IMG.points },
      { name: '红玫瑰 11 支', pointsNeed: 1280, cash: 108, cat: '鲜花', desc: '情人节款', img: IMG.crossShop },
      { name: '多肉组合盆栽', pointsNeed: 560, cash: 49, cat: '绿植', desc: '含盆', img: IMG.mall }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_02',
    invite: 'PRES22',
    role: 'cross',
    name: '奶油社烘焙',
    bizType: '蛋糕',
    city: '深圳·罗湖',
    address: '万象城 L1 甜品区',
    lat: 22.5405,
    lng: 114.112,
    cover: IMG.cake,
    hue: '#C9A227',
    goods: [
      { name: '巴斯克芝士切角', pointsNeed: 420, cash: 39, cat: '蛋糕', desc: '冷藏保存', img: IMG.fruit },
      { name: '焦糖布丁塔', pointsNeed: 360, cash: 32, cat: '甜品', desc: '当日烤制', img: IMG.jianbing },
      { name: '手冲美式', pointsNeed: 180, cash: 16, cat: '饮品', desc: '热/冰可选', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_03',
    invite: 'PRES23',
    role: 'cross',
    name: '鲜果切 FreshCut',
    bizType: '百货商店',
    city: '深圳·宝安',
    address: '壹方城 B1 生鲜档',
    lat: 22.5612,
    lng: 113.888,
    cover: IMG.mall,
    hue: '#3D8B4A',
    goods: [
      { name: '综合果切盒（小）', pointsNeed: 280, cash: 26, cat: '果切', desc: '西瓜/蜜瓜/提子', img: IMG.fruit },
      { name: '芒果杯', pointsNeed: 320, cash: 29, cat: '果切', desc: '当季芒果', img: IMG.cake },
      { name: '鲜榨椰子水', pointsNeed: 160, cash: 14, cat: '饮品', desc: '冷藏柜', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_04',
    invite: 'PRES24',
    role: 'cross',
    name: '邻里便利购',
    bizType: '百货商店',
    city: '深圳·龙华',
    address: '大悦城 B1-06',
    lat: 22.6582,
    lng: 114.0375,
    cover: IMG.supermarket,
    hue: '#2E6B8A',
    goods: [
      { name: '店内满减券 50 元', pointsNeed: 5000, cash: 50, cat: '券', desc: '满 80 可用', img: IMG.crossShop },
      { name: '进口零食礼盒', pointsNeed: 2800, cash: 69, cat: '零食', desc: '混合装', img: IMG.cake },
      { name: '矿泉水整提 12 瓶', pointsNeed: 900, cash: 22, cat: '饮品', desc: '提装', img: IMG.points }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_05',
    invite: 'PRES25',
    role: 'cross',
    name: '捷途精洗车行',
    bizType: '百货商店',
    city: '深圳·福田',
    address: '福田中心二路停车场旁',
    lat: 22.5412,
    lng: 114.0578,
    cover: IMG.carwash,
    hue: '#3A6EA5',
    goods: [
      { name: '标准外观洗车', pointsNeed: 1500, cash: 35, cat: '洗车', desc: '轿车', img: IMG.login },
      { name: '精洗内饰套餐', pointsNeed: 3200, cash: 88, cat: '洗车', desc: '约 40 分钟', img: IMG.supermarket },
      { name: '打蜡护理一次', pointsNeed: 4800, cash: 128, cat: '养护', desc: '轿车', img: IMG.crossShop }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_06',
    invite: 'PRES26',
    role: 'cross',
    name: '慢煮茶室',
    bizType: '餐饮',
    city: '深圳·南山',
    address: '海岸城 L2 茶饮区',
    lat: 22.5178,
    lng: 113.9362,
    cover: IMG.milktea,
    hue: '#C45A2A',
    goods: [
      { name: '桂花乌龙（少糖）', pointsNeed: 220, cash: 19, cat: '茶饮', desc: '可调糖度', img: IMG.flower },
      { name: '杨枝甘露', pointsNeed: 260, cash: 23, cat: '茶饮', desc: '芒果椰奶', img: IMG.fruit },
      { name: '烤奶布丁', pointsNeed: 180, cash: 15, cat: '甜品', desc: '杯装冷藏', img: IMG.cake }
    ]
  },
  {
    merchantNo: 'PRES_SUPPLY_01',
    invite: 'PRES31',
    role: 'supply',
    name: '龙华鲜冻集配中心',
    bizType: '百货商店',
    city: '深圳·龙华',
    address: '龙华物流园 3 号冷库',
    lat: 22.661,
    lng: 114.028,
    cover: IMG.warehouse,
    hue: '#3A6EA5',
    goods: [
      { name: '冷冻鸡翅中 10kg', price: 268, pts: 80, cat: '冻品', desc: '餐饮箱装', img: IMG.bbq },
      { name: '速冻水饺 5kg', price: 98, pts: 30, cat: '冻品', desc: '猪肉白菜', img: IMG.noodles },
      { name: '冷冻薯条 10kg', price: 128, pts: 40, cat: '冻品', desc: '直薯条', img: IMG.stallNight }
    ]
  },
  {
    merchantNo: 'PRES_SUPPLY_02',
    invite: 'PRES32',
    role: 'supply',
    name: '西乡粮油调味仓',
    bizType: '百货商店',
    city: '深圳·宝安',
    address: '宝安西乡工业区 8 栋',
    lat: 22.568,
    lng: 113.875,
    cover: IMG.supplyBay,
    hue: '#3E7A3A',
    goods: [
      { name: '花生油 20L 桶', price: 218, pts: 60, cat: '粮油', desc: '餐饮装', img: IMG.supermarket },
      { name: '生抽 15kg 桶', price: 86, pts: 25, cat: '调味', desc: '餐饮装', img: IMG.malatang },
      { name: '火锅底料箱（20 袋）', price: 160, pts: 45, cat: '调味', desc: '微辣', img: IMG.warehouse }
    ]
  }
]

async function getConfig(key) {
  try {
    const rows = await query(
      `SELECT config_value AS v FROM platform_config WHERE config_key=:k LIMIT 1`,
      { k: key }
    )
    return rows[0] ? String(rows[0].v) : null
  } catch (_) {
    return null
  }
}

async function setConfig(key, value, remark) {
  await query(
    `INSERT INTO platform_config (config_key, config_value, remark)
     VALUES (:k, :v, :r)
     ON DUPLICATE KEY UPDATE config_value=VALUES(config_value), remark=IFNULL(VALUES(remark), remark)`,
    { k: key, v: String(value), r: remark || null }
  )
}

/**
 * 是否放宽首页进件门槛。
 * env HOME_PRESENTATION_RELAX=0/1 可强制覆盖；否则读 platform_config。
 */
async function isPresentationRelaxEnabled() {
  const env = String(process.env.HOME_PRESENTATION_RELAX || '').trim().toLowerCase()
  if (env === '0' || env === 'false' || env === 'off') return false
  if (env === '1' || env === 'true' || env === 'on') return true
  const v = await getConfig(CONFIG_KEY)
  if (v == null) return true // 当前呈现需求：默认放开；正式上线请一键改回
  return v === '1' || v === 'true'
}

async function setPresentationRelax(enabled, { confirm } = {}) {
  if (enabled) {
    await setConfig(CONFIG_KEY, '1', '呈现模式：C端列表不卡二级商户进件（可一键改回）')
  } else {
    if (confirm !== 'REVERT_PRESENTATION') {
      throw new HttpError(400, '关闭呈现模式请传 confirm=REVERT_PRESENTATION')
    }
    await setConfig(CONFIG_KEY, '0', '已恢复：C端列表需二级商户进件完成')
  }
  try {
    require('./merchantReady').clearHomeVisibleCache()
  } catch (_) {}
  return getStatus()
}

async function countPresentationMerchants() {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM merchants
     WHERE deleted_at IS NULL AND merchant_no LIKE :p`,
    { p: `${MERCHANT_NO_PREFIX}%` }
  )
  return Number(rows[0] && rows[0].c) || 0
}

async function getStatus() {
  const enabled = await isPresentationRelaxEnabled()
  const merchants = await countPresentationMerchants()
  return {
    enabled,
    configKey: CONFIG_KEY,
    envOverride: String(process.env.HOME_PRESENTATION_RELAX || '').trim() || null,
    presentationMerchants: merchants,
    howToRevert:
      'POST /admin/ops/presentation/mode {\"enabled\":false,\"confirm\":\"REVERT_PRESENTATION\"}',
    howToPurge:
      'POST /admin/ops/presentation/purge {\"confirm\":\"PURGE_PRESENTATION\"}',
    howToSeed:
      'POST /admin/ops/presentation/seed {\"confirm\":\"SEED_PRESENTATION\"}',
    note:
      '呈现模式只影响 C 端列表可见性；支付/上架门槛仍按进件规则。演示数据 data_source=presentation，与人工维护隔离。'
  }
}

async function ensurePoolAndAccount(merchantId, role) {
  await query(
    `INSERT INTO merchant_points_pool (merchant_id, balance)
     SELECT :id, 2000 FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM merchant_points_pool WHERE merchant_id=:id)`,
    { id: merchantId }
  )
  const accountType = role === 'supply' ? 'cash_goods' : 'cash_settlement'
  await query(
    `INSERT INTO merchant_accounts (merchant_id, account_type, balance, frozen)
     SELECT :id, :t, 0, 0 FROM DUAL
     WHERE NOT EXISTS (
       SELECT 1 FROM merchant_accounts WHERE merchant_id=:id AND account_type=:t
     )`,
    { id: merchantId, t: accountType }
  )
}

async function upsertMerchant(seed) {
  const existing = await query(
    `SELECT id FROM merchants WHERE merchant_no=:no LIMIT 1`,
    { no: seed.merchantNo }
  )
  if (existing.length) {
    const id = Number(existing[0].id)
    await query(
      `UPDATE merchants
       SET name=:name, role=:role, city=:city, address=:address,
           latitude=:lat, longitude=:lng, cover_hue=:hue, cover_url=:cover,
           biz_type=:biz, status=1, deleted_at=NULL, invite_code=:invite
       WHERE id=:id`,
      {
        id,
        name: seed.name,
        role: seed.role,
        city: seed.city,
        address: seed.address,
        lat: seed.lat,
        lng: seed.lng,
        hue: seed.hue,
        cover: seed.cover,
        biz: seed.bizType,
        invite: seed.invite
      }
    )
    await ensurePoolAndAccount(id, seed.role)
    return id
  }
  const r = await query(
    `INSERT INTO merchants
      (merchant_no, role, name, credit_code, legal_person, contact_name, contact_phone,
       city, address, latitude, longitude, cover_hue, cover_url, status, invite_code, biz_type)
     VALUES
      (:no, :role, :name, :credit, '演示法人', '演示联系人', '13800000000',
       :city, :address, :lat, :lng, :hue, :cover, 1, :invite, :biz)`,
    {
      no: seed.merchantNo,
      role: seed.role,
      name: seed.name,
      credit: `91440300${seed.invite}`,
      city: seed.city,
      address: seed.address,
      lat: seed.lat,
      lng: seed.lng,
      hue: seed.hue,
      cover: seed.cover,
      invite: seed.invite,
      biz: seed.bizType
    }
  )
  const id = Number(r.insertId)
  await ensurePoolAndAccount(id, seed.role)
  return id
}

async function upsertStallGoods(merchantId, goods) {
  let n = 0
  for (const g of goods) {
    const sku = `PRES-S-${merchantId}-${g.name.slice(0, 8)}`
    const hit = await query(
      `SELECT id FROM stall_goods
       WHERE merchant_id=:mid AND name=:name AND deleted_at IS NULL LIMIT 1`,
      { mid: merchantId, name: g.name }
    )
    if (hit.length) {
      await query(
        `UPDATE stall_goods
         SET price=:price, points_grant=:pts, points_usable=:usable, mix_enabled=1,
             category=:cat, desc_text=:desc, image_url=:img, stock=999, on_sale=1,
             data_source='presentation', created_by_type='script', created_by_name='呈现演示'
         WHERE id=:id`,
        {
          id: hit[0].id,
          price: g.price,
          pts: g.pts,
          usable: g.usable || 0,
          cat: g.cat,
          desc: g.desc,
          img: g.img
        }
      )
    } else {
      try {
        await query(
          `INSERT INTO stall_goods
            (merchant_id, name, sku_code, price, points_grant, points_usable, mix_enabled,
             category, desc_text, image_url, stock, on_sale, sales_count,
             data_source, created_by_type, created_by_name)
           VALUES
            (:mid, :name, :sku, :price, :pts, :usable, 1,
             :cat, :desc, :img, 999, 1, 0,
             'presentation', 'script', '呈现演示')`,
          {
            mid: merchantId,
            name: g.name,
            sku,
            price: g.price,
            pts: g.pts,
            usable: g.usable || 0,
            cat: g.cat,
            desc: g.desc,
            img: g.img
          }
        )
      } catch (e) {
        if (e && e.code === 'ER_BAD_FIELD_ERROR') {
          await query(
            `INSERT INTO stall_goods
              (merchant_id, name, sku_code, price, points_grant, category, desc_text, image_url, stock, on_sale)
             VALUES
              (:mid, :name, :sku, :price, :pts, :cat, :desc, :img, 999, 1)`,
            {
              mid: merchantId,
              name: g.name,
              sku,
              price: g.price,
              pts: g.pts,
              cat: g.cat,
              desc: g.desc,
              img: g.img
            }
          )
        } else throw e
      }
    }
    n += 1
  }
  return n
}

async function upsertCrossGoods(merchantId, goods) {
  let n = 0
  for (const g of goods) {
    const sku = `PRES-C-${merchantId}-${g.name.slice(0, 8)}`
    const hit = await query(
      `SELECT id FROM cross_goods
       WHERE merchant_id=:mid AND name=:name AND deleted_at IS NULL LIMIT 1`,
      { mid: merchantId, name: g.name }
    )
    if (hit.length) {
      await query(
        `UPDATE cross_goods
         SET points_need=:need, cash_price=:cash, category=:cat, desc_text=:desc,
             image_url=:img, stock=999, on_sale=1,
             data_source='presentation', created_by_type='script', created_by_name='呈现演示'
         WHERE id=:id`,
        {
          id: hit[0].id,
          need: g.pointsNeed,
          cash: g.cash,
          cat: g.cat,
          desc: g.desc,
          img: g.img
        }
      )
    } else {
      try {
        await query(
          `INSERT INTO cross_goods
            (merchant_id, name, sku_code, points_need, cash_price, category, desc_text,
             image_url, stock, on_sale, data_source, created_by_type, created_by_name)
           VALUES
            (:mid, :name, :sku, :need, :cash, :cat, :desc,
             :img, 999, 1, 'presentation', 'script', '呈现演示')`,
          {
            mid: merchantId,
            name: g.name,
            sku,
            need: g.pointsNeed,
            cash: g.cash,
            cat: g.cat,
            desc: g.desc,
            img: g.img
          }
        )
      } catch (e) {
        if (e && e.code === 'ER_BAD_FIELD_ERROR') {
          await query(
            `INSERT INTO cross_goods
              (merchant_id, name, sku_code, points_need, cash_price, desc_text, image_url, stock, on_sale)
             VALUES
              (:mid, :name, :sku, :need, :cash, :desc, :img, 999, 1)`,
            {
              mid: merchantId,
              name: g.name,
              sku,
              need: g.pointsNeed,
              cash: g.cash,
              desc: g.desc,
              img: g.img
            }
          )
        } else throw e
      }
    }
    n += 1
  }
  return n
}

async function upsertSupplyGoods(merchantId, goods) {
  let n = 0
  for (const g of goods) {
    const sku = `PRES-G-${merchantId}-${g.name.slice(0, 8)}`
    const hit = await query(
      `SELECT id FROM supply_goods
       WHERE merchant_id=:mid AND name=:name AND deleted_at IS NULL LIMIT 1`,
      { mid: merchantId, name: g.name }
    )
    if (hit.length) {
      await query(
        `UPDATE supply_goods
         SET price=:price, points_grant=:pts, category=:cat, image_url=:img, stock=500, status=1,
             data_source='presentation', created_by_type='script', created_by_name='呈现演示'
         WHERE id=:id`,
        {
          id: hit[0].id,
          price: g.price,
          pts: g.pts,
          cat: g.cat,
          img: g.img
        }
      )
    } else {
      try {
        await query(
          `INSERT INTO supply_goods
            (merchant_id, name, sku_code, category, price, stock, points_grant, image_url, status,
             data_source, created_by_type, created_by_name)
           VALUES
            (:mid, :name, :sku, :cat, :price, 500, :pts, :img, 1,
             'presentation', 'script', '呈现演示')`,
          {
            mid: merchantId,
            name: g.name,
            sku,
            cat: g.cat,
            price: g.price,
            pts: g.pts,
            img: g.img
          }
        )
      } catch (e) {
        if (e && e.code === 'ER_BAD_FIELD_ERROR') {
          await query(
            `INSERT INTO supply_goods
              (merchant_id, name, sku_code, category, price, stock, points_grant, image_url, status)
             VALUES
              (:mid, :name, :sku, :cat, :price, 500, :pts, :img, 1)`,
            {
              mid: merchantId,
              name: g.name,
              sku,
              cat: g.cat,
              price: g.price,
              pts: g.pts,
              img: g.img
            }
          )
        } else throw e
      }
    }
    n += 1
  }
  return n
}

async function pruneOrphanPresentationGoods(merchantId, role, keepNames) {
  const table = role === 'stall' ? 'stall_goods' : role === 'cross' ? 'cross_goods' : 'supply_goods'
  const saleCol = role === 'supply' ? 'status' : 'on_sale'
  const names = (keepNames || []).map((n) => String(n || '').trim()).filter(Boolean)
  if (!names.length) return 0
  const ph = names.map((_, i) => `:n${i}`).join(',')
  const params = { mid: merchantId }
  names.forEach((n, i) => {
    params[`n${i}`] = n
  })
  try {
    const r = await query(
      `UPDATE ${table}
       SET ${saleCol}=0, deleted_at=NOW()
       WHERE merchant_id=:mid AND deleted_at IS NULL
         AND IFNULL(data_source,'manual')='presentation'
         AND name NOT IN (${ph})`,
      params
    )
    return Number(r.affectedRows) || 0
  } catch (e) {
    if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
    const r = await query(
      `UPDATE ${table}
       SET ${saleCol}=0, deleted_at=NOW()
       WHERE merchant_id=:mid AND deleted_at IS NULL
         AND (sku_code LIKE 'PRES-%')
         AND name NOT IN (${ph})`,
      params
    )
    return Number(r.affectedRows) || 0
  }
}

async function seedPresentationCatalog({ confirm, enableRelax = true } = {}) {
  if (confirm !== 'SEED_PRESENTATION') {
    throw new HttpError(400, '播种呈现数据请传 confirm=SEED_PRESENTATION')
  }
  if (enableRelax) {
    await setConfig(CONFIG_KEY, '1', '呈现模式：C端列表不卡二级商户进件（可一键改回）')
  }
  let merchants = 0
  let goods = 0
  let pruned = 0
  for (const seed of DEMO_MERCHANTS) {
    const mid = await upsertMerchant(seed)
    merchants += 1
    if (seed.role === 'stall') goods += await upsertStallGoods(mid, seed.goods)
    else if (seed.role === 'cross') goods += await upsertCrossGoods(mid, seed.goods)
    else goods += await upsertSupplyGoods(mid, seed.goods)
    pruned += await pruneOrphanPresentationGoods(
      mid,
      seed.role,
      (seed.goods || []).map((g) => g.name)
    )
  }
  await setConfig('home_presentation_seeded', '1', '呈现演示目录已写入')
  await setConfig(CATALOG_VERSION_KEY, CATALOG_VERSION, '呈现演示目录版本')
  return {
    ...(await getStatus()),
    catalogVersion: CATALOG_VERSION,
    seededMerchants: merchants,
    seededGoods: goods,
    prunedOrphans: pruned
  }
}

async function purgePresentationCatalog({ confirm } = {}) {
  if (confirm !== 'PURGE_PRESENTATION') {
    throw new HttpError(400, '清除呈现数据请传 confirm=PURGE_PRESENTATION')
  }
  const mids = await query(
    `SELECT id FROM merchants WHERE merchant_no LIKE :p`,
    { p: `${MERCHANT_NO_PREFIX}%` }
  )
  const ids = mids.map((r) => Number(r.id)).filter(Boolean)
  let goodsAffected = 0
  if (ids.length) {
    const ph = ids.map((_, i) => `:id${i}`).join(',')
    const params = {}
    ids.forEach((id, i) => {
      params[`id${i}`] = id
    })
    for (const [table, saleCol] of [
      ['stall_goods', 'on_sale'],
      ['cross_goods', 'on_sale'],
      ['supply_goods', 'status']
    ]) {
      try {
        const r = await query(
          `UPDATE ${table}
           SET ${saleCol}=0, deleted_at=NOW()
           WHERE deleted_at IS NULL
             AND (
               merchant_id IN (${ph})
               OR IFNULL(data_source,'manual')='presentation'
               OR sku_code LIKE 'PRES-%'
             )`,
          params
        )
        goodsAffected += Number(r.affectedRows) || 0
      } catch (e) {
        if (!(e && e.code === 'ER_BAD_FIELD_ERROR')) throw e
        const r = await query(
          `UPDATE ${table}
           SET ${saleCol}=0, deleted_at=NOW()
           WHERE deleted_at IS NULL
             AND (merchant_id IN (${ph}) OR sku_code LIKE 'PRES-%')`,
          params
        )
        goodsAffected += Number(r.affectedRows) || 0
      }
    }
    await query(
      `UPDATE merchants SET status=2, deleted_at=NOW()
       WHERE merchant_no LIKE :p AND deleted_at IS NULL`,
      { p: `${MERCHANT_NO_PREFIX}%` }
    )
  } else {
    for (const [table, saleCol] of [
      ['stall_goods', 'on_sale'],
      ['cross_goods', 'on_sale'],
      ['supply_goods', 'status']
    ]) {
      try {
        const r = await query(
          `UPDATE ${table}
           SET ${saleCol}=0, deleted_at=NOW()
           WHERE deleted_at IS NULL
             AND (IFNULL(data_source,'manual')='presentation' OR sku_code LIKE 'PRES-%')`
        )
        goodsAffected += Number(r.affectedRows) || 0
      } catch (_) {}
    }
  }
  await setConfig('home_presentation_seeded', '0', '呈现演示目录已清除')
  return {
    ...(await getStatus()),
    purgedMerchants: ids.length,
    purgedGoods: goodsAffected
  }
}

/** 启动时幂等：确保呈现模式开启 + 演示目录为最新版本（不覆盖正式数据） */
async function ensurePresentationBootstrap() {
  const enabled = await isPresentationRelaxEnabled()
  if (enabled) {
    const v = await getConfig(CONFIG_KEY)
    if (v == null) await setConfig(CONFIG_KEY, '1', '呈现模式默认开启（可一键改回）')
  }
  const ver = await getConfig(CATALOG_VERSION_KEY)
  const count = await countPresentationMerchants()
  if (ver === CATALOG_VERSION && count > 0) {
    return { skipped: true, reason: 'catalog_up_to_date', count, catalogVersion: ver }
  }
  // 版本变化或尚未播种：刷新店名/封面/菜品图（upsert + 清理旧菜名）
  return seedPresentationCatalog({ confirm: 'SEED_PRESENTATION', enableRelax: true })
}

module.exports = {
  CONFIG_KEY,
  CATALOG_VERSION,
  DEMO_MERCHANTS,
  isPresentationRelaxEnabled,
  setPresentationRelax,
  getStatus,
  seedPresentationCatalog,
  purgePresentationCatalog,
  ensurePresentationBootstrap
}

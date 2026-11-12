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
  stallNight: `${MP_STATIC}/809fc9e17ef933b6.webp`
}

const CONFIG_KEY = 'home_presentation_relax'
const MERCHANT_NO_PREFIX = 'PRES_'
const INVITE_PREFIX = 'PRES'

/** 演示门店清单：类型不重复，坐标落在已开通深圳商场附近 */
const DEMO_MERCHANTS = [
  {
    merchantNo: 'PRES_STALL_01',
    invite: 'PRES01',
    role: 'stall',
    name: '海岸城石锅拌饭',
    bizType: '餐饮',
    city: '深圳·南山',
    address: '海岸城负一楼美食区 B1-18',
    lat: 22.5172,
    lng: 113.9345,
    cover: IMG.noodles,
    hue: '#C45A2A',
    goods: [
      { name: '牛肉石锅拌饭', price: 28, pts: 28, usable: 10, cat: '主食', desc: '韩式辣酱 · 配蛋', img: IMG.noodles },
      { name: '芝士芝士蛋包饭', price: 26, pts: 26, usable: 8, cat: '主食', desc: '双层芝士', img: IMG.noodles },
      { name: '韩式泡菜汤', price: 12, pts: 12, usable: 4, cat: '汤', desc: '酸辣开胃', img: IMG.malatang },
      { name: '冰美式', price: 9, pts: 9, usable: 3, cat: '饮品', desc: '中杯', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_STALL_02',
    invite: 'PRES02',
    role: 'stall',
    name: '万象城手工水饺',
    bizType: '餐饮',
    city: '深圳·罗湖',
    address: '万象城 B1 美食广场',
    lat: 22.5398,
    lng: 114.1112,
    cover: IMG.noodles,
    hue: '#B86A1C',
    goods: [
      { name: '猪肉白菜饺（12只）', price: 18, pts: 18, usable: 6, cat: '主食', desc: '现包现煮', img: IMG.noodles },
      { name: '牛肉香菜饺（12只）', price: 22, pts: 22, usable: 8, cat: '主食', desc: '偏咸鲜', img: IMG.noodles },
      { name: '酸汤水饺', price: 20, pts: 20, usable: 6, cat: '主食', desc: '番茄酸汤', img: IMG.noodles },
      { name: '紫菜蛋花汤', price: 6, pts: 6, usable: 2, cat: '汤', desc: '可续', img: IMG.tofu }
    ]
  },
  {
    merchantNo: 'PRES_STALL_03',
    invite: 'PRES03',
    role: 'stall',
    name: '壹方城重庆小面',
    bizType: '餐饮',
    city: '深圳·宝安',
    address: '壹方城 B2 小吃街',
    lat: 22.5601,
    lng: 113.8872,
    cover: IMG.noodles,
    hue: '#D4532B',
    goods: [
      { name: '红油抄手', price: 16, pts: 16, usable: 5, cat: '主食', desc: '微辣/中辣', img: IMG.noodles },
      { name: '豌杂小面', price: 15, pts: 15, usable: 5, cat: '主食', desc: '豌豆肉臊', img: IMG.noodles },
      { name: '牛肉小面', price: 18, pts: 18, usable: 6, cat: '主食', desc: '宽汤', img: IMG.noodles },
      { name: '冰粉', price: 8, pts: 8, usable: 2, cat: '小吃', desc: '红糖冰粉', img: IMG.fruit }
    ]
  },
  {
    merchantNo: 'PRES_STALL_04',
    invite: 'PRES04',
    role: 'stall',
    name: '大悦城现炒牛河',
    bizType: '餐饮',
    city: '深圳·龙华',
    address: '大悦城 L1 餐饮走廊',
    lat: 22.6575,
    lng: 114.0368,
    cover: IMG.noodles,
    hue: '#E08A1E',
    goods: [
      { name: '干炒牛河', price: 24, pts: 24, usable: 8, cat: '主食', desc: '镬气足', img: IMG.noodles },
      { name: '滑蛋牛肉饭', price: 22, pts: 22, usable: 7, cat: '主食', desc: '配时蔬', img: IMG.noodles },
      { name: '姜葱炒时蔬', price: 12, pts: 12, usable: 3, cat: '小菜', desc: '时令蔬菜', img: IMG.fruit },
      { name: '冻柠茶', price: 8, pts: 8, usable: 2, cat: '饮品', desc: '大杯', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_STALL_05',
    invite: 'PRES05',
    role: 'stall',
    name: '星河COCO章鱼小丸子',
    bizType: '餐饮',
    city: '深圳·龙岗',
    address: '星河 COCO Park 一层外摆',
    lat: 22.7204,
    lng: 114.2471,
    cover: IMG.bbq,
    hue: '#E24E12',
    goods: [
      { name: '原味章鱼小丸子', price: 15, pts: 15, usable: 5, cat: '小吃', desc: '8粒', img: IMG.bbq },
      { name: '芝士章鱼小丸子', price: 18, pts: 18, usable: 6, cat: '小吃', desc: '拉丝芝士', img: IMG.bbq },
      { name: '烤肠串', price: 6, pts: 6, usable: 2, cat: '小吃', desc: '一根', img: IMG.bbq },
      { name: '可乐', price: 5, pts: 5, usable: 1, cat: '饮品', desc: '听装', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_STALL_06',
    invite: 'PRES06',
    role: 'stall',
    name: '前海夜市烤生蚝',
    bizType: '餐饮',
    city: '深圳·宝安',
    address: '前海合作区夜市 C06',
    lat: 22.5268,
    lng: 113.8915,
    cover: IMG.bbq,
    hue: '#A33B1F',
    goods: [
      { name: '蒜蓉烤生蚝', price: 12, pts: 12, usable: 4, cat: '烧烤', desc: '一只', img: IMG.bbq },
      { name: '烤鱿鱼须', price: 18, pts: 18, usable: 6, cat: '烧烤', desc: '一份', img: IMG.bbq },
      { name: '烤茄子', price: 14, pts: 14, usable: 4, cat: '烧烤', desc: '蒜香', img: IMG.bbq },
      { name: '扎啤', price: 10, pts: 10, usable: 3, cat: '酒水', desc: '500ml', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_STALL_07',
    invite: 'PRES07',
    role: 'stall',
    name: '东门步行街酸辣粉',
    bizType: '餐饮',
    city: '深圳·罗湖',
    address: '东门步行街美食城 2 楼',
    lat: 22.5456,
    lng: 114.1208,
    cover: IMG.malatang,
    hue: '#C23B22',
    goods: [
      { name: '招牌酸辣粉', price: 14, pts: 14, usable: 5, cat: '主食', desc: '红薯粉', img: IMG.malatang },
      { name: '肥肠酸辣粉', price: 19, pts: 19, usable: 6, cat: '主食', desc: '加肥肠', img: IMG.malatang },
      { name: '凉皮', price: 12, pts: 12, usable: 4, cat: '小吃', desc: '芝麻酱', img: IMG.tofu },
      { name: '豆浆', price: 4, pts: 4, usable: 1, cat: '饮品', desc: '热/冰', img: IMG.jianbing }
    ]
  },
  {
    merchantNo: 'PRES_STALL_08',
    invite: 'PRES08',
    role: 'stall',
    name: '深圳湾轻食沙拉',
    bizType: '餐饮',
    city: '深圳·南山',
    address: '深圳湾万象城 L2',
    lat: 22.4856,
    lng: 113.9452,
    cover: IMG.fruit,
    hue: '#2F8F6B',
    goods: [
      { name: '鸡胸谷物碗', price: 32, pts: 32, usable: 12, cat: '轻食', desc: '低脂', img: IMG.fruit },
      { name: '牛油果虾仁沙拉', price: 36, pts: 36, usable: 12, cat: '轻食', desc: '油醋汁', img: IMG.fruit },
      { name: '鲜榨橙汁', price: 16, pts: 16, usable: 5, cat: '饮品', desc: '现榨', img: IMG.fruit },
      { name: '希腊酸奶杯', price: 18, pts: 18, usable: 6, cat: '小吃', desc: '配坚果', img: IMG.cake }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_01',
    invite: 'PRES21',
    role: 'cross',
    name: '海岸城花艺馆',
    bizType: '鲜花',
    city: '深圳·南山',
    address: '海岸城 L3-12',
    lat: 22.5181,
    lng: 113.9358,
    cover: IMG.flower,
    hue: '#3D8B4A',
    goods: [
      { name: '日常鲜花束', pointsNeed: 800, cash: 68, cat: '鲜花', desc: '当季混搭', img: IMG.flower },
      { name: '红玫瑰 11 支', pointsNeed: 1200, cash: 98, cat: '鲜花', desc: '含包装', img: IMG.flower },
      { name: '绿植小盆栽', pointsNeed: 500, cash: 45, cat: '绿植', desc: '易养活', img: IMG.flower }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_02',
    invite: 'PRES22',
    role: 'cross',
    name: '万象城烘焙工坊',
    bizType: '蛋糕',
    city: '深圳·罗湖',
    address: '万象城 L1 甜品区',
    lat: 22.5405,
    lng: 114.112,
    cover: IMG.cake,
    hue: '#C9A227',
    goods: [
      { name: '招牌芝士蛋糕（切角）', pointsNeed: 420, cash: 38, cat: '蛋糕', desc: '冷藏', img: IMG.cake },
      { name: '焦糖布蕾塔', pointsNeed: 360, cash: 32, cat: '甜品', desc: '当日烤', img: IMG.cake },
      { name: '手冲美式', pointsNeed: 180, cash: 16, cat: '饮品', desc: '热/冰', img: IMG.milktea }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_03',
    invite: 'PRES23',
    role: 'cross',
    name: '壹方城鲜切果盘',
    bizType: '百货商店',
    city: '深圳·宝安',
    address: '壹方城 B1 生鲜档',
    lat: 22.5612,
    lng: 113.888,
    cover: IMG.fruit,
    hue: '#3D8B4A',
    goods: [
      { name: '综合果切小份', pointsNeed: 280, cash: 25, cat: '果切', desc: '西瓜/蜜瓜', img: IMG.fruit },
      { name: '芒果盒', pointsNeed: 320, cash: 28, cat: '果切', desc: '当季芒果', img: IMG.fruit },
      { name: '椰子水', pointsNeed: 150, cash: 12, cat: '饮品', desc: '冷藏', img: IMG.fruit }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_04',
    invite: 'PRES24',
    role: 'cross',
    name: '大悦城邻里便利',
    bizType: '百货商店',
    city: '深圳·龙华',
    address: '大悦城 B1-06',
    lat: 22.6582,
    lng: 114.0375,
    cover: IMG.supermarket,
    hue: '#2E6B8A',
    goods: [
      { name: '日用品兑换券 50 元', pointsNeed: 5000, cash: 50, cat: '券', desc: '店内核销', img: IMG.supermarket },
      { name: '进口零食礼盒', pointsNeed: 2800, cash: 68, cat: '零食', desc: '混合装', img: IMG.supermarket },
      { name: '瓶装水 12 件', pointsNeed: 900, cash: 22, cat: '饮品', desc: '整提', img: IMG.supermarket }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_05',
    invite: 'PRES25',
    role: 'cross',
    name: '福田中心洗车养车',
    bizType: '百货商店',
    city: '深圳·福田',
    address: '福田中心二路停车场旁',
    lat: 22.5412,
    lng: 114.0578,
    cover: IMG.carwash,
    hue: '#3A6EA5',
    goods: [
      { name: '标准洗车一次', pointsNeed: 1500, cash: 35, cat: '洗车', desc: '轿车', img: IMG.carwash },
      { name: '精洗内饰', pointsNeed: 3200, cash: 88, cat: '洗车', desc: '约 40 分钟', img: IMG.carwash },
      { name: '打蜡护理', pointsNeed: 4800, cash: 128, cat: '养护', desc: '轿车', img: IMG.carwash }
    ]
  },
  {
    merchantNo: 'PRES_CROSS_06',
    invite: 'PRES26',
    role: 'cross',
    name: '南山手作茶馆',
    bizType: '餐饮',
    city: '深圳·南山',
    address: '海岸城 L2 茶饮区',
    lat: 22.5178,
    lng: 113.9362,
    cover: IMG.milktea,
    hue: '#C45A2A',
    goods: [
      { name: '桂花乌龙', pointsNeed: 220, cash: 18, cat: '茶饮', desc: '少糖可调', img: IMG.milktea },
      { name: '杨枝甘露', pointsNeed: 260, cash: 22, cat: '茶饮', desc: '芒果椰奶', img: IMG.milktea },
      { name: '烤奶布丁', pointsNeed: 180, cash: 15, cat: '甜品', desc: '杯装', img: IMG.cake }
    ]
  },
  {
    merchantNo: 'PRES_SUPPLY_01',
    invite: 'PRES31',
    role: 'supply',
    name: '龙华冻品集配仓',
    bizType: '百货商店',
    city: '深圳·龙华',
    address: '龙华物流园 3 号冷库',
    lat: 22.661,
    lng: 114.028,
    cover: IMG.warehouse,
    hue: '#3A6EA5',
    goods: [
      { name: '冷冻鸡翅中（10kg）', price: 268, pts: 80, cat: '冻品', desc: 'B2B 箱装', img: IMG.warehouse },
      { name: '速冻水饺（5kg）', price: 98, pts: 30, cat: '冻品', desc: '猪肉白菜', img: IMG.warehouse },
      { name: '冷冻薯条（10kg）', price: 128, pts: 40, cat: '冻品', desc: '餐饮装', img: IMG.warehouse }
    ]
  },
  {
    merchantNo: 'PRES_SUPPLY_02',
    invite: 'PRES32',
    role: 'supply',
    name: '宝安粮油调味仓',
    bizType: '百货商店',
    city: '深圳·宝安',
    address: '宝安西乡工业区 8 栋',
    lat: 22.568,
    lng: 113.875,
    cover: IMG.warehouse,
    hue: '#3E7A3A',
    goods: [
      { name: '花生油 20L', price: 218, pts: 60, cat: '粮油', desc: '餐饮装', img: IMG.warehouse },
      { name: '生抽 15kg', price: 86, pts: 25, cat: '调味', desc: '桶装', img: IMG.warehouse },
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

async function seedPresentationCatalog({ confirm, enableRelax = true } = {}) {
  if (confirm !== 'SEED_PRESENTATION') {
    throw new HttpError(400, '播种呈现数据请传 confirm=SEED_PRESENTATION')
  }
  if (enableRelax) {
    await setConfig(CONFIG_KEY, '1', '呈现模式：C端列表不卡二级商户进件（可一键改回）')
  }
  let merchants = 0
  let goods = 0
  for (const seed of DEMO_MERCHANTS) {
    const mid = await upsertMerchant(seed)
    merchants += 1
    if (seed.role === 'stall') goods += await upsertStallGoods(mid, seed.goods)
    else if (seed.role === 'cross') goods += await upsertCrossGoods(mid, seed.goods)
    else goods += await upsertSupplyGoods(mid, seed.goods)
  }
  await setConfig('home_presentation_seeded', '1', '呈现演示目录已写入')
  return {
    ...(await getStatus()),
    seededMerchants: merchants,
    seededGoods: goods
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

/** 启动时幂等：确保呈现模式开启 + 演示目录存在（不覆盖正式数据） */
async function ensurePresentationBootstrap() {
  const enabled = await isPresentationRelaxEnabled()
  if (enabled) {
    const v = await getConfig(CONFIG_KEY)
    if (v == null) await setConfig(CONFIG_KEY, '1', '呈现模式默认开启（可一键改回）')
  }
  const seeded = await getConfig('home_presentation_seeded')
  const count = await countPresentationMerchants()
  if (seeded === '1' && count > 0) return { skipped: true, reason: 'already_seeded', count }
  if (count > 0) {
    await setConfig('home_presentation_seeded', '1', '检测到呈现演示门店')
    return { skipped: true, reason: 'merchants_exist', count }
  }
  return seedPresentationCatalog({ confirm: 'SEED_PRESENTATION', enableRelax: true })
}

module.exports = {
  CONFIG_KEY,
  DEMO_MERCHANTS,
  isPresentationRelaxEnabled,
  setPresentationRelax,
  getStatus,
  seedPresentationCatalog,
  purgePresentationCatalog,
  ensurePresentationBootstrap
}

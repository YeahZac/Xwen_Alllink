/**
 * 履约演示数据：物流轨迹 / 待确认收货 / 客服
 * 本地可读写确认状态；后续可替换为真实 API。
 */
const CONFIRMED_KEY = 'wy_receipt_confirmed'

function pad(n) {
  return n < 10 ? `0${n}` : String(n)
}

function formatTime(d) {
  const x = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(x.getTime())) return ''
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000)
}

function getConfirmedMap() {
  try {
    return wx.getStorageSync(CONFIRMED_KEY) || {}
  } catch (_) {
    return {}
  }
}

function markConfirmed(orderNo) {
  const map = getConfirmedMap()
  map[String(orderNo)] = Date.now()
  try {
    wx.setStorageSync(CONFIRMED_KEY, map)
  } catch (_) {}
  return map
}

function isConfirmed(orderNo) {
  const map = getConfirmedMap()
  return !!map[String(orderNo)]
}

/** 演示物流单（餐饮 / 鲜花 / 蛋糕 / 百货） */
const SHIPMENTS = [
  {
    orderNo: 'PO20261023001',
    type: 'purchase',
    title: '餐饮食材箱配送',
    sellerName: '精选超市供货仓',
    buyerName: '味满分餐厅',
    status: 'transit',
    statusText: '运输中',
    courier: '顺丰速运',
    courierPhone: '95338',
    trackingNo: 'SF3148291765032',
    fromAddress: '深圳市宝安区福永街道物流园 A3',
    toAddress: '深圳市罗湖区万象城餐饮区',
    receiver: '张经理',
    receiverPhone: '138****2018',
    goods: [
      { name: '餐饮食材箱', qty: '3箱', sku: 'SP-FOOD-01' },
      { name: '餐具耗材包', qty: '2箱', sku: 'SP-BOX-02' }
    ],
    amount: 486.0,
    shippedAt: formatTime(hoursAgo(18)),
    etaText: '预计今日 18:00 前送达',
    traces: [
      { time: formatTime(hoursAgo(1.2)), loc: '深圳罗湖', text: '快件已到达【罗湖万象城服务点】，派送中', active: true },
      { time: formatTime(hoursAgo(4)), loc: '深圳转运中心', text: '快件已发往【罗湖万象城服务点】' },
      { time: formatTime(hoursAgo(9)), loc: '深圳转运中心', text: '快件已到达【深圳转运中心】' },
      { time: formatTime(hoursAgo(14)), loc: '宝安福永', text: '快件已从【宝安福永营业点】发出' },
      { time: formatTime(hoursAgo(18)), loc: '宝安福永', text: '商家已交运，运单号 SF3148291765032' }
    ]
  },
  {
    orderNo: 'PO20261022008',
    type: 'purchase',
    title: '鲜花鲜切花批发',
    sellerName: '花漾坊供货',
    buyerName: '花事馆',
    status: 'delivering',
    statusText: '派送中',
    courier: '京东物流',
    courierPhone: '950616',
    trackingNo: 'JDVB1289037456',
    fromAddress: '深圳市龙岗区花卉物流园 12 号',
    toAddress: '深圳市福田区中心城花艺区',
    receiver: '小美',
    receiverPhone: '139****6621',
    goods: [
      { name: '鲜切花批发', qty: '20束', sku: 'SP-FL-20' },
      { name: '包装纸套装', qty: '5包', sku: 'SP-WRAP-5' }
    ],
    amount: 268.5,
    shippedAt: formatTime(hoursAgo(30)),
    etaText: '预计 1 小时内送达',
    traces: [
      { time: formatTime(hoursAgo(0.5)), loc: '深圳福田', text: '快递员正在派送，请保持电话畅通', active: true },
      { time: formatTime(hoursAgo(3)), loc: '深圳福田营业部', text: '快件已到达【福田花艺驿站】' },
      { time: formatTime(hoursAgo(12)), loc: '深圳龙岗', text: '快件运输中' },
      { time: formatTime(hoursAgo(30)), loc: '龙岗花卉园', text: '商家已发货' }
    ]
  },
  {
    orderNo: 'PO20261020015',
    type: 'purchase',
    title: '烘焙原料到货',
    sellerName: '云朵烘焙仓',
    buyerName: '甜森蛋糕',
    status: 'pending_receipt',
    statusText: '待确认收货',
    courier: '德邦快递',
    courierPhone: '95353',
    trackingNo: 'DPK8820193341',
    fromAddress: '深圳市南山区西丽街道物流大道 6 号',
    toAddress: '深圳市南山区海岸城烘焙区',
    receiver: '阿甜',
    receiverPhone: '136****9088',
    goods: [
      { name: '烘焙原料箱', qty: '4箱', sku: 'SP-CAKE-04' },
      { name: '蛋糕盒耗材', qty: '2箱', sku: 'SP-BOX-CK' }
    ],
    amount: 392.0,
    shippedAt: formatTime(hoursAgo(52)),
    etaText: '已签收待确认',
    traces: [
      { time: formatTime(hoursAgo(6)), loc: '深圳南山', text: '您的快件已签收，感谢使用德邦快递', active: true },
      { time: formatTime(hoursAgo(8)), loc: '深圳南山', text: '派送完成，待买家确认收货' },
      { time: formatTime(hoursAgo(20)), loc: '深圳南山营业部', text: '快件到达目的地网点' },
      { time: formatTime(hoursAgo(52)), loc: '南山西丽', text: '商家已发货' }
    ]
  }
]

function listShipments() {
  return SHIPMENTS.map((s) => {
    const confirmed = isConfirmed(s.orderNo)
    let status = s.status
    let statusText = s.statusText
    if (confirmed) {
      status = 'confirmed'
      statusText = '已确认收货'
    }
    return {
      ...s,
      status,
      statusText,
      confirmed,
      canConfirm: !confirmed && (s.status === 'pending_receipt' || s.status === 'delivering' || s.status === 'transit'),
      canTrack: true
    }
  })
}

function getShipment(orderNo) {
  const list = listShipments()
  const hit = list.find((s) => String(s.orderNo) === String(orderNo))
  if (hit) return hit
  // 兜底：任意单号也返回一份演示轨迹，便于从真实订单跳入
  const base = list[0]
  return {
    ...base,
    orderNo: String(orderNo || base.orderNo),
    title: `物流详情 · ${orderNo || base.orderNo}`,
    statusText: isConfirmed(orderNo) ? '已确认收货' : base.statusText,
    confirmed: isConfirmed(orderNo),
    canConfirm: !isConfirmed(orderNo)
  }
}

function listPendingReceipt() {
  return listShipments().filter((s) => s.canConfirm)
}

const SERVICE = {
  hotline: '400-882-0918',
  workTime: '每天 09:00–22:00',
  wechatCs: '万业互联云客服',
  tip: '优先通过在线客服；紧急履约问题可拨打热线。以下为演示数据。',
  channels: [
    { id: 'online', title: '在线客服', sub: '小程序会话 · 平均 2 分钟响应', action: 'contact', seal: '在', tone: 'red' },
    { id: 'phone', title: '客服热线', sub: '400-882-0918 · 09:00–22:00', action: 'phone', seal: '电', tone: 'teal' },
    { id: 'logistics', title: '查物流 / 确认收货', sub: '查看演示运单与签收', action: 'logistics', seal: '运', tone: 'gold' },
    { id: 'orders', title: '我的订单', sub: '点餐与兑换记录', action: 'orders', seal: '单', tone: 'soft' }
  ],
  faqs: [
    {
      q: '采购的货多久能到？',
      a: '线上物流一般 24–48 小时内送达深圳市内商场门店；可在「物流详情」查看实时轨迹。'
    },
    {
      q: '如何确认收货？',
      a: '货物签收后进入「确认收货」页核对品名与数量，确认后货款才会最终结算给供货商。'
    },
    {
      q: '积分什么时候到账？',
      a: '餐饮等门店点餐完成后划拨；供货采购在成交或确认收货规则下入额度池（以当前业务规则为准）。'
    },
    {
      q: '投诉多久处理？',
      a: '工作时间内一般 2 小时内首次响应，复杂纠纷 1–3 个工作日闭环。'
    }
  ]
}

module.exports = {
  listShipments,
  getShipment,
  listPendingReceipt,
  markConfirmed,
  isConfirmed,
  SERVICE,
  formatTime
}

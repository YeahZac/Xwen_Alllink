/** Banner：优先云端实景；本地仅留加载占位。 */
const cdn = require('./cdn')

const PACK = {
  consumer: [
    {
      title: '夜市扫码点餐',
      sub: '就近下单 · 积分马上到账',
      image: cdn.bannerUrl('consumer-scan.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/pages/index/index',
      linkType: 'switchTab'
    },
    {
      title: '积分兑鲜花蛋糕',
      sub: '100积分=1元 · 不够可补现金',
      image: cdn.bannerUrl('consumer-points.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/pages/cross/cross',
      linkType: 'switchTab'
    },
    {
      title: '附近夜市好店',
      sub: '炒面烤串麻辣烫都有',
      image: cdn.bannerUrl('consumer-market.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/pages/index/index',
      linkType: 'switchTab'
    }
  ],
  stall: [
    {
      title: '地摊数字化',
      sub: '扫码点餐 · 积分划拨',
      image: cdn.bannerUrl('stall-purchase.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/merchant/purchase/purchase',
      linkType: 'navigate'
    },
    {
      title: '门店采购获额度',
      sub: '向供货商进货 · 划拨给顾客',
      image: cdn.bannerUrl('consumer-scan.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/merchant/purchase/purchase',
      linkType: 'navigate'
    }
  ],
  cross: [
    {
      title: '承接积分客',
      sub: '餐饮鲜花蛋糕百货可兑',
      image: cdn.bannerUrl('cross-redeem.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/merchant/goods/goods',
      linkType: 'navigate'
    },
    {
      title: '门店数字化',
      sub: '积分核销 · 现金价双轨',
      image: cdn.bannerUrl('consumer-points.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/merchant/orders/orders',
      linkType: 'navigate'
    }
  ],
  supply: [
    {
      title: '供货本地门店',
      sub: '餐饮 · 鲜花 · 蛋糕 · 百货',
      image: cdn.bannerUrl('supply-warehouse.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/merchant/customers/customers',
      linkType: 'navigate'
    },
    {
      title: '需求大厅',
      sub: '接单报价 · 发货履约',
      image: cdn.bannerUrl('supply-warehouse.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/merchant/needs/needs',
      linkType: 'navigate'
    }
  ],
  login: [
    {
      title: '商户入驻',
      sub: '点餐门店 / 兑换门店 / 供货商',
      image: cdn.bannerUrl('login-join.jpg'),
      placeholder: cdn.PLACEHOLDER_BANNER,
      link: '/pages/apply/apply',
      linkType: 'navigate'
    }
  ]
}

const BAD_REMOTE =
  /7072-prod-.*\/admin\/banner\/|placehold|picsum|unsplash|dummyimage|via\.placeholder/i

function isMissingImage(image) {
  const s = String(image || '').trim()
  if (!s) return true
  if (s.indexOf('/assets/placeholders/') === 0) return false
  if (cdn.isOurCdn(s)) return false
  if (s.indexOf('/uploads/') === 0) return false
  if (/^cloud:\/\//i.test(s)) return false
  if (BAD_REMOTE.test(s)) return true
  if (/(consumer|stall|cross|supply|login)-[123]\.png$/i.test(s)) return true
  if (/\/assets\/banners\//i.test(s)) return true
  if (/^https?:\/\//i.test(s)) return true
  return false
}

function packFor(role) {
  return PACK[role] || PACK.consumer
}

function mergeBanners(role, rows) {
  const pack = packFor(role)
  const list = Array.isArray(rows) && rows.length ? rows : pack
  return list.map((item, i) => {
    const fallback = pack[i % pack.length]
    const image = isMissingImage(item.image) ? fallback.image : item.image
    return {
      id: item.id || `local-${role}-${i}`,
      title: item.title || fallback.title,
      sub: item.sub || fallback.sub,
      image,
      placeholder: fallback.placeholder || cdn.PLACEHOLDER_BANNER,
      link: item.link != null && item.link !== undefined ? item.link : fallback.link,
      linkType: item.linkType || fallback.linkType,
      imgError: !String(image || '').trim()
    }
  })
}

module.exports = { mergeBanners, packFor }

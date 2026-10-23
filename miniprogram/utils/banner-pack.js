/** 运营未配图时的线上宣传图。主包不再打包这些大图。 */
const HOST = 'https://7072-prod-d3g1vkrj3290d085e-1467541248.tcb.qcloud.la/admin/banner/20260918'
const PACK = {
  consumer: [
    {
      title: '商场好店上新',
      sub: '餐饮 · 鲜花 · 蛋糕 · 百货',
      image: HOST + '/8e81329f825d6afd.webp',
      link: '',
      linkType: 'none'
    },
    {
      title: '积分兑鲜花蛋糕',
      sub: '100积分=1元 · 不够可补现金',
      image: HOST + '/e71d33452d517e39.webp',
      link: '/pages/cross/cross',
      linkType: 'switchTab'
    },
    {
      title: '附近餐饮百货',
      sub: '鲜花蛋糕也能兑',
      image: HOST + '/ee3b164869f21c57.webp',
      link: '/pages/index/index',
      linkType: 'switchTab'
    }
  ],
  stall: [
    {
      title: '门店采购获额度',
      sub: '向供货商进货 · 划拨给顾客',
      image: HOST + '/1ef8e0176023fed0.webp',
      link: '/merchant/purchase/purchase',
      linkType: 'navigate'
    }
  ],
  cross: [
    {
      title: '承接积分客',
      sub: '餐饮鲜花蛋糕百货可兑',
      image: HOST + '/2b04f7adc3fccb07.webp',
      link: '/merchant/goods/goods',
      linkType: 'navigate'
    }
  ],
  supply: [
    {
      title: '供货本地门店',
      sub: '餐饮 · 鲜花 · 蛋糕 · 百货',
      image: HOST + '/4fab0609b9f304b3.webp',
      link: '/merchant/customers/customers',
      linkType: 'navigate'
    }
  ],
  login: [
    {
      title: '商户入驻',
      sub: '点餐门店 / 兑换门店 / 供货商',
      image: HOST + '/7f54551761013628.webp',
      link: '/pages/apply/apply',
      linkType: 'navigate'
    }
  ]
}

const LOCAL = /\/assets\/banners\/|(consumer-[123]|stall-[12]|cross-[12]|supply-[12]|login-[12])\.png$/i

function isMissingImage(image) {
  const s = String(image || '').trim()
  if (!s) return true
  return LOCAL.test(s)
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
      link: item.link != null && item.link !== undefined ? item.link : fallback.link,
      linkType: item.linkType || fallback.linkType,
      imgError: !String(image || '').trim()
    }
  })
}

module.exports = { mergeBanners, packFor }

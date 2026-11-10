const { query } = require('../utils/db')

async function getConfig(key, fallback = null) {
  const rows = await query(
    'SELECT config_value FROM platform_config WHERE config_key = :key LIMIT 1',
    { key }
  )
  if (!rows.length) return fallback
  return rows[0].config_value
}

async function getCashRate() {
  const v = await getConfig('points_cash_rate', '0.01')
  return Number(v) || 0.01
}

function pointsToCash(points, rate) {
  return Math.round(Number(points) * Number(rate) * 10000) / 10000
}

async function listConfigs() {
  return query(
    `SELECT id, config_key AS \`key\`, config_value AS value, remark, updated_at AS updatedAt
     FROM platform_config ORDER BY id`
  )
}

async function setConfig(key, value, remark) {
  const rows = await query('SELECT id FROM platform_config WHERE config_key=:key', { key })
  if (rows.length) {
    await query(
      `UPDATE platform_config SET config_value=:v, remark=IFNULL(:r, remark) WHERE config_key=:key`,
      { key, v: String(value), r: remark || null }
    )
  } else {
    await query(
      `INSERT INTO platform_config (config_key, config_value, remark) VALUES (:key, :v, :r)`,
      { key, v: String(value), r: remark || null }
    )
  }
  return { key, value: String(value) }
}

const DEFAULT_MERCHANT_AGREEMENT = `万业互联云商户入驻服务协议

甲方：万业互联云平台（以下简称「平台」）
乙方（入驻商家）：{{shopName}}
经营者/法人：{{legalPerson}}
联系人：{{contactName}}
联系电话：{{contactPhone}}
经营城市：{{city}}
经营地址：{{address}}
经营类型：{{roleLabel}}
签署日期：{{date}}

一、协议生效与同意方式
1. 乙方通过本平台小程序提交入驻申请，并经平台审核通过后，即视为已阅读、理解并同意本协议全部条款，双方正式建立合作关系。
2. 本协议页眉已根据乙方入驻申请资料自动填充商家信息；入驻成功即构成乙方对本协议的确认与签署，无需另行纸质签章。

二、服务内容
1. 平台为乙方提供门店展示、订单履约、积分额度管理及相关运营工具。
2. 乙方按平台规则使用积分额度池：开店默认获赠额度，平台可继续划拨；也可通过供应链采购补充额度，用于向消费者划拨消费积分。

三、乙方义务
1. 保证提交的证照、身份及经营信息真实、合法、有效，并及时更新。
2. 依法合规经营，对所售商品/服务自行承担责任；服从属地监管要求。
3. 不得利用平台从事违法违规或损害消费者、其他商户及平台权益的行为。

四、费用与结算
双方结算、服务费及提现规则以平台公示或后台配置为准；欠费可能导致功能受限。

五、信息与隐私
乙方同意平台为履约之必要处理其联系人、门店及交易相关信息，并按《平台隐私政策》保护用户与商家数据。

六、违约与终止
乙方严重违约、提供虚假材料或违反法律法规的，平台有权驳回申请、暂停或终止服务，并保留追责权利。

七、其他
本协议未尽事宜，适用国家法律法规及平台公示规则。因本协议产生的争议，双方协商解决；协商不成的，提交平台所在地有管辖权的人民法院诉讼解决。

（以下无正文）
乙方确认：入驻申请审核通过即同意本协议。`

const MERCHANT_AGREEMENT_KEY = 'merchant_onboarding_agreement'

const ROLE_LABEL_MAP = { stall: '地摊', cross: '异业', supply: '供应链' }

async function getMerchantAgreementTemplate() {
  const v = await getConfig(MERCHANT_AGREEMENT_KEY, DEFAULT_MERCHANT_AGREEMENT)
  return String(v || DEFAULT_MERCHANT_AGREEMENT)
}

function fillMerchantAgreement(template, vars = {}) {
  const role = vars.role || ''
  const map = {
    shopName: vars.shopName || '（入驻时填写的店铺名称）',
    legalPerson: vars.legalPerson || '（经营者/法人）',
    contactName: vars.contactName || '（联系人）',
    contactPhone: vars.contactPhone || '（联系电话）',
    city: vars.city || '（经营城市）',
    address: vars.address || '（经营地址）',
    roleLabel: vars.roleLabel || ROLE_LABEL_MAP[role] || '商户',
    date: vars.date || new Date().toISOString().slice(0, 10)
  }
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    map[k] != null ? String(map[k]) : ''
  )
}

async function getMerchantAgreement(vars = {}) {
  const template = await getMerchantAgreementTemplate()
  const content = fillMerchantAgreement(template, vars)
  return {
    title: '商户入驻平台协议',
    template,
    content,
    placeholders: Object.keys({
      shopName: 1,
      legalPerson: 1,
      contactName: 1,
      contactPhone: 1,
      city: 1,
      address: 1,
      roleLabel: 1,
      date: 1
    })
  }
}

module.exports = {
  getConfig,
  getCashRate,
  pointsToCash,
  listConfigs,
  setConfig,
  DEFAULT_MERCHANT_AGREEMENT,
  MERCHANT_AGREEMENT_KEY,
  getMerchantAgreementTemplate,
  fillMerchantAgreement,
  getMerchantAgreement
}

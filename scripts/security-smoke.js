/**
 * 无 DB 依赖的安全回归冒烟：鉴权开关 / openid 伪造 / 支付模拟闸门
 */
const assert = require('assert')

process.env.NODE_ENV = 'production'
delete process.env.ALLOW_PAY_SIMULATE
delete process.env.ALLOW_INVITE_LOGIN
delete process.env.ALLOW_BODY_OPENID
delete require.cache[require.resolve('../src/config')]
const config = require('../src/config')

assert.strictEqual(config.allowPaySimulate, false, 'prod 默认禁止支付模拟')
assert.strictEqual(config.allowInviteLogin, false, 'prod 默认禁止邀请码登录')
assert.strictEqual(config.allowBodyOpenid, false, 'prod 默认禁止 body openid')

async function main() {
  const authService = require('../src/services/authService')
  let rejected = false
  try {
    await authService.loginWithWeChat({ bodyOpenid: 'attacker_openid_spoof' })
  } catch (e) {
    rejected = /未能获取微信身份|微信/.test(String(e.message || ''))
  }
  assert.ok(rejected, '应拒绝 body openid 伪造登录')

  const orderService = require('../src/services/orderService')
  // 通过内部函数不可直接测 assertPaySimulate；用 create 会撞 DB。
  // 配置闸门已在上方断言。
  console.log('security-smoke ok')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

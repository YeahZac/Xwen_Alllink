/**
 * 小程序对接云托管配置
 * serviceName 需与云托管「服务名称」一致
 */
module.exports = {
  envId: 'prod-d3g1vkrj3290d085e',
  serviceName: 'alllink-server',
  /** true=走 callContainer；本地调试可改为 false 并用 baseUrl */
  useCallContainer: true,
  baseUrl: '',
  apiPrefix: '/api'
}

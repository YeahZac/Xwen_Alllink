const { HttpError, fail } = require('../utils/response')

function notFound(_req, res) {
  res.status(404).json(fail('接口不存在', 404))
}

function errorHandler(err, _req, res, _next) {
  const dropped =
    err &&
    (err.code === 'ECONNRESET' ||
      err.code === 'PROTOCOL_CONNECTION_LOST' ||
      err.code === 'ECONNREFUSED' ||
      /ECONNRESET|PROTOCOL_CONNECTION_LOST/i.test(String(err.message || '')))
  const status = dropped ? 503 : err.status || 500
  const code = typeof err.code === 'number' ? err.code : 1
  const message = dropped ? '数据库连接中断，请稍后重试' : err.message || '服务器错误'
  if (status >= 500) {
    console.error('[API ERROR]', err)
  }
  res.status(status).json(fail(message, code))
}

module.exports = { notFound, errorHandler, HttpError }

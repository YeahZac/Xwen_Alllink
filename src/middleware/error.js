const { HttpError, fail } = require('../utils/response')

function notFound(_req, res) {
  res.status(404).json(fail('接口不存在', 404))
}

function errorHandler(err, _req, res, _next) {
  const status = err.status || 500
  const code = err.code || 1
  const message = err.message || '服务器错误'
  if (status >= 500) {
    console.error('[API ERROR]', err)
  }
  res.status(status).json(fail(message, code))
}

module.exports = { notFound, errorHandler, HttpError }

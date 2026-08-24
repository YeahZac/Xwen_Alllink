function ok(data = null, message = 'ok') {
  return { code: 0, message, data }
}

function fail(message = 'error', code = 1, data = null) {
  return { code, message, data }
}

class HttpError extends Error {
  constructor(status, message, code = 1) {
    super(message)
    this.status = status
    this.code = code
  }
}

module.exports = { ok, fail, HttpError }

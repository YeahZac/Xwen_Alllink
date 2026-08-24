const jwt = require('jsonwebtoken')
const config = require('../config')
const { HttpError } = require('../utils/response')

function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn })
}

function authRequired(req, _res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return next(new HttpError(401, '未登录'))
  try {
    req.auth = jwt.verify(token, config.jwt.secret)
    next()
  } catch (e) {
    next(new HttpError(401, '登录已失效'))
  }
}

function requireRoles(...roles) {
  return (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return next(new HttpError(403, '无权限访问该资源'))
    }
    next()
  }
}

module.exports = { signToken, authRequired, requireRoles }

const { v4: uuidv4 } = require('uuid')

function orderNo(prefix = 'O') {
  const d = new Date()
  const pad = (n, l = 2) => String(n).padStart(l, '0')
  const ts =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${prefix}${ts}${Math.floor(Math.random() * 9000 + 1000)}`
}

function shortCode(prefix = '') {
  return `${prefix}${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

module.exports = { orderNo, shortCode, uuidv4 }

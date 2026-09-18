const mysql = require('mysql2/promise')
const config = require('../config')

const RETRYABLE = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT'
])

let pool = mysql.createPool(config.db)
let recycling = null

function isRetryable(err) {
  if (!err) return false
  if (RETRYABLE.has(err.code)) return true
  return /ECONNRESET|PROTOCOL_CONNECTION_LOST|server closed the connection/i.test(String(err.message || ''))
}

function recyclePool() {
  if (recycling) return recycling
  const dead = pool
  pool = mysql.createPool(config.db)
  recycling = dead.end().catch(() => {}).finally(() => {
    recycling = null
  })
  return recycling
}

async function query(sql, params, attempt = 0) {
  try {
    const [rows] = await pool.execute(sql, params)
    return rows
  } catch (err) {
    if (attempt < 1 && isRetryable(err)) {
      await recyclePool()
      return query(sql, params, attempt + 1)
    }
    throw err
  }
}

async function withTransaction(fn) {
  let conn
  try {
    try {
      conn = await pool.getConnection()
      await conn.beginTransaction()
    } catch (err) {
      if (conn) {
        try {
          conn.release()
        } catch (_) {}
        conn = null
      }
      if (!isRetryable(err)) throw err
      await recyclePool()
      conn = await pool.getConnection()
      await conn.beginTransaction()
    }
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback()
      } catch (_) {}
    }
    throw err
  } finally {
    if (conn) conn.release()
  }
}

module.exports = { get pool() { return pool }, query, withTransaction }

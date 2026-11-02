/**
 * 远程图本地缓存：下载到 USER_DATA_PATH，减少重复请求。
 * 失败时返回原 URL，由组件继续走网络加载。
 */
const CACHE_KEY = 'wy_media_cache_v1'
const MAX_ENTRIES = 40

function readIndex() {
  try {
    return wx.getStorageSync(CACHE_KEY) || {}
  } catch (_) {
    return {}
  }
}

function writeIndex(map) {
  try {
    wx.setStorageSync(CACHE_KEY, map)
  } catch (_) {}
}

function localPathFor(url) {
  const fs = wx.getFileSystemManager()
  const root = `${wx.env.USER_DATA_PATH}/media-cache`
  try {
    fs.accessSync(root)
  } catch (_) {
    try {
      fs.mkdirSync(root, true)
    } catch (__) {}
  }
  let hash = 0
  const s = String(url || '')
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  const ext = /\.webp($|\?)/i.test(s) ? 'webp' : /\.png($|\?)/i.test(s) ? 'png' : 'jpg'
  return `${root}/${hash.toString(16)}.${ext}`
}

function resolve(url) {
  const remote = String(url || '').trim()
  if (!remote || remote.indexOf('/assets/') === 0) {
    return Promise.resolve(remote)
  }
  if (!/^https?:\/\//i.test(remote)) return Promise.resolve(remote)

  const index = readIndex()
  const cached = index[remote]
  if (cached) {
    try {
      wx.getFileSystemManager().accessSync(cached)
      return Promise.resolve(cached)
    } catch (_) {
      delete index[remote]
      writeIndex(index)
    }
  }

  const dest = localPathFor(remote)
  return new Promise((resolvePromise) => {
    wx.downloadFile({
      url: remote,
      filePath: dest,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const path = res.filePath || dest
          index[remote] = path
          const keys = Object.keys(index)
          if (keys.length > MAX_ENTRIES) {
            const drop = keys.slice(0, keys.length - MAX_ENTRIES)
            drop.forEach((k) => {
              try {
                wx.getFileSystemManager().unlinkSync(index[k])
              } catch (_) {}
              delete index[k]
            })
          }
          writeIndex(index)
          resolvePromise(path)
          return
        }
        resolvePromise(remote)
      },
      fail() {
        resolvePromise(remote)
      }
    })
  })
}

async function resolveList(urls) {
  const list = Array.isArray(urls) ? urls : []
  const out = []
  for (const u of list) {
    out.push(await resolve(u))
  }
  return out
}

module.exports = { resolve, resolveList }

/**
 * 将本地图片压缩到指定大小以内（默认 1MB），便于证照上传。
 * 优先 wx.compressImage，必要时多次降质。
 */
const DEFAULT_MAX = 1024 * 1024

function getFileSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success: (r) => resolve(Number(r.size) || 0),
      fail: (e) => reject(new Error((e && e.errMsg) || '无法读取图片大小'))
    })
  })
}

function compressOnce(src, quality) {
  return new Promise((resolve, reject) => {
    if (!wx.compressImage) {
      reject(new Error('当前基础库不支持图片压缩，请更换较小照片'))
      return
    }
    wx.compressImage({
      src,
      quality,
      success: (r) => resolve(r.tempFilePath || src),
      fail: (e) => reject(new Error((e && e.errMsg) || '图片压缩失败'))
    })
  })
}

/**
 * @param {string} filePath
 * @param {number} [maxBytes]
 * @returns {Promise<{ filePath: string, size: number, compressed: boolean }>}
 */
async function compressUnderLimit(filePath, maxBytes = DEFAULT_MAX) {
  let path = filePath
  let size = await getFileSize(path)
  if (size <= maxBytes) {
    return { filePath: path, size, compressed: false }
  }

  // 从较高画质逐步压到更小，尽量保住证件可读性
  const qualities = [80, 70, 60, 50, 40, 30, 20]
  for (const q of qualities) {
    path = await compressOnce(path, q)
    size = await getFileSize(path)
    if (size <= maxBytes) {
      return { filePath: path, size, compressed: true }
    }
  }

  if (size > maxBytes) {
    throw new Error(`图片压缩后仍超过 ${Math.round(maxBytes / 1024)}KB，请换一张更清晰的小图`)
  }
  return { filePath: path, size, compressed: true }
}

module.exports = {
  DEFAULT_MAX,
  getFileSize,
  compressUnderLimit
}

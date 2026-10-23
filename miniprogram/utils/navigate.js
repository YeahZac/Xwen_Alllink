/**
 * 打开微信内置地图，可从当前位置导航到门店（调起系统地图 App）。
 * @param {object} place
 * @param {number|string} place.latitude
 * @param {number|string} place.longitude
 * @param {string} [place.name]
 * @param {string} [place.address]
 */
function openPlace(place) {
  const lat = Number(place && (place.latitude != null ? place.latitude : place.lat))
  const lng = Number(place && (place.longitude != null ? place.longitude : place.lng))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    wx.showToast({ title: '暂无该门店坐标，无法导航', icon: 'none' })
    return Promise.reject(new Error('missing_coords'))
  }
  const name = String((place && (place.name || place.shopName)) || '门店').slice(0, 32)
  const address = String((place && (place.address || place.city)) || '').slice(0, 128)
  return new Promise((resolve, reject) => {
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name,
      address,
      scale: 16,
      success: resolve,
      fail: (err) => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) {
          resolve(err)
          return
        }
        wx.showToast({ title: '打开地图失败，请稍后重试', icon: 'none' })
        reject(err || new Error('openLocation_failed'))
      }
    })
  })
}

/** 从列表 dataset / 事件里取门店并导航 */
function openFromDataset(dataset, list) {
  const id = dataset && dataset.id
  if (id != null && Array.isArray(list)) {
    const hit = list.find((x) => String(x.id) === String(id))
    if (hit) return openPlace(hit)
  }
  return openPlace({
    latitude: dataset && dataset.lat,
    longitude: dataset && dataset.lng,
    name: dataset && dataset.name,
    address: dataset && dataset.address
  })
}

module.exports = {
  openPlace,
  openFromDataset
}

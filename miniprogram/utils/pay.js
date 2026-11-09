const api = require('./api')

function requestWxPay(result) {
  return new Promise((resolve, reject) => {
    if (!result) {
      resolve(result)
      return
    }
    const params = result.payParams
    if (result.simulated || !params || !params.timeStamp) {
      resolve(result)
      return
    }
    wx.requestPayment({
      timeStamp: String(params.timeStamp),
      nonceStr: params.nonceStr,
      package: params.package,
      signType: params.signType || 'RSA',
      paySign: params.paySign,
      success: async () => {
        if (result.needConfirm && result.orderNo) {
          try {
            const synced = await api.syncPay({ orderNo: result.orderNo })
            resolve({ ...result, ...synced, payStatus: 'paid' })
            return
          } catch (e) {
            // 回调可能更快已入账；短暂重试一次
            try {
              await new Promise((r) => setTimeout(r, 800))
              const synced = await api.syncPay({ orderNo: result.orderNo })
              resolve({ ...result, ...synced, payStatus: 'paid' })
              return
            } catch (e2) {
              reject(new Error((e2 && e2.message) || (e && e.message) || '支付成功但入账确认失败，请稍后在订单中查看'))
              return
            }
          }
        }
        resolve(result)
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '微信支付未完成'
        if (String(msg).indexOf('cancel') >= 0) {
          reject(new Error('已取消微信支付'))
          return
        }
        reject(new Error(msg))
      }
    })
  })
}

module.exports = { requestWxPay }

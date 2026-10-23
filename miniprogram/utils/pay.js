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
      success: () => resolve(result),
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

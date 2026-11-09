const api = require('./api')

function isCancelError(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return /cancel|取消/i.test(msg)
}

/**
 * 拉起微信支付；模拟支付或零元单直接成功。
 * 真实支付缺参时拒绝，避免「未支付却当成功」。
 */
function requestWxPay(result) {
  return new Promise((resolve, reject) => {
    if (!result) {
      reject(new Error('支付结果为空'))
      return
    }
    const cash =
      result.cashPaid != null
        ? Number(result.cashPaid)
        : result.cashAmount != null
          ? Number(result.cashAmount)
          : 0
    const params = result.payParams
    const alreadyPaid = result.payStatus === 'paid' || result.alreadyPaid || result.simulated

    if (alreadyPaid || result.simulated || !(cash > 0)) {
      resolve({ ...result, payStatus: result.payStatus || 'paid' })
      return
    }

    if (!params || !params.timeStamp || !params.paySign) {
      reject(new Error('缺少微信支付参数，请稍后重试或联系客服'))
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
            try {
              await new Promise((r) => setTimeout(r, 800))
              const synced = await api.syncPay({ orderNo: result.orderNo })
              resolve({ ...result, ...synced, payStatus: 'paid' })
              return
            } catch (e2) {
              const err = new Error(
                (e2 && e2.message) || (e && e.message) || '支付成功但入账确认失败，请稍后在订单中查看'
              )
              err.code = 'SYNC_PENDING'
              err.orderNo = result.orderNo
              reject(err)
              return
            }
          }
        }
        resolve({ ...result, payStatus: 'paid' })
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '微信支付未完成'
        const e = new Error(isCancelError(err) ? '已取消微信支付' : msg)
        e.code = isCancelError(err) ? 'USER_CANCEL' : 'PAY_FAIL'
        e.orderNo = result.orderNo
        e.raw = err
        reject(e)
      }
    })
  })
}

module.exports = { requestWxPay, isCancelError }

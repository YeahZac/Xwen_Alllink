/**
 * 正式环境不再内置演示门店。
 * 云托管冷启动时展示空态，等接口返回真实可收款门店。
 */

function homePayload() {
  return {
    stalls: [],
    crossStores: [],
    supplyMerchants: [],
    points: 0,
    cashValue: '0.00',
    bootstrap: true,
    networkEmpty: true
  }
}

function stalls() {
  return []
}

function crossStores() {
  return []
}

function supplyMerchants() {
  return []
}

module.exports = {
  homePayload,
  stalls,
  crossStores,
  supplyMerchants
}

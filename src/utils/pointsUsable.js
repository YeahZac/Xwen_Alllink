/**
 * 点餐单件「最大可抵扣积分」：须保留至少 ¥0.01 现金，故上限 = floor(price/0.01) - 1。
 */
function maxPointsUsableForPrice(priceYuan) {
  const p = Number(priceYuan)
  if (!Number.isFinite(p) || p < 0.01) return 0
  return Math.max(0, Math.floor(p / 0.01) - 1)
}

function clampPointsUsable(pointsUsable, priceYuan) {
  const want = Math.max(0, Math.floor(Number(pointsUsable) || 0))
  const cap = maxPointsUsableForPrice(priceYuan)
  return Math.min(want, cap)
}

module.exports = { maxPointsUsableForPrice, clampPointsUsable }

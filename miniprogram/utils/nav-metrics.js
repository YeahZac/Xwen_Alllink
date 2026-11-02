/** 自定义导航：状态栏 + 胶囊对齐高度 */
function getNavMetrics() {
  const sys = wx.getSystemInfoSync() || {}
  const statusBarHeight = sys.statusBarHeight || 20
  let navBarHeight = 44
  let capsuleRight = 12
  let headerTop = statusBarHeight + navBarHeight
  try {
    const capsule = wx.getMenuButtonBoundingClientRect()
    if (capsule && capsule.height) {
      navBarHeight = capsule.height + (capsule.top - statusBarHeight) * 2
      headerTop = capsule.bottom + 8
      const winW = sys.windowWidth || 375
      capsuleRight = Math.max(12, winW - capsule.left + 8)
    }
  } catch (_) {}
  return {
    statusBarHeight,
    navBarHeight,
    headerTop,
    capsuleRight,
    navPadTop: statusBarHeight
  }
}

module.exports = { getNavMetrics }

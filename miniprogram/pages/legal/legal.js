const legal = require('../../utils/legal')

Page({
  data: {
    docs: legal.DOCS,
    portalUrl: `${legal.LEGAL_BASE}/`
  },
  onLoad(q) {
    const key = q && q.key
    if (key && legal.docByKey(key)) {
      // 从登录/入驻深链直接打开对应 PDF
      setTimeout(() => legal.openDoc(key), 200)
    }
  },
  openDoc(e) {
    const key = e.currentTarget.dataset.key
    legal.openDoc(key)
  }
})

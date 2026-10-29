const legal = require('../../utils/legal')

Page({
  data: {
    docs: legal.DOCS
  },
  onLoad(q) {
    const key = q && q.key
    if (key && legal.docByKey(key)) {
      setTimeout(() => legal.openDoc(key), 200)
    }
  },
  openDoc(e) {
    const key = e.currentTarget.dataset.key
    legal.openDoc(key)
  }
})

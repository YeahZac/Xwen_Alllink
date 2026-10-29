const api = require('../../utils/api')
const location = require('../../utils/location')
const store = require('../../utils/store')
const legal = require('../../utils/legal')

const TYPE_META = {
  stall: {
    name: '地摊商铺',
    desc: '扫码点餐 · 采购获额度 · 向消费者划拨积分',
    tags: ['食品经营许可', '扫码点餐']
  },
  cross: {
    name: '异业门店',
    desc: '承接积分兑换 · 可采购供应链获额度',
    tags: ['积分兑换', '全现金兜底']
  },
  supply: {
    name: '供应链',
    desc: '向地摊/异业供货 · 货款与积分分账户',
    tags: ['供货', '分账结算']
  }
}

const ROLE_FIELDS = {
  stall: {
    label: '地摊商铺',
    licenses: [
      { key: 'foodLicense', label: '食品经营许可证', required: true },
      { key: 'idCardFront', label: '法人身份证正面', required: true },
      { key: 'idCardBack', label: '法人身份证反面', required: true },
      { key: 'storePhoto', label: '摊位封面照片', required: true }
    ]
  },
  cross: {
    label: '异业门店',
    licenses: [
      { key: 'businessLicense', label: '营业执照', required: true },
      { key: 'idCardFront', label: '法人身份证正面', required: true },
      { key: 'idCardBack', label: '法人身份证反面', required: true },
      { key: 'storePhoto', label: '门店封面照片', required: true }
    ]
  },
  supply: {
    label: '供应链',
    licenses: [
      { key: 'businessLicense', label: '营业执照', required: true },
      { key: 'idCardFront', label: '法人身份证正面', required: true },
      { key: 'idCardBack', label: '法人身份证反面', required: true },
      { key: 'storePhoto', label: '门店/仓库封面照片', required: true }
    ]
  }
}

/** 详细地址不走普通输入框，改由地图选点回填后可编辑；经营城市由地图定位自动识别，不单独填写 */
const BASE_FIELDS_COMMON = [
  { key: 'shopName', label: '店铺名称', required: true },
  { key: 'legalPerson', label: '法人姓名', required: true },
  { key: 'contactName', label: '联系人', required: true },
  { key: 'contactPhone', label: '联系电话', required: true, type: 'number', maxLength: 11 },
  { key: 'referrerCode', label: '推荐人邀请码', required: false, placeholder: '选填，有则填写' }
]

const CREDIT_CODE_FIELD = {
  key: 'creditCode',
  label: '统一社会信用代码',
  required: true
}

function baseFieldsForRole(role) {
  // 地摊无需统一社会信用代码；异业 / 供应链照常填写
  if (role === 'stall') return BASE_FIELDS_COMMON.slice()
  return [BASE_FIELDS_COMMON[0], CREDIT_CODE_FIELD, ...BASE_FIELDS_COMMON.slice(1)]
}

Page({
  data: {
    step: 1,
    selected: 'stall',
    roleLabel: '地摊商铺',
    types: [],
    baseFields: baseFieldsForRole('stall'),
    licenseFields: [],
    form: {
      shopName: '',
      creditCode: '',
      legalPerson: '',
      contactName: '',
      contactPhone: '',
      city: '',
      address: '',
      referrerCode: '',
      agreed: false
    },
    files: {},
    fileUrls: {},
    latitude: '',
    longitude: '',
    locationName: '',
    locationText: '',
    cities: [],
    submitting: false
  },
  onLoad(query) {
    const selected = ROLE_FIELDS[query.role] ? query.role : 'stall'
    const session = store.getSession() || {}
    const form = { ...this.data.form }
    if (session.phone) form.contactPhone = session.phone
    if (session.name && !form.contactName) form.contactName = session.name
    this.setData({
      types: Object.keys(TYPE_META).map((id) => ({ id, ...TYPE_META[id] })),
      selected,
      form
    })
    this.syncRoleFields(selected)
    api.cities().then((rows) => this.setData({ cities: rows || [] })).catch(() => {})
  },
  syncRoleFields(role) {
    const cfg = ROLE_FIELDS[role]
    this.setData({
      roleLabel: cfg.label,
      licenseFields: cfg.licenses,
      baseFields: baseFieldsForRole(role)
    })
  },
  selectRole(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ selected: id })
    this.syncRoleFields(id)
  },
  onField(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: e.detail.value })
  },
  onAddressInput(e) {
    this.setData({ 'form.address': e.detail.value })
  },
  validateStep2() {
    const { form, latitude, longitude, baseFields, selected } = this.data
    for (const f of baseFields || []) {
      if (f.required && !String(form[f.key] || '').trim()) {
        wx.showToast({ title: `请填写${f.label}`, icon: 'none' })
        return false
      }
    }
    if (!/^1\d{10}$/.test(String(form.contactPhone))) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' })
      return false
    }
    if (selected !== 'stall' && !String(form.creditCode || '').trim()) {
      wx.showToast({ title: '请填写统一社会信用代码', icon: 'none' })
      return false
    }
    const lat = Number(latitude)
    const lng = Number(longitude)
    if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
      wx.showToast({ title: '请用地图标注经营地址', icon: 'none' })
      return false
    }
    if (!String(form.address || '').trim()) {
      wx.showToast({ title: '请确认详细地址文字', icon: 'none' })
      return false
    }
    return true
  },
  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        const lat = Number(res.latitude)
        const lng = Number(res.longitude)
        const name = String(res.name || '').trim()
        const addr = String(res.address || res.name || '').trim()
        const matched = location.matchOpenCity
          ? location.matchOpenCity(lat, lng)
          : { city: '', label: '' }
        const patch = {
          latitude: lat,
          longitude: lng,
          locationName: name,
          locationText: name || addr || `${lat},${lng}`,
          'form.address': addr || name
        }
        if (matched && matched.inService && matched.city) {
          patch['form.city'] = matched.city
        } else if (matched && matched.label && !this.data.form.city) {
          patch['form.city'] = matched.label
        }
        this.setData(patch)
      },
      fail: (err) => {
        const msg = String((err && err.errMsg) || '')
        if (/auth deny|authorize|permission|隐私|deny/i.test(msg)) {
          wx.showToast({ title: '请允许位置权限后再选点', icon: 'none' })
          return
        }
        if (/cancel/i.test(msg)) return
        wx.showToast({ title: '未选择点位', icon: 'none' })
      }
    })
  },
  nextStep() {
    if (this.data.step === 1) {
      this.setData({ step: 2 })
      return
    }
    if (this.data.step === 2 && this.validateStep2()) {
      this.setData({ step: 3 })
    }
  },
  prevStep() {
    if (this.data.step > 1) this.setData({ step: this.data.step - 1 })
  },
  chooseImage(e) {
    const key = e.currentTarget.dataset.key
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        const path = file && file.tempFilePath
        if (!path) {
          wx.showToast({ title: '未选择图片', icon: 'none' })
          return
        }
        this.setData({ [`files.${key}`]: path })
        try {
          wx.showLoading({ title: '压缩上传中', mask: true })
          const up = await api.uploadFile(path, 'license')
          wx.hideLoading()
          this.setData({ [`fileUrls.${key}`]: up.fileUrl || up.url || up })
          wx.showToast({ title: '已上传', icon: 'success' })
        } catch (err) {
          wx.hideLoading()
          this.setData({ [`files.${key}`]: '', [`fileUrls.${key}`]: '' })
          wx.showToast({ title: err.message || '上传失败', icon: 'none' })
        }
      },
      fail: (err) => {
        if (String((err && err.errMsg) || '').indexOf('cancel') < 0) {
          wx.showToast({ title: '选择图片失败', icon: 'none' })
        }
      }
    })
  },
  toggleAgree() {
    this.setData({ 'form.agreed': !this.data.form.agreed })
  },
  openMerchantLegal() {
    legal.openDoc('merchant')
  },
  queryStatus() {
    this.queryApplyProgress()
  },
  async queryApplyProgress() {
    if (!store.isLoggedIn()) {
      wx.showToast({ title: '请先登录后再查询', icon: 'none' })
      setTimeout(() => wx.navigateTo({ url: '/pages/login/login' }), 400)
      return
    }
    try {
      wx.showLoading({ title: '查询中', mask: true })
      const item = await api.applyStatusMine()
      wx.hideLoading()
      if (!item) {
        wx.showToast({ title: '未找到申请记录', icon: 'none' })
        return
      }
      wx.showModal({
        title: item.statusText || item.status || '审核进度',
        content: [
          `申请单：${item.applyNo || item.id || '—'}`,
          `入驻身份：${item.roleLabel || item.role || '—'}`,
          item.shopName ? `店铺：${item.shopName}` : '',
          item.remark || item.rejectReason || ''
        ]
          .filter(Boolean)
          .join('\n'),
        showCancel: false,
        confirmText: '知道了'
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '查询失败', icon: 'none' })
    }
  },
  async submit() {
    if (this.data.submitting) return
    if (!this.data.form.agreed) {
      wx.showToast({ title: '请同意入驻协议', icon: 'none' })
      return
    }
    const licenses = { ...(this.data.fileUrls || {}) }
    const reqLic = ROLE_FIELDS[this.data.selected].licenses.filter((x) => x.required)
    for (const l of reqLic) {
      if (!licenses[l.key]) {
        wx.showToast({ title: `请上传${l.label}`, icon: 'none' })
        return
      }
    }
    this.setData({ submitting: true })
    try {
      const form = this.data.form
      const session = store.getSession() || {}
      const result = await api.submitApply({
        role: this.data.selected,
        shopName: form.shopName,
        creditCode: form.creditCode,
        legalPerson: form.legalPerson,
        contactName: form.contactName,
        contactPhone: form.contactPhone,
        city: form.city,
        address: form.address,
        referrerCode: form.referrerCode,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        applicantUserId: session.userId || undefined,
        agreed: true,
        licenses
      })
      this.setData({ submitting: false })
      wx.showModal({
        title: '提交成功',
        content: `单号 ${result.applyNo}\n${result.remark || '请等待审核'}`,
        showCancel: false,
        success: () => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) })
      })
    } catch (e) {
      this.setData({ submitting: false })
      wx.showToast({ title: e.message || '提交失败', icon: 'none' })
    }
  }
})

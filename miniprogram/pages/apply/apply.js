const api = require('../../utils/api')
const location = require('../../utils/location')
const store = require('../../utils/store')
const legal = require('../../utils/legal')

const TYPE_META = {
  stall: {
    name: '地摊经营',
    desc: '商家经营类型 · 个人经营者可入驻 · 扫码点餐 · 采购获额度',
    tags: ['商家类型', '无证可申', '扫码点餐']
  },
  cross: {
    name: '异业门店',
    desc: '商家经营类型 · 承接积分兑换 · 可向供应链采购获额度',
    tags: ['商家类型', '需营业执照', '积分兑换']
  },
  supply: {
    name: '供应链供货',
    desc: '商家经营类型 · 向地摊/异业供货 · 非独立登录身份',
    tags: ['商家类型', '需营业执照', '供货结算']
  }
}

const ROLE_FIELDS = {
  stall: {
    label: '地摊经营',
    // 对齐微信收付通「小微」进件：身份证正反面+姓名号码有效期+本人结算卡+经营场景照
    // 手持身份证非微信必填，平台侧建议上传便于人工核验
    licenses: [
      { key: 'idCardFront', label: '身份证人像面', required: true, tip: '微信进件必填' },
      { key: 'idCardBack', label: '身份证国徽面', required: true, tip: '微信进件必填' },
      {
        key: 'idCardHandheld',
        label: '手持身份证照片（建议）',
        required: false,
        tip: '平台人工审核建议上传；微信小微进件不强制'
      },
      { key: 'storePhoto', label: '摊位/经营场景照', required: true, tip: '微信进件经营场景材料' },
      {
        key: 'foodLicense',
        label: '食品经营许可证（选填）',
        required: false,
        tip: '支付进件不强制；售卖热食建议补办'
      }
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
    label: '供应链供货',
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

const STALL_MICRO_FIELDS = [
  {
    key: 'idCardNumber',
    label: '身份证号码',
    required: true,
    maxLength: 18,
    placeholder: '与证件一致，微信小微进件必填'
  },
  {
    key: 'idCardValidBegin',
    label: '身份证有效期起',
    required: true,
    placeholder: '如 2020-01-01'
  },
  {
    key: 'idCardValidEnd',
    label: '身份证有效期止',
    required: true,
    placeholder: '如 2030-01-01 或 长期'
  },
  {
    key: 'bankAccountName',
    label: '结算户名',
    required: true,
    placeholder: '须与经营者姓名一致'
  },
  {
    key: 'bankAccountNo',
    label: '结算银行卡号',
    required: true,
    type: 'number',
    maxLength: 32,
    placeholder: '本人借记卡'
  },
  {
    key: 'bankName',
    label: '开户银行',
    required: true,
    placeholder: '如 招商银行深圳分行'
  },
  {
    key: 'microBizType',
    label: '经营类型',
    required: true,
    placeholder: '流动经营/便民服务（地摊默认）'
  }
]

function baseFieldsForRole(role) {
  // 地摊：无需统一社会信用代码；补齐微信小微进件字段
  if (role === 'stall') {
    const base = BASE_FIELDS_COMMON.map((f) =>
      f.key === 'legalPerson' ? { ...f, label: '经营者姓名（真实姓名）' } : { ...f }
    )
    return [...base, ...STALL_MICRO_FIELDS]
  }
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
      idCardNumber: '',
      idCardValidBegin: '',
      idCardValidEnd: '',
      bankAccountName: '',
      bankAccountNo: '',
      bankName: '',
      microBizType: '流动经营/便民服务',
      agreed: false,
      stallCommitment: false
    },
    files: {},
    fileUrls: {},
    latitude: '',
    longitude: '',
    locationName: '',
    locationText: '',
    cities: [],
    submitting: false,
    isStall: true,
    step3Title: '身份核验与承诺',
    step3Desc: '地摊可无营业执照与食品证 · 须完成身份核验与合规承诺'
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
    const isStall = role === 'stall'
    this.setData({
      roleLabel: cfg.label,
      licenseFields: cfg.licenses,
      baseFields: baseFieldsForRole(role),
      isStall,
      step3Title: isStall ? '身份核验与承诺' : '证照上传',
      step3Desc: isStall
        ? '地摊可无营业执照与食品证 · 须完成身份核验与合规承诺'
        : '照片清晰完整 · 审核通过后方可经营',
      'form.stallCommitment': isStall ? this.data.form.stallCommitment : false
    })
  },
  selectRole(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ selected: id })
    this.syncRoleFields(id)
  },
  onRoleChange(e) {
    const id = e.detail.value
    if (!id) return
    this.setData({ selected: id })
    this.syncRoleFields(id)
  },
  onAgreeChange(e) {
    this.setData({ 'form.agreed': (e.detail.value || []).includes('1') })
  },
  onStallCommitChange(e) {
    this.setData({ 'form.stallCommitment': (e.detail.value || []).includes('1') })
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
    if (selected === 'stall') {
      const idNo = String(form.idCardNumber || '').trim().toUpperCase()
      if (!/^\d{17}[\dX]$/.test(idNo)) {
        wx.showToast({ title: '请填写正确的身份证号码', icon: 'none' })
        return false
      }
      const begin = String(form.idCardValidBegin || '').trim()
      const end = String(form.idCardValidEnd || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(begin)) {
        wx.showToast({ title: '身份证有效期起格式应为 YYYY-MM-DD', icon: 'none' })
        return false
      }
      if (!(end === '长期' || /^\d{4}-\d{2}-\d{2}$/.test(end))) {
        wx.showToast({ title: '身份证有效期止应为日期或「长期」', icon: 'none' })
        return false
      }
      if (!String(form.bankAccountNo || '').replace(/\s/g, '')) {
        wx.showToast({ title: '请填写结算银行卡号', icon: 'none' })
        return false
      }
      const bankNameOwner = String(form.bankAccountName || '').trim()
      const legal = String(form.legalPerson || '').trim()
      if (bankNameOwner && legal && bankNameOwner !== legal) {
        wx.showToast({ title: '结算户名须与经营者姓名一致', icon: 'none' })
        return false
      }
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
          wx.showLoading({ title: '上传中…', mask: true })
          const up = await api.uploadFile(path, 'license')
          wx.hideLoading()
          this.setData({ [`fileUrls.${key}`]: up.fileUrl || up.url || up })
          wx.showToast({ title: '已上传', icon: 'success' })
        } catch (err) {
          wx.hideLoading()
          this.setData({ [`files.${key}`]: '', [`fileUrls.${key}`]: '' })
          const msg = String((err && err.message) || '')
          wx.showToast({
            title: /timeout|超时|SIGTERM|重启/i.test(msg)
              ? '服务繁忙或正在发版，请稍后再传'
              : err.message || '上传失败',
            icon: 'none',
            duration: 2500
          })
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
  toggleStallCommitment() {
    this.setData({ 'form.stallCommitment': !this.data.form.stallCommitment })
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
    if (this.data.selected === 'stall' && !this.data.form.stallCommitment) {
      wx.showToast({ title: '请勾选地摊合规经营承诺', icon: 'none' })
      return
    }
    const session = store.getSession() || {}
    if (!session.userId || !store.getToken()) {
      // 入驻必须登录：用户身份以服务端 JWT 为准，避免脏会话误判「已有门店」
      if (store.beginLoginFlow) {
        store.beginLoginFlow('from=apply')
      } else {
        wx.showToast({ title: '请先登录', icon: 'none' })
      }
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
    // 未上传的选填证照不传空值，避免后台误判
    Object.keys(licenses).forEach((k) => {
      if (!licenses[k]) delete licenses[k]
    })
    this.setData({ submitting: true })
    try {
      const form = this.data.form
      if (this.data.selected === 'stall') {
        // 写入证照 JSON，供运营台与后续微信小微进件使用
        licenses.microPaySubject = 'SUBJECT_TYPE_MICRO'
        licenses.microBizType = form.microBizType || 'MICRO_TYPE_MOBILE'
        licenses.idCardName = form.legalPerson
        licenses.idCardNumber = String(form.idCardNumber || '')
          .trim()
          .toUpperCase()
        licenses.idCardValidBegin = form.idCardValidBegin
        licenses.idCardValidEnd = form.idCardValidEnd
        licenses.bankAccountName = form.bankAccountName || form.legalPerson
        licenses.bankAccountNo = String(form.bankAccountNo || '').replace(/\s/g, '')
        licenses.bankName = form.bankName
        licenses.bankAccountType = 'BANK_ACCOUNT_TYPE_PERSONAL'
      }
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
        agreed: true,
        stallCommitment: this.data.selected === 'stall' ? !!form.stallCommitment : undefined,
        idCardNumber: form.idCardNumber,
        idCardValidBegin: form.idCardValidBegin,
        idCardValidEnd: form.idCardValidEnd,
        bankAccountName: form.bankAccountName,
        bankAccountNo: form.bankAccountNo,
        bankName: form.bankName,
        microBizType: form.microBizType,
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
      const msg = (e && e.message) || '提交失败'
      if (/已有营业中|已有审核中|已绑定|该手机号已有/.test(msg)) {
        wx.showModal({ title: '无法提交', content: msg, showCancel: false })
      } else {
        wx.showToast({ title: msg, icon: 'none', duration: 3500 })
      }
    }
  }
})

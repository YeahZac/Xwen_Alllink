const store = require('../../utils/store')
const api = require('../../utils/api')
const legal = require('../../utils/legal')

const GENDER_OPTIONS = ['不展示', '男', '女']

Page({
  data: {
    name: '',
    roleLabel: '',
    points: 0,
    orderCount: 0,
    coverUrl: '',
    phone: '',
    gender: 0,
    genderText: '',
    genderOptions: GENDER_OPTIONS
  },
  async onShow() {
    if (!store.ensureConsumerOrRedirect()) return
    try {
      const [session, orders, pointsData] = await Promise.all([
        store.refreshProfile(),
        api.myOrders().catch(() => []),
        api.myPoints().catch(() => ({ points: 0 }))
      ])
      const gender = Number(session.gender) || 0
      this.setData({
        name: session.name,
        roleLabel: store.ROLE_LABEL[session.role] || '',
        points: pointsData.points != null ? pointsData.points : session.points || 0,
        orderCount: (orders || []).length,
        coverUrl: session.coverUrl || session.avatarUrl || '',
        phone: session.phone || '',
        gender,
        genderText: gender ? GENDER_OPTIONS[gender] : ''
      })
    } catch (e) {
      const s = store.getSession() || {}
      const gender = Number(s.gender) || 0
      this.setData({
        name: s.name || '',
        roleLabel: store.ROLE_LABEL[s.role] || '',
        points: s.points || 0,
        gender,
        genderText: gender ? GENDER_OPTIONS[gender] : ''
      })
    }
  },
  goOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' })
  },
  goPoints() {
    wx.switchTab({ url: '/pages/points/points' })
  },
  goRecommend() {
    wx.navigateTo({ url: '/pages/recommend/recommend' })
  },
  goApply() {
    wx.navigateTo({ url: '/pages/apply/apply' })
  },
  goSupplyNeed() {
    wx.navigateTo({ url: '/pages/supply-need/supply-need' })
  },
  goLegal() {
    wx.navigateTo({ url: '/pages/legal/legal' })
  },
  openLegalDoc(e) {
    const key = e.currentTarget.dataset.key
    legal.openDoc(key)
  },
  async onChooseAvatar(e) {
    const path = (e.detail && e.detail.avatarUrl) || ''
    if (!path) return
    this.setData({ coverUrl: path })
    try {
      const up = await api.uploadFile(path, 'avatar')
      const url = (up && up.fileUrl) || ''
      if (url) {
        const data = await api.updateProfile({ avatarUrl: url })
        store.applyAuthResult(data)
        this.setData({ coverUrl: data.avatarUrl || url })
      }
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '头像保存失败', icon: 'none' })
    }
  },
  async onNicknameBlur(e) {
    const nickname = String((e.detail && e.detail.value) || '').trim()
    if (!nickname || nickname === this.data.name) return
    try {
      const data = await api.updateProfile({ nickname })
      store.applyAuthResult(data)
      this.setData({ name: data.name || nickname })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '昵称保存失败', icon: 'none' })
    }
  },
  async onGenderChange(e) {
    const gender = Number(e.detail.value) || 0
    try {
      const data = await api.updateProfile({ gender })
      store.applyAuthResult(data)
      this.setData({
        gender,
        genderText: gender ? GENDER_OPTIONS[gender] : ''
      })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '性别保存失败', icon: 'none' })
    }
  },
  async onGetPhone(e) {
    const detail = (e && e.detail) || {}
    if (detail.errMsg && String(detail.errMsg).indexOf('ok') < 0) {
      wx.showToast({ title: '未授权手机号', icon: 'none' })
      return
    }
    if (!detail.code) {
      wx.showToast({ title: '请在真机完成手机号授权', icon: 'none' })
      return
    }
    try {
      const data = await api.bindPhone(detail.code)
      store.applyAuthResult(data)
      this.setData({ phone: data.phone || '' })
      wx.showToast({ title: data.phone ? '手机号已更新' : '已绑定', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '绑定失败', icon: 'none' })
    }
  },
  goTestLogin() {
    wx.reLaunch({ url: '/pages/login/login' })
  },
  onComplaint() {
    wx.showModal({
      title: '投诉建议',
      editable: true,
      placeholderText: '请描述问题',
      success: async (r) => {
        if (!r.confirm || !r.content) return
        try {
          await api.complaint({ targetType: 'other', content: r.content })
          wx.showToast({ title: '已提交', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: e.message || '提交失败', icon: 'none' })
        }
      }
    })
  },
  onLogout() {
    store.logout()
    wx.reLaunch({ url: '/pages/login/login' })
  }
})

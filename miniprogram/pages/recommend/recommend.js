const store = require('../../utils/store')
const api = require('../../utils/api')
const invite = require('../../utils/invite')

Page({
  data: {
    code: '',
    qrcodeUrl: '',
    qrLoading: false,
    bindCode: '',
    records: [],
    rules: [],
    bound: false,
    referrerName: '',
    referrerCode: '',
    inviteFriendPoints: 0,
    inviteFriendEnabled: false,
    stats: { invited: 0, rewardedPoints: 0 }
  },
  async onShow() {
    if (!store.ensureLoggedIn()) return
    this.setData({ qrLoading: true })
    try {
      const home = await api.referralHome()
      this.setData({
        code: home.shareCode || home.personalCode || '',
        qrcodeUrl: home.qrcodeUrl || '',
        qrLoading: false,
        records: (home.records || []).map((r, i) => ({
          id: r.id || i,
          name: r.name || '新用户',
          time: r.time ? String(r.time).replace('T', ' ').slice(0, 16) : '',
          triggerName: r.triggerName || '',
          reward: r.reward || 0
        })),
        rules: home.rules || [],
        bound: !!home.bound,
        referrerName: home.referrerName || '',
        referrerCode: home.referrerCode || '',
        inviteFriendPoints: Number(home.inviteFriendPoints) || 0,
        inviteFriendEnabled: !!home.inviteFriendEnabled,
        stats: home.stats || { invited: 0, rewardedPoints: 0 }
      })
      if (home.shareCode) {
        const s = store.getSession() || {}
        s.inviteCode = home.shareCode
        store.setSession(s)
      }
      if (!home.qrcodeUrl) {
        this.refreshQr(false)
      }
    } catch (e) {
      this.setData({ qrLoading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  async refreshQr(force) {
    this.setData({ qrLoading: true })
    try {
      const data = await api.referralQrcode(!!force)
      this.setData({
        qrcodeUrl: data.qrcodeUrl || '',
        code: data.inviteCode || this.data.code,
        qrLoading: false
      })
    } catch (e) {
      this.setData({ qrLoading: false })
      if (force) wx.showToast({ title: e.message || '生成失败', icon: 'none' })
    }
  },
  onInput(e) {
    this.setData({ bindCode: e.detail.value })
  },
  onCopy() {
    if (!this.data.code) return
    wx.setClipboardData({
      data: this.data.code,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'none' })
    })
  },
  onPreviewQr() {
    if (!this.data.qrcodeUrl) return
    wx.previewImage({ urls: [this.data.qrcodeUrl], current: this.data.qrcodeUrl })
  },
  onSaveQr() {
    const url = this.data.qrcodeUrl
    if (!url) return
    wx.showLoading({ title: '保存中', mask: true })
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
          return
        }
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            wx.hideLoading()
            wx.showToast({ title: '已保存到相册', icon: 'success' })
          },
          fail: (err) => {
            wx.hideLoading()
            const msg = (err && err.errMsg) || ''
            if (/auth deny|authorize/i.test(msg)) {
              wx.showModal({
                title: '需要相册权限',
                content: '请在设置中允许保存到相册',
                confirmText: '去设置',
                success: (r) => {
                  if (r.confirm) wx.openSetting({})
                }
              })
              return
            }
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
      }
    })
  },
  async doBind(code) {
    const c = String(code || '').trim()
    if (!c) {
      wx.showToast({ title: '请输入或扫描邀请码', icon: 'none' })
      return
    }
    try {
      const res = await api.bindReferral(c)
      const pts = Number(res && res.rewardPoints) || 0
      wx.showToast({
        title: pts > 0 ? `绑定成功，邀请人 +${pts} 积分` : '绑定成功',
        icon: 'none'
      })
      this.setData({ bindCode: '' })
      this.onShow()
    } catch (e) {
      wx.showToast({ title: e.message || '绑定失败', icon: 'none' })
    }
  },
  onBind() {
    this.doBind(this.data.bindCode)
  },
  onScanBind() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const code =
          invite.extractInviteCode(res.result) ||
          invite.extractInviteCode(res.path) ||
          invite.extractInviteCode(res.rawData)
        if (!code) {
          wx.showToast({ title: '未识别到邀请码', icon: 'none' })
          return
        }
        this.setData({ bindCode: code })
        this.doBind(code)
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (/cancel/i.test(msg)) return
        wx.showToast({ title: '扫码失败', icon: 'none' })
      }
    })
  },
  onShareAppMessage() {
    return {
      title: '万业互联云 · 用我的邀请码领积分',
      path: `/pages/login/login?ref=${this.data.code || ''}`,
      imageUrl: this.data.qrcodeUrl || ''
    }
  }
})

const config = require('./config')

const TOKEN_KEY = 'wy_token'
let redirectingToLogin = false

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || ''
  } catch (_) {
    return ''
  }
}

function setToken(token) {
  try {
    if (token) wx.setStorageSync(TOKEN_KEY, token)
    else wx.removeStorageSync(TOKEN_KEY)
  } catch (_) {}
}

function ensureCloud() {
  if (!wx.cloud) return
  try {
    wx.cloud.init({ env: config.envId, traceUser: true })
  } catch (_) {}
}

function isCallContainerTimeout(err) {
  const msg = String((err && (err.errMsg || err.message)) || '')
  const code = err && (err.errCode != null ? err.errCode : err.code)
  return code === 102002 || /102002|timeout|超时/i.test(msg)
}

function friendlyCallError(err) {
  if (isCallContainerTimeout(err)) {
    return '服务启动较慢，请再试一次（云托管冷启动超时）'
  }
  const code = err && (err.errCode != null ? err.errCode : err.code)
  const msg = String((err && (err.errMsg || err.message)) || '')
  if (code === -606001 || /-606001/i.test(msg)) {
    return '上传内容过大（云托管限制），请压缩后重试'
  }
  return (err && (err.errMsg || err.message)) || '云托管调用失败，请检查服务名与环境'
}

function request({ path, method = 'GET', data, auth = true, header = {}, _retry = 0, timeout = 15000 }) {
  ensureCloud()
  const apiPath = path.startsWith('/api') ? path : `${config.apiPrefix}${path.startsWith('/') ? path : `/${path}`}`
  const headers = {
    'content-type': 'application/json',
    ...header
  }
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  return new Promise((resolve, reject) => {
    const finish = (statusCode, body) => {
      let json = body
      if (typeof body === 'string') {
        try {
          json = JSON.parse(body)
        } catch (_) {
          json = { code: -1, message: body }
        }
      }
      if (statusCode === 401) {
        setToken('')
        try {
          wx.removeStorageSync('wy_session')
        } catch (_) {}
        if (!redirectingToLogin) {
          redirectingToLogin = true
          let loginUrl = '/pages/login/login'
          try {
            const pending = require('./scan').getPendingPay()
            if (pending && pending.stallId) loginUrl += '?from=scanpay'
          } catch (_) {}
          setTimeout(() => {
            wx.reLaunch({
              url: loginUrl,
              complete: () => {
                redirectingToLogin = false
              }
            })
          }, 0)
        }
        reject(new Error('登录已失效，请重新登录'))
        return
      }
      if (statusCode >= 400 || (json && json.code !== undefined && json.code !== 0)) {
        const gatewayCode = json && json.code
        if (gatewayCode === 'INVALID_HOST') {
          reject(new Error(`云托管服务名无效（当前 ${config.serviceName}），请核对控制台服务名称`))
          return
        }
        reject(new Error((json && json.message) || `请求失败 ${statusCode}`))
        return
      }
      resolve(json && json.data !== undefined ? json.data : json)
    }

    if (config.useCallContainer && wx.cloud && wx.cloud.callContainer) {
      wx.cloud.callContainer({
        config: { env: config.envId },
        path: apiPath,
        method,
        timeout: Number(timeout) || 15000,
        header: {
          'X-WX-SERVICE': config.serviceName,
          ...headers
        },
        data: method === 'GET' ? undefined : data || {},
        success: (res) => finish(res.statusCode || 200, res.data),
        fail: (err) => {
          // 把 errCode 带进 Error，便于上传层识别 -606001
          const e = new Error(friendlyCallError(err))
          e.errCode = err && err.errCode
          e.errMsg = err && err.errMsg
          // 冷启动超时：自动重试一次，给实例拉起时间
          if (_retry < 1 && isCallContainerTimeout(err)) {
            setTimeout(() => {
              request({ path, method, data, auth, header, _retry: _retry + 1, timeout })
                .then(resolve)
                .catch(reject)
            }, 1200)
            return
          }
          if (config.baseUrl) {
            fallbackHttp({ apiPath, method, data, headers, finish, reject, err })
          } else {
            reject(e)
          }
        }
      })
      return
    }

    fallbackHttp({ apiPath, method, data, headers, finish, reject })
  })
}

function fallbackHttp({ apiPath, method, data, headers, finish, reject, err }) {
  if (!config.baseUrl) {
    reject(new Error((err && err.errMsg) || '未配置 baseUrl，且 callContainer 不可用'))
    return
  }
  wx.request({
    url: `${config.baseUrl.replace(/\/$/, '')}${apiPath}`,
    method,
    data: data || {},
    header: headers,
    success: (res) => finish(res.statusCode || 200, res.data),
    fail: (e) => reject(new Error(e.errMsg || '网络错误'))
  })
}

/** 上传文件到后端 /api/media/upload，返回 { fileUrl, ... } */
function uploadFile({ filePath, bizType = 'license', formData = {} }) {
  ensureCloud()
  const apiPath = `${config.apiPrefix}/media/upload`
  const token = getToken()
  const header = {}
  if (token) header.Authorization = `Bearer ${token}`

  return new Promise((resolve, reject) => {
    const done = (statusCode, body) => {
      let json = body
      if (typeof body === 'string') {
        try {
          json = JSON.parse(body)
        } catch (_) {}
      }
      if (statusCode >= 400 || (json && json.code !== 0)) {
        reject(new Error((json && json.message) || '上传失败'))
        return
      }
      resolve(json.data)
    }

    // callContainer 对 multipart 支持有限：优先用云托管上传开放能力；否则走临时 HTTPS
    if (config.useCallContainer && wx.cloud && wx.cloud.uploadFile) {
      // 部分基础库无 cloud.uploadFile 到容器；统一用 wx.uploadFile + 内网域名不可用
      // 因此这里用 callContainer 不可传文件时，提示用 chooseMedia 后转 base64 不理想
    }

    if (!config.baseUrl && config.useCallContainer) {
      // 云托管：通过 callContainer 无法直接 multipart，改用临时读文件 + 自定义上传接口不便
      // 采用：wx.cloud.callContainer 不支持文件时，用「开放接口」风格 —— 先读为 ArrayBuffer 再走 JSON 不合适
      // 实务：配置云托管「默认域名」到 baseUrl 做上传，或使用服务公开域名
      wx.getFileSystemManager().readFile({
        filePath,
        success: async (fileRes) => {
          // 退化为：提示需要 baseUrl。若已配置则走 uploadFile
          if (!config.baseUrl) {
            // 尝试 callContainer 不可行，返回本地路径占位由后台审核时再传
            reject(new Error('请在 utils/config.js 配置 baseUrl（云托管服务域名）以支持证照上传'))
            return
          }
          wx.uploadFile({
            url: `${config.baseUrl.replace(/\/$/, '')}${apiPath}`,
            filePath,
            name: 'file',
            formData: { bizType, ...formData },
            header,
            success: (res) => done(res.statusCode, res.data),
            fail: (e) => reject(new Error(e.errMsg || '上传失败'))
          })
        },
        fail: () => reject(new Error('读取文件失败'))
      })
      return
    }

    const url = `${(config.baseUrl || '').replace(/\/$/, '')}${apiPath}`
    wx.uploadFile({
      url,
      filePath,
      name: 'file',
      formData: { bizType, ...formData },
      header,
      success: (res) => done(res.statusCode, res.data),
      fail: (e) => reject(new Error(e.errMsg || '上传失败'))
    })
  })
}

module.exports = {
  getToken,
  setToken,
  request,
  uploadFile,
  ensureCloud
}

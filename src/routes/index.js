const express = require('express')
const multer = require('multer')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ok, HttpError } = require('../utils/response')
const { authRequired, requireRoles } = require('../middleware/auth')
const { query } = require('../utils/db')
const authService = require('../services/authService')
const applyService = require('../services/applyService')
const orderService = require('../services/orderService')
const catalogService = require('../services/catalogService')
const adminService = require('../services/adminService')
const rbacService = require('../services/rbacService')
const storageService = require('../services/storageService')
const opsService = require('../services/opsService')
const merchantPortalService = require('../services/merchantPortalService')
const {
  getCashRate,
  pointsToCash,
  getMerchantAgreement,
  getMerchantAgreementTemplate,
  setConfig,
  MERCHANT_AGREEMENT_KEY
} = require('../services/configService')
const categoryService = require('../services/categoryService')
const cityService = require('../services/cityService')
const feeService = require('../services/feeService')
const referralService = require('../services/referralService')
const partnerService = require('../services/partnerService')
const founderService = require('../services/founderService')
const subMerchantService = require('../services/subMerchantService')

const router = express.Router()
const adminOnly = [authRequired, requireRoles('admin')]
const founderOnly = [authRequired, requireRoles('founder', 'admin')]
const partnerOnly = [authRequired, requireRoles('partner')]
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const mime = String((file && file.mimetype) || '').toLowerCase()
    const ok =
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      mime === 'application/octet-stream'
    if (!ok) return cb(new HttpError(400, '仅支持图片或 PDF 上传'))
    cb(null, true)
  }
})

function assertUploadMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.startsWith('image/') || m === 'application/pdf' || m === 'application/octet-stream') return
  throw new HttpError(400, '仅支持图片或 PDF 上传')
}

/** 页面级 RBAC：GET 需浏览权，写操作需编辑权 */
function requirePage(pageKey, { edit } = {}) {
  return async (req, _res, next) => {
    try {
      const needEdit =
        edit === true
          ? true
          : edit === false
            ? false
            : !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())
      await rbacService.ensurePageAccess(req.auth, pageKey, needEdit)
      next()
    } catch (e) {
      next(e)
    }
  }
}

function requireAnyPage(pageKeys, { edit } = {}) {
  return async (req, _res, next) => {
    try {
      const needEdit =
        edit === true
          ? true
          : edit === false
            ? false
            : !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())
      await rbacService.ensureAnyPageAccess(req.auth, pageKeys, needEdit)
      next()
    } catch (e) {
      next(e)
    }
  }
}

const STORE_PAGES = ['stores_stall', 'stores_cross', 'stores_supply', 'users_all']
const STORE_EDIT_PAGES = ['stores_stall', 'stores_cross', 'stores_supply', 'users_all']
const GOODS_EDIT_PAGES = ['goods_sku', 'goods', 'stores_stall', 'stores_cross', 'stores_supply']
const PLATFORM_IDENTITY_EDIT_PAGES = ['users_all']

async function requireSysEdit(req, _res, next) {
  try {
    await rbacService.ensurePageAccess(req.auth, 'sys_accounts', true)
    next()
  } catch (e) {
    next(e)
  }
}

async function requireSysRolesEdit(req, _res, next) {
  try {
    await rbacService.ensurePageAccess(req.auth, 'sys_roles', true)
    next()
  } catch (e) {
    next(e)
  }
}

router.get('/health', async (req, res) => {
  const config = require('../config')
  let db = { ok: false }
  try {
    await query('SELECT 1 AS ok')
    db = {
      ok: true,
      host: config.db.host,
      port: config.db.port,
      database: config.db.database
    }
  } catch (e) {
    db = {
      ok: false,
      error: e.code || e.message,
      hint:
        '无法连接 MySQL。云托管请在服务环境变量配置 MYSQL_ADDRESS / MYSQL_USERNAME / MYSQL_PASSWORD（或 DB_HOST/DB_USER/DB_PASSWORD），并执行 sql 初始化脚本。'
    }
  }
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .split(':')[0]
  const origin = config.publicBaseUrl || (host ? `${proto}://${host}` : '')
  const onAdminHost = host && (host === config.adminHost || host.startsWith('admin.'))
  res.status(db.ok ? 200 : 503).json(
    ok({
      service: 'xwen-alllink-api',
      ts: Date.now(),
      publicBaseUrl: origin || null,
      adminHost: config.adminHost || null,
      adminUrl: onAdminHost
        ? `${proto}://${host}/`
        : config.adminHost
          ? `https://${config.adminHost}/`
          : origin
            ? `${origin}/admin/`
            : '/admin/',
      db
    })
  )
})

/** 平台协议目录（与 /legal 静态资源一致，供审核与前端引用） */
router.get('/legal', (req, res) => {
  const config = require('../config')
  const base = (config.publicBaseUrl || 'https://admin.wanye.cloud').replace(/\/+$/, '')
  res.json(
    ok({
      portal: `${base}/legal/`,
      docs: [
        {
          key: 'user',
          title: '用户服务协议',
          name: '万业互联云平台用户服务协议',
          url: `${base}/legal/user-service-agreement.pdf`,
          path: '/legal/user-service-agreement.pdf'
        },
        {
          key: 'merchant',
          title: '商户入驻平台协议',
          name: '万业互联云商户入驻服务协议',
          url: `${base}/legal/merchant-onboarding-agreement.pdf`,
          path: '/legal/merchant-onboarding-agreement.pdf'
        },
        {
          key: 'dispute',
          title: '消费者权益保障措施说明',
          name: '万业互联云平台交易纠纷处理机制说明',
          url: `${base}/legal/transaction-dispute-resolution.pdf`,
          path: '/legal/transaction-dispute-resolution.pdf'
        }
      ],
      miniprogram: {
        login: '登录页底部协议勾选区可点开《用户服务协议》《消费者权益保障措施说明》',
        mine: '我的 → 平台协议',
        apply: '申请入驻 → 《商户入驻平台协议》',
        page: 'pages/legal/legal'
      }
    })
  )
})

// ---------- Auth ----------
router.post('/auth/login', async (req, res, next) => {
  try {
    // 支持：邀请码 / 运营账号密码（username+password）
    if (req.body.username && req.body.password) {
      res.json(ok(await authService.loginAdmin(req.body.username, req.body.password)))
      return
    }
    const data = await authService.loginByInviteCode(req.body.code || req.body.username)
    res.json(ok(data))
  } catch (e) {
    next(e)
  }
})

router.post('/auth/admin-login', async (req, res, next) => {
  try {
    res.json(ok(await authService.loginAdmin(req.body.username, req.body.password)))
  } catch (e) {
    next(e)
  }
})

router.post('/auth/wx-login', async (req, res, next) => {
  try {
    // 仅信任云托管注入头 / code2session；禁止客户端伪造 body.openid
    const headerOpenid = req.headers['x-wx-openid'] || req.headers['x-wx-from-openid']
    const headerUnionid = req.headers['x-wx-unionid']
    const data = await authService.loginWithWeChat({
      jsCode: req.body.jsCode || req.body.code,
      nickname: req.body.nickname,
      avatarUrl: req.body.avatarUrl,
      openid: headerOpenid || undefined,
      unionid: headerUnionid || undefined,
      bodyOpenid: req.body.openid,
      bodyUnionid: req.body.unionid
    })
    res.json(ok(data))
  } catch (e) {
    next(e)
  }
})

router.post('/auth/bind-phone', authRequired, requireRoles('consumer'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await authService.bindPhone(
          req.auth.userId,
          req.body.code || req.body.phoneCode,
          req.headers['x-wx-openid'] || req.headers['x-wx-from-openid']
        )
      )
    )
  } catch (e) {
    next(e)
  }
})

router.post('/auth/profile', authRequired, requireRoles('consumer'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await authService.updateConsumerProfile(req.auth.userId, {
          nickname: req.body.nickname,
          avatarUrl: req.body.avatarUrl,
          gender: req.body.gender
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get('/auth/profile', authRequired, async (req, res, next) => {
  try {
    res.json(ok(await authService.getProfile(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.get('/auth/identities', authRequired, async (req, res, next) => {
  try {
    res.json(ok(await authService.listIdentities(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.post('/auth/switch-identity', authRequired, async (req, res, next) => {
  try {
    res.json(
      ok(
        await authService.switchIdentity(req.auth, {
          role: req.body.role,
          merchantId: req.body.merchantId
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

// ---------- Apply ----------
router.get('/apply/license-rules', (_req, res) => {
  res.json(
    ok({
      required: applyService.ROLE_LICENSE_RULES,
      optional: applyService.ROLE_OPTIONAL_LICENSES || {},
      notes: {
        stall:
          '地摊走微信收付通「小微」：无营业执照/食品证亦可。必填：经营者真实姓名、身份证号、证件有效期、身份证人像/国徽面、摊位场景照、本人结算卡（户名须同名）、联系手机，并勾选合规承诺。手持身份证为平台建议项（微信不强制）。'
      }
    })
  )
})

router.post('/apply/submit', authRequired, async (req, res, next) => {
  try {
    res.json(ok(await applyService.submitApply(req.body || {}, { auth: req.auth, source: 'mp' })))
  } catch (e) {
    next(e)
  }
})

router.get('/apply/status', async (req, res, next) => {
  try {
    res.json(
      ok(await applyService.queryByPhone(req.query.phone, { applyNo: req.query.applyNo }))
    )
  } catch (e) {
    next(e)
  }
})

router.get('/apply/status/mine', authRequired, async (req, res, next) => {
  try {
    res.json(ok(await applyService.queryByUserId(req.auth.userId)))
  } catch (e) {
    next(e)
  }
})

router.post(
  '/admin/apply/:id/approve',
  ...adminOnly,
  requirePage('applies'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await applyService.approveApply(Number(req.params.id), {
            reviewerId: req.auth.adminId || req.auth.userId,
            reviewerName: req.auth.username || req.auth.name || '',
            remark: req.body?.remark
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/apply/:id/reject',
  ...adminOnly,
  requirePage('applies'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await applyService.rejectApply(Number(req.params.id), {
            reason: req.body.reason,
            reviewerId: req.auth.adminId || req.auth.userId,
            reviewerName: req.auth.username || req.auth.name || ''
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.delete(
  '/admin/apply/:id',
  ...adminOnly,
  requirePage('applies', { edit: true }),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await applyService.deleteApply(Number(req.params.id), {
            reviewerId: req.auth.adminId || req.auth.userId,
            reviewerName: req.auth.username || req.auth.name || ''
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/applies',
  ...adminOnly,
  requirePage('applies', { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await applyService.submitAdminApply(req.body || {})))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/admin/applies/:id/logs',
  ...adminOnly,
  requirePage('applies'),
  async (req, res, next) => {
    try {
      res.json(ok(await applyService.listApplyReviewLogs(Number(req.params.id))))
    } catch (e) {
      next(e)
    }
  }
)

router.get('/admin/applies', ...adminOnly, requirePage('applies'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await applyService.listApplies({
          status: req.query.status,
          page: req.query.page,
          pageSize: req.query.pageSize,
          limit: req.query.limit
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/cities', ...adminOnly, requirePage('cities'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await cityService.listCities({
          status: req.query.status,
          page: req.query.page,
          pageSize: req.query.pageSize,
          limit: req.query.limit
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.post('/admin/cities', ...adminOnly, requirePage('cities'), async (req, res, next) => {
  try {
    res.json(ok(await cityService.saveCity(req.body || {})))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/cities/:id/close', ...adminOnly, requirePage('cities'), async (req, res, next) => {
  try {
    res.json(ok(await cityService.closeCity(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/applies/:id', ...adminOnly, requirePage('applies'), async (req, res, next) => {
  try {
    res.json(ok(await applyService.getApplyDetail(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.get(
  '/admin/merchants',
  ...adminOnly,
  requireAnyPage(STORE_PAGES, { edit: false }),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await applyService.listMerchants({
            role: req.query.role,
            page: req.query.page,
            pageSize: req.query.pageSize,
            limit: req.query.limit
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get('/admin/dashboard', ...adminOnly, requirePage('dashboard'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.dashboard()))
  } catch (e) {
    next(e)
  }
})

router.get(
  '/admin/merchants/:id',
  ...adminOnly,
  requireAnyPage(STORE_PAGES, { edit: false }),
  async (req, res, next) => {
    try {
      res.json(ok(await adminService.getMerchantDetail(Number(req.params.id))))
    } catch (e) {
      next(e)
    }
  }
)

router.patch(
  '/admin/merchants/:id',
  ...adminOnly,
  requireAnyPage(STORE_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await adminService.updateMerchant(Number(req.params.id), req.body)))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/admin/users',
  ...adminOnly,
  requireAnyPage(['users_consumer', 'users_all'], { edit: false }),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await adminService.listUsers({
            q: req.query.q,
            page: req.query.page,
            pageSize: req.query.pageSize,
            limit: req.query.limit
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.patch(
  '/admin/users/:id',
  ...adminOnly,
  requireAnyPage(['users_consumer', 'users_all'], { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await adminService.updateUser(Number(req.params.id), req.body)))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/users/:id/points',
  ...adminOnly,
  requireAnyPage(['users_consumer', 'users_all', 'points'], { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await adminService.adjustUserPoints(Number(req.params.id), req.body)))
    } catch (e) {
      next(e)
    }
  }
)

router.get('/admin/goods/stall', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listStallGoods(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/goods/stall', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.saveStallGoods(req.body, req.auth)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/goods/stall/:id/options', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    const stallOptionsService = require('../services/stallOptionsService')
    res.json(ok(await stallOptionsService.getGoodsOptionGroups(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.put('/admin/goods/stall/:id/options', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    const stallOptionsService = require('../services/stallOptionsService')
    res.json(
      ok(await stallOptionsService.saveGoodsOptionGroups(Number(req.params.id), req.body.groups || []))
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/goods/cross', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listCrossGoods(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/goods/cross', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.saveCrossGoods(req.body, req.auth)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/goods/supply', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listSupplyGoodsAdmin(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/goods/supply', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.saveSupplyGoods(req.body, req.auth)))
  } catch (e) {
    next(e)
  }
})

/** 快捷改积分/价格/上下架：只更新指定字段，禁止误新建 */
router.patch('/admin/goods/:type/:id', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    const type = String(req.params.type || '')
    if (!['stall', 'cross', 'supply'].includes(type)) {
      throw new HttpError(400, '商品类型无效')
    }
    res.json(ok(await adminService.patchGoods(type, Number(req.params.id), req.body || {})))
  } catch (e) {
    next(e)
  }
})

router.delete('/admin/goods/:type/:id', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    const type = String(req.params.type || '')
    if (!['stall', 'cross', 'supply'].includes(type)) {
      throw new HttpError(400, '商品类型无效')
    }
    res.json(ok(await opsService.softDeleteGoods(type, Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

/** C 端：启用中的商品类目（分类页入口，默认全部角色） */
router.get('/goods-categories', async (req, res, next) => {
  try {
    res.json(ok(await categoryService.listPublicCategories(req.query.role || 'all')))
  } catch (e) {
    next(e)
  }
})

/** C 端：类目下关联商家（二级列表） */
router.get('/goods-categories/:id/merchants', async (req, res, next) => {
  try {
    res.json(ok(await categoryService.listMerchantsByCategory(Number(req.params.id), req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/goods-categories/:id/goods', async (req, res, next) => {
  try {
    res.json(ok(await categoryService.listGoodsByCategory(Number(req.params.id), req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/goods-categories', ...adminOnly, requirePage('goods_categories'), async (req, res, next) => {
  try {
    res.json(ok(await categoryService.listCategories(req.query.role || '')))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/goods-categories', ...adminOnly, requirePage('goods_categories'), async (req, res, next) => {
  try {
    res.json(ok(await categoryService.saveCategory(req.body || {})))
  } catch (e) {
    next(e)
  }
})

router.patch(
  '/admin/goods-categories/:id/status',
  ...adminOnly,
  requirePage('goods_categories'),
  async (req, res, next) => {
    try {
      const categoryService = require('../services/categoryService')
      res.json(ok(await categoryService.setCategoryStatus(Number(req.params.id), req.body?.status)))
    } catch (e) {
      next(e)
    }
  }
)

router.delete('/admin/goods-categories/:id', ...adminOnly, requirePage('goods_categories'), async (req, res, next) => {
  try {
    res.json(ok(await categoryService.deleteCategory(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/orders/consumer', ...adminOnly, requirePage('orders'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listConsumerOrders(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/orders/cross', ...adminOnly, requirePage('orders'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listCrossOrders(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/orders/purchase', ...adminOnly, requirePage('orders'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listPurchaseOrders(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/orders/:type/:id', ...adminOnly, requirePage('orders'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.getOrderDetail(req.params.type, Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/settlements/commissions', ...adminOnly, requirePage('settlements'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await adminService.listCommissions({
          page: req.query.page,
          pageSize: req.query.pageSize,
          limit: req.query.limit
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/settlements/accounts', ...adminOnly, requirePage('settlements'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await adminService.listAccountLedgers({
          page: req.query.page,
          pageSize: req.query.pageSize,
          limit: req.query.limit,
          merchantId: req.query.merchantId
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/points/user-ledger', ...adminOnly, requirePage('points'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await adminService.listUserPointsLedger({
          page: req.query.page,
          pageSize: req.query.pageSize,
          limit: req.query.limit,
          userId: req.query.userId
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/points/pool-ledger', ...adminOnly, requirePage('points'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await adminService.listPoolLedger({
          page: req.query.page,
          pageSize: req.query.pageSize,
          limit: req.query.limit,
          merchantId: req.query.merchantId
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/banners/meta', ...adminOnly, requirePage('banners'), async (req, res, next) => {
  try {
    res.json(ok(adminService.bannerMeta()))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/banners', ...adminOnly, requirePage('banners'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await adminService.listAllBanners({
          roleScope: req.query.role || req.query.roleScope || '',
          pageKey: req.query.page || req.query.pageKey || ''
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.post('/admin/banners', ...adminOnly, requirePage('banners'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.saveBanner(req.body)))
  } catch (e) {
    next(e)
  }
})

router.delete('/admin/banners/:id', ...adminOnly, requirePage('banners'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.deleteBanner(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.patch('/admin/banners/:id/status', ...adminOnly, requirePage('banners'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.setBannerStatus(Number(req.params.id), req.body?.status)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/configs', ...adminOnly, requirePage('configs'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listConfigs()))
  } catch (e) {
    next(e)
  }
})

router.put('/admin/configs/:key', ...adminOnly, requirePage('configs'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.setConfig(req.params.key, req.body.value, req.body.remark)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/withdraws', ...adminOnly, requirePage('withdraws'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listWithdraws(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/withdraws/:id/review', ...adminOnly, requirePage('withdraws'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.reviewWithdraw(Number(req.params.id), req.body)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/withdraws/demo', ...adminOnly, requirePage('withdraws'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.createDemoWithdraw(req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/complaints', ...adminOnly, requirePage('complaints'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listComplaints(req.query)))
  } catch (e) {
    next(e)
  }
})

router.patch('/admin/complaints/:id', ...adminOnly, requirePage('complaints'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.updateComplaint(Number(req.params.id), req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/supply-needs', ...adminOnly, requirePage('needs'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listSupplyNeeds(req.query)))
  } catch (e) {
    next(e)
  }
})

router.patch('/admin/supply-needs/:id', ...adminOnly, requirePage('needs'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.updateSupplyNeed(Number(req.params.id), req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/partner-applies', ...adminOnly, requirePage('partner_ops'), async (req, res, next) => {
  try {
    res.json(ok(await partnerService.listPartnerApplies(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/platform-role-applies', ...adminOnly, requirePage('identity_flags'), async (req, res, next) => {
  try {
    res.json(ok(await partnerService.listPlatformRoleApplies(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post(
  '/admin/platform-role-applies/:id/approve',
  ...adminOnly,
  requirePage('identity_flags'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await partnerService.approvePlatformRoleApply(Number(req.params.id), {
            reviewerId: req.auth.adminId || req.auth.userId,
            reviewerName: req.auth.username || req.auth.name || ''
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/platform-role-applies/:id/reject',
  ...adminOnly,
  requirePage('identity_flags'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await partnerService.rejectPlatformRoleApply(Number(req.params.id), {
            reviewerId: req.auth.adminId || req.auth.userId,
            reviewerName: req.auth.username || req.auth.name || '',
            reason: req.body?.reason
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/partner-applies/:id/approve',
  ...adminOnly,
  requirePage('partner_ops'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await partnerService.approvePartnerApply(Number(req.params.id), {
            reviewerId: req.auth.adminId || req.auth.userId,
            reviewerName: req.auth.username || req.auth.name || ''
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/partner-applies/:id/reject',
  ...adminOnly,
  requirePage('partner_ops'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await partnerService.rejectPartnerApply(Number(req.params.id), {
            reviewerId: req.auth.adminId || req.auth.userId,
            reviewerName: req.auth.username || req.auth.name || '',
            reason: req.body?.reason
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get('/admin/partner-withdraws', ...adminOnly, requirePage('partner_ops'), async (req, res, next) => {
  try {
    res.json(ok(await partnerService.listPartnerWithdraws(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post(
  '/admin/partner-withdraws/:id/review',
  ...adminOnly,
  requirePage('partner_ops'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await partnerService.reviewPartnerWithdraw(Number(req.params.id), {
            action: req.body?.action || 'approve',
            reason: req.body?.reason,
            reviewerId: req.auth.userId
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get('/admin/partner-purchases', ...adminOnly, requirePage('partner_purchases'), async (req, res, next) => {
  try {
    res.json(ok(await partnerService.listAllPurchaseOrders(req.query)))
  } catch (e) {
    next(e)
  }
})

router.patch(
  '/admin/partner-purchases/:id',
  ...adminOnly,
  requirePage('partner_purchases'),
  async (req, res, next) => {
    try {
      res.json(ok(await partnerService.updatePurchaseStatus(req.params.id, req.body?.status)))
    } catch (e) {
      next(e)
    }
  }
)

router.get('/admin/identity-members', ...adminOnly, requirePage('identity_flags'), async (req, res, next) => {
  try {
    res.json(ok(await founderService.listMembers(req.auth, req.query)))
  } catch (e) {
    next(e)
  }
})

router.post(
  '/admin/identity-members/:id/flag',
  ...adminOnly,
  requirePage('identity_flags'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await founderService.setUserFlag(req.auth, req.params.id, {
            flag: req.body?.flag,
            value: req.body?.value
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get('/admin/op-logs', ...adminOnly, requirePage('op_logs'), async (req, res, next) => {
  try {
    res.json(ok(await founderService.listLogs(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/referrals', ...adminOnly, requirePage('referrals'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listReferrals(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/referral-triggers', ...adminOnly, requirePage('referral_triggers'), async (req, res, next) => {
  try {
    res.json(ok(await referralService.getSettings()))
  } catch (e) {
    next(e)
  }
})

router.put('/admin/referral-triggers', ...adminOnly, requirePage('referral_triggers'), async (req, res, next) => {
  try {
    res.json(ok(await referralService.saveSettings(req.body || {})))
  } catch (e) {
    next(e)
  }
})

router.put('/admin/referral-triggers/:key', ...adminOnly, requirePage('referral_triggers'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await referralService.saveTrigger({
          ...(req.body || {}),
          triggerKey: req.params.key
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

// ---------- 系统管理：角色 / 账号 / 权限 ----------
router.get('/admin/rbac/permissions', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await rbacService.listPermissionCatalog()))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/rbac/me', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await rbacService.getMyPermissions(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/rbac/roles', ...adminOnly, async (req, res, next) => {
  try {
    await rbacService.ensurePageAccess(req.auth, 'sys_roles', false)
    res.json(ok(await rbacService.listRoles()))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/rbac/roles/:id', ...adminOnly, async (req, res, next) => {
  try {
    await rbacService.ensurePageAccess(req.auth, 'sys_roles', false)
    res.json(ok(await rbacService.getRoleDetail(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/rbac/roles', ...adminOnly, requireSysRolesEdit, async (req, res, next) => {
  try {
    res.json(ok(await rbacService.saveRole(req.body)))
  } catch (e) {
    next(e)
  }
})

router.put('/admin/rbac/roles/:id/permissions', ...adminOnly, requireSysRolesEdit, async (req, res, next) => {
  try {
    res.json(
      ok(await rbacService.saveRolePermissions(Number(req.params.id), req.body.permissions || []))
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/rbac/accounts', ...adminOnly, async (req, res, next) => {
  try {
    await rbacService.ensurePageAccess(req.auth, 'sys_accounts', false)
    res.json(ok(await rbacService.listAccounts()))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/rbac/accounts', ...adminOnly, requireSysEdit, async (req, res, next) => {
  try {
    res.json(ok(await rbacService.saveAccount(req.body)))
  } catch (e) {
    next(e)
  }
})

// ---------- 媒体上传 / 删除 / 列表 ----------
router.post(
  '/admin/media/upload',
  ...adminOnly,
  requireAnyPage(
    ['sys_media', 'banners', 'goods', 'goods_sku', 'applies', 'stores_stall', 'stores_cross', 'stores_supply'],
    { edit: true }
  ),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) throw new HttpError(400, '请选择文件')
      const data = await storageService.uploadBuffer({
        buffer: req.file.buffer,
        mime: req.file.mimetype,
        originalName: req.file.originalname,
        bizType: req.body.bizType || 'general',
        adminId: req.auth.adminId || req.auth.userId || null,
        skipOptimize: req.body.skipOptimize === '1'
      })
      res.json(ok(data))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/admin/media',
  ...adminOnly,
  requireAnyPage(['sys_media', 'banners', 'goods', 'goods_sku'], { edit: false }),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await storageService.listMedia({
            bizType: req.query.bizType,
            page: req.query.page,
            pageSize: req.query.pageSize,
            limit: req.query.limit
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.delete('/admin/media', ...adminOnly, requirePage('sys_media', { edit: true }), async (req, res, next) => {
  try {
    res.json(
      ok(
        await storageService.deleteByKeyOrUrl({
          id: req.body.id || req.query.id,
          fileKey: req.body.fileKey || req.query.fileKey,
          fileUrl: req.body.fileUrl || req.query.fileUrl
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

// ---------- 分角色用户/门店 / SKU ----------
/** 数据大屏已下线 */
router.get('/admin/ops/screen', ...adminOnly, async (req, res) => {
  res.status(410).json({ code: 410, message: '数据大屏已下线', data: null })
})

/** 显式同步 mp-static 占位图；不会覆盖商户/运营已上传的真实 CDN 图。勿在启动流程调用。 */
router.post('/admin/sys/sync-mp-media', ...adminOnly, requirePage('sys_media', { edit: true }), async (req, res, next) => {
  try {
    const mediaSyncService = require('../services/mediaSyncService')
    res.json(ok(await mediaSyncService.syncAllMpStaticMedia()))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/sys/ensure-ops-roles', ...adminOnly, requirePage('sys_roles', { edit: true }), async (req, res, next) => {
  try {
    await rbacService.ensureOpsRolesAndAccounts()
    res.json(ok({ ok: true, accounts: await rbacService.listAccounts() }))
  } catch (e) {
    next(e)
  }
})

/** 为小程序用户开通/绑定后台账号（合伙人/创始人/负责人） */
router.post('/admin/sys/provision-ops-account', ...adminOnly, requirePage('sys_accounts', { edit: true }), async (req, res, next) => {
  try {
    res.json(
      ok(
        await rbacService.provisionLinkedOpsAccount({
          userId: req.body?.userId,
          roleCode: req.body?.roleCode,
          username: req.body?.username,
          password: req.body?.password || '123456',
          displayName: req.body?.displayName
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/ops/identities', ...adminOnly, async (req, res, next) => {
  try {
    const role = String(req.query.role || 'all')
    const pageKey =
      role === 'consumer'
        ? 'users_consumer'
        : role === 'stall'
          ? 'stores_stall'
          : role === 'cross'
            ? 'stores_cross'
            : role === 'supply'
              ? 'stores_supply'
              : 'users_all'
    await rbacService.ensurePageAccess(req.auth, pageKey, false)
    res.json(
      ok(
        await opsService.listAllIdentities({
          role: req.query.role,
          q: req.query.q,
          page: req.query.page,
          pageSize: req.query.pageSize,
          limit: req.query.limit
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get(
  '/admin/ops/stores/:id',
  ...adminOnly,
  requireAnyPage([...STORE_PAGES, 'applies'], { edit: false }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.getStoreDetail(Number(req.params.id))))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/admin/ops/biz-owners',
  ...adminOnly,
  requireAnyPage(STORE_EDIT_PAGES, { edit: false }),
  async (req, res, next) => {
    try {
      const rows = await rbacService.listAccounts()
      res.json(
        ok(
          (rows || [])
            .filter((a) => Number(a.status) === 1)
            .map((a) => ({
              id: a.id,
              username: a.username,
              displayName: a.displayName || a.username,
              roleName: a.roleName || ''
            }))
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/ops/stores',
  ...adminOnly,
  requireAnyPage(STORE_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.createStore(req.body || {})))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/ops/identities',
  ...adminOnly,
  requireAnyPage(PLATFORM_IDENTITY_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.createPlatformIdentity(req.body || {})))
    } catch (e) {
      next(e)
    }
  }
)

router.patch(
  '/admin/ops/stores/:id',
  ...adminOnly,
  requireAnyPage(STORE_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.updateStore(Number(req.params.id), req.body || {})))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/ops/stores/:id/status',
  ...adminOnly,
  requireAnyPage(STORE_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.setMerchantStatus(Number(req.params.id), req.body.status)))
    } catch (e) {
      next(e)
    }
  }
)

router.delete(
  '/admin/ops/stores/:id',
  ...adminOnly,
  requireAnyPage(STORE_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.softDeleteMerchant(Number(req.params.id))))
    } catch (e) {
      next(e)
    }
  }
)

router.put(
  '/admin/ops/stores/:id/materials',
  ...adminOnly,
  requireAnyPage(STORE_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.updateMerchantMaterials(Number(req.params.id), req.body.materials)))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/ops/users/:id/status',
  ...adminOnly,
  requireAnyPage(['users_consumer', 'users_all'], { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.setUserStatus(Number(req.params.id), req.body.status)))
    } catch (e) {
      next(e)
    }
  }
)

router.delete(
  '/admin/ops/users/:id',
  ...adminOnly,
  requireAnyPage(['users_consumer', 'users_all'], { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.softDeleteUser(Number(req.params.id))))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/admin/ops/skus',
  ...adminOnly,
  requireAnyPage(GOODS_EDIT_PAGES, { edit: false }),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await opsService.listSkus({
            type: req.query.type,
            merchantId: req.query.merchantId,
            shopName: req.query.shopName,
            dataSource: req.query.dataSource,
            includeDeleted: req.query.includeDeleted === '1',
            page: req.query.page,
            pageSize: req.query.pageSize,
            limit: req.query.limit
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/ops/skus/:type',
  ...adminOnly,
  requireAnyPage(GOODS_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.createSku(req.params.type, req.body || {}, req.auth)))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/admin/ops/goods-cleanup/preview',
  ...adminOnly,
  requireAnyPage(GOODS_EDIT_PAGES, { edit: false }),
  async (req, res, next) => {
    try {
      const sources = String(req.query.sources || 'test')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      res.json(ok(await opsService.previewGoodsCleanup({ sources })))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/ops/goods-cleanup/purge',
  ...adminOnly,
  requireAnyPage(GOODS_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      const body = req.body || {}
      res.json(
        ok(
          await opsService.purgeGoodsBySource({
            sources: body.sources || ['test'],
            confirm: body.confirm === true || body.confirm === 1 || body.confirm === '1'
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/ops/skus/:type/:id/open',
  ...adminOnly,
  requireAnyPage(GOODS_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.setGoodsOpen(req.params.type, Number(req.params.id), true)))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/ops/skus/:type/:id/close',
  ...adminOnly,
  requireAnyPage(GOODS_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.setGoodsOpen(req.params.type, Number(req.params.id), false)))
    } catch (e) {
      next(e)
    }
  }
)

router.delete(
  '/admin/ops/skus/:type/:id',
  ...adminOnly,
  requireAnyPage(GOODS_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.softDeleteGoods(req.params.type, Number(req.params.id))))
    } catch (e) {
      next(e)
    }
  }
)

router.put(
  '/admin/ops/skus/:type/:id',
  ...adminOnly,
  requireAnyPage(GOODS_EDIT_PAGES, { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await opsService.saveSku(req.params.type, { ...req.body, id: Number(req.params.id) })))
    } catch (e) {
      next(e)
    }
  }
)

router.post('/track/visit', async (req, res, next) => {
  try {
    res.json(ok(await opsService.trackVisit(req.body)))
  } catch (e) {
    next(e)
  }
})

// ---------- Banners ----------
router.get('/banners', async (req, res, next) => {
  try {
    res.json(ok(await catalogService.listBanners(req.query.role || 'consumer', req.query.page || '')))
  } catch (e) {
    next(e)
  }
})

// ---------- Catalog (C端) ----------
router.get('/stalls', async (req, res, next) => {
  try {
    res.json(ok(await orderService.listNearbyStalls(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/stalls/:id/menu', async (req, res, next) => {
  try {
    res.json(ok(await orderService.getStallMenu(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.get('/cross-stores', async (req, res, next) => {
  try {
    res.json(ok(await orderService.listCrossStores(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/cross-stores/:id', async (req, res, next) => {
  try {
    res.json(ok(await merchantPortalService.getCrossStoreDetail(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.get('/supply/merchants', async (req, res, next) => {
  try {
    res.json(ok(await merchantPortalService.listSupplyMerchants(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/supply/goods', async (_req, res, next) => {
  try {
    res.json(ok(await catalogService.listSupplyGoods()))
  } catch (e) {
    next(e)
  }
})

/** 小程序/入驻申请上传（公开，可带 token；类型与大小已收紧） */
router.post('/media/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, '请选择文件')
    assertUploadMime(req.file.mimetype)
    const data = await storageService.uploadBuffer({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mime: req.file.mimetype,
      bizType: req.body.bizType || 'license',
      adminId: null
    })
    res.json(ok(data))
  } catch (e) {
    next(e)
  }
})

/** 小程序 callContainer 友好：base64 上传 */
router.post('/media/upload-base64', async (req, res, next) => {
  try {
    const { content, fileName, mime, bizType } = req.body || {}
    if (!content) throw new HttpError(400, '缺少文件内容')
    assertUploadMime(mime || 'application/octet-stream')
    const raw = String(content).replace(/^data:[^;]+;base64,/, '')
    const buffer = Buffer.from(raw, 'base64')
    if (!buffer.length) throw new HttpError(400, '文件内容无效')
    if (buffer.length > 12 * 1024 * 1024) throw new HttpError(400, '文件过大')
    const data = await storageService.uploadBuffer({
      buffer,
      originalName: fileName || 'upload.bin',
      mime: mime || 'application/octet-stream',
      bizType: bizType || 'license',
      adminId: null
    })
    res.json(ok(data))
  } catch (e) {
    next(e)
  }
})

const CHUNK_ROOT = path.join(os.tmpdir(), 'xwen-upload-chunks')

function chunkDir(uploadId) {
  const id = String(uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (!id || id.length < 8 || id.length > 80) throw new HttpError(400, 'uploadId 无效')
  return path.join(CHUNK_ROOT, id)
}

router.post('/media/upload-base64-chunk', async (req, res, next) => {
  try {
    const { uploadId, index, total, content } = req.body || {}
    const i = Number(index)
    const n = Number(total)
    if (!Number.isInteger(i) || i < 0 || !Number.isInteger(n) || n < 1 || n > 200) {
      throw new HttpError(400, '分片参数无效')
    }
    if (i >= n) throw new HttpError(400, '分片序号越界')
    const piece = String(content || '')
    if (!piece) throw new HttpError(400, '分片内容为空')
    if (piece.length > 90 * 1024) throw new HttpError(400, '单片过大')
    const dir = chunkDir(uploadId)
    fs.mkdirSync(dir, { recursive: true })
    // 元信息写在 meta.json（首次带上）
    const metaPath = path.join(dir, 'meta.json')
    if (!fs.existsSync(metaPath)) {
      fs.writeFileSync(
        metaPath,
        JSON.stringify({
          total: n,
          fileName: req.body.fileName || 'upload.bin',
          mime: req.body.mime || 'application/octet-stream',
          bizType: req.body.bizType || 'license',
          createdAt: Date.now()
        })
      )
    }
    fs.writeFileSync(path.join(dir, `part-${i}`), piece, 'utf8')
    res.json(ok({ uploadId, index: i, total: n }))
  } catch (e) {
    next(e)
  }
})

router.post('/media/upload-base64-finish', async (req, res, next) => {
  try {
    const { uploadId } = req.body || {}
    const dir = chunkDir(uploadId)
    const metaPath = path.join(dir, 'meta.json')
    if (!fs.existsSync(metaPath)) throw new HttpError(400, '上传会话不存在或已过期')
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    const total = Number(meta.total) || 0
    const parts = []
    for (let i = 0; i < total; i++) {
      const p = path.join(dir, `part-${i}`)
      if (!fs.existsSync(p)) throw new HttpError(400, `缺少分片 ${i + 1}/${total}`)
      parts.push(fs.readFileSync(p, 'utf8'))
    }
    const raw = parts.join('').replace(/^data:[^;]+;base64,/, '')
    const buffer = Buffer.from(raw, 'base64')
    if (!buffer.length) throw new HttpError(400, '文件内容无效')
    if (buffer.length > 12 * 1024 * 1024) throw new HttpError(400, '文件过大')
    const data = await storageService.uploadBuffer({
      buffer,
      originalName: meta.fileName || 'upload.bin',
      mime: meta.mime || 'application/octet-stream',
      bizType: meta.bizType || 'license',
      adminId: null
    })
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (_) {}
    res.json(ok(data))
  } catch (e) {
    next(e)
  }
})

router.get('/config/cash-rate', async (_req, res, next) => {
  try {
    const rate = await getCashRate()
    res.json(ok({ rate, example: `100积分≈¥${pointsToCash(100, rate)}` }))
  } catch (e) {
    next(e)
  }
})

router.get('/config/merchant-agreement', async (req, res, next) => {
  try {
    const q = req.query || {}
    res.json(
      ok(
        await getMerchantAgreement({
          shopName: q.shopName || q.shop_name || '',
          legalPerson: q.legalPerson || q.legal_person || '',
          contactName: q.contactName || q.contact_name || '',
          contactPhone: q.contactPhone || q.contact_phone || '',
          city: q.city || '',
          address: q.address || '',
          role: q.role || '',
          roleLabel: q.roleLabel || q.role_label || '',
          date: q.date || ''
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get(
  '/admin/merchant-agreement',
  ...adminOnly,
  requireAnyPage(['applies', 'configs']),
  async (_req, res, next) => {
    try {
      const template = await getMerchantAgreementTemplate()
      res.json(
        ok({
          key: MERCHANT_AGREEMENT_KEY,
          template,
          placeholders: [
            'shopName',
            'legalPerson',
            'contactName',
            'contactPhone',
            'city',
            'address',
            'roleLabel',
            'date'
          ],
          hint: '入驻申请页会按商家填写信息自动替换 {{占位符}}；审核通过即视为同意本协议。'
        })
      )
    } catch (e) {
      next(e)
    }
  }
)

router.put(
  '/admin/merchant-agreement',
  ...adminOnly,
  requireAnyPage(['applies', 'configs'], { edit: true }),
  async (req, res, next) => {
    try {
      const template = String((req.body && req.body.template) || '').trim()
      if (!template) throw new HttpError(400, '协议内容不能为空')
      await setConfig(MERCHANT_AGREEMENT_KEY, template, '商户入驻协议模板（支持 {{shopName}} 等占位符）')
      res.json(ok({ key: MERCHANT_AGREEMENT_KEY, template }))
    } catch (e) {
      next(e)
    }
  }
)

router.get('/cities/resolve', async (req, res, next) => {
  try {
    res.json(ok(await cityService.resolveCity(req.query.lat, req.query.lng)))
  } catch (e) {
    next(e)
  }
})

router.get('/cities', async (_req, res, next) => {
  try {
    res.json(ok(await cityService.listOpenCities()))
  } catch (e) {
    next(e)
  }
})

// ---------- Consumer orders / points ----------
router.post(
  '/orders/stall/scan-pay',
  authRequired,
  requireRoles('consumer'),
  async (req, res, next) => {
    try {
      const data = await orderService.createScanPayOrder({
        userId: req.auth.userId,
        merchantId: Number(req.body.merchantId),
        amount: req.body.amount
      })
      res.json(ok(data))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/orders/stall/pay',
  authRequired,
  requireRoles('consumer'),
  async (req, res, next) => {
    try {
      const data = await orderService.createAndPayStallOrder({
        userId: req.auth.userId,
        merchantId: Number(req.body.merchantId),
        items: req.body.items || [],
        pointsUse: Number(req.body.pointsUse) || 0,
        remark: req.body.remark || req.body.buyerRemark || ''
      })
      res.json(ok(data))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/orders/stall/cancel',
  authRequired,
  requireRoles('consumer'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await orderService.cancelUnpaidConsumerOrder(
            req.body?.orderNo || req.body?.outTradeNo,
            req.auth.userId
          )
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/orders/stall/repay',
  authRequired,
  requireRoles('consumer'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await orderService.repayConsumerOrder(
            req.body?.orderNo || req.body?.outTradeNo,
            req.auth.userId
          )
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

/** 微信支付结果通知（无需登录；验签在服务内完成） */
router.post('/wxpay/notify', async (req, res) => {
  try {
    const raw =
      req.rawBody ||
      (Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {})))
    const result = await orderService.handleWxPayNotify(req.headers, raw)
    res.json({ code: 'SUCCESS', message: '成功', data: result })
  } catch (e) {
    console.error('[wxpay/notify]', e.message || e)
    res.status(e.status || 500).json({ code: 'FAIL', message: e.message || '处理失败' })
  }
})

/** 小程序支付成功后主动对账入账 */
router.post(
  '/orders/pay/sync',
  authRequired,
  requireRoles('consumer'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await orderService.syncConsumerPay(req.body?.orderNo || req.body?.outTradeNo, req.auth.userId)
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get('/wxpay/config-check', ...adminOnly, async (_req, res, next) => {
  try {
    const wxPayService = require('../services/wxPayService')
    const c = wxPayService.payConfig()
    const pub = wxPayService.publicKeyHealth()
    const priv = wxPayService.privateKeyHealth()
    res.json(
      ok({
        configured: wxPayService.wxPayConfigured(),
        mchId: c.mchId || null,
        appId: c.appId || null,
        serialNo: c.serialNo ? `${String(c.serialNo).slice(0, 6)}…` : null,
        hasPrivateKey: Boolean(c.privateKey),
        privateKeyPemKind: priv.pemKind,
        privateKeyLineCount: priv.lineCount,
        privateKeyHeader: priv.header,
        privateKeyFooter: priv.footer,
        privateKeyLooksSingleLine: priv.looksSingleLine,
        privateKeyParseOk: priv.parseOk,
        privateKeySignOk: priv.signOk,
        privateKeyError: priv.error,
        hasPublicKey: Boolean(c.wechatPubKey),
        publicKeyId: c.wechatPubKeyId || null,
        publicKeyPemKind: pub.pemKind,
        publicKeyParseOk: pub.parseOk,
        publicKeyEncryptOk: pub.encryptOk,
        publicKeyError: pub.error,
        mode: c.mode,
        allowDirect: c.allowDirect,
        platformSubMchId: c.platformSubMchId || null,
        profitSharing: c.profitSharing,
        notifyUrl: c.notifyUrl
      })
    )
  } catch (e) {
    next(e)
  }
})

/** —— 二级商户进件 / 分账比例 —— */
router.get(
  '/admin/wx-sub-merchants',
  ...adminOnly,
  requirePage('wx_sub_merchants'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await subMerchantService.listSubMerchants({
            q: req.query.q,
            state: req.query.state,
            role: req.query.role,
            page: req.query.page,
            pageSize: req.query.pageSize,
            limit: req.query.limit
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/admin/wx-sub-merchants/:id',
  ...adminOnly,
  requirePage('wx_sub_merchants'),
  async (req, res, next) => {
    try {
      res.json(ok(await subMerchantService.getSubMerchantDetail(Number(req.params.id))))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/wx-sub-merchants/:id/submit',
  ...adminOnly,
  requirePage('wx_sub_merchants', { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await subMerchantService.submitApplyment(Number(req.params.id), req.body || {})))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/wx-sub-merchants/:id/sync',
  ...adminOnly,
  requirePage('wx_sub_merchants'),
  async (req, res, next) => {
    try {
      res.json(ok(await subMerchantService.syncApplymentStatus(Number(req.params.id))))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/wx-sub-merchants/sync-pending',
  ...adminOnly,
  requirePage('wx_sub_merchants', { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await subMerchantService.syncPendingApplyments({ limit: req.body?.limit })))
    } catch (e) {
      next(e)
    }
  }
)

router.patch(
  '/admin/wx-sub-merchants/:id/profit-share-rate',
  ...adminOnly,
  requirePage('wx_sub_merchants', { edit: true }),
  async (req, res, next) => {
    try {
      res.json(
        ok(await subMerchantService.setProfitShareRate(Number(req.params.id), req.body?.rate))
      )
    } catch (e) {
      next(e)
    }
  }
)

router.patch(
  '/admin/wx-sub-merchants/:id/sub-mch-id',
  ...adminOnly,
  requirePage('wx_sub_merchants', { edit: true }),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await subMerchantService.setSubMchIdManual(
            Number(req.params.id),
            req.body?.subMchId ?? req.body?.wxSubMchId
          )
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.patch(
  '/admin/wx-sub-merchants/:id/settlement',
  ...adminOnly,
  requirePage('wx_sub_merchants', { edit: true }),
  async (req, res, next) => {
    try {
      res.json(ok(await subMerchantService.updateSettlementDraft(Number(req.params.id), req.body || {})))
    } catch (e) {
      next(e)
    }
  }
)

/** 商家端：进件状态 / 补结算资料 */
router.get(
  '/merchant/store-qrcode',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      if (!req.auth.merchantId) throw new HttpError(400, '未绑定门店')
      res.json(
        ok(
          await merchantPortalService.getOrCreateStoreQrcode(req.auth.merchantId, {
            kind: req.query.kind || 'menu',
            force: req.query.force === '1' || req.query.force === 'true'
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/wx-sub/status',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      if (!req.auth.merchantId) throw new HttpError(400, '未绑定门店')
      res.json(ok(await subMerchantService.getMerchantSelfWxStatus(req.auth.merchantId)))
    } catch (e) {
      next(e)
    }
  }
)

router.patch(
  '/merchant/wx-sub/settlement',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      if (!req.auth.merchantId) throw new HttpError(400, '未绑定门店')
      res.json(ok(await subMerchantService.merchantUpdateSettlement(req.auth.merchantId, req.body || {})))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/orders/cross/redeem',
  authRequired,
  requireRoles('consumer'),
  async (req, res, next) => {
    try {
      const data = await orderService.redeemCross({
        userId: req.auth.userId,
        merchantId: Number(req.body.merchantId),
        goodsId: Number(req.body.goodsId),
        payMode: req.body.payMode || 'points',
        pointsUse: Number(req.body.pointsUse) || 0
      })
      res.json(ok(data))
    } catch (e) {
      next(e)
    }
  }
)

router.get('/orders/mine', authRequired, requireRoles('consumer'), async (req, res, next) => {
  try {
    res.json(ok(await catalogService.listConsumerOrders(req.auth.userId)))
  } catch (e) {
    next(e)
  }
})

router.get(
  '/orders/detail/:orderNo',
  authRequired,
  requireRoles('consumer'),
  async (req, res, next) => {
    try {
      res.json(ok(await orderService.getConsumerOrderDetail(req.params.orderNo, req.auth.userId)))
    } catch (e) {
      next(e)
    }
  }
)

router.get('/points/me', authRequired, requireRoles('consumer'), async (req, res, next) => {
  try {
    const data = await catalogService.getUserPoints(req.auth.userId)
    const rate = await getCashRate()
    data.cashRate = rate
    data.cashValue = pointsToCash(data.points, rate)
    res.json(ok(data))
  } catch (e) {
    next(e)
  }
})

// ---------- Merchant ----------
router.post(
  '/merchant/purchase',
  authRequired,
  requireRoles('stall', 'cross'),
  async (req, res, next) => {
    try {
      const data = await orderService.createPurchaseOrder({
        buyerMerchantId: req.auth.merchantId,
        goodsId: Number(req.body.goodsId),
        qty: Number(req.body.qty) || 1,
        fulfillType: req.body.fulfillType || 'online'
      })
      res.json(ok(data))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/points-pool',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      const data = await catalogService.getPool(req.auth.merchantId)
      const rate = await getCashRate()
      data.cashRate = rate
      data.cashValue = pointsToCash(data.balance, rate)
      res.json(ok(data))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/dashboard',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(ok(await merchantPortalService.dashboard(req.auth.merchantId, req.auth.role)))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/orders',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await merchantPortalService.listOrders(req.auth.merchantId, req.auth.role, {
            type: req.query.type,
            limit: req.query.limit
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/merchant/orders/:id/complete',
  authRequired,
  requireRoles('stall'),
  async (req, res, next) => {
    try {
      res.json(
        ok(await merchantPortalService.completeStallOrder(req.auth.merchantId, req.params.id))
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/merchant/profile/status',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      const open = req.body.open === 1 || req.body.open === true || req.body.open === '1'
      res.json(ok(await merchantPortalService.setMerchantOpen(req.auth.merchantId, open)))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/fees/status',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(ok(await feeService.merchantFeeStatus(req.auth.merchantId)))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/goods',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(ok(await merchantPortalService.listGoods(req.auth.merchantId, req.auth.role)))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/merchant/goods',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(
        ok(await merchantPortalService.saveGoods(req.auth.merchantId, req.auth.role, req.body, req.auth))
      )
    } catch (e) {
      next(e)
    }
  }
)

router.patch(
  '/merchant/goods/:id',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await merchantPortalService.patchGoods(
            req.auth.merchantId,
            req.auth.role,
            req.params.id,
            req.body || {}
          )
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/goods/:id',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(ok(await merchantPortalService.getGoods(req.auth.merchantId, req.auth.role, req.params.id)))
    } catch (e) {
      next(e)
    }
  }
)

router.delete(
  '/merchant/goods/:id',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(
        ok(await merchantPortalService.deleteGoods(req.auth.merchantId, req.auth.role, req.params.id))
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/goods/:id/options',
  authRequired,
  requireRoles('stall'),
  async (req, res, next) => {
    try {
      res.json(
        ok(await merchantPortalService.getMerchantGoodsOptions(req.auth.merchantId, req.params.id))
      )
    } catch (e) {
      next(e)
    }
  }
)

router.put(
  '/merchant/goods/:id/options',
  authRequired,
  requireRoles('stall'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await merchantPortalService.saveMerchantGoodsOptions(
            req.auth.merchantId,
            req.params.id,
            req.body.groups || []
          )
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/customers',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(ok(await merchantPortalService.listCustomers(req.auth.merchantId, req.auth.role, req.query)))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/flow',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(ok(await merchantPortalService.listFlow(req.auth.merchantId, req.query)))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/supply-needs',
  authRequired,
  requireRoles('supply'),
  async (_req, res, next) => {
    try {
      res.json(ok(await adminService.listSupplyNeeds({ limit: 100 })))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/merchant/supply-needs/:id/quote',
  authRequired,
  requireRoles('supply'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await catalogService.quoteSupplyNeed(Number(req.params.id), {
            merchantId: req.auth.merchantId,
            status: req.body.status,
            quotePrice: req.body.quotePrice,
            quoteNote: req.body.quoteNote
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/admin/points-pool/grant',
  ...adminOnly,
  requireAnyPage(['points', ...STORE_EDIT_PAGES], { edit: true }),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await adminService.grantPool({
            merchantId: Number(req.body.merchantId),
            points: Number(req.body.points) || 500,
            title: req.body.title
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

// ---------- Merchant accounts / withdraw / purchase fulfill ----------
router.get(
  '/merchant/accounts',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(ok(await orderService.getMerchantAccounts(req.auth.merchantId)))
    } catch (e) {
      next(e)
    }
  }
)

router.get(
  '/merchant/withdraws',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(ok(await orderService.listMerchantWithdraws(req.auth.merchantId)))
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/merchant/withdraw',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await orderService.applyWithdraw({
            merchantId: req.auth.merchantId,
            accountType: req.body.accountType,
            amount: req.body.amount
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/merchant/purchase/:id/ship',
  authRequired,
  requireRoles('supply'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await orderService.shipPurchaseOrder({
            sellerMerchantId: req.auth.merchantId,
            orderId: Number(req.params.id)
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/merchant/purchase/:id/confirm',
  authRequired,
  requireRoles('stall', 'cross'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await orderService.confirmPurchaseOrder({
            buyerMerchantId: req.auth.merchantId,
            orderId: Number(req.params.id)
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.post(
  '/merchant/purchase/:id/cancel',
  authRequired,
  requireRoles('stall', 'cross', 'supply'),
  async (req, res, next) => {
    try {
      res.json(
        ok(
          await orderService.cancelPurchaseOrder({
            merchantId: req.auth.merchantId,
            orderId: Number(req.params.id),
            reason: req.body.reason,
            role: req.auth.role
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

// ---------- Referral / complaints / needs ----------
const promoterRoles = ['consumer', 'stall', 'cross', 'supply', 'partner', 'founder']

router.post('/referral/bind', authRequired, requireRoles(...promoterRoles), async (req, res, next) => {
  try {
    const userId = req.auth.userId
    if (!userId) throw new HttpError(400, '当前账号未绑定推广身份')
    res.json(ok(await referralService.bindReferrer({ userId, inviteCode: req.body.code })))
  } catch (e) {
    next(e)
  }
})

router.get('/referral/mine', authRequired, requireRoles(...promoterRoles), async (req, res, next) => {
  try {
    const userId = req.auth.userId
    if (!userId) throw new HttpError(400, '当前账号未绑定推广身份')
    res.json(ok(await referralService.listMyReferrals(userId)))
  } catch (e) {
    next(e)
  }
})

router.get('/referral/home', authRequired, requireRoles(...promoterRoles), async (req, res, next) => {
  try {
    const userId = req.auth.userId
    if (!userId) throw new HttpError(400, '当前账号未绑定推广身份')
    res.json(
      ok(
        await referralService.getHome(userId, {
          merchantId: req.auth.merchantId || null
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

/** 获取/刷新本人固定邀请小程序码 */
router.get('/referral/qrcode', authRequired, requireRoles(...promoterRoles), async (req, res, next) => {
  try {
    const userId = req.auth.userId
    if (!userId) throw new HttpError(400, '当前账号未绑定推广身份')
    const force = String(req.query.force || '') === '1'
    res.json(ok(await referralService.getOrCreateInviteQrcode(userId, { force })))
  } catch (e) {
    next(e)
  }
})

router.post('/complaints', authRequired, async (req, res, next) => {
  try {
    res.json(
      ok(
        await catalogService.submitComplaint({
          userId: req.auth.userId,
          targetType: req.body.targetType,
          targetId: req.body.targetId,
          content: req.body.content
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get('/supply-needs/mine', authRequired, requireRoles('consumer'), async (req, res, next) => {
  try {
    res.json(ok(await catalogService.listMySupplyNeeds(req.auth.userId)))
  } catch (e) {
    next(e)
  }
})

router.post('/supply-needs', authRequired, requireRoles('consumer'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await catalogService.submitSupplyNeed({
          userId: req.auth.userId,
          goodsName: req.body.goodsName,
          qtyText: req.body.qtyText,
          expectTime: req.body.expectTime,
          note: req.body.note
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

// ---------- Partner（区域合伙人） ----------
router.post('/partner/apply', authRequired, async (req, res, next) => {
  try {
    res.json(ok(await partnerService.submitPartnerApply(req.body, req.auth)))
  } catch (e) {
    next(e)
  }
})

router.post('/identity/role-apply', authRequired, async (req, res, next) => {
  try {
    res.json(ok(await partnerService.submitPlatformRoleApply(req.body || {}, req.auth)))
  } catch (e) {
    next(e)
  }
})

router.get('/partner/dashboard', ...partnerOnly, async (req, res, next) => {
  try {
    res.json(ok(await partnerService.getDashboard(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.post('/partner/withdraw', ...partnerOnly, async (req, res, next) => {
  try {
    res.json(ok(await partnerService.submitWithdraw(req.auth, req.body || {})))
  } catch (e) {
    next(e)
  }
})

// ---------- Founder（创始人轻控制台） ----------
router.get('/founder/overview', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.overview(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.get('/founder/applies', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.listMerchantApplies(req.auth, req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/founder/applies/:id/approve', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.approveMerchantApply(req.auth, req.params.id, req.body?.remark)))
  } catch (e) {
    next(e)
  }
})

router.post('/founder/applies/:id/reject', ...founderOnly, async (req, res, next) => {
  try {
    res.json(
      ok(await founderService.rejectMerchantApply(req.auth, req.params.id, req.body?.reason))
    )
  } catch (e) {
    next(e)
  }
})

router.get('/founder/partner-applies', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.listPartnerApplies(req.auth, req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/founder/partner-applies/:id/approve', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.approvePartner(req.auth, req.params.id)))
  } catch (e) {
    next(e)
  }
})

router.post('/founder/partner-applies/:id/reject', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.rejectPartner(req.auth, req.params.id, req.body?.reason)))
  } catch (e) {
    next(e)
  }
})

router.get('/founder/partner-withdraws', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.listWithdraws(req.auth, req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/founder/partner-withdraws/:id/review', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.reviewWithdraw(req.auth, req.params.id, req.body || {})))
  } catch (e) {
    next(e)
  }
})

router.get('/founder/members', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.listMembers(req.auth, req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/founder/logs', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.listLogs(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.get('/founder/perms', ...founderOnly, async (req, res, next) => {
  try {
    res.json(ok(await founderService.getPerms(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.post('/founder/users/:id/flag', ...founderOnly, async (req, res, next) => {
  try {
    res.json(
      ok(
        await founderService.setUserFlag(req.auth, req.params.id, {
          flag: req.body?.flag,
          value: req.body?.value
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.get('/partner/merchant-orders', ...partnerOnly, async (req, res, next) => {
  try {
    res.json(ok(await partnerService.listMerchantOrders(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.get('/partner/purchase-orders', ...partnerOnly, async (req, res, next) => {
  try {
    res.json(ok(await partnerService.listPurchaseOrders(req.auth)))
  } catch (e) {
    next(e)
  }
})

router.post('/partner/purchase-orders', ...partnerOnly, async (req, res, next) => {
  try {
    res.json(ok(await partnerService.submitPurchase(req.auth, req.body || {})))
  } catch (e) {
    next(e)
  }
})

module.exports = router

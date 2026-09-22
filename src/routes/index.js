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
const { getCashRate, pointsToCash } = require('../services/configService')
const categoryService = require('../services/categoryService')
const cityService = require('../services/cityService')
const feeService = require('../services/feeService')
const referralService = require('../services/referralService')

const router = express.Router()
const adminOnly = [authRequired, requireRoles('admin')]
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
})

/** 页面级 RBAC：GET 需浏览权，写操作需编辑权 */
function requirePage(pageKey) {
  return async (req, _res, next) => {
    try {
      const needEdit = !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())
      await rbacService.ensurePageAccess(req.auth, pageKey, needEdit)
      next()
    } catch (e) {
      next(e)
    }
  }
}

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

router.get('/health', async (_req, res) => {
  let db = { ok: false }
  try {
    const config = require('../config')
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
  res.status(db.ok ? 200 : 503).json(
    ok({
      service: 'xwen-alllink-api',
      ts: Date.now(),
      db
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
    const data = await authService.loginWithWeChat({
      jsCode: req.body.jsCode || req.body.code,
      nickname: req.body.nickname,
      avatarUrl: req.body.avatarUrl,
      openid: req.headers['x-wx-openid'] || req.headers['x-wx-from-openid'] || req.body.openid,
      unionid: req.headers['x-wx-unionid'] || req.body.unionid
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

// ---------- Apply ----------
router.get('/apply/license-rules', (_req, res) => {
  res.json(ok(applyService.ROLE_LICENSE_RULES))
})

router.post('/apply/submit', async (req, res, next) => {
  try {
    res.json(ok(await applyService.submitApply(req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/apply/status', async (req, res, next) => {
  try {
    res.json(ok(await applyService.queryByPhone(req.query.phone)))
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
      res.json(ok(await applyService.approveApply(Number(req.params.id), { reviewerId: req.auth.userId })))
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
            reviewerId: req.auth.userId
          })
        )
      )
    } catch (e) {
      next(e)
    }
  }
)

router.get('/admin/applies', ...adminOnly, requirePage('applies'), async (req, res, next) => {
  try {
    res.json(ok(await applyService.listApplies({ status: req.query.status, limit: req.query.limit })))
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

router.get('/admin/merchants', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await applyService.listMerchants({ role: req.query.role, limit: req.query.limit })))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/dashboard', ...adminOnly, requirePage('dashboard'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.dashboard()))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/merchants/:id', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.getMerchantDetail(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.patch('/admin/merchants/:id', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.updateMerchant(Number(req.params.id), req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/users', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listUsers({ q: req.query.q, limit: req.query.limit })))
  } catch (e) {
    next(e)
  }
})

router.patch('/admin/users/:id', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.updateUser(Number(req.params.id), req.body)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/users/:id/points', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.adjustUserPoints(Number(req.params.id), req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/goods/stall', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listStallGoods(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/goods/stall', ...adminOnly, requirePage('goods'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.saveStallGoods(req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/goods/stall/:id/options', ...adminOnly, async (req, res, next) => {
  try {
    const stallOptionsService = require('../services/stallOptionsService')
    res.json(ok(await stallOptionsService.getGoodsOptionGroups(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.put('/admin/goods/stall/:id/options', ...adminOnly, async (req, res, next) => {
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
    res.json(ok(await adminService.saveCrossGoods(req.body)))
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
    res.json(ok(await adminService.saveSupplyGoods(req.body)))
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
    res.json(ok(await adminService.listCommissions({ limit: req.query.limit })))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/settlements/accounts', ...adminOnly, requirePage('settlements'), async (req, res, next) => {
  try {
    res.json(
      ok(await adminService.listAccountLedgers({ limit: req.query.limit, merchantId: req.query.merchantId }))
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/points/user-ledger', ...adminOnly, requirePage('points'), async (req, res, next) => {
  try {
    res.json(
      ok(await adminService.listUserPointsLedger({ limit: req.query.limit, userId: req.query.userId }))
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/points/pool-ledger', ...adminOnly, requirePage('points'), async (req, res, next) => {
  try {
    res.json(
      ok(await adminService.listPoolLedger({ limit: req.query.limit, merchantId: req.query.merchantId }))
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/banners', ...adminOnly, requirePage('banners'), async (req, res, next) => {
  try {
    res.json(ok(await adminService.listAllBanners()))
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

router.get('/admin/media', ...adminOnly, async (req, res, next) => {
  try {
    await rbacService.ensurePageAccess(req.auth, 'sys_media', false).catch(async () => {
      // 无媒体页权限时仍允许有业务编辑权限的账号上传回显列表为空处理：允许查看自己上传
      return true
    })
    res.json(ok(await storageService.listMedia({ bizType: req.query.bizType, limit: req.query.limit })))
  } catch (e) {
    next(e)
  }
})

router.delete('/admin/media', ...adminOnly, async (req, res, next) => {
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

// ---------- 分角色用户/门店 / SKU / 大屏 ----------
router.get('/admin/ops/screen', ...adminOnly, requirePage('screen'), async (req, res, next) => {
  try {
    res.json(ok(await opsService.bigScreen()))
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
      ok(await opsService.listAllIdentities({ role: req.query.role, q: req.query.q, limit: req.query.limit }))
    )
  } catch (e) {
    next(e)
  }
})

router.get('/admin/ops/stores/:id', ...adminOnly, async (req, res, next) => {
  try {
    if (!rbacService.isSuperAdmin(req.auth)) {
      const { permissions } = await rbacService.getMyPermissions(req.auth)
      const okView = ['stores_stall', 'stores_cross', 'stores_supply', 'users_all', 'applies'].some(
        (k) => permissions[k] && permissions[k].view
      )
      if (!okView) throw new HttpError(403, '无浏览权限')
    }
    res.json(ok(await opsService.getStoreDetail(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/ops/stores/:id/status', ...adminOnly, async (req, res, next) => {
  try {
    if (!rbacService.isSuperAdmin(req.auth)) {
      const { permissions } = await rbacService.getMyPermissions(req.auth)
      const okEdit = ['stores_stall', 'stores_cross', 'stores_supply'].some(
        (k) => permissions[k] && permissions[k].edit
      )
      if (!okEdit) throw new HttpError(403, '无编辑权限')
    }
    res.json(ok(await opsService.setMerchantStatus(Number(req.params.id), req.body.status)))
  } catch (e) {
    next(e)
  }
})

router.delete('/admin/ops/stores/:id', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await opsService.softDeleteMerchant(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.put('/admin/ops/stores/:id/materials', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await opsService.updateMerchantMaterials(Number(req.params.id), req.body.materials)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/ops/users/:id/status', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await opsService.setUserStatus(Number(req.params.id), req.body.status)))
  } catch (e) {
    next(e)
  }
})

router.delete('/admin/ops/users/:id', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await opsService.softDeleteUser(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/ops/skus', ...adminOnly, requirePage('goods_sku'), async (req, res, next) => {
  try {
    res.json(
      ok(
        await opsService.listSkus({
          type: req.query.type,
          merchantId: req.query.merchantId,
          shopName: req.query.shopName,
          includeDeleted: req.query.includeDeleted === '1'
        })
      )
    )
  } catch (e) {
    next(e)
  }
})

router.post('/admin/ops/skus/:type/:id/open', ...adminOnly, requirePage('goods_sku'), async (req, res, next) => {
  try {
    res.json(ok(await opsService.setGoodsOpen(req.params.type, Number(req.params.id), true)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/ops/skus/:type/:id/close', ...adminOnly, requirePage('goods_sku'), async (req, res, next) => {
  try {
    res.json(ok(await opsService.setGoodsOpen(req.params.type, Number(req.params.id), false)))
  } catch (e) {
    next(e)
  }
})

router.delete('/admin/ops/skus/:type/:id', ...adminOnly, requirePage('goods_sku'), async (req, res, next) => {
  try {
    res.json(ok(await opsService.softDeleteGoods(req.params.type, Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.put('/admin/ops/skus/:type/:id', ...adminOnly, requirePage('goods_sku'), async (req, res, next) => {
  try {
    res.json(ok(await opsService.saveSku(req.params.type, { ...req.body, id: Number(req.params.id) })))
  } catch (e) {
    next(e)
  }
})

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

/** 小程序/入驻申请上传（公开，可带 token） */
router.post('/media/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, '请选择文件')
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
        pointsUse: Number(req.body.pointsUse) || 0
      })
      res.json(ok(data))
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
      res.json(ok(await merchantPortalService.saveGoods(req.auth.merchantId, req.auth.role, req.body)))
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

router.post('/admin/points-pool/grant', ...adminOnly, async (req, res, next) => {
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
})

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
const promoterRoles = ['consumer', 'stall', 'cross', 'supply']

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

module.exports = router

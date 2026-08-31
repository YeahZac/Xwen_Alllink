const express = require('express')
const { ok } = require('../utils/response')
const { authRequired, requireRoles } = require('../middleware/auth')
const { query } = require('../utils/db')
const authService = require('../services/authService')
const applyService = require('../services/applyService')
const orderService = require('../services/orderService')
const catalogService = require('../services/catalogService')
const adminService = require('../services/adminService')
const rbacService = require('../services/rbacService')
const { getCashRate, pointsToCash } = require('../services/configService')

const router = express.Router()
const adminOnly = [authRequired, requireRoles('admin')]

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
    const data = await authService.loginAsConsumer({ nickname: req.body.nickname })
    res.json(ok(data))
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

router.get('/admin/applies', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await applyService.listApplies({ status: req.query.status, limit: req.query.limit })))
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

router.get('/admin/dashboard', ...adminOnly, async (req, res, next) => {
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

router.get('/admin/goods/stall', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listStallGoods(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/goods/stall', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.saveStallGoods(req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/goods/cross', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listCrossGoods(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/goods/cross', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.saveCrossGoods(req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/goods/supply', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listSupplyGoodsAdmin(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/goods/supply', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.saveSupplyGoods(req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/orders/consumer', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listConsumerOrders(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/orders/cross', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listCrossOrders(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/orders/purchase', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listPurchaseOrders(req.query)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/banners', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listAllBanners()))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/banners', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.saveBanner(req.body)))
  } catch (e) {
    next(e)
  }
})

router.delete('/admin/banners/:id', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.deleteBanner(Number(req.params.id))))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/configs', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listConfigs()))
  } catch (e) {
    next(e)
  }
})

router.put('/admin/configs/:key', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.setConfig(req.params.key, req.body.value, req.body.remark)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/withdraws', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listWithdraws(req.query)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/withdraws/:id/review', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.reviewWithdraw(Number(req.params.id), req.body)))
  } catch (e) {
    next(e)
  }
})

router.post('/admin/withdraws/demo', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.createDemoWithdraw(req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/complaints', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listComplaints(req.query)))
  } catch (e) {
    next(e)
  }
})

router.patch('/admin/complaints/:id', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.updateComplaint(Number(req.params.id), req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/supply-needs', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listSupplyNeeds(req.query)))
  } catch (e) {
    next(e)
  }
})

router.patch('/admin/supply-needs/:id', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.updateSupplyNeed(Number(req.params.id), req.body)))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/referrals', ...adminOnly, async (req, res, next) => {
  try {
    res.json(ok(await adminService.listReferrals(req.query)))
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

// ---------- Banners ----------
router.get('/banners', async (req, res, next) => {
  try {
    res.json(ok(await catalogService.listBanners(req.query.role || 'consumer')))
  } catch (e) {
    next(e)
  }
})

// ---------- Catalog (C端) ----------
router.get('/stalls', async (_req, res, next) => {
  try {
    res.json(ok(await orderService.listNearbyStalls()))
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

router.get('/cross-stores', async (_req, res, next) => {
  try {
    res.json(ok(await orderService.listCrossStores()))
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

router.get('/config/cash-rate', async (_req, res, next) => {
  try {
    const rate = await getCashRate()
    res.json(ok({ rate, example: `100积分≈¥${pointsToCash(100, rate)}` }))
  } catch (e) {
    next(e)
  }
})

// ---------- Consumer orders / points ----------
router.post(
  '/orders/stall/pay',
  authRequired,
  requireRoles('consumer'),
  async (req, res, next) => {
    try {
      const data = await orderService.createAndPayStallOrder({
        userId: req.auth.userId,
        merchantId: Number(req.body.merchantId),
        items: req.body.items || []
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
        payMode: req.body.payMode || 'points'
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

router.post(
  '/admin/points-pool/grant',
  authRequired,
  requireRoles('admin', 'stall', 'cross'),
  async (req, res, next) => {
    try {
      // 演示：商户也可调此接口模拟后台发放；正式环境仅 admin
      const merchantId = req.auth.role === 'admin'
        ? Number(req.body.merchantId)
        : req.auth.merchantId
      res.json(
        ok(
          await orderService.adminGrantPool({
            merchantId,
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

// ---------- Referral / complaints / needs ----------
const referralService = require('../services/referralService')

router.post('/referral/bind', authRequired, requireRoles('consumer'), async (req, res, next) => {
  try {
    res.json(ok(await referralService.bindReferrer({ userId: req.auth.userId, inviteCode: req.body.code })))
  } catch (e) {
    next(e)
  }
})

router.get('/referral/mine', authRequired, requireRoles('consumer'), async (req, res, next) => {
  try {
    res.json(ok(await referralService.listMyReferrals(req.auth.userId)))
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

router.post('/supply-needs', async (req, res, next) => {
  try {
    res.json(
      ok(
        await catalogService.submitSupplyNeed({
          userId: req.auth?.userId || null,
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

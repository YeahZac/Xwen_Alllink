const express = require('express')
const { ok } = require('../utils/response')
const { authRequired, requireRoles } = require('../middleware/auth')
const authService = require('../services/authService')
const applyService = require('../services/applyService')
const orderService = require('../services/orderService')
const catalogService = require('../services/catalogService')
const { getCashRate, pointsToCash } = require('../services/configService')

const router = express.Router()

router.get('/health', (_req, res) => {
  res.json(ok({ service: 'xwen-alllink-api', ts: Date.now() }))
})

// ---------- Auth ----------
router.post('/auth/login', async (req, res, next) => {
  try {
    const data = await authService.loginByInviteCode(req.body.code)
    res.json(ok(data))
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
  authRequired,
  requireRoles('admin'),
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
  authRequired,
  requireRoles('admin'),
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

router.get('/admin/applies', authRequired, requireRoles('admin'), async (req, res, next) => {
  try {
    res.json(ok(await applyService.listApplies({ status: req.query.status, limit: req.query.limit })))
  } catch (e) {
    next(e)
  }
})

router.get('/admin/merchants', authRequired, requireRoles('admin'), async (req, res, next) => {
  try {
    res.json(ok(await applyService.listMerchants({ role: req.query.role, limit: req.query.limit })))
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

module.exports = router

const { query } = require('../utils/db')
const { HttpError } = require('../utils/response')
const applyService = require('./applyService')
const partnerService = require('./partnerService')

async function assertFounder(auth) {
  if (!auth) throw new HttpError(401, '未登录')
  if (auth.role === 'admin') return
  if (auth.role !== 'founder') throw new HttpError(403, '仅创始人可操作')
  const uid = Number(auth.userId) || 0
  if (!uid) throw new HttpError(403, '仅创始人可操作')
  try {
    const rows = await query(
      `SELECT IFNULL(is_founder,0) AS is_founder FROM users WHERE id=:id AND status=1 LIMIT 1`,
      { id: uid }
    )
    if (!rows.length || !Number(rows[0].is_founder)) {
      throw new HttpError(403, '当前账号未授权创始人身份')
    }
  } catch (e) {
    if (e instanceof HttpError) throw e
    // 列未迁移时：若 JWT 已是 founder 则放行（便于联调）
    if (!/Unknown column.*is_founder/i.test(String(e.message || ''))) throw e
  }
}

async function overview(auth) {
  await assertFounder(auth)
  let merchants = 0
  try {
    const rows = await query(`SELECT COUNT(*) AS c FROM merchants WHERE deleted_at IS NULL`)
    merchants = Number(rows[0].c) || 0
  } catch (_) {
    try {
      const rows = await query(`SELECT COUNT(*) AS c FROM merchants`)
      merchants = Number(rows[0].c) || 0
    } catch (__) {
      merchants = 0
    }
  }

  let pendingApplies = 0
  try {
    const rows = await query(
      `SELECT COUNT(*) AS c FROM merchant_applications WHERE status='pending' AND deleted_at IS NULL`
    ).catch(() =>
      query(`SELECT COUNT(*) AS c FROM merchant_applications WHERE status='pending'`)
    )
    pendingApplies = Number(rows[0].c) || 0
  } catch (_) {}

  let pendingPartners = 0
  try {
    const rows = await query(
      `SELECT COUNT(*) AS c FROM partner_applications WHERE status='pending'`
    )
    pendingPartners = Number(rows[0].c) || 0
  } catch (_) {}

  let pendingWithdraws = 0
  try {
    const rows = await query(
      `SELECT COUNT(*) AS c FROM partner_withdraw_requests WHERE status='pending'`
    )
    pendingWithdraws = Number(rows[0].c) || 0
  } catch (_) {}

  let todayOrders = 0
  try {
    const rows = await query(
      `SELECT COUNT(*) AS c FROM consumer_orders WHERE DATE(created_at)=CURDATE()`
    )
    todayOrders = Number(rows[0].c) || 0
  } catch (_) {}

  let userCnt = 0
  try {
    const rows = await query(`SELECT COUNT(*) AS c FROM users WHERE status=1`)
    userCnt = Number(rows[0].c) || 0
  } catch (_) {}

  return {
    metrics: {
      merchants,
      users: userCnt,
      todayOrders,
      pendingApplies,
      pendingPartners,
      pendingWithdraws
    },
    todoTotal: pendingApplies + pendingPartners + pendingWithdraws,
    menus: [
      { id: 'applies', title: '商家入驻审核', sub: `${pendingApplies} 待审`, url: '/founder/applies/applies?tab=merchant' },
      { id: 'partners', title: '合伙人审核', sub: `${pendingPartners} 待审`, url: '/founder/applies/applies?tab=partner' },
      { id: 'withdraws', title: '合伙人提现', sub: `${pendingWithdraws} 待审`, url: '/founder/applies/applies?tab=withdraw' },
      { id: 'members', title: '成员名单', sub: '用户 / 合伙人 / 创始人', url: '/founder/members/members' },
      { id: 'logs', title: '操作日志', sub: '审核与提现流水', url: '/founder/logs/logs' },
      { id: 'perms', title: '权限授权', sub: '开通合伙人/创始人', url: '/founder/perms/perms' },
      { id: 'admin', title: '完整运营台', sub: '重型配置请用 Web 控制台', url: '' }
    ]
  }
}

async function listMembers(auth, { q, role } = {}) {
  await assertFounder(auth)
  const keyword = String(q || '').trim()
  const roleFilter = String(role || '').trim()
  let sql = `SELECT id, nickname, phone, invite_code AS inviteCode, points_balance AS points,
                    IFNULL(is_partner,0) AS isPartner, IFNULL(is_founder,0) AS isFounder,
                    status, created_at AS createdAt
             FROM users WHERE status=1`
  const params = {}
  if (keyword) {
    sql += ` AND (nickname LIKE :kw OR phone LIKE :kw OR invite_code LIKE :kw OR CAST(id AS CHAR)=:exact)`
    params.kw = `%${keyword}%`
    params.exact = keyword
  }
  if (roleFilter === 'partner') sql += ` AND IFNULL(is_partner,0)=1`
  if (roleFilter === 'founder') sql += ` AND IFNULL(is_founder,0)=1`
  sql += ` ORDER BY id DESC LIMIT 100`
  try {
    const users = await query(sql, params)
    return users.map((u) => ({
      ...u,
      roleLabel: Number(u.isFounder)
        ? '创始人'
        : Number(u.isPartner)
          ? '合伙人'
          : '消费者'
    }))
  } catch (e) {
    if (/Unknown column.*is_partner|is_founder/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/26_user_identities.sql')
    }
    throw e
  }
}

async function listLogs(auth) {
  await assertFounder(auth)
  const logs = []
  try {
    const ops = await query(
      `SELECT id, actor_user_id AS actorId, actor_role AS actorRole, action, target_type AS targetType,
              target_id AS targetId, detail, created_at AS at
       FROM operation_logs ORDER BY id DESC LIMIT 60`
    )
    ops.forEach((r) => {
      logs.push({
        id: `op-${r.id}`,
        type: '操作日志',
        title: `${r.action} · ${r.targetType || ''}#${r.targetId || ''}`,
        status: r.actorRole || '',
        remark: r.detail || `操作人#${r.actorId || ''}`,
        time: r.at
      })
    })
  } catch (_) {}
  try {
    const applies = await query(
      `SELECT id, apply_no AS ref, role, shop_name AS title, status, reviewed_at AS at, reject_reason AS remark
       FROM merchant_applications
       WHERE status IN ('approved','rejected')
       ORDER BY reviewed_at DESC, id DESC LIMIT 40`
    )
    applies.forEach((r) => {
      logs.push({
        id: `ma-${r.id}`,
        type: '商家入驻',
        title: r.title || r.ref,
        status: r.status,
        remark: r.remark || '',
        time: r.at
      })
    })
  } catch (_) {}
  try {
    const partners = await query(
      `SELECT id, apply_no AS ref, contact_name AS title, status, reviewed_at AS at, reject_reason AS remark
       FROM partner_applications
       WHERE status IN ('approved','rejected')
       ORDER BY reviewed_at DESC, id DESC LIMIT 40`
    )
    partners.forEach((r) => {
      logs.push({
        id: `pa-${r.id}`,
        type: '合伙人申请',
        title: r.title || r.ref,
        status: r.status,
        remark: r.remark || '',
        time: r.at
      })
    })
  } catch (_) {}
  try {
    const wd = await query(
      `SELECT id, user_id AS title, amount_points AS pts, status, reviewed_at AS at, reject_reason AS remark
       FROM partner_withdraw_requests
       WHERE status IN ('approved','rejected','paid')
       ORDER BY reviewed_at DESC, id DESC LIMIT 40`
    )
    wd.forEach((r) => {
      logs.push({
        id: `pw-${r.id}`,
        type: '合伙人提现',
        title: `用户#${r.title} · ${r.pts}积分`,
        status: r.status,
        remark: r.remark || '',
        time: r.at
      })
    })
  } catch (_) {}
  logs.sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
  return logs.slice(0, 80)
}

async function getPerms(auth) {
  await assertFounder(auth)
  let partners = 0
  let founders = 0
  let merchants = 0
  try {
    const p = await query(`SELECT COUNT(*) AS c FROM users WHERE IFNULL(is_partner,0)=1 AND status=1`)
    partners = Number(p[0].c) || 0
    const f = await query(`SELECT COUNT(*) AS c FROM users WHERE IFNULL(is_founder,0)=1 AND status=1`)
    founders = Number(f[0].c) || 0
  } catch (_) {}
  try {
    const m = await query(`SELECT COUNT(*) AS c FROM merchants`)
    merchants = Number(m[0].c) || 0
  } catch (_) {}
  return {
    summary: { partners, founders, merchants },
    rules: [
      { key: 'consumer', label: '消费者', desc: '默认开通，逛店点餐与积分' },
      { key: 'merchant', label: '商家', desc: '入驻审核通过后按经营类型开通' },
      { key: 'partner', label: '合伙人', desc: '申请审核或创始人手动授权 is_partner' },
      { key: 'founder', label: '创始人', desc: '仅平台主账号授权 is_founder；负责人=权限子集（后续）' }
    ]
  }
}

async function writeOpLog(auth, action, targetType, targetId, detail) {
  try {
    await query(
      `INSERT INTO operation_logs (actor_user_id, actor_role, action, target_type, target_id, detail)
       VALUES (:uid, :role, :action, :tt, :tid, :detail)`,
      {
        uid: auth.userId || null,
        role: auth.role || '',
        action,
        tt: targetType || '',
        tid: String(targetId || ''),
        detail: String(detail || '').slice(0, 500)
      }
    )
  } catch (_) {}
}

async function setUserFlag(auth, userId, { flag, value } = {}) {
  await assertFounder(auth)
  const id = Number(userId) || 0
  if (!id) throw new HttpError(400, '无效用户')
  const col =
    flag === 'founder' ? 'is_founder' : flag === 'partner' ? 'is_partner' : flag === 'lead' ? 'is_lead' : ''
  if (!col) throw new HttpError(400, '无效权限标记')
  const v = value ? 1 : 0
  try {
    await query(`UPDATE users SET ${col}=:v WHERE id=:id`, { v, id })
  } catch (e) {
    if (/Unknown column/i.test(String(e.message || ''))) {
      throw new HttpError(503, '请先执行 sql/26_user_identities.sql')
    }
    throw e
  }
  await writeOpLog(auth, 'set_user_flag', 'user', id, `${flag}=${v}`)
  return { ok: true, userId: id, flag, value: !!v }
}

async function listMerchantApplies(auth, queryParams) {
  await assertFounder(auth)
  return applyService.listApplies(queryParams || { status: 'pending' })
}

async function approveMerchantApply(auth, id, remark) {
  await assertFounder(auth)
  return applyService.approveApply(Number(id), {
    reviewerId: auth.userId,
    remark
  })
}

async function rejectMerchantApply(auth, id, reason) {
  await assertFounder(auth)
  return applyService.rejectApply(Number(id), {
    reviewerId: auth.userId,
    reason
  })
}

async function listPartnerApplies(auth, queryParams) {
  await assertFounder(auth)
  return partnerService.listPartnerApplies(queryParams)
}

async function approvePartner(auth, id) {
  await assertFounder(auth)
  return partnerService.approvePartnerApply(Number(id), { reviewerId: auth.userId })
}

async function rejectPartner(auth, id, reason) {
  await assertFounder(auth)
  return partnerService.rejectPartnerApply(Number(id), {
    reviewerId: auth.userId,
    reason
  })
}

async function listWithdraws(auth, queryParams) {
  await assertFounder(auth)
  return partnerService.listPartnerWithdraws(queryParams)
}

async function reviewWithdraw(auth, id, body) {
  await assertFounder(auth)
  return partnerService.reviewPartnerWithdraw(Number(id), {
    action: body.action || 'approve',
    reason: body.reason,
    reviewerId: auth.userId
  })
}

module.exports = {
  assertFounder,
  overview,
  listMerchantApplies,
  approveMerchantApply,
  rejectMerchantApply,
  listPartnerApplies,
  approvePartner,
  rejectPartner,
  listWithdraws,
  reviewWithdraw,
  listMembers,
  listLogs,
  getPerms,
  setUserFlag
}

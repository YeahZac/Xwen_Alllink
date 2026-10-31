const crypto = require('crypto')
const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { signToken } = require('../middleware/auth')

const DEFAULT_SALT = 'xwen_admin_salt_v1'

/** 与运营台 NAV / 后续新增页面对齐；启动时同步入库并授予超级管理员 */
const PAGE_CATALOG = [
  { pageKey: 'screen', pageName: '数据大屏', groupName: '数据洞察', sortOrder: 5 },
  { pageKey: 'dashboard', pageName: '概览', groupName: '数据洞察', sortOrder: 10 },
  { pageKey: 'users_all', pageName: '用户总览', groupName: '用户与门店', sortOrder: 20 },
  { pageKey: 'users_consumer', pageName: 'C端用户', groupName: '用户与门店', sortOrder: 25 },
  { pageKey: 'stores_stall', pageName: '地摊门店', groupName: '用户与门店', sortOrder: 30 },
  { pageKey: 'stores_cross', pageName: '异业门店', groupName: '用户与门店', sortOrder: 35 },
  { pageKey: 'stores_supply', pageName: '供应链', groupName: '用户与门店', sortOrder: 40 },
  { pageKey: 'applies', pageName: '入驻审核', groupName: '用户与门店', sortOrder: 45 },
  { pageKey: 'cities', pageName: '经营城市', groupName: '用户与门店', sortOrder: 48 },
  { pageKey: 'orders', pageName: '订单中心', groupName: '交易运营', sortOrder: 50 },
  { pageKey: 'points', pageName: '积分与额度', groupName: '交易运营', sortOrder: 55 },
  { pageKey: 'settlements', pageName: '结算抽成', groupName: '交易运营', sortOrder: 60 },
  { pageKey: 'withdraws', pageName: '提现审核', groupName: '交易运营', sortOrder: 65 },
  { pageKey: 'referrals', pageName: '推荐记录', groupName: '交易运营', sortOrder: 70 },
  { pageKey: 'goods_sku', pageName: '商品SKU', groupName: '内容管理', sortOrder: 80 },
  { pageKey: 'goods', pageName: '商品目录', groupName: '内容管理', sortOrder: 85 },
  { pageKey: 'goods_categories', pageName: '商品类目', groupName: '内容管理', sortOrder: 88 },
  { pageKey: 'banners', pageName: 'Banner', groupName: '内容管理', sortOrder: 90 },
  { pageKey: 'needs', pageName: '供应需求', groupName: '内容管理', sortOrder: 95 },
  { pageKey: 'complaints', pageName: '投诉工单', groupName: '内容管理', sortOrder: 100 },
  { pageKey: 'configs', pageName: '平台配置', groupName: '内容管理', sortOrder: 105 },
  { pageKey: 'referral_triggers', pageName: '推荐奖励设置', groupName: '系统管理', sortOrder: 190 },
  { pageKey: 'sys_roles', pageName: '角色权限', groupName: '系统管理', sortOrder: 200 },
  { pageKey: 'sys_accounts', pageName: '账号管理', groupName: '系统管理', sortOrder: 210 },
  { pageKey: 'sys_media', pageName: '媒体资源', groupName: '系统管理', sortOrder: 220 }
]

function hashPassword(password, salt = DEFAULT_SALT) {
  return crypto.createHash('sha256').update(String(salt) + String(password)).digest('hex')
}

function isSuperAdmin(auth) {
  if (!auth || auth.role !== 'admin') return false
  // 邀请码兜底会话（未建表时）
  if (Number(auth.adminId) === 0 && auth.roleCode === 'super_admin') return true
  if (auth.roleCode === 'super_admin') return true
  if (Number(auth.roleId) === 1) return true
  return false
}

/** 启动时：补齐权限点、超级管理员角色/账号，并把全部页面授给超管 */
async function ensureRbacBootstrap() {
  for (const p of PAGE_CATALOG) {
    await query(
      `INSERT INTO admin_permissions (page_key, page_name, group_name, sort_order)
       VALUES (:k, :n, :g, :s)
       ON DUPLICATE KEY UPDATE page_name=VALUES(page_name), group_name=VALUES(group_name), sort_order=VALUES(sort_order)`,
      { k: p.pageKey, n: p.pageName, g: p.groupName, s: p.sortOrder }
    )
  }
  await query(
    `INSERT INTO admin_roles (id, code, name, remark, is_system, status)
     VALUES (1, 'super_admin', '超级管理员', '拥有全部页面浏览与编辑；新增功能自动授权', 1, 1)
     ON DUPLICATE KEY UPDATE name=VALUES(name), remark=VALUES(remark), is_system=1, status=1, code='super_admin'`
  )
  await query(
    `INSERT INTO admin_role_permissions (role_id, page_key, can_view, can_edit)
     SELECT 1, p.page_key, 1, 1 FROM admin_permissions p
     ON DUPLICATE KEY UPDATE can_view=1, can_edit=1`
  )
  const hash = hashPassword('123456', DEFAULT_SALT)
  await query(
    `INSERT INTO admin_accounts (id, username, password_hash, password_salt, display_name, role_id, status)
     VALUES (1, 'admin', :h, :salt, '超级管理员', 1, 1)
     ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), password_salt=VALUES(password_salt),
       display_name='超级管理员', role_id=1, status=1`,
    { h: hash, salt: DEFAULT_SALT }
  )
  return { pages: PAGE_CATALOG.length, superAdmin: 'admin' }
}

/** 业务新增页面时调用：登记权限点并自动授予超级管理员 */
async function registerPagePermission({ pageKey, pageName, groupName = '业务运营', sortOrder = 500 }) {
  if (!pageKey) throw new HttpError(400, 'pageKey 必填')
  await query(
    `INSERT INTO admin_permissions (page_key, page_name, group_name, sort_order)
     VALUES (:k, :n, :g, :s)
     ON DUPLICATE KEY UPDATE page_name=VALUES(page_name), group_name=VALUES(group_name), sort_order=VALUES(sort_order)`,
    { k: pageKey, n: pageName || pageKey, g: groupName, s: sortOrder }
  )
  await query(
    `INSERT INTO admin_role_permissions (role_id, page_key, can_view, can_edit)
     VALUES (1, :k, 1, 1)
     ON DUPLICATE KEY UPDATE can_view=1, can_edit=1`,
    { k: pageKey }
  )
  return { pageKey }
}

function verifyPassword(password, salt, passwordHash) {
  return hashPassword(password, salt) === passwordHash
}

async function listPermissionCatalog() {
  return query(
    `SELECT page_key AS pageKey, page_name AS pageName, group_name AS groupName, sort_order AS sortOrder
     FROM admin_permissions ORDER BY sort_order, id`
  )
}

async function getRolePermissions(roleId) {
  return query(
    `SELECT p.page_key AS pageKey, p.page_name AS pageName, p.group_name AS groupName,
            IFNULL(rp.can_view, 0) AS canView, IFNULL(rp.can_edit, 0) AS canEdit
     FROM admin_permissions p
     LEFT JOIN admin_role_permissions rp ON rp.page_key=p.page_key AND rp.role_id=:rid
     ORDER BY p.sort_order, p.id`,
    { rid: roleId }
  )
}

async function permissionsMapForRole(roleId) {
  const rows = await query(
    `SELECT page_key AS pageKey, can_view AS canView, can_edit AS canEdit
     FROM admin_role_permissions WHERE role_id=:rid`,
    { rid: roleId }
  )
  const map = {}
  for (const r of rows) {
    map[r.pageKey] = { view: !!r.canView, edit: !!r.canEdit }
  }
  return map
}

async function buildAdminSession(account) {
  const perms = await permissionsMapForRole(account.role_id)
  const token = signToken({
    role: 'admin',
    userId: account.id,
    adminId: account.id,
    roleId: account.role_id,
    roleCode: account.role_code,
    username: account.username,
    merchantId: null,
    shopName: account.display_name || account.username
  })
  return {
    token,
    role: 'admin',
    userId: account.id,
    adminId: account.id,
    username: account.username,
    name: account.display_name || account.username,
    nickname: account.display_name || account.username,
    shopName: '万业互联云运营台',
    roleId: account.role_id,
    roleCode: account.role_code,
    roleName: account.role_name,
    permissions: perms
  }
}

async function loginByPassword(username, password) {
  const rows = await query(
    `SELECT a.*, r.code AS role_code, r.name AS role_name, r.status AS role_status
     FROM admin_accounts a
     JOIN admin_roles r ON r.id=a.role_id
     WHERE a.username=:u LIMIT 1`,
    { u: String(username || '').trim() }
  )
  if (!rows.length) throw new HttpError(401, '账号或密码错误')
  const a = rows[0]
  if (a.status !== 1) throw new HttpError(403, '账号已停用')
  if (a.role_status !== 1) throw new HttpError(403, '所属角色已停用')
  if (!verifyPassword(password, a.password_salt, a.password_hash)) {
    throw new HttpError(401, '账号或密码错误')
  }
  await query('UPDATE admin_accounts SET last_login_at=NOW() WHERE id=:id', { id: a.id })
  return buildAdminSession(a)
}

/** 兼容旧邀请码 A001：映射到超级管理员会话 */
async function loginByAdminInviteCode(code) {
  const adminCode = String(process.env.ADMIN_CODE || 'A001').trim()
  if (String(code || '').trim() !== adminCode) return null

  const rows = await query(
    `SELECT a.*, r.code AS role_code, r.name AS role_name, r.status AS role_status
     FROM admin_accounts a
     JOIN admin_roles r ON r.id=a.role_id
     WHERE a.username='admin' AND a.status=1 LIMIT 1`
  )
  if (rows.length) {
    await query('UPDATE admin_accounts SET last_login_at=NOW() WHERE id=:id', { id: rows[0].id })
    return buildAdminSession(rows[0])
  }

  // 表未初始化时的兜底
  const token = signToken({
    role: 'admin',
    userId: 0,
    adminId: 0,
    roleId: 0,
    roleCode: 'super_admin',
    username: 'admin',
    merchantId: null,
    shopName: '平台运营'
  })
  const catalog = await listPermissionCatalog().catch(() => [])
  const permissions = {}
  for (const p of catalog) permissions[p.pageKey] = { view: true, edit: true }
  if (!Object.keys(permissions).length) {
    ;[
      'screen',
      'dashboard',
      'users_all',
      'users_consumer',
      'stores_stall',
      'stores_cross',
      'stores_supply',
      'applies',
      'orders',
      'points',
      'settlements',
      'withdraws',
      'referrals',
      'goods_sku',
      'goods',
      'goods_categories',
      'banners',
      'configs',
      'complaints',
      'needs',
      'referral_triggers',
      'sys_roles',
      'sys_accounts',
      'sys_media'
    ].forEach((k) => {
      permissions[k] = { view: true, edit: true }
    })
  }
  return {
    token,
    role: 'admin',
    userId: 0,
    adminId: 0,
    username: 'admin',
    name: '超级管理员',
    nickname: '超级管理员',
    shopName: '万业互联云运营台',
    roleId: 0,
    roleCode: 'super_admin',
    roleName: '超级管理员',
    permissions
  }
}

async function listRoles() {
  const roles = await query(
    `SELECT r.id, r.code, r.name, r.remark, r.is_system AS isSystem, r.status,
            (SELECT COUNT(*) FROM admin_accounts a WHERE a.role_id=r.id) AS accountCount,
            r.created_at AS createdAt
     FROM admin_roles r ORDER BY r.id`
  )
  return roles
}

async function getRoleDetail(id) {
  const rows = await query(
    `SELECT id, code, name, remark, is_system AS isSystem, status FROM admin_roles WHERE id=:id`,
    { id }
  )
  if (!rows.length) throw new HttpError(404, '角色不存在')
  const permissions = await getRolePermissions(id)
  return { ...rows[0], permissions }
}

async function saveRole(body) {
  const name = String(body.name || '').trim()
  const code = String(body.code || '').trim()
  if (!name) throw new HttpError(400, '请填写角色名称')
  if (body.id) {
    const rows = await query('SELECT id, is_system, code FROM admin_roles WHERE id=:id', { id: body.id })
    if (!rows.length) throw new HttpError(404, '角色不存在')
    const isSuperRole = Number(body.id) === 1 || rows[0].code === 'super_admin'
    if (isSuperRole && body.status === 0) {
      throw new HttpError(400, '不能停用超级管理员角色')
    }
    await query(
      `UPDATE admin_roles SET name=:name, remark=:remark, status=:status WHERE id=:id`,
      {
        id: Number(body.id),
        name: isSuperRole ? '超级管理员' : name,
        remark: body.remark || '',
        status: body.status === 0 ? 0 : 1
      }
    )
    return { id: Number(body.id) }
  }
  if (!code) throw new HttpError(400, '请填写角色编码')
  if (code === 'super_admin') throw new HttpError(400, '超级管理员角色编码不可新建')
  const exists = await query('SELECT id FROM admin_roles WHERE code=:c', { c: code })
  if (exists.length) throw new HttpError(400, '角色编码已存在')
  const r = await query(
    `INSERT INTO admin_roles (code, name, remark, is_system, status) VALUES (:c, :n, :r, 0, :s)`,
    { c: code, n: name, r: body.remark || '', s: body.status === 0 ? 0 : 1 }
  )
  return { id: r.insertId }
}

async function saveRolePermissions(roleId, permissions = []) {
  const roles = await query('SELECT id, code FROM admin_roles WHERE id=:id', { id: roleId })
  if (!roles.length) throw new HttpError(404, '角色不存在')
  const isSuperRole = Number(roleId) === 1 || roles[0].code === 'super_admin'
  // 超级管理员始终全开，避免误操作导致自己锁死
  if (isSuperRole) {
    await query(
      `INSERT INTO admin_role_permissions (role_id, page_key, can_view, can_edit)
       SELECT :rid, p.page_key, 1, 1 FROM admin_permissions p
       ON DUPLICATE KEY UPDATE can_view=1, can_edit=1`,
      { rid: Number(roleId) }
    )
    return { roleId: Number(roleId), forcedFull: true }
  }
  return withTransaction(async (conn) => {
    await conn.execute('DELETE FROM admin_role_permissions WHERE role_id=?', [roleId])
    for (const p of permissions) {
      if (!p.pageKey) continue
      let view = p.canView || p.view ? 1 : 0
      let edit = p.canEdit || p.edit ? 1 : 0
      if (edit) view = 1
      if (!view && !edit) continue
      await conn.execute(
        `INSERT INTO admin_role_permissions (role_id, page_key, can_view, can_edit)
         VALUES (?, ?, ?, ?)`,
        [roleId, p.pageKey, view, edit]
      )
    }
    return { roleId: Number(roleId) }
  })
}

async function listAccounts() {
  return query(
    `SELECT a.id, a.username, a.display_name AS displayName, a.role_id AS roleId,
            r.name AS roleName, r.code AS roleCode, a.status, a.last_login_at AS lastLoginAt,
            a.created_at AS createdAt
     FROM admin_accounts a
     JOIN admin_roles r ON r.id=a.role_id
     ORDER BY a.id`
  )
}

async function saveAccount(body) {
  const username = String(body.username || '').trim()
  const displayName = String(body.displayName || body.name || '').trim() || username
  const roleId = Number(body.roleId)
  if (!username) throw new HttpError(400, '请填写登录账号')
  if (!roleId) throw new HttpError(400, '请选择角色')
  const role = await query('SELECT id, code FROM admin_roles WHERE id=:id AND status=1', { id: roleId })
  if (!role.length) throw new HttpError(400, '角色无效或已停用')

  if (body.id) {
    const id = Number(body.id)
    const rows = await query(
      'SELECT id, username, role_id AS roleId FROM admin_accounts WHERE id=:id',
      { id }
    )
    if (!rows.length) throw new HttpError(404, '账号不存在')
    const isBuiltinAdmin = rows[0].username === 'admin' || Number(rows[0].id) === 1
    if (isBuiltinAdmin) {
      if (body.status === 0) throw new HttpError(400, '不能停用内置超级管理员账号')
      if (Number(roleId) !== 1) throw new HttpError(400, '内置 admin 账号必须保持超级管理员角色')
    }
    await query(
      `UPDATE admin_accounts SET display_name=:n, role_id=:rid, status=:s WHERE id=:id`,
      { id, n: isBuiltinAdmin ? '超级管理员' : displayName, rid: roleId, s: body.status === 0 ? 0 : 1 }
    )
    if (body.password) {
      const salt = DEFAULT_SALT
      await query(
        `UPDATE admin_accounts SET password_hash=:h, password_salt=:salt WHERE id=:id`,
        { id, h: hashPassword(body.password, salt), salt }
      )
    }
    return { id }
  }

  if (!body.password) throw new HttpError(400, '请设置初始密码')
  const exists = await query('SELECT id FROM admin_accounts WHERE username=:u', { u: username })
  if (exists.length) throw new HttpError(400, '登录账号已存在')
  const salt = DEFAULT_SALT
  const r = await query(
    `INSERT INTO admin_accounts (username, password_hash, password_salt, display_name, role_id, status)
     VALUES (:u, :h, :salt, :n, :rid, :s)`,
    {
      u: username,
      h: hashPassword(body.password, salt),
      salt,
      n: displayName,
      rid: roleId,
      s: body.status === 0 ? 0 : 1
    }
  )
  return { id: r.insertId }
}

async function getMyPermissions(auth) {
  if (isSuperAdmin(auth)) {
    const catalog = await listPermissionCatalog()
    const permissions = {}
    catalog.forEach((p) => {
      permissions[p.pageKey] = { view: true, edit: true }
    })
    return { permissions, roleCode: auth.roleCode || 'super_admin' }
  }
  if (!auth.roleId) throw new HttpError(403, '无角色权限')
  return {
    permissions: await permissionsMapForRole(auth.roleId),
    roleCode: auth.roleCode
  }
}

async function ensurePageAccess(auth, pageKey, needEdit = false) {
  if (!auth || auth.role !== 'admin') throw new HttpError(403, '无权限')
  if (isSuperAdmin(auth)) return true
  if (!auth.roleId) throw new HttpError(403, '无权限访问')
  const rows = await query(
    `SELECT can_view, can_edit FROM admin_role_permissions
     WHERE role_id=:rid AND page_key=:pk LIMIT 1`,
    { rid: auth.roleId, pk: pageKey }
  )
  if (!rows.length || !Number(rows[0].can_view)) {
    throw new HttpError(403, `无浏览权限：${pageKey}`)
  }
  if (needEdit && !Number(rows[0].can_edit)) {
    throw new HttpError(403, `无操作权限：${pageKey}`)
  }
  return true
}

/** 任一页面有权限即可（门店详情等跨页能力） */
async function ensureAnyPageAccess(auth, pageKeys = [], needEdit = false) {
  if (!auth || auth.role !== 'admin') throw new HttpError(403, '无权限')
  if (isSuperAdmin(auth)) return true
  let lastErr = null
  for (const k of pageKeys) {
    try {
      await ensurePageAccess(auth, k, needEdit)
      return true
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new HttpError(403, '无权限')
}

module.exports = {
  PAGE_CATALOG,
  hashPassword,
  isSuperAdmin,
  ensureRbacBootstrap,
  registerPagePermission,
  listPermissionCatalog,
  getRolePermissions,
  permissionsMapForRole,
  loginByPassword,
  loginByAdminInviteCode,
  listRoles,
  getRoleDetail,
  saveRole,
  saveRolePermissions,
  listAccounts,
  saveAccount,
  getMyPermissions,
  ensurePageAccess,
  ensureAnyPageAccess,
  buildAdminSession
}

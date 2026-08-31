const crypto = require('crypto')
const { query, withTransaction } = require('../utils/db')
const { HttpError } = require('../utils/response')
const { signToken } = require('../middleware/auth')

const DEFAULT_SALT = 'xwen_admin_salt_v1'

function hashPassword(password, salt = DEFAULT_SALT) {
  return crypto.createHash('sha256').update(String(salt) + String(password)).digest('hex')
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
      'dashboard',
      'applies',
      'merchants',
      'users',
      'goods',
      'orders',
      'banners',
      'configs',
      'withdraws',
      'complaints',
      'needs',
      'referrals',
      'sys_roles',
      'sys_accounts'
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
    const rows = await query('SELECT id, is_system FROM admin_roles WHERE id=:id', { id: body.id })
    if (!rows.length) throw new HttpError(404, '角色不存在')
    await query(
      `UPDATE admin_roles SET name=:name, remark=:remark, status=:status WHERE id=:id`,
      {
        id: Number(body.id),
        name,
        remark: body.remark || '',
        status: body.status === 0 ? 0 : 1
      }
    )
    return { id: Number(body.id) }
  }
  if (!code) throw new HttpError(400, '请填写角色编码')
  const exists = await query('SELECT id FROM admin_roles WHERE code=:c', { c: code })
  if (exists.length) throw new HttpError(400, '角色编码已存在')
  const r = await query(
    `INSERT INTO admin_roles (code, name, remark, is_system, status) VALUES (:c, :n, :r, 0, :s)`,
    { c: code, n: name, r: body.remark || '', s: body.status === 0 ? 0 : 1 }
  )
  return { id: r.insertId }
}

async function saveRolePermissions(roleId, permissions = []) {
  const roles = await query('SELECT id FROM admin_roles WHERE id=:id', { id: roleId })
  if (!roles.length) throw new HttpError(404, '角色不存在')
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
  const role = await query('SELECT id FROM admin_roles WHERE id=:id AND status=1', { id: roleId })
  if (!role.length) throw new HttpError(400, '角色无效或已停用')

  if (body.id) {
    const id = Number(body.id)
    const rows = await query('SELECT id FROM admin_accounts WHERE id=:id', { id })
    if (!rows.length) throw new HttpError(404, '账号不存在')
    await query(
      `UPDATE admin_accounts SET display_name=:n, role_id=:rid, status=:s WHERE id=:id`,
      { id, n: displayName, rid: roleId, s: body.status === 0 ? 0 : 1 }
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
  if (auth.roleCode === 'super_admin' || auth.roleId === 1 || auth.adminId === 0) {
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

function assertPageAccess(auth, pageKey, needEdit = false) {
  // bootstrap / super
  if (auth.roleCode === 'super_admin' || auth.roleId === 1 || auth.adminId === 0) return
  // permissions may be loaded later; for route middleware we query DB
}

async function ensurePageAccess(auth, pageKey, needEdit = false) {
  if (!auth || auth.role !== 'admin') throw new HttpError(403, '无权限')
  if (auth.roleCode === 'super_admin' || auth.roleId === 1 || auth.adminId === 0) return true
  if (!auth.roleId) throw new HttpError(403, '无权限访问')
  const rows = await query(
    `SELECT can_view, can_edit FROM admin_role_permissions
     WHERE role_id=:rid AND page_key=:pk LIMIT 1`,
    { rid: auth.roleId, pk: pageKey }
  )
  if (!rows.length || !rows[0].can_view) throw new HttpError(403, '无浏览权限')
  if (needEdit && !rows[0].can_edit) throw new HttpError(403, '无编辑权限')
  return true
}

module.exports = {
  hashPassword,
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
  buildAdminSession
}

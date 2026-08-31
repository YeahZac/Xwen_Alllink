-- =============================================================================
-- 仅创建业务库（在云托管 MySQL「SQL窗口」先执行这一段）
-- 库名：wanyehulian
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `wanyehulian`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

SHOW DATABASES LIKE 'wanyehulian';

-- 若账号不是 root，在「账号管理」里给 Cby_xw 勾选 wanyehulian 的全部权限
-- 或执行（需有授权权限的账号）：
-- GRANT ALL PRIVILEGES ON `wanyehulian`.* TO 'Cby_xw'@'%';
-- FLUSH PRIVILEGES;

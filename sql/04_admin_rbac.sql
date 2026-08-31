-- =============================================================================
-- 运营台 RBAC：角色 / 权限 / 账号
-- =============================================================================
USE `wanyehulian`;

CREATE TABLE IF NOT EXISTS `admin_roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NOT NULL COMMENT '角色编码',
  `name` VARCHAR(64) NOT NULL COMMENT '角色名称',
  `remark` VARCHAR(255) DEFAULT NULL,
  `is_system` TINYINT NOT NULL DEFAULT 0 COMMENT '1系统内置不可删',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运营角色';

CREATE TABLE IF NOT EXISTS `admin_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `page_key` VARCHAR(64) NOT NULL COMMENT '页面对应 nav id',
  `page_name` VARCHAR(64) NOT NULL,
  `group_name` VARCHAR(64) NOT NULL DEFAULT '业务运营',
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_page` (`page_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运营页面权限点';

CREATE TABLE IF NOT EXISTS `admin_role_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `page_key` VARCHAR(64) NOT NULL,
  `can_view` TINYINT NOT NULL DEFAULT 1,
  `can_edit` TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_page` (`role_id`,`page_key`),
  KEY `idx_page` (`page_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色-页面权限';

CREATE TABLE IF NOT EXISTS `admin_accounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL COMMENT '登录账号',
  `password_hash` VARCHAR(128) NOT NULL,
  `password_salt` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(64) NOT NULL DEFAULT '',
  `role_id` BIGINT UNSIGNED NOT NULL,
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  KEY `idx_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运营账号';

-- 页面权限点（与运营台导航一致）
INSERT INTO `admin_permissions` (`page_key`, `page_name`, `group_name`, `sort_order`) VALUES
('dashboard', '概览', '业务运营', 10),
('applies', '入驻审核', '业务运营', 20),
('merchants', '商户管理', '业务运营', 30),
('users', '用户积分', '业务运营', 40),
('goods', '商品目录', '业务运营', 50),
('orders', '订单中心', '业务运营', 60),
('banners', 'Banner', '业务运营', 70),
('configs', '平台配置', '业务运营', 80),
('withdraws', '提现审核', '业务运营', 90),
('complaints', '投诉工单', '业务运营', 100),
('needs', '供应需求', '业务运营', 110),
('referrals', '推荐记录', '业务运营', 120),
('sys_roles', '角色权限', '系统管理', 200),
('sys_accounts', '账号管理', '系统管理', 210)
ON DUPLICATE KEY UPDATE
  `page_name`=VALUES(`page_name`),
  `group_name`=VALUES(`group_name`),
  `sort_order`=VALUES(`sort_order`);

-- 超级管理员角色
INSERT INTO `admin_roles` (`id`, `code`, `name`, `remark`, `is_system`, `status`) VALUES
(1, 'super_admin', '超级管理员', '拥有全部页面浏览与编辑权限', 1, 1)
ON DUPLICATE KEY UPDATE
  `name`=VALUES(`name`),
  `remark`=VALUES(`remark`),
  `is_system`=1,
  `status`=1;

-- 授予全部页面 view+edit
INSERT INTO `admin_role_permissions` (`role_id`, `page_key`, `can_view`, `can_edit`)
SELECT 1, p.page_key, 1, 1 FROM `admin_permissions` p
ON DUPLICATE KEY UPDATE `can_view`=1, `can_edit`=1;

-- 默认超级管理员账号 admin / Admin@123
-- salt=xwen_admin_salt_v1  hash=sha256(salt + password)
INSERT INTO `admin_accounts`
  (`id`, `username`, `password_hash`, `password_salt`, `display_name`, `role_id`, `status`)
VALUES
(1, 'admin',
 '71843258803369413baec8620a0020dac0e84bffa4634e805728b2429ee88c3a',
 'xwen_admin_salt_v1',
 '超级管理员', 1, 1)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),
  `role_id`=1,
  `status`=1;

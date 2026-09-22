-- 运营台权限点对齐导航；补充默认角色与演示账号
INSERT INTO `admin_permissions` (`page_key`, `page_name`, `group_name`, `sort_order`) VALUES
('screen', '数据大屏', '数据洞察', 5),
('dashboard', '概览', '数据洞察', 10),
('users_all', '用户总览', '用户与门店', 20),
('users_consumer', 'C端用户', '用户与门店', 25),
('stores_stall', '地摊门店', '用户与门店', 30),
('stores_cross', '异业门店', '用户与门店', 35),
('stores_supply', '供应链', '用户与门店', 40),
('applies', '入驻审核', '用户与门店', 45),
('orders', '订单中心', '交易运营', 50),
('points', '积分与额度', '交易运营', 55),
('settlements', '结算抽成', '交易运营', 60),
('withdraws', '提现审核', '交易运营', 65),
('referrals', '推荐记录', '交易运营', 70),
('goods_sku', '商品SKU', '内容管理', 80),
('goods', '商品目录', '内容管理', 85),
('goods_categories', '商品类目', '内容管理', 88),
('banners', 'Banner', '内容管理', 90),
('needs', '供应需求', '内容管理', 95),
('complaints', '投诉工单', '内容管理', 100),
('configs', '平台配置', '内容管理', 105),
('referral_triggers', '推荐奖励设置', '系统管理', 190),
('sys_roles', '角色权限', '系统管理', 200),
('sys_accounts', '账号管理', '系统管理', 210),
('sys_media', '媒体资源', '系统管理', 220)
ON DUPLICATE KEY UPDATE
  `page_name` = VALUES(`page_name`),
  `group_name` = VALUES(`group_name`),
  `sort_order` = VALUES(`sort_order`);

INSERT INTO `admin_roles` (`id`, `code`, `name`, `remark`, `is_system`, `status`) VALUES
(1, 'super_admin', '超级管理员', '全部页面浏览与编辑', 1, 1),
(2, 'ops_admin', '运营管理员', '门店/用户/订单/商品日常运营', 1, 1),
(3, 'auditor', '入驻审核员', '仅入驻审核相关', 1, 1),
(4, 'finance', '财务专员', '提现、结算、积分额度', 1, 1),
(5, 'content', '内容编辑', 'Banner、类目、媒体、配置', 1, 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `remark` = VALUES(`remark`),
  `is_system` = 1,
  `status` = 1;

-- 超管：全开
INSERT INTO `admin_role_permissions` (`role_id`, `page_key`, `can_view`, `can_edit`)
SELECT 1, p.page_key, 1, 1 FROM `admin_permissions` p
ON DUPLICATE KEY UPDATE `can_view` = 1, `can_edit` = 1;

-- 运营管理员
DELETE FROM `admin_role_permissions` WHERE role_id = 2;
INSERT INTO `admin_role_permissions` (`role_id`, `page_key`, `can_view`, `can_edit`)
SELECT 2, p.page_key, 1, 1 FROM `admin_permissions` p
WHERE p.page_key IN (
  'dashboard','users_all','users_consumer','stores_stall','stores_cross','stores_supply',
  'applies','orders','points','goods_sku','goods','goods_categories','banners','needs',
  'complaints','referrals'
);

-- 入驻审核员：只读概览 + 审核编辑
DELETE FROM `admin_role_permissions` WHERE role_id = 3;
INSERT INTO `admin_role_permissions` (`role_id`, `page_key`, `can_view`, `can_edit`) VALUES
(3, 'dashboard', 1, 0),
(3, 'applies', 1, 1),
(3, 'stores_stall', 1, 0),
(3, 'stores_cross', 1, 0),
(3, 'stores_supply', 1, 0);

-- 财务专员
DELETE FROM `admin_role_permissions` WHERE role_id = 4;
INSERT INTO `admin_role_permissions` (`role_id`, `page_key`, `can_view`, `can_edit`) VALUES
(4, 'dashboard', 1, 0),
(4, 'orders', 1, 0),
(4, 'points', 1, 1),
(4, 'settlements', 1, 1),
(4, 'withdraws', 1, 1);

-- 内容编辑
DELETE FROM `admin_role_permissions` WHERE role_id = 5;
INSERT INTO `admin_role_permissions` (`role_id`, `page_key`, `can_view`, `can_edit`) VALUES
(5, 'dashboard', 1, 0),
(5, 'goods', 1, 1),
(5, 'goods_categories', 1, 1),
(5, 'goods_sku', 1, 1),
(5, 'banners', 1, 1),
(5, 'sys_media', 1, 1),
(5, 'configs', 1, 1);

-- 默认账号：admin / ops / audit / finance / content ，密码均为 123456
INSERT INTO `admin_accounts`
  (`id`, `username`, `password_hash`, `password_salt`, `display_name`, `role_id`, `status`)
VALUES
(1, 'admin',
 'b6a192c0d4d4ff4c8d9ced0f7b33d5a6644580696c38088ece51bacb03edfa3e',
 'xwen_admin_salt_v1', '超级管理员', 1, 1),
(2, 'ops',
 'b6a192c0d4d4ff4c8d9ced0f7b33d5a6644580696c38088ece51bacb03edfa3e',
 'xwen_admin_salt_v1', '运营管理员', 2, 1),
(3, 'audit',
 'b6a192c0d4d4ff4c8d9ced0f7b33d5a6644580696c38088ece51bacb03edfa3e',
 'xwen_admin_salt_v1', '入驻审核员', 3, 1),
(4, 'finance',
 'b6a192c0d4d4ff4c8d9ced0f7b33d5a6644580696c38088ece51bacb03edfa3e',
 'xwen_admin_salt_v1', '财务专员', 4, 1),
(5, 'content',
 'b6a192c0d4d4ff4c8d9ced0f7b33d5a6644580696c38088ece51bacb03edfa3e',
 'xwen_admin_salt_v1', '内容编辑', 5, 1)
ON DUPLICATE KEY UPDATE
  `password_hash` = VALUES(`password_hash`),
  `password_salt` = VALUES(`password_salt`),
  `display_name` = VALUES(`display_name`),
  `role_id` = VALUES(`role_id`),
  `status` = 1;

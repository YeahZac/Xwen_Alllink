-- 强化运营台 RBAC：补齐权限点、超级管理员角色与账号，超管自动拥有全部页面
-- 后续新增页面：写入 admin_permissions 后由 ensureRbacBootstrap / registerPagePermission 授给 role_id=1

INSERT INTO `admin_roles` (`id`, `code`, `name`, `remark`, `is_system`, `status`) VALUES
(1, 'super_admin', '超级管理员', '拥有全部页面浏览与编辑；新增功能自动授权', 1, 1)
ON DUPLICATE KEY UPDATE
  `code`='super_admin',
  `name`='超级管理员',
  `remark`='拥有全部页面浏览与编辑；新增功能自动授权',
  `is_system`=1,
  `status`=1;

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
  `page_name`=VALUES(`page_name`),
  `group_name`=VALUES(`group_name`),
  `sort_order`=VALUES(`sort_order`);

INSERT INTO `admin_role_permissions` (`role_id`, `page_key`, `can_view`, `can_edit`)
SELECT 1, p.`page_key`, 1, 1 FROM `admin_permissions` p
ON DUPLICATE KEY UPDATE `can_view`=1, `can_edit`=1;

-- 超级管理员账号 admin / 123456
INSERT INTO `admin_accounts`
  (`id`, `username`, `password_hash`, `password_salt`, `display_name`, `role_id`, `status`)
VALUES
(1, 'admin',
 'b6a192c0d4d4ff4c8d9ced0f7b33d5a6644580696c38088ece51bacb03edfa3e',
 'xwen_admin_salt_v1',
 '超级管理员', 1, 1)
ON DUPLICATE KEY UPDATE
  `password_hash`=VALUES(`password_hash`),
  `password_salt`=VALUES(`password_salt`),
  `display_name`='超级管理员',
  `role_id`=1,
  `status`=1;

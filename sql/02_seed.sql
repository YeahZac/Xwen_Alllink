-- =============================================================================
-- 万业互联云 · 演示种子数据
-- 执行前请先执行 01_schema.sql
-- =============================================================================

USE `wanyehulian`;

INSERT INTO `platform_config` (`config_key`, `config_value`, `remark`) VALUES
('points_cash_rate', '0.01', '1积分=多少元（抵现汇率）'),
('referral_first_order_reward', '50', '好友首单推荐奖励积分'),
('commission_rate_default', '0.001', '默认成交抽成约千分之一'),
('pool_shortage_policy', 'partial', '额度不足时：partial部分划拨 / block限制完单')
ON DUPLICATE KEY UPDATE `config_value`=VALUES(`config_value`);

-- 演示消费者
INSERT INTO `users` (`id`, `openid`, `invite_code`, `nickname`, `phone`, `points_balance`, `status`) VALUES
(1, 'demo_openid_c001', 'C001', '演示消费者', '13800000001', 286, 1)
ON DUPLICATE KEY UPDATE `nickname`=VALUES(`nickname`);

-- 演示商户
INSERT INTO `merchants` (`id`, `merchant_no`, `role`, `name`, `credit_code`, `legal_person`, `contact_name`, `contact_phone`, `city`, `address`, `cover_hue`, `status`, `invite_code`, `owner_user_id`) VALUES
(1, 'M_STALL_01', 'stall', '张记夜市炒面', '91360481MA39U4GA9B', '张老板', '张老板', '13800001001', '九江·瑞昌', '夜市一条街 A12', '#E60012', 1, 'D001', NULL),
(2, 'M_STALL_02', 'stall', '阿姐烤串档', '91360481MA39U4GA9C', '阿姐', '阿姐', '13800001002', '九江·瑞昌', '夜市一条街 B03', '#FF4757', 1, 'D002', NULL),
(3, 'M_CROSS_01', 'cross', '瑞昌果切小屋', '91360481MA39U4GA9D', '果切店长', '果切店长', '13800002001', '九江·瑞昌', '步行街 B12', '#F5A623', 1, 'Y001', NULL),
(4, 'M_SUPPLY_01', 'supply', '赣北粮油供应链', '91360481MA39U4GA9E', '供应链经理', '供应链经理', '13800003001', '九江·瑞昌', '工业园 8 号仓', '#E60012', 1, 'G001', NULL)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

INSERT INTO `merchant_points_pool` (`merchant_id`, `balance`) VALUES
(1, 5000), (2, 3200), (3, 2600)
ON DUPLICATE KEY UPDATE `balance`=VALUES(`balance`);

INSERT INTO `merchant_accounts` (`merchant_id`, `account_type`, `balance`) VALUES
(1, 'cash_settlement', 2860.00),
(3, 'cash_settlement', 1820.00),
(4, 'cash_goods', 21400.00),
(4, 'points_redeem', 8600.00)
ON DUPLICATE KEY UPDATE `balance`=VALUES(`balance`);

INSERT INTO `stall_goods` (`merchant_id`, `name`, `price`, `points_grant`, `category`, `desc_text`) VALUES
(1, '招牌炒面', 12.00, 18, '主食', '宽面现炒'),
(1, '加蛋', 2.00, 3, '配料', '配料'),
(1, '加火腿肠', 3.00, 4, '配料', '配料'),
(1, '酸辣粉', 10.00, 15, '主食', '可选微辣'),
(1, '冰红茶', 4.00, 5, '饮品', '饮品'),
(2, '羊肉串 ×5', 20.00, 28, '主食', '现烤'),
(2, '烤茄子', 8.00, 10, '主食', '蒜香');

INSERT INTO `cross_goods` (`merchant_id`, `name`, `points_need`, `cash_price`, `desc_text`) VALUES
(3, '时令果切拼盘', 200, 18.00, '当日鲜切'),
(3, '椰子水', 80, 8.00, '冷藏');

INSERT INTO `supply_goods` (`merchant_id`, `name`, `price`, `stock`, `points_grant`, `points_ratio_text`) VALUES
(4, '宽面 5kg', 28.00, 120, 280, '货值约1000:1'),
(4, '菜籽油 5L', 68.00, 40, 680, '货值约1000:1'),
(4, '火腿肠箱装', 45.00, 66, 360, '货值约800:1'),
(4, '时令水果箱', 88.00, 30, 880, '异业采购可获额度');

INSERT INTO `banners` (`role_scope`, `title`, `sub_title`, `image_url`, `link_url`, `link_type`, `sort_order`, `status`) VALUES
('consumer', '新客专享', '首单立减 · 扫码点餐', '/assets/banners/consumer-1.png', '/pages/stall-menu/stall-menu?id=1&from=scan', 'navigate', 1, 1),
('consumer', '积分抵现周', '100积分=1元 · 异业通用', '/assets/banners/consumer-2.png', '/pages/points/points', 'switchTab', 2, 1),
('stall', '采购获额度', '向供应链进货 · 划拨给顾客', '/assets/banners/stall-2.png', '/merchant/purchase/purchase', 'navigate', 1, 1),
('cross', '承接积分客', '自定兑换规则 · 全现金兜底', '/assets/banners/cross-1.png', '/merchant/goods/goods', 'navigate', 1, 1),
('supply', '拓展地摊客户', '货款与积分权益分账户', '/assets/banners/supply-1.png', '/merchant/customers/customers', 'navigate', 1, 1),
('login', '商户入驻', '地摊 / 异业 / 供应链', '/assets/banners/login-2.png', '/pages/apply/apply', 'navigate', 1, 1);

-- 运营后台登录码默认 A001（环境变量 ADMIN_CODE，不写入 merchants 表）
-- 演示码：C001 消费者 / D001 地摊 / Y001 异业 / G001 供应链 / A001 运营


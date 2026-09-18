-- =============================================================================
-- 万业互联云 · 演示种子数据（闭环样例 · 扩充版）
-- 执行前请先执行 01_schema.sql；存量库请先执行 03_patch.sql 及后续补丁
-- 可重复执行（固定主键 + ON DUPLICATE KEY UPDATE）
-- 规模：地摊/异业/供应链各 ≥5；商品与三类订单各 ≥5
-- =============================================================================

USE `wanyehulian`;

INSERT INTO `platform_config` (`config_key`, `config_value`, `remark`) VALUES
('points_cash_rate', '0.01', '1积分=多少元（抵现汇率）'),
('referral_first_order_reward', '50', '好友首单推荐奖励积分'),
('commission_rate_default', '0.001', '默认成交抽成约千分之一'),
('pool_shortage_policy', 'partial', '额度不足时：partial部分划拨 / block限制完单'),
('withdraw_t_plus', '1', '提现 T+N 工作日（演示配置）')
ON DUPLICATE KEY UPDATE `config_value`=VALUES(`config_value`), `remark`=VALUES(`remark`);

INSERT INTO `users` (`id`, `openid`, `invite_code`, `referrer_user_id`, `nickname`, `phone`, `points_balance`, `status`) VALUES
(1, 'demo_openid_c001', 'C001', NULL, '演示消费者', '13800000001', 286, 1),
(2, 'demo_openid_c002', 'C002', 1, '好友小李', '13800000002', 80, 1),
(3, 'demo_openid_c003', 'C003', 1, '夜市常客阿强', '13800000003', 120, 1),
(4, 'demo_openid_c004', 'C004', 1, '上班族小周', '13800000004', 160, 1),
(5, 'demo_openid_c005', 'C005', 2, '旅游客小美', '13800000005', 45, 1)
ON DUPLICATE KEY UPDATE
  `nickname`=VALUES(`nickname`),
  `referrer_user_id`=VALUES(`referrer_user_id`),
  `points_balance`=VALUES(`points_balance`),
  `phone`=VALUES(`phone`);

INSERT INTO `merchants` (
  `id`, `merchant_no`, `role`, `name`, `credit_code`, `legal_person`, `contact_name`, `contact_phone`,
  `city`, `address`, `latitude`, `longitude`, `cover_hue`, `status`, `invite_code`, `owner_user_id`
) VALUES
(1, 'M_STALL_01', 'stall', '张记夜市炒面', '91360481MA39U4GA9B', '张老板', '张老板', '13800001001',
 '九江·瑞昌', '夜市一条街 A12', 29.6761000, 115.6810000, '#E60012', 1, 'D001', NULL),
(2, 'M_STALL_02', 'stall', '阿姐烤串档', '91360481MA39U4GA9C', '阿姐', '阿姐', '13800001002',
 '九江·瑞昌', '夜市一条街 B03', 29.6765000, 115.6818000, '#FF4757', 1, 'D002', NULL),
(6, 'M_STALL_03', 'stall', '老周臭豆腐', '91360481MA39U4GB01', '周师傅', '周师傅', '13800001003',
 '九江·瑞昌', '夜市一条街 C05', 29.6768000, 115.6822000, '#C41E3A', 1, 'D003', NULL),
(7, 'M_STALL_04', 'stall', '深夜麻辣烫', '91360481MA39U4GB02', '陈姐', '陈姐', '13800001004',
 '九江·浔阳', '湓浦路夜市 08', 29.7051000, 116.0012000, '#9B1530', 1, 'D004', NULL),
(8, 'M_STALL_05', 'stall', '阿强煎饼果子', '91360481MA39U4GB03', '阿强', '阿强', '13800001005',
 '九江·柴桑', '火车站夜市 03', 29.6688000, 115.9905000, '#D63A52', 1, 'D005', NULL),
(3, 'M_CROSS_01', 'cross', '瑞昌果切小屋', '91360481MA39U4GA9D', '果切店长', '果切店长', '13800002001',
 '九江·瑞昌', '步行街 B12', 29.6752000, 115.6795000, '#F5A623', 1, 'Y001', NULL),
(5, 'M_CROSS_02', 'cross', '老街奶茶铺', '91360481MA39U4GA9F', '奶茶店长', '奶茶店长', '13800002002',
 '九江·瑞昌', '老街 16 号', 29.6748000, 115.6788000, '#2EC4B6', 1, 'Y002', NULL),
(9, 'M_CROSS_03', 'cross', '浔阳花艺馆', '91360481MA39U4GB04', '花艺店长', '花艺店长', '13800002003',
 '九江·浔阳', '大中路 88 号', 29.7072000, 115.9928000, '#E8A317', 1, 'Y003', NULL),
(10, 'M_CROSS_04', 'cross', '柴桑洗车行', '91360481MA39U4GB05', '洗车店长', '洗车店长', '13800002004',
 '九江·柴桑', '昌九大道旁', 29.6702000, 115.9850000, '#2F6F5E', 1, 'Y004', NULL),
(11, 'M_CROSS_05', 'cross', '庐山足道馆', '91360481MA39U4GB06', '足道店长', '足道店长', '13800002005',
 '九江·庐山', '牯岭镇商街', 29.5755000, 115.9801000, '#9A7B2F', 1, 'Y005', NULL),
(4, 'M_SUPPLY_01', 'supply', '赣北粮油供应链', '91360481MA39U4GA9E', '供应链经理', '供应链经理', '13800003001',
 '九江·瑞昌', '工业园 8 号仓', 29.6900000, 115.7000000, '#E60012', 1, 'G001', NULL),
(12, 'M_SUPPLY_02', 'supply', '鄱阳湖冻品仓', '91360481MA39U4GB07', '冻品经理', '冻品经理', '13800003002',
 '九江·浔阳', '城东冻库区 A3', 29.7200000, 116.0200000, '#1A5F7A', 1, 'G002', NULL),
(13, 'M_SUPPLY_03', 'supply', '昌九调味品厂', '91360481MA39U4GB08', '调味厂长', '调味厂长', '13800003003',
 '九江·柴桑', '工业大道 16 号', 29.6550000, 115.9600000, '#C41E3A', 1, 'G003', NULL),
(14, 'M_SUPPLY_04', 'supply', '赣江包装耗材', '91360481MA39U4GB09', '耗材经理', '耗材经理', '13800003004',
 '九江·瑞昌', '物流园 3 栋', 29.6850000, 115.7100000, '#5B616B', 1, 'G004', NULL),
(15, 'M_SUPPLY_05', 'supply', '浔阳生鲜集配', '91360481MA39U4GB10', '集配站长', '集配站长', '13800003005',
 '九江·浔阳', '农批市场 12 号', 29.7150000, 116.0050000, '#2F6F5E', 1, 'G005', NULL)
ON DUPLICATE KEY UPDATE
  `name`=VALUES(`name`), `city`=VALUES(`city`), `address`=VALUES(`address`),
  `latitude`=VALUES(`latitude`), `longitude`=VALUES(`longitude`), `status`=VALUES(`status`),
  `cover_hue`=VALUES(`cover_hue`), `contact_phone`=VALUES(`contact_phone`);

INSERT INTO `merchant_points_pool` (`merchant_id`, `balance`) VALUES
(1, 5000), (2, 3200), (3, 2600), (5, 880),
(6, 1500), (7, 2100), (8, 980),
(9, 1200), (10, 600), (11, 2400)
ON DUPLICATE KEY UPDATE `balance`=VALUES(`balance`);

INSERT INTO `merchant_accounts` (`merchant_id`, `account_type`, `balance`, `frozen`) VALUES
(1, 'cash_settlement', 2860.00, 0.00),
(2, 'cash_settlement', 420.00, 0.00),
(3, 'cash_settlement', 1820.00, 200.00),
(4, 'cash_goods', 20900.00, 500.00),
(4, 'points_redeem', 8600.00, 0.00),
(5, 'cash_settlement', 96.00, 0.00),
(6, 'cash_settlement', 310.00, 0.00),
(7, 'cash_settlement', 540.00, 0.00),
(8, 'cash_settlement', 188.00, 0.00),
(9, 'cash_settlement', 420.00, 0.00),
(10, 'cash_settlement', 260.00, 0.00),
(11, 'cash_settlement', 780.00, 0.00),
(12, 'cash_goods', 8600.00, 0.00),
(12, 'points_redeem', 1200.00, 0.00),
(13, 'cash_goods', 4500.00, 0.00),
(13, 'points_redeem', 680.00, 0.00),
(14, 'cash_goods', 2200.00, 0.00),
(14, 'points_redeem', 320.00, 0.00),
(15, 'cash_goods', 5800.00, 0.00),
(15, 'points_redeem', 900.00, 0.00)
ON DUPLICATE KEY UPDATE `balance`=VALUES(`balance`), `frozen`=VALUES(`frozen`);

INSERT INTO `stall_goods` (`id`, `merchant_id`, `name`, `price`, `points_grant`, `category`, `desc_text`, `stock`, `on_sale`) VALUES
(1, 1, '招牌炒面', 12.00, 18, '主食', '宽面现炒', 9999, 1),
(2, 1, '加蛋', 2.00, 3, '配料', '配料', 9999, 1),
(3, 1, '加火腿肠', 3.00, 4, '配料', '配料', 9999, 1),
(4, 1, '酸辣粉', 10.00, 15, '主食', '可选微辣', 9999, 1),
(5, 1, '冰红茶', 4.00, 5, '饮品', '饮品', 9999, 1),
(6, 2, '羊肉串 ×5', 20.00, 28, '主食', '现烤', 9999, 1),
(7, 2, '烤茄子', 8.00, 10, '主食', '蒜香', 9999, 1),
(8, 2, '啤酒烤翅', 15.00, 20, '主食', '半翅四只', 9999, 1),
(9, 6, '经典臭豆腐', 8.00, 12, '小吃', '外酥内嫩', 9999, 1),
(10, 6, '辣味臭豆腐', 9.00, 13, '小吃', '特辣', 9999, 1),
(11, 7, '麻辣烫小份', 16.00, 22, '主食', '自选菜', 9999, 1),
(12, 7, '麻辣烫大份', 22.00, 30, '主食', '加宽粉', 9999, 1),
(13, 8, '煎饼果子', 7.00, 10, '主食', '薄脆现烙', 9999, 1),
(14, 8, '鸡蛋灌饼', 8.00, 11, '主食', '加火腿', 9999, 1),
(15, 8, '豆浆', 3.00, 4, '饮品', '现磨', 9999, 1)
ON DUPLICATE KEY UPDATE `merchant_id`=VALUES(`merchant_id`), `name`=VALUES(`name`), `price`=VALUES(`price`), `points_grant`=VALUES(`points_grant`),
  `category`=VALUES(`category`), `desc_text`=VALUES(`desc_text`), `stock`=VALUES(`stock`), `on_sale`=VALUES(`on_sale`);

INSERT INTO `cross_goods` (`id`, `merchant_id`, `name`, `points_need`, `cash_price`, `desc_text`, `on_sale`) VALUES
(1, 3, '时令果切拼盘', 200, 18.00, '当日鲜切', 1),
(2, 3, '椰子水', 80, 8.00, '冷藏', 1),
(3, 5, '招牌奶茶', 100, 12.00, '少糖去冰可选', 1),
(4, 5, '杨枝甘露', 120, 15.00, '芒果椰浆', 1),
(5, 9, '迷你花束', 180, 28.00, '可积分兑', 1),
(6, 9, '绿植盆栽', 260, 48.00, '办公室友好', 1),
(7, 10, '标准洗车', 150, 25.00, '外观清洗', 1),
(8, 10, '精洗套餐', 280, 58.00, '内外精洗', 1),
(9, 11, '足道 45 分钟', 220, 68.00, '含茶水', 1),
(10, 11, '肩颈舒缓', 180, 58.00, '30 分钟', 1)
ON DUPLICATE KEY UPDATE `merchant_id`=VALUES(`merchant_id`), `name`=VALUES(`name`), `points_need`=VALUES(`points_need`), `cash_price`=VALUES(`cash_price`),
  `desc_text`=VALUES(`desc_text`), `on_sale`=VALUES(`on_sale`);

INSERT INTO `supply_goods` (`id`, `merchant_id`, `name`, `price`, `stock`, `points_grant`, `points_ratio_text`, `status`) VALUES
(1, 4, '宽面 5kg', 28.00, 118, 280, '货值约1000:1', 1),
(2, 4, '菜籽油 5L', 68.00, 39, 680, '货值约1000:1', 1),
(3, 4, '火腿肠箱装', 45.00, 66, 360, '货值约800:1', 1),
(4, 4, '时令水果箱', 88.00, 28, 880, '异业采购可获额度', 1),
(5, 4, '香辛料组合包', 36.00, 80, 360, '货值约1000:1', 1),
(6, 12, '冷冻鸡翅 10kg', 128.00, 42, 1280, '冻品仓直发', 1),
(7, 12, '鱿鱼须 5kg', 96.00, 30, 960, '烧烤专用', 1),
(8, 13, '辣椒面 2kg', 32.00, 100, 320, '本地厂供', 1),
(9, 13, '复合调味酱箱', 58.00, 55, 580, '麻辣烫专用', 1),
(10, 14, '一次性餐盒 500 套', 75.00, 200, 750, '耗材', 1),
(11, 14, '竹签 1000 支', 18.00, 500, 180, '烤串耗材', 1),
(12, 15, '叶菜混装筐', 42.00, 60, 420, '当日采摘', 1),
(13, 15, '土豆洋葱混装', 35.00, 90, 350, '炒菜基础菜', 1)
ON DUPLICATE KEY UPDATE `merchant_id`=VALUES(`merchant_id`), `name`=VALUES(`name`), `price`=VALUES(`price`), `stock`=VALUES(`stock`),
  `points_grant`=VALUES(`points_grant`), `points_ratio_text`=VALUES(`points_ratio_text`), `status`=VALUES(`status`);

-- sales_count 列在 06_ops_extend 后才有；用存储过程式安全更新
SET @has_sales := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'stall_goods' AND column_name = 'sales_count'
);
SET @sql := IF(@has_sales > 0,
  'UPDATE stall_goods SET sales_count = GREATEST(IFNULL(sales_count, 0), id * 17) WHERE id BETWEEN 1 AND 15',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_sales_c := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'cross_goods' AND column_name = 'sales_count'
);
SET @sqlc := IF(@has_sales_c > 0,
  'UPDATE cross_goods SET sales_count = GREATEST(IFNULL(sales_count, 0), id * 11) WHERE id BETWEEN 1 AND 10',
  'SELECT 1');
PREPARE stmtc FROM @sqlc; EXECUTE stmtc; DEALLOCATE PREPARE stmtc;

SET @has_sales_s := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'supply_goods' AND column_name = 'sales_count'
);
SET @sqls := IF(@has_sales_s > 0,
  'UPDATE supply_goods SET sales_count = GREATEST(IFNULL(sales_count, 0), id * 9) WHERE id BETWEEN 1 AND 13',
  'SELECT 1');
PREPARE stmts FROM @sqls; EXECUTE stmts; DEALLOCATE PREPARE stmts;

DELETE FROM `banners`;
INSERT INTO `banners` (`role_scope`, `title`, `sub_title`, `image_url`, `link_url`, `link_type`, `sort_order`, `status`) VALUES
('consumer', '夜市扫码点餐', '就近下单 · 积分马上到账', '/assets/banners/consumer-scan.jpg', '', 'none', 1, 1),
('consumer', '积分抵现周', '100积分=1元 · 异业通用', '/assets/banners/consumer-points.jpg', '/pages/cross/cross', 'switchTab', 2, 1),
('consumer', '附近夜市好店', '炒面烤串麻辣烫都有', '/assets/banners/consumer-market.jpg', '/pages/index/index', 'switchTab', 3, 1),
('stall', '采购获额度', '向供应链进货 · 划拨给顾客', '/assets/banners/stall-purchase.jpg', '/merchant/purchase/purchase', 'navigate', 1, 1),
('cross', '承接积分客', '自定兑换规则 · 全现金兜底', '/assets/banners/cross-redeem.jpg', '/merchant/goods/goods', 'navigate', 1, 1),
('supply', '拓展地摊客户', '货款与积分权益分账户', '/assets/banners/supply-warehouse.jpg', '/merchant/customers/customers', 'navigate', 1, 1),
('login', '商户入驻', '地摊 / 异业 / 供应链', '/assets/banners/login-join.jpg', '/pages/apply/apply', 'navigate', 1, 1);

INSERT INTO `merchant_applications` (
  `id`, `apply_no`, `role`, `shop_name`, `credit_code`, `legal_person`, `contact_name`, `contact_phone`,
  `city`, `address`, `license_json`, `status`, `reject_reason`, `merchant_id`, `reviewed_at`
) VALUES
(1, 'AP20260301001', 'stall', '路边凉皮摊', '91360481MA39U4GA9G', '王师傅', '王师傅', '13800001999',
 '九江·瑞昌', '夜市 C08', CAST('{"businessLicense":"demo","foodLicense":"demo","idCardFront":"demo","idCardBack":"demo"}' AS JSON),
 'pending', NULL, NULL, NULL),
(2, 'AP20260220001', 'cross', '老街奶茶铺', '91360481MA39U4GA9F', '奶茶店长', '奶茶店长', '13800002002',
 '九江·瑞昌', '老街 16 号', CAST('{"businessLicense":"demo","idCardFront":"demo","idCardBack":"demo","storePhoto":"demo"}' AS JSON),
 'approved', NULL, 5, NOW() - INTERVAL 10 DAY),
(3, 'AP20260210001', 'supply', '资料不全供应链', '91360481MA39U4GA9H', '李某', '李某', '13800003999',
 '九江·瑞昌', '开发区', CAST('{"businessLicense":"demo","idCardFront":"demo"}' AS JSON),
 'rejected', '证照不齐，请补传身份证反面', NULL, NOW() - INTERVAL 20 DAY),
(4, 'AP20260305001', 'cross', '浔阳花艺馆', '91360481MA39U4GB04', '花艺店长', '花艺店长', '13800002003',
 '九江·浔阳', '大中路 88 号', CAST('{"businessLicense":"demo","idCardFront":"demo","idCardBack":"demo","storePhoto":"demo"}' AS JSON),
 'approved', NULL, 9, NOW() - INTERVAL 8 DAY),
(5, 'AP20260308001', 'stall', '深夜麻辣烫', '91360481MA39U4GB02', '陈姐', '陈姐', '13800001004',
 '九江·浔阳', '湓浦路夜市 08', CAST('{"businessLicense":"demo","foodLicense":"demo","idCardFront":"demo","idCardBack":"demo"}' AS JSON),
 'approved', NULL, 7, NOW() - INTERVAL 5 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `reject_reason`=VALUES(`reject_reason`), `merchant_id`=VALUES(`merchant_id`);

INSERT INTO `purchase_orders` (
  `id`, `order_no`, `buyer_merchant_id`, `seller_merchant_id`, `fulfill_type`,
  `total_amount`, `points_grant`, `status`, `paid_at`, `confirmed_at`, `created_at`
) VALUES
(1, 'PSEED0001', 1, 4, 'offline', 56.00, 560, 'confirmed', NOW() - INTERVAL 15 DAY, NOW() - INTERVAL 15 DAY, NOW() - INTERVAL 15 DAY),
(2, 'PSEED0002', 3, 4, 'online', 88.00, 880, 'confirmed', NOW() - INTERVAL 12 DAY, NOW() - INTERVAL 11 DAY, NOW() - INTERVAL 12 DAY),
(3, 'PSEED0003', 1, 4, 'online', 68.00, 680, 'shipped', NOW() - INTERVAL 2 DAY, NULL, NOW() - INTERVAL 2 DAY),
(4, 'PSEED0004', 5, 4, 'online', 88.00, 880, 'pending', NOW() - INTERVAL 1 DAY, NULL, NOW() - INTERVAL 1 DAY),
(5, 'PSEED0005', 7, 13, 'online', 58.00, 580, 'confirmed', NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 4 DAY),
(6, 'PSEED0006', 2, 12, 'online', 128.00, 1280, 'shipped', NOW() - INTERVAL 1 DAY, NULL, NOW() - INTERVAL 1 DAY),
(7, 'PSEED0007', 6, 15, 'offline', 42.00, 420, 'confirmed', NOW() - INTERVAL 6 DAY, NOW() - INTERVAL 6 DAY, NOW() - INTERVAL 6 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `total_amount`=VALUES(`total_amount`), `points_grant`=VALUES(`points_grant`);

INSERT INTO `purchase_order_items` (`id`, `order_id`, `goods_id`, `goods_name`, `price`, `qty`, `points_grant`) VALUES
(1, 1, 1, '宽面 5kg', 28.00, 2, 280),
(2, 2, 4, '时令水果箱', 88.00, 1, 880),
(3, 3, 2, '菜籽油 5L', 68.00, 1, 680),
(4, 4, 4, '时令水果箱', 88.00, 1, 880),
(5, 5, 9, '复合调味酱箱', 58.00, 1, 580),
(6, 6, 6, '冷冻鸡翅 10kg', 128.00, 1, 1280),
(7, 7, 12, '叶菜混装筐', 42.00, 1, 420)
ON DUPLICATE KEY UPDATE `qty`=VALUES(`qty`), `goods_name`=VALUES(`goods_name`);

INSERT INTO `consumer_orders` (
  `id`, `order_no`, `user_id`, `merchant_id`, `total_amount`, `points_want`, `points_allocated`,
  `pay_status`, `order_status`, `paid_at`, `created_at`
) VALUES
(1, 'OSEED0001', 1, 1, 14.00, 21, 21, 'paid', 'completed', NOW() - INTERVAL 8 DAY, NOW() - INTERVAL 8 DAY),
(2, 'OSEED0002', 2, 1, 12.00, 18, 18, 'paid', 'completed', NOW() - INTERVAL 7 DAY, NOW() - INTERVAL 7 DAY),
(3, 'OSEED0003', 1, 2, 20.00, 28, 28, 'paid', 'completed', NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 5 DAY),
(4, 'OSEED0004', 3, 1, 16.00, 23, 23, 'paid', 'completed', NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY),
(5, 'OSEED0005', 4, 6, 8.00, 12, 12, 'paid', 'completed', NOW() - INTERVAL 2 DAY, NOW() - INTERVAL 2 DAY),
(6, 'OSEED0006', 5, 7, 16.00, 22, 22, 'paid', 'completed', NOW() - INTERVAL 1 DAY, NOW() - INTERVAL 1 DAY),
(7, 'OSEED0007', 3, 8, 10.00, 14, 14, 'paid', 'completed', NOW() - INTERVAL 12 HOUR, NOW() - INTERVAL 12 HOUR)
ON DUPLICATE KEY UPDATE `points_allocated`=VALUES(`points_allocated`), `total_amount`=VALUES(`total_amount`),
  `pay_status`=VALUES(`pay_status`), `order_status`=VALUES(`order_status`);

INSERT INTO `consumer_order_items` (`id`, `order_id`, `goods_id`, `goods_name`, `price`, `points_grant`, `qty`) VALUES
(1, 1, 1, '招牌炒面', 12.00, 18, 1),
(2, 1, 2, '加蛋', 2.00, 3, 1),
(3, 2, 1, '招牌炒面', 12.00, 18, 1),
(4, 3, 6, '羊肉串 ×5', 20.00, 28, 1),
(5, 4, 1, '招牌炒面', 12.00, 18, 1),
(6, 4, 5, '冰红茶', 4.00, 5, 1),
(7, 5, 9, '经典臭豆腐', 8.00, 12, 1),
(8, 6, 11, '麻辣烫小份', 16.00, 22, 1),
(9, 7, 13, '煎饼果子', 7.00, 10, 1),
(10, 7, 15, '豆浆', 3.00, 4, 1)
ON DUPLICATE KEY UPDATE `qty`=VALUES(`qty`), `goods_name`=VALUES(`goods_name`);

INSERT INTO `cross_orders` (
  `id`, `order_no`, `user_id`, `merchant_id`, `goods_id`, `goods_name`,
  `pay_mode`, `points_spend`, `cash_amount`, `status`, `created_at`
) VALUES
(1, 'CSEED0001', 1, 3, 1, '时令果切拼盘', 'points', 200, 0.00, 'completed', NOW() - INTERVAL 6 DAY),
(2, 'CSEED0002', 1, 3, 2, '椰子水', 'cash', 0, 8.00, 'completed', NOW() - INTERVAL 4 DAY),
(3, 'CSEED0003', 3, 5, 3, '招牌奶茶', 'points', 100, 0.00, 'completed', NOW() - INTERVAL 2 DAY),
(4, 'CSEED0004', 4, 9, 5, '迷你花束', 'points', 180, 0.00, 'completed', NOW() - INTERVAL 3 DAY),
(5, 'CSEED0005', 2, 10, 7, '标准洗车', 'cash', 0, 25.00, 'completed', NOW() - INTERVAL 1 DAY),
(6, 'CSEED0006', 5, 11, 9, '足道 45 分钟', 'points', 220, 0.00, 'completed', NOW() - INTERVAL 20 HOUR),
(7, 'CSEED0007', 1, 5, 4, '杨枝甘露', 'cash', 0, 15.00, 'completed', NOW() - INTERVAL 10 HOUR)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `points_spend`=VALUES(`points_spend`), `cash_amount`=VALUES(`cash_amount`);

DELETE FROM `merchant_pool_ledger`;
INSERT INTO `merchant_pool_ledger` (`merchant_id`, `change_amount`, `balance_after`, `biz_type`, `biz_id`, `title`, `created_at`) VALUES
(1, 560, 560, 'purchase', 'PSEED0001', '采购成交 · 宽面 5kg · 获额度 +560', NOW() - INTERVAL 15 DAY),
(1, 5000, 5560, 'admin_grant', 'AGSEED01', '平台后台发放积分额度 +5000', NOW() - INTERVAL 14 DAY),
(1, -21, 5539, 'allocate', 'OSEED0001', '划拨给消费者 · OSEED0001', NOW() - INTERVAL 8 DAY),
(1, -18, 5521, 'allocate', 'OSEED0002', '划拨给消费者 · OSEED0002', NOW() - INTERVAL 7 DAY),
(1, -23, 5498, 'allocate', 'OSEED0004', '划拨给消费者 · OSEED0004', NOW() - INTERVAL 3 DAY),
(1, -498, 5000, 'adjust', 'SEED_ADJ1', '演示对齐终值', NOW() - INTERVAL 1 DAY),
(2, 3200, 3200, 'admin_grant', 'AGSEED02', '平台后台发放积分额度 +3200', NOW() - INTERVAL 14 DAY),
(2, -28, 3172, 'allocate', 'OSEED0003', '划拨给消费者 · OSEED0003', NOW() - INTERVAL 5 DAY),
(2, 28, 3200, 'adjust', 'SEED_ADJ2', '演示对齐终值', NOW() - INTERVAL 1 DAY),
(3, 880, 880, 'purchase', 'PSEED0002', '采购成交 · 时令水果箱 · 获额度 +880', NOW() - INTERVAL 11 DAY),
(3, 2000, 2880, 'admin_grant', 'AGSEED03', '平台后台发放积分额度 +2000', NOW() - INTERVAL 10 DAY),
(3, -280, 2600, 'adjust', 'SEED_ADJ3', '演示对齐终值', NOW() - INTERVAL 1 DAY),
(5, 880, 880, 'admin_grant', 'AGSEED05', '开业赠送额度 +880', NOW() - INTERVAL 9 DAY),
(6, 1500, 1500, 'admin_grant', 'AGSEED06', '开业赠送额度 +1500', NOW() - INTERVAL 7 DAY),
(6, -12, 1488, 'allocate', 'OSEED0005', '划拨给消费者 · OSEED0005', NOW() - INTERVAL 2 DAY),
(6, 12, 1500, 'adjust', 'SEED_ADJ6', '演示对齐终值', NOW() - INTERVAL 1 DAY),
(7, 580, 580, 'purchase', 'PSEED0005', '采购成交 · 复合调味酱 · 获额度 +580', NOW() - INTERVAL 3 DAY),
(7, 1542, 2122, 'admin_grant', 'AGSEED07', '平台补发额度', NOW() - INTERVAL 3 DAY),
(7, -22, 2100, 'allocate', 'OSEED0006', '划拨给消费者 · OSEED0006', NOW() - INTERVAL 1 DAY),
(8, 980, 980, 'admin_grant', 'AGSEED08', '开业赠送额度 +980', NOW() - INTERVAL 5 DAY),
(8, -14, 966, 'allocate', 'OSEED0007', '划拨给消费者 · OSEED0007', NOW() - INTERVAL 12 HOUR),
(8, 14, 980, 'adjust', 'SEED_ADJ8', '演示对齐终值', NOW() - INTERVAL 6 HOUR),
(9, 1200, 1200, 'admin_grant', 'AGSEED09', '开业赠送额度 +1200', NOW() - INTERVAL 8 DAY),
(10, 600, 600, 'admin_grant', 'AGSEED10', '开业赠送额度 +600', NOW() - INTERVAL 8 DAY),
(11, 2400, 2400, 'admin_grant', 'AGSEED11', '开业赠送额度 +2400', NOW() - INTERVAL 8 DAY);

DELETE FROM `user_points_ledger`;
INSERT INTO `user_points_ledger` (`user_id`, `change_amount`, `balance_after`, `biz_type`, `biz_id`, `title`, `cash_value`, `created_at`) VALUES
(1, 21, 21, 'grant', 'OSEED0001', '张记夜市炒面 · 消费划拨', 0.2100, NOW() - INTERVAL 8 DAY),
(1, 50, 71, 'referral', 'OSEED0002', '好友首单推荐奖励 +50', 0.5000, NOW() - INTERVAL 7 DAY),
(1, 28, 99, 'grant', 'OSEED0003', '阿姐烤串档 · 消费划拨', 0.2800, NOW() - INTERVAL 5 DAY),
(1, 387, 486, 'adjust', 'SEED_U1', '历史累计对齐', 3.8700, NOW() - INTERVAL 5 DAY),
(1, -200, 286, 'spend', 'CSEED0001', '时令果切拼盘 · 兑换扣减', 2.0000, NOW() - INTERVAL 6 DAY),
(2, 18, 18, 'grant', 'OSEED0002', '张记夜市炒面 · 消费划拨', 0.1800, NOW() - INTERVAL 7 DAY),
(2, 62, 80, 'adjust', 'SEED_U2', '历史累计对齐', 0.6200, NOW() - INTERVAL 1 DAY),
(3, 23, 23, 'grant', 'OSEED0004', '张记夜市炒面 · 消费划拨', 0.2300, NOW() - INTERVAL 3 DAY),
(3, 197, 220, 'adjust', 'SEED_U3', '历史累计对齐', 1.9700, NOW() - INTERVAL 2 DAY),
(3, -100, 120, 'spend', 'CSEED0003', '招牌奶茶 · 兑换扣减', 1.0000, NOW() - INTERVAL 2 DAY),
(4, 12, 12, 'grant', 'OSEED0005', '老周臭豆腐 · 消费划拨', 0.1200, NOW() - INTERVAL 2 DAY),
(4, 328, 340, 'adjust', 'SEED_U4', '历史累计对齐', 3.2800, NOW() - INTERVAL 2 DAY),
(4, -180, 160, 'spend', 'CSEED0004', '迷你花束 · 兑换扣减', 1.8000, NOW() - INTERVAL 3 DAY),
(5, 22, 22, 'grant', 'OSEED0006', '深夜麻辣烫 · 消费划拨', 0.2200, NOW() - INTERVAL 1 DAY),
(5, 243, 265, 'adjust', 'SEED_U5', '历史累计对齐', 2.4300, NOW() - INTERVAL 1 DAY),
(5, -220, 45, 'spend', 'CSEED0006', '足道 45 分钟 · 兑换扣减', 2.2000, NOW() - INTERVAL 20 HOUR);

DELETE FROM `merchant_account_ledger`;
INSERT INTO `merchant_account_ledger`
  (`merchant_id`, `account_type`, `change_amount`, `balance_after`, `frozen_after`, `biz_type`, `biz_id`, `title`, `created_at`) VALUES
(4, 'cash_goods', 55.94, 55.94, 0.00, 'purchase_cash', 'PSEED0001', '采购货款入账 · PSEED0001', NOW() - INTERVAL 15 DAY),
(4, 'points_redeem', 5.60, 5.60, 0.00, 'purchase_points_equity', 'PSEED0001', '买方获额对应折现权益 · PSEED0001', NOW() - INTERVAL 15 DAY),
(4, 'cash_goods', 87.91, 143.85, 0.00, 'purchase_cash', 'PSEED0002', '采购货款入账 · PSEED0002', NOW() - INTERVAL 11 DAY),
(4, 'points_redeem', 8.80, 14.40, 0.00, 'purchase_points_equity', 'PSEED0002', '买方获额对应折现权益 · PSEED0002', NOW() - INTERVAL 11 DAY),
(4, 'cash_goods', 21256.15, 21400.00, 0.00, 'adjust', 'SEED_AC4', '历史货款对齐终值', NOW() - INTERVAL 10 DAY),
(4, 'points_redeem', 8585.60, 8600.00, 0.00, 'adjust', 'SEED_AC4B', '历史权益对齐终值', NOW() - INTERVAL 10 DAY),
(4, 'cash_goods', -500.00, 20900.00, 500.00, 'withdraw_freeze', 'WDSEED02', '提现申请冻结 · WDSEED02', NOW() - INTERVAL 1 DAY),
(1, 'cash_settlement', 13.99, 13.99, 0.00, 'stall_settle', 'OSEED0001', '点餐货款入账 · OSEED0001', NOW() - INTERVAL 8 DAY),
(1, 'cash_settlement', 2846.01, 2860.00, 0.00, 'adjust', 'SEED_AC1', '历史应收对齐终值', NOW() - INTERVAL 1 DAY),
(3, 'cash_settlement', 1.99, 1.99, 0.00, 'cross_points_settle', 'CSEED0001', '积分兑换结算 · CSEED0001', NOW() - INTERVAL 6 DAY),
(3, 'cash_settlement', 7.99, 9.98, 0.00, 'cross_cash_settle', 'CSEED0002', '全现金兑换结算 · CSEED0002', NOW() - INTERVAL 4 DAY),
(3, 'cash_settlement', 2010.02, 2020.00, 0.00, 'adjust', 'SEED_AC3', '历史应收对齐终值', NOW() - INTERVAL 1 DAY),
(3, 'cash_settlement', -200.00, 1820.00, 200.00, 'withdraw_freeze', 'WDSEED01', '提现申请冻结 · WDSEED01', NOW() - INTERVAL 1 DAY),
(2, 'cash_settlement', 19.98, 19.98, 0.00, 'stall_settle', 'OSEED0003', '点餐货款入账 · OSEED0003', NOW() - INTERVAL 5 DAY),
(2, 'cash_settlement', 400.02, 420.00, 0.00, 'adjust', 'SEED_AC2', '历史应收对齐终值', NOW() - INTERVAL 1 DAY),
(5, 'cash_settlement', 0.99, 0.99, 0.00, 'cross_points_settle', 'CSEED0003', '积分兑换结算 · CSEED0003', NOW() - INTERVAL 2 DAY),
(5, 'cash_settlement', 95.01, 96.00, 0.00, 'adjust', 'SEED_AC5', '历史应收对齐终值', NOW() - INTERVAL 1 DAY),
(6, 'cash_settlement', 310.00, 310.00, 0.00, 'adjust', 'SEED_AC6', '开业资金对齐', NOW() - INTERVAL 1 DAY),
(7, 'cash_settlement', 540.00, 540.00, 0.00, 'adjust', 'SEED_AC7', '开业资金对齐', NOW() - INTERVAL 1 DAY),
(8, 'cash_settlement', 188.00, 188.00, 0.00, 'adjust', 'SEED_AC8', '开业资金对齐', NOW() - INTERVAL 1 DAY),
(9, 'cash_settlement', 420.00, 420.00, 0.00, 'adjust', 'SEED_AC9', '开业资金对齐', NOW() - INTERVAL 1 DAY),
(10, 'cash_settlement', 260.00, 260.00, 0.00, 'adjust', 'SEED_AC10', '开业资金对齐', NOW() - INTERVAL 1 DAY),
(11, 'cash_settlement', 780.00, 780.00, 0.00, 'adjust', 'SEED_AC11', '开业资金对齐', NOW() - INTERVAL 1 DAY),
(12, 'cash_goods', 8600.00, 8600.00, 0.00, 'adjust', 'SEED_AC12', '开业货款对齐', NOW() - INTERVAL 1 DAY),
(13, 'cash_goods', 4500.00, 4500.00, 0.00, 'adjust', 'SEED_AC13', '开业货款对齐', NOW() - INTERVAL 1 DAY),
(14, 'cash_goods', 2200.00, 2200.00, 0.00, 'adjust', 'SEED_AC14', '开业货款对齐', NOW() - INTERVAL 1 DAY),
(15, 'cash_goods', 5800.00, 5800.00, 0.00, 'adjust', 'SEED_AC15', '开业货款对齐', NOW() - INTERVAL 1 DAY);

DELETE FROM `commission_ledger`;
INSERT INTO `commission_ledger` (`biz_type`, `biz_id`, `payer_merchant_id`, `amount_gross`, `rate`, `commission`, `rule_version`, `created_at`) VALUES
('purchase', 'PSEED0001', 4, 56.00, 0.001000, 0.06, 'default', NOW() - INTERVAL 15 DAY),
('purchase', 'PSEED0002', 4, 88.00, 0.001000, 0.09, 'default', NOW() - INTERVAL 11 DAY),
('purchase', 'PSEED0005', 13, 58.00, 0.001000, 0.06, 'default', NOW() - INTERVAL 3 DAY),
('purchase', 'PSEED0006', 12, 128.00, 0.001000, 0.13, 'default', NOW() - INTERVAL 1 DAY),
('purchase', 'PSEED0007', 15, 42.00, 0.001000, 0.04, 'default', NOW() - INTERVAL 6 DAY),
('stall', 'OSEED0001', 1, 14.00, 0.001000, 0.01, 'default', NOW() - INTERVAL 8 DAY),
('stall', 'OSEED0002', 1, 12.00, 0.001000, 0.01, 'default', NOW() - INTERVAL 7 DAY),
('stall', 'OSEED0003', 2, 20.00, 0.001000, 0.02, 'default', NOW() - INTERVAL 5 DAY),
('stall', 'OSEED0004', 1, 16.00, 0.001000, 0.02, 'default', NOW() - INTERVAL 3 DAY),
('stall', 'OSEED0005', 6, 8.00, 0.001000, 0.01, 'default', NOW() - INTERVAL 2 DAY),
('stall', 'OSEED0006', 7, 16.00, 0.001000, 0.02, 'default', NOW() - INTERVAL 1 DAY),
('stall', 'OSEED0007', 8, 10.00, 0.001000, 0.01, 'default', NOW() - INTERVAL 12 HOUR),
('cross', 'CSEED0001', 3, 2.00, 0.001000, 0.00, 'default', NOW() - INTERVAL 6 DAY),
('cross', 'CSEED0002', 3, 8.00, 0.001000, 0.01, 'default', NOW() - INTERVAL 4 DAY),
('cross', 'CSEED0003', 5, 1.00, 0.001000, 0.00, 'default', NOW() - INTERVAL 2 DAY),
('cross', 'CSEED0004', 9, 1.80, 0.001000, 0.00, 'default', NOW() - INTERVAL 3 DAY),
('cross', 'CSEED0005', 10, 25.00, 0.001000, 0.03, 'default', NOW() - INTERVAL 1 DAY),
('cross', 'CSEED0006', 11, 2.20, 0.001000, 0.00, 'default', NOW() - INTERVAL 20 HOUR),
('cross', 'CSEED0007', 5, 15.00, 0.001000, 0.02, 'default', NOW() - INTERVAL 10 HOUR);

INSERT INTO `withdraw_requests` (`id`, `request_no`, `merchant_id`, `account_type`, `amount`, `status`, `remark`, `created_at`) VALUES
(1, 'WDSEED01', 3, 'cash_settlement', 200.00, 'pending', '异业应收提现', NOW() - INTERVAL 1 DAY),
(2, 'WDSEED02', 4, 'cash_goods', 500.00, 'pending', '供应链货款提现', NOW() - INTERVAL 1 DAY),
(3, 'WDSEED03', 1, 'cash_settlement', 100.00, 'paid', '地摊历史提现已打款', NOW() - INTERVAL 20 DAY),
(4, 'WDSEED04', 4, 'points_redeem', 50.00, 'rejected', '资料不全已驳回', NOW() - INTERVAL 18 DAY),
(5, 'WDSEED05', 12, 'cash_goods', 300.00, 'pending', '冻品仓货款提现', NOW() - INTERVAL 6 HOUR)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `amount`=VALUES(`amount`), `remark`=VALUES(`remark`);

INSERT INTO `referral_records` (`id`, `inviter_user_id`, `invitee_user_id`, `trigger_type`, `reward_points`, `created_at`) VALUES
(1, 1, 2, 'register', 0, NOW() - INTERVAL 10 DAY),
(2, 1, 2, 'first_order', 50, NOW() - INTERVAL 7 DAY),
(3, 1, 3, 'register', 0, NOW() - INTERVAL 9 DAY),
(4, 1, 4, 'register', 0, NOW() - INTERVAL 8 DAY),
(5, 2, 5, 'register', 0, NOW() - INTERVAL 5 DAY)
ON DUPLICATE KEY UPDATE `reward_points`=VALUES(`reward_points`);

INSERT INTO `complaints` (`id`, `user_id`, `target_type`, `target_id`, `content`, `status`, `created_at`) VALUES
(1, 1, 'merchant', 1, '上次炒面等太久，希望加快出餐', 'processing', NOW() - INTERVAL 4 DAY),
(2, 3, 'order', 3, '烤串少送了一串', 'open', NOW() - INTERVAL 2 DAY),
(3, 4, 'merchant', 6, '臭豆腐味道偏淡', 'open', NOW() - INTERVAL 1 DAY),
(4, 5, 'merchant', 7, '麻辣烫出餐慢', 'processing', NOW() - INTERVAL 20 HOUR),
(5, 2, 'order', 5, '洗车预约迟到', 'closed', NOW() - INTERVAL 3 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `content`=VALUES(`content`);

INSERT INTO `supply_needs` (`id`, `user_id`, `goods_name`, `qty_text`, `expect_time`, `note`, `status`, `created_at`) VALUES
(1, NULL, '冷冻鸡翅', '每周 2 箱', '本周五前', '地摊档口询价', 'open', NOW() - INTERVAL 3 DAY),
(2, 1, '现切水果原料', '每天 1 箱', '长期', '异业果切补货', 'quoted', NOW() - INTERVAL 6 DAY),
(3, NULL, '竹签 / 餐盒', '每月 1 批', '月底前', '烤串耗材', 'open', NOW() - INTERVAL 2 DAY),
(4, NULL, '辣椒面', '每月 20kg', '长期', '麻辣烫档口', 'open', NOW() - INTERVAL 1 DAY),
(5, NULL, '叶菜混装', '每天清晨', '长期', '炒面配菜', 'quoted', NOW() - INTERVAL 4 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `note`=VALUES(`note`);

-- 演示码：消费者 C001–C005 / 地摊 D001–D005 / 异业 Y001–Y005 / 供应链 G001–G005 / 运营 A001

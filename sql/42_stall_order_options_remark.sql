-- 点餐规格完善：商品可开备注；订单/明细备注；为未配规格的在售菜补默认口味/分量/配料

-- stall_goods.allow_remark
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stall_goods' AND COLUMN_NAME = 'allow_remark'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE stall_goods ADD COLUMN allow_remark TINYINT NOT NULL DEFAULT 1 COMMENT ''点餐是否允许填写备注'' AFTER on_sale',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- consumer_orders.buyer_remark
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumer_orders' AND COLUMN_NAME = 'buyer_remark'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE consumer_orders ADD COLUMN buyer_remark VARCHAR(255) NULL COMMENT ''整单备注'' AFTER order_status',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- consumer_order_items.item_remark
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumer_order_items' AND COLUMN_NAME = 'item_remark'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE consumer_order_items ADD COLUMN item_remark VARCHAR(128) NULL COMMENT ''单品备注'' AFTER options_text',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 默认开启备注（已有行）
UPDATE stall_goods SET allow_remark = 1 WHERE allow_remark IS NULL OR allow_remark = 0;

-- 为尚未配置规格、且非纯收款占位的在售菜补「口味 / 分量 / 配料」
INSERT INTO stall_goods_option_groups (goods_id, name, type, required, multi_select, min_select, max_select, sort_order)
SELECT g.id, '口味', 'flavor', 1, 0, 1, 1, 10
FROM stall_goods g
WHERE g.deleted_at IS NULL
  AND g.on_sale = 1
  AND IFNULL(g.category, '') NOT IN ('收款', '支付测试')
  AND g.name NOT LIKE '%到店消费%'
  AND g.name NOT LIKE '测试小食%'
  AND NOT EXISTS (SELECT 1 FROM stall_goods_option_groups og WHERE og.goods_id = g.id);

INSERT INTO stall_goods_option_groups (goods_id, name, type, required, multi_select, min_select, max_select, sort_order)
SELECT g.id, '分量', 'portion', 1, 0, 1, 1, 20
FROM stall_goods g
WHERE g.deleted_at IS NULL
  AND g.on_sale = 1
  AND IFNULL(g.category, '') NOT IN ('收款', '支付测试')
  AND g.name NOT LIKE '%到店消费%'
  AND g.name NOT LIKE '测试小食%'
  AND EXISTS (SELECT 1 FROM stall_goods_option_groups og WHERE og.goods_id = g.id AND og.type = 'flavor')
  AND NOT EXISTS (SELECT 1 FROM stall_goods_option_groups og WHERE og.goods_id = g.id AND og.type = 'portion');

INSERT INTO stall_goods_option_groups (goods_id, name, type, required, multi_select, min_select, max_select, sort_order)
SELECT g.id, '配料', 'topping', 0, 1, 0, 5, 30
FROM stall_goods g
WHERE g.deleted_at IS NULL
  AND g.on_sale = 1
  AND IFNULL(g.category, '') NOT IN ('收款', '支付测试')
  AND g.name NOT LIKE '%到店消费%'
  AND g.name NOT LIKE '测试小食%'
  AND EXISTS (SELECT 1 FROM stall_goods_option_groups og WHERE og.goods_id = g.id AND og.type = 'flavor')
  AND NOT EXISTS (SELECT 1 FROM stall_goods_option_groups og WHERE og.goods_id = g.id AND og.type = 'topping');

INSERT INTO stall_goods_options (group_id, name, price_delta, points_delta, is_default, sort_order)
SELECT og.id, v.name, v.pd, v.ptd, v.def, v.so
FROM stall_goods_option_groups og
JOIN (
  SELECT 'flavor' AS t, '微辣' AS name, 0.00 AS pd, 0 AS ptd, 1 AS def, 1 AS so
  UNION ALL SELECT 'flavor', '中辣', 0.00, 0, 0, 2
  UNION ALL SELECT 'flavor', '特辣', 0.50, 0, 0, 3
  UNION ALL SELECT 'portion', '标准', 0.00, 0, 1, 1
  UNION ALL SELECT 'portion', '大份', 2.00, 1, 0, 2
  UNION ALL SELECT 'portion', '小份', -1.00, 0, 0, 3
  UNION ALL SELECT 'topping', '加蛋', 1.50, 0, 0, 1
  UNION ALL SELECT 'topping', '加肠', 2.00, 0, 0, 2
  UNION ALL SELECT 'topping', '加豆皮', 1.00, 0, 0, 3
) v ON v.t = og.type
WHERE NOT EXISTS (SELECT 1 FROM stall_goods_options o WHERE o.group_id = og.id);

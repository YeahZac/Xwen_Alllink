-- 地摊点餐：口味 / 分量 / 配料 及加价
-- 可在已有库上重复执行（IF NOT EXISTS）

CREATE TABLE IF NOT EXISTS stall_goods_option_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  goods_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(64) NOT NULL,
  type ENUM('flavor','portion','topping','custom') NOT NULL DEFAULT 'custom',
  required TINYINT NOT NULL DEFAULT 0,
  multi_select TINYINT NOT NULL DEFAULT 0,
  min_select INT NOT NULL DEFAULT 0,
  max_select INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_goods (goods_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stall_goods_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(64) NOT NULL,
  price_delta DECIMAL(10,2) NOT NULL DEFAULT 0,
  points_delta INT NOT NULL DEFAULT 0,
  is_default TINYINT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_group (group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订单行快照：选中规格与单价
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumer_order_items' AND COLUMN_NAME = 'options_json'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE consumer_order_items ADD COLUMN options_json JSON NULL AFTER qty, ADD COLUMN options_text VARCHAR(255) NULL AFTER options_json',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 演示数据：为已有炒面类商品补口味/分量/配料（仅当该商品尚无规格组）
INSERT INTO stall_goods_option_groups (goods_id, name, type, required, multi_select, min_select, max_select, sort_order)
SELECT g.id, '口味', 'flavor', 1, 0, 1, 1, 10
FROM stall_goods g
WHERE g.deleted_at IS NULL AND g.name LIKE '%面%'
  AND NOT EXISTS (SELECT 1 FROM stall_goods_option_groups og WHERE og.goods_id = g.id)
LIMIT 20;

INSERT INTO stall_goods_option_groups (goods_id, name, type, required, multi_select, min_select, max_select, sort_order)
SELECT g.id, '分量', 'portion', 1, 0, 1, 1, 20
FROM stall_goods g
WHERE g.deleted_at IS NULL AND g.name LIKE '%面%'
  AND NOT EXISTS (
    SELECT 1 FROM stall_goods_option_groups og WHERE og.goods_id = g.id AND og.type = 'portion'
  )
LIMIT 20;

INSERT INTO stall_goods_option_groups (goods_id, name, type, required, multi_select, min_select, max_select, sort_order)
SELECT g.id, '配料', 'topping', 0, 1, 0, 5, 30
FROM stall_goods g
WHERE g.deleted_at IS NULL AND g.name LIKE '%面%'
  AND NOT EXISTS (
    SELECT 1 FROM stall_goods_option_groups og WHERE og.goods_id = g.id AND og.type = 'topping'
  )
LIMIT 20;

INSERT INTO stall_goods_options (group_id, name, price_delta, points_delta, is_default, sort_order)
SELECT og.id, v.name, v.pd, v.ptd, v.def, v.so
FROM stall_goods_option_groups og
JOIN (
  SELECT 'flavor' AS t, '微辣' AS name, 0 AS pd, 0 AS ptd, 1 AS def, 1 AS so
  UNION ALL SELECT 'flavor', '中辣', 0, 0, 0, 2
  UNION ALL SELECT 'flavor', '特辣', 1, 1, 0, 3
  UNION ALL SELECT 'portion', '标准', 0, 0, 1, 1
  UNION ALL SELECT 'portion', '大份', 3, 2, 0, 2
  UNION ALL SELECT 'portion', '小份', -2, -1, 0, 3
  UNION ALL SELECT 'topping', '加蛋', 2, 1, 0, 1
  UNION ALL SELECT 'topping', '加火腿肠', 3, 1, 0, 2
  UNION ALL SELECT 'topping', '加豆皮', 1.5, 1, 0, 3
) v ON v.t = og.type
WHERE NOT EXISTS (SELECT 1 FROM stall_goods_options o WHERE o.group_id = og.id);

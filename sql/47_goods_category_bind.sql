-- 商品绑定运营台「商品类目」：category_id + 按名称回填
USE `wanyehulian`;

SET @db := DATABASE();

-- stall
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='stall_goods' AND COLUMN_NAME='category_id');
SET @sql := IF(@exist=0, "ALTER TABLE stall_goods ADD COLUMN `category_id` BIGINT UNSIGNED NULL COMMENT '关联 goods_categories.id' AFTER `category`, ADD KEY `idx_stall_category_id` (`category_id`)", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- cross：确保有 category 文本列
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='cross_goods' AND COLUMN_NAME='category');
SET @sql := IF(@exist=0, "ALTER TABLE cross_goods ADD COLUMN `category` VARCHAR(64) NULL COMMENT '类目名称（冗余）' AFTER `name`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='cross_goods' AND COLUMN_NAME='category_id');
SET @sql := IF(@exist=0, "ALTER TABLE cross_goods ADD COLUMN `category_id` BIGINT UNSIGNED NULL COMMENT '关联 goods_categories.id' AFTER `category`, ADD KEY `idx_cross_category_id` (`category_id`)", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- supply：确保有 category 文本列
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='supply_goods' AND COLUMN_NAME='category');
SET @sql := IF(@exist=0, "ALTER TABLE supply_goods ADD COLUMN `category` VARCHAR(64) NULL COMMENT '类目名称（冗余）' AFTER `name`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='supply_goods' AND COLUMN_NAME='category_id');
SET @sql := IF(@exist=0, "ALTER TABLE supply_goods ADD COLUMN `category_id` BIGINT UNSIGNED NULL COMMENT '关联 goods_categories.id' AFTER `category`, ADD KEY `idx_supply_category_id` (`category_id`)", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE stall_goods g
INNER JOIN goods_categories c ON c.role='stall' AND c.name=g.category AND c.status=1
SET g.category_id = c.id
WHERE g.category_id IS NULL AND IFNULL(g.category,'') <> '';

UPDATE cross_goods g
INNER JOIN goods_categories c ON c.role='cross' AND c.name=g.category AND c.status=1
SET g.category_id = c.id
WHERE g.category_id IS NULL AND IFNULL(g.category,'') <> '';

UPDATE supply_goods g
INNER JOIN goods_categories c ON c.role='supply' AND c.name=g.category AND c.status=1
SET g.category_id = c.id
WHERE g.category_id IS NULL AND IFNULL(g.category,'') <> '';

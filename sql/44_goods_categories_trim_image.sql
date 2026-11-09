-- 商品类目：补齐封面图字段（不再限制每角色数量；C 端展示全部启用类目）
USE `wanyehulian`;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='goods_categories' AND COLUMN_NAME='image_url');
SET @s := IF(@c=0,
  'ALTER TABLE `goods_categories` ADD COLUMN `image_url` VARCHAR(1024) DEFAULT NULL COMMENT ''小程序类目封面'' AFTER `name`',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

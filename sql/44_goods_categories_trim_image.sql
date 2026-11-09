-- 商品类目：展示图 + 每角色仅保留 2 个启用类目（正式数据准备）
USE `wanyehulian`;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='goods_categories' AND COLUMN_NAME='image_url');
SET @s := IF(@c=0,
  'ALTER TABLE `goods_categories` ADD COLUMN `image_url` VARCHAR(1024) DEFAULT NULL COMMENT ''小程序类目封面'' AFTER `name`',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `goods_categories` SET `status` = 0;

INSERT INTO `goods_categories` (`role`, `name`, `sort_order`, `status`) VALUES
('stall', '餐饮', 10, 1),
('stall', '百货商店', 20, 1),
('cross', '餐饮', 10, 1),
('cross', '百货商店', 20, 1),
('supply', '粮油', 10, 1),
('supply', '生鲜', 20, 1)
ON DUPLICATE KEY UPDATE
  `status` = 1,
  `sort_order` = VALUES(`sort_order`);

DELETE FROM `goods_categories` WHERE `status` = 0;

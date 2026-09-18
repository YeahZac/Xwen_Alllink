-- 微信登录资料、商品完善字段、积分+微信组合支付（兼容 MySQL 5.7 / mysql2）
USE `wanyehulian`;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='consumer_orders' AND COLUMN_NAME='points_spend') = 0,
    'ALTER TABLE consumer_orders ADD COLUMN `points_spend` INT NOT NULL DEFAULT 0 COMMENT ''支付抵扣积分'' AFTER `points_allocated`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='consumer_orders' AND COLUMN_NAME='cash_paid') = 0,
    'ALTER TABLE consumer_orders ADD COLUMN `cash_paid` DECIMAL(10,2) DEFAULT NULL COMMENT ''实付现金'' AFTER `points_spend`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='consumer_orders' AND COLUMN_NAME='pay_channel') = 0,
    'ALTER TABLE consumer_orders ADD COLUMN `pay_channel` VARCHAR(32) DEFAULT NULL COMMENT ''wxpay/wxpay_sim/points'' AFTER `cash_paid`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='stall_goods' AND COLUMN_NAME='unit') = 0,
    'ALTER TABLE stall_goods ADD COLUMN `unit` VARCHAR(16) DEFAULT ''份'' COMMENT ''计价单位'' AFTER `category`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='stall_goods' AND COLUMN_NAME='mix_enabled') = 0,
    'ALTER TABLE stall_goods ADD COLUMN `mix_enabled` TINYINT NOT NULL DEFAULT 1 COMMENT ''允许积分抵现'' AFTER `on_sale`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='cross_goods' AND COLUMN_NAME='category') = 0,
    'ALTER TABLE cross_goods ADD COLUMN `category` VARCHAR(32) DEFAULT ''服务'' COMMENT ''分类'' AFTER `name`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='cross_goods' AND COLUMN_NAME='stock') = 0,
    'ALTER TABLE cross_goods ADD COLUMN `stock` INT NOT NULL DEFAULT 9999 AFTER `cash_price`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='cross_goods' AND COLUMN_NAME='allow_mix') = 0,
    'ALTER TABLE cross_goods ADD COLUMN `allow_mix` TINYINT NOT NULL DEFAULT 1 COMMENT ''允许积分+微信组合'' AFTER `on_sale`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='supply_goods' AND COLUMN_NAME='category') = 0,
    'ALTER TABLE supply_goods ADD COLUMN `category` VARCHAR(32) DEFAULT ''原料'' COMMENT ''分类'' AFTER `name`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='supply_goods' AND COLUMN_NAME='desc_text') = 0,
    'ALTER TABLE supply_goods ADD COLUMN `desc_text` VARCHAR(255) DEFAULT NULL AFTER `points_ratio_text`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE `cross_orders`
  MODIFY COLUMN `pay_mode` ENUM('points','cash','mix') NOT NULL;

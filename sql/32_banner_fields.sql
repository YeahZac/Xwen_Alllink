-- Banner：按端/展示位管理；精简跳转字段（图片详情 / 本小程序页 / 其他小程序 / 外链）
USE `wanyehulian`;

-- role_scope / link_type 改为字符串，便于扩展合伙人/创始人等端
ALTER TABLE `banners`
  MODIFY COLUMN `role_scope` VARCHAR(32) NOT NULL COMMENT '端：consumer/stall/cross/supply/partner/founder/login',
  MODIFY COLUMN `link_type` VARCHAR(32) NOT NULL DEFAULT 'page' COMMENT 'image_detail|page|miniprogram|url|none';

SET @has_appid := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'banners' AND COLUMN_NAME = 'link_appid'
);
SET @ddl := IF(@has_appid = 0,
  'ALTER TABLE `banners` ADD COLUMN `link_appid` VARCHAR(64) DEFAULT NULL COMMENT ''跳转其他小程序 AppID'' AFTER `link_url`',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_limg := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'banners' AND COLUMN_NAME = 'link_image_url'
);
SET @ddl := IF(@has_limg = 0,
  'ALTER TABLE `banners` ADD COLUMN `link_image_url` VARCHAR(1024) DEFAULT NULL COMMENT ''图片详情用图'' AFTER `link_appid`',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_remark := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'banners' AND COLUMN_NAME = 'remark'
);
SET @ddl := IF(@has_remark = 0,
  'ALTER TABLE `banners` ADD COLUMN `remark` VARCHAR(255) DEFAULT NULL COMMENT ''备注'' AFTER `link_image_url`',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 旧类型迁移
UPDATE `banners` SET `link_type` = 'page' WHERE `link_type` IN ('navigate', 'switchTab');
UPDATE `banners` SET `link_type` = 'none' WHERE `link_type` = '' OR `link_type` IS NULL;
UPDATE `banners` SET `remark` = `sub_title` WHERE (`remark` IS NULL OR `remark` = '') AND `sub_title` IS NOT NULL AND `sub_title` <> '';

-- 默认展示位
UPDATE `banners` SET `page_key` = 'index' WHERE `role_scope` = 'consumer' AND (`page_key` IS NULL OR `page_key` = '');
UPDATE `banners` SET `page_key` = 'home' WHERE `role_scope` IN ('stall','cross','supply','partner','founder') AND (`page_key` IS NULL OR `page_key` = '');
UPDATE `banners` SET `page_key` = 'apply' WHERE `role_scope` = 'login' AND (`page_key` IS NULL OR `page_key` = '');

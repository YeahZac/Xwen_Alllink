-- 门店商务负责人：关联后台账号 admin_accounts.id
USE `wanyehulian`;

SET @has_biz_owner := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchants'
    AND COLUMN_NAME = 'biz_owner_admin_id'
);
SET @ddl := IF(@has_biz_owner = 0,
  'ALTER TABLE `merchants` ADD COLUMN `biz_owner_admin_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''商务负责人(admin_accounts.id)'' AFTER `owner_user_id`, ADD KEY `idx_biz_owner` (`biz_owner_admin_id`)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

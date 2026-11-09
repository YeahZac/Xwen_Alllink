-- 入驻申请软删除：后台「商家入驻审核」可删，删后小程序可重新入驻
USE `wanyehulian`;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_applications'
    AND COLUMN_NAME = 'deleted_at'
);
SET @s := IF(
  @c = 0,
  'ALTER TABLE `merchant_applications` ADD COLUMN `deleted_at` DATETIME DEFAULT NULL COMMENT ''软删除时间，非空则不在审核列表展示'' AFTER `updated_at`, ADD KEY `idx_deleted_at` (`deleted_at`)',
  'SELECT 1'
);
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

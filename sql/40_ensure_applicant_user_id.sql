-- 云托管若入驻提交报 Unknown column 'applicant_user_id'，执行本脚本
USE `wanyehulian`;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_applications'
    AND COLUMN_NAME = 'applicant_user_id'
);
SET @s := IF(
  @c = 0,
  'ALTER TABLE `merchant_applications` ADD COLUMN `applicant_user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''提交人用户ID'' AFTER `contact_phone`, ADD KEY `idx_applicant_user` (`applicant_user_id`)',
  'SELECT 1'
);
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

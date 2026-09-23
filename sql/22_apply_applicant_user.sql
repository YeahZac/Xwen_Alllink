-- 入驻申请关联提交人用户 ID，审核进度按当前登录用户查询
USE `wanyehulian`;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='merchant_applications' AND COLUMN_NAME='applicant_user_id') = 0,
    'ALTER TABLE merchant_applications ADD COLUMN `applicant_user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''提交人用户ID'' AFTER `contact_phone`, ADD KEY `idx_applicant_user` (`applicant_user_id`)',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

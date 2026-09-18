-- 用户性别（个人中心可选）
USE `wanyehulian`;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='gender') = 0,
    'ALTER TABLE users ADD COLUMN `gender` TINYINT NOT NULL DEFAULT 0 COMMENT ''0不展示 1男 2女'' AFTER `phone`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

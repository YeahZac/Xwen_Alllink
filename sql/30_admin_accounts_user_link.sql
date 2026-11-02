-- 后台账号绑定小程序用户（微信 openid），用于审核通过后开通后台登录 + 小程序身份联动
CALL sp_add_col_if_missing(
  'admin_accounts',
  'user_id',
  "`user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 users.id' AFTER `role_id`"
);
CALL sp_add_col_if_missing(
  'admin_accounts',
  'openid',
  "`openid` VARCHAR(64) DEFAULT NULL COMMENT '关联微信 openid' AFTER `user_id`"
);

-- 索引（若不存在再加）
SET @idx := (
  SELECT COUNT(1) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_accounts' AND INDEX_NAME = 'idx_admin_user'
);
SET @sql := IF(@idx = 0, 'ALTER TABLE admin_accounts ADD KEY idx_admin_user (user_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx2 := (
  SELECT COUNT(1) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_accounts' AND INDEX_NAME = 'idx_admin_openid'
);
SET @sql2 := IF(@idx2 = 0, 'ALTER TABLE admin_accounts ADD KEY idx_admin_openid (openid)', 'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

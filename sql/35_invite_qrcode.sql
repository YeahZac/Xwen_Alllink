-- 用户固定邀请小程序码 URL
USE `wanyehulian`;

SET @has_qr := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'invite_qrcode_url'
);
SET @ddl := IF(@has_qr = 0,
  'ALTER TABLE `users` ADD COLUMN `invite_qrcode_url` VARCHAR(1024) DEFAULT NULL COMMENT ''固定邀请小程序码'' AFTER `invite_code`',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 明确「邀请好友」触发点文案（积分仍由后台可改）
INSERT INTO `referral_triggers`
  (`trigger_key`,`name`,`enabled`,`reward_points`,`stackable`,`daily_limit`,`sort_order`,`remark`) VALUES
('register', '邀请好友', 1, 10, 0, 20, 10, '好友扫邀请码/填写邀请码并绑定成功后，给邀请人发积分（可在后台改积分）')
ON DUPLICATE KEY UPDATE
  `name`=VALUES(`name`),
  `remark`=VALUES(`remark`);

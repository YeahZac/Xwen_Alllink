-- 五类身份对齐：用户侧合伙人/创始人标记 + 合伙人申请
-- 商家经营类型仍用 merchants.role = stall|cross|supply（非独立登录主身份）
-- 若列已存在会报 Duplicate column，可忽略继续执行后续建表

ALTER TABLE `users`
  ADD COLUMN `is_partner` TINYINT NOT NULL DEFAULT 0 COMMENT '1=已开通合伙人身份' AFTER `status`;

ALTER TABLE `users`
  ADD COLUMN `is_founder` TINYINT NOT NULL DEFAULT 0 COMMENT '1=已开通创始人身份' AFTER `is_partner`;

CREATE TABLE IF NOT EXISTS `partner_applications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `apply_no` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
  `contact_phone` VARCHAR(20) NOT NULL DEFAULT '',
  `city` VARCHAR(64) DEFAULT NULL,
  `referrer_code` VARCHAR(32) DEFAULT NULL,
  `remark` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reject_reason` VARCHAR(255) DEFAULT NULL,
  `reviewed_by` BIGINT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_apply_no` (`apply_no`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='区域合伙人入驻申请';

CREATE TABLE IF NOT EXISTS `partner_withdraw_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `amount_points` INT NOT NULL DEFAULT 0 COMMENT '申请提现对应积分',
  `amount_cash` DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '折现人民币',
  `bank_name` VARCHAR(64) DEFAULT NULL,
  `bank_account` VARCHAR(64) DEFAULT NULL,
  `account_name` VARCHAR(64) DEFAULT NULL,
  `status` ENUM('pending','approved','rejected','paid') NOT NULL DEFAULT 'pending',
  `reject_reason` VARCHAR(255) DEFAULT NULL,
  `reviewed_by` BIGINT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合伙人佣金提现申请';

UPDATE users SET is_founder = 1 WHERE phone = '13800138000' AND status = 1;

-- 兼容扩展会话表角色枚举（若表未使用可忽略失败）
ALTER TABLE `auth_sessions`
  MODIFY COLUMN `role` ENUM('consumer','stall','cross','supply','admin','partner','founder','merchant') NOT NULL;

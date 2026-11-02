-- 后台运营角色：创始人 / 合伙人 / 负责人 + 小程序平台身份申请（创始人/负责人）

ALTER TABLE `users`
  ADD COLUMN `is_lead` TINYINT NOT NULL DEFAULT 0 COMMENT '1=已开通负责人身份（创始人权限子集）' AFTER `is_founder`;

CREATE TABLE IF NOT EXISTS `platform_role_applications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `apply_no` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `apply_role` ENUM('founder','lead') NOT NULL COMMENT '申请身份',
  `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
  `contact_phone` VARCHAR(20) NOT NULL DEFAULT '',
  `city` VARCHAR(64) DEFAULT NULL,
  `remark` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reject_reason` VARCHAR(255) DEFAULT NULL,
  `reviewed_by` BIGINT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_apply_no` (`apply_no`),
  KEY `idx_user_role_status` (`user_id`, `apply_role`, `status`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='创始人/负责人身份申请';

-- =============================================================================
-- 万业互联云 · 存量库补丁（已执行过 01_schema 的环境请跑本脚本）
-- =============================================================================
USE `wanyehulian`;

CREATE TABLE IF NOT EXISTS `merchant_account_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `account_type` ENUM('cash_goods','cash_settlement','points_redeem') NOT NULL,
  `change_amount` DECIMAL(14,2) NOT NULL,
  `balance_after` DECIMAL(14,2) NOT NULL,
  `frozen_after` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `biz_type` VARCHAR(32) NOT NULL,
  `biz_id` VARCHAR(64) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_time` (`merchant_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商户资金流水';

CREATE TABLE IF NOT EXISTS `commission_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `biz_type` VARCHAR(32) NOT NULL,
  `biz_id` VARCHAR(64) NOT NULL,
  `payer_merchant_id` BIGINT UNSIGNED DEFAULT NULL,
  `amount_gross` DECIMAL(14,2) NOT NULL,
  `rate` DECIMAL(10,6) NOT NULL,
  `commission` DECIMAL(14,2) NOT NULL,
  `rule_version` VARCHAR(32) NOT NULL DEFAULT 'default',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_biz` (`biz_type`,`biz_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台抽成流水';

-- 推荐：同一被邀请人可有多种触发点
SET @idx := (
  SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'referral_records' AND index_name = 'uk_invitee'
);
SET @sql := IF(@idx > 0, 'ALTER TABLE referral_records DROP INDEX uk_invitee', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx2 := (
  SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'referral_records' AND index_name = 'uk_invitee_trigger'
);
SET @sql2 := IF(@idx2 = 0,
  'ALTER TABLE referral_records ADD UNIQUE KEY uk_invitee_trigger (invitee_user_id, trigger_type)',
  'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

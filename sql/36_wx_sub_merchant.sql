-- 二级商户进件 / 分账比例
USE `wanyehulian`;

-- merchants 扩展
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='wx_applyment_id');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `wx_applyment_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''微信进件申请单号'' AFTER `wx_sub_mch_id`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='wx_out_request_no');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `wx_out_request_no` VARCHAR(64) DEFAULT NULL COMMENT ''进件业务申请编号'' AFTER `wx_applyment_id`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='wx_apply_state');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `wx_apply_state` VARCHAR(32) DEFAULT NULL COMMENT ''进件状态'' AFTER `wx_out_request_no`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='wx_apply_state_desc');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `wx_apply_state_desc` VARCHAR(255) DEFAULT NULL COMMENT ''进件状态说明'' AFTER `wx_apply_state`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='wx_sign_url');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `wx_sign_url` VARCHAR(512) DEFAULT NULL COMMENT ''待签约链接'' AFTER `wx_apply_state_desc`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='wx_settlement_json');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `wx_settlement_json` JSON DEFAULT NULL COMMENT ''结算账户等进件补充'' AFTER `wx_sign_url`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='profit_share_rate');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `profit_share_rate` DECIMAL(8,6) NOT NULL DEFAULT 0.100000 COMMENT ''平台分账比例0-0.3'' AFTER `wx_settlement_json`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='wx_apply_synced_at');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `wx_apply_synced_at` DATETIME DEFAULT NULL COMMENT ''最近同步进件状态'' AFTER `profit_share_rate`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `wx_sub_applyments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `out_request_no` VARCHAR(64) NOT NULL,
  `applyment_id` BIGINT UNSIGNED DEFAULT NULL,
  `organization_type` VARCHAR(8) NOT NULL DEFAULT '2401',
  `state` VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  `state_desc` VARCHAR(255) DEFAULT NULL,
  `sub_mchid` VARCHAR(32) DEFAULT NULL,
  `sign_url` VARCHAR(512) DEFAULT NULL,
  `sign_state` VARCHAR(32) DEFAULT NULL,
  `reject_detail_json` JSON DEFAULT NULL,
  `account_validation_json` JSON DEFAULT NULL,
  `request_snapshot_json` JSON DEFAULT NULL COMMENT '脱敏后的提交快照',
  `last_error` VARCHAR(512) DEFAULT NULL,
  `submitted_at` DATETIME DEFAULT NULL,
  `synced_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_out_request` (`out_request_no`),
  KEY `idx_merchant` (`merchant_id`),
  KEY `idx_applyment` (`applyment_id`),
  KEY `idx_state` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='电商收付通二级商户进件单';

CREATE TABLE IF NOT EXISTS `wx_profit_share_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `order_no` VARCHAR(64) NOT NULL,
  `transaction_id` VARCHAR(64) DEFAULT NULL,
  `sub_mchid` VARCHAR(32) NOT NULL,
  `out_order_no` VARCHAR(64) NOT NULL,
  `amount_total_fen` INT NOT NULL DEFAULT 0,
  `platform_amount_fen` INT NOT NULL DEFAULT 0,
  `rate` DECIMAL(8,6) NOT NULL DEFAULT 0,
  `state` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  `wx_response_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_out_order` (`out_order_no`),
  KEY `idx_order_no` (`order_no`),
  KEY `idx_merchant` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='微信分账请求记录';

INSERT INTO `admin_permissions` (`page_key`,`page_name`,`group_name`,`sort_order`) VALUES
('wx_sub_merchants', '二级商户进件', '交易与资金', 145)
ON DUPLICATE KEY UPDATE `page_name`=VALUES(`page_name`), `group_name`=VALUES(`group_name`), `sort_order`=VALUES(`sort_order`);

INSERT INTO `admin_role_permissions` (`role_id`,`page_key`,`can_view`,`can_edit`)
SELECT 1, 'wx_sub_merchants', 1, 1
ON DUPLICATE KEY UPDATE `can_view`=1, `can_edit`=1;

INSERT INTO `platform_config` (`config_key`, `config_value`, `remark`) VALUES
('wx_profit_share_rate_default', '0.10', '默认平台分账比例（0-0.3，需不超过合作伙伴平台最大分账比例）'),
('wx_profit_share_auto', '1', '支付成功后是否自动请求分账给平台')
ON DUPLICATE KEY UPDATE `remark`=VALUES(`remark`);

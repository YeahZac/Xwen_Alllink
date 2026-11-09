-- 业务自动化：自动审核 / 自动进件 / 门店点餐码缓存
USE `wanyehulian`;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='menu_qrcode_url');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `menu_qrcode_url` VARCHAR(512) DEFAULT NULL COMMENT ''点餐/门店小程序码'' AFTER `wx_apply_synced_at`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='pay_qrcode_url');
SET @s := IF(@c=0, 'ALTER TABLE `merchants` ADD COLUMN `pay_qrcode_url` VARCHAR(512) DEFAULT NULL COMMENT ''收款码小程序码'' AFTER `menu_qrcode_url`', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

INSERT INTO `platform_config` (`config_key`, `config_value`, `remark`) VALUES
('apply_auto_approve', '1', '商家入驻是否自动审核通过：1=开（仍校验必填资料与开城）'),
('apply_auto_approve_roles', 'stall', '自动审核角色，逗号分隔：stall,cross,supply；建议先开地摊'),
('wx_applyment_auto_submit', '1', '审核通过后资料齐备时自动提交微信二级商户进件（签约仍须商户本人微信完成）')
ON DUPLICATE KEY UPDATE `remark`=VALUES(`remark`);

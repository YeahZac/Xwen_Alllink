-- =============================================================================
-- 推荐奖励：人人可推 + 后台可配触发点（幂等）
-- =============================================================================
USE `wanyehulian`;

CREATE TABLE IF NOT EXISTS `referral_triggers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `trigger_key` VARCHAR(32) NOT NULL,
  `name` VARCHAR(64) NOT NULL,
  `enabled` TINYINT NOT NULL DEFAULT 0,
  `reward_points` INT NOT NULL DEFAULT 0,
  `stackable` TINYINT NOT NULL DEFAULT 0,
  `daily_limit` INT NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `remark` VARCHAR(255) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_trigger_key` (`trigger_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推荐奖励触发点配置';

INSERT INTO `referral_triggers`
  (`trigger_key`,`name`,`enabled`,`reward_points`,`stackable`,`daily_limit`,`sort_order`,`remark`) VALUES
('register',          '注册绑定',        1, 10,  0, 20, 10, '被邀请人绑定推荐码即给邀请人发积分'),
('first_order',       '好友首单',        1, 50,  0, 20, 20, '被邀请人完成首笔点餐或异业消费'),
('merchant_approved', '商户入驻通过',    1, 200, 0, 10, 30, '被邀请人作为商户审核通过'),
('first_cross_order', '首次异业消费',    0, 30,  0, 20, 40, '预留：可与首单叠加，仅异业核销时触发'),
('repurchase',        '复购奖励',        0, 5,   1, 10, 50, '预留：第二单起每单可发（需打开开关）'),
('custom_1',          '自定义触发点1',   0, 0,   0, 0,  80, '预留扩展位，打开后由后续业务接入'),
('custom_2',          '自定义触发点2',   0, 0,   0, 0,  90, '预留扩展位，打开后由后续业务接入')
ON DUPLICATE KEY UPDATE
  `name`=VALUES(`name`),
  `remark`=VALUES(`remark`);

INSERT INTO `platform_config` (`config_key`, `config_value`, `remark`) VALUES
('referral_risk_daily_cap', '10', '单个推广员每日奖励次数上限（0=不限）'),
('referral_enabled', '1', '是否开启推荐奖励总开关')
ON DUPLICATE KEY UPDATE `remark`=VALUES(`remark`);

INSERT INTO `admin_permissions` (`page_key`,`page_name`,`group_name`,`sort_order`) VALUES
('referral_triggers', '推荐奖励设置', '系统管理', 210)
ON DUPLICATE KEY UPDATE `page_name`=VALUES(`page_name`), `group_name`=VALUES(`group_name`), `sort_order`=VALUES(`sort_order`);

INSERT INTO `admin_role_permissions` (`role_id`,`page_key`,`can_view`,`can_edit`)
SELECT 1, 'referral_triggers', 1, 1
ON DUPLICATE KEY UPDATE `can_view`=1, `can_edit`=1;

DROP PROCEDURE IF EXISTS `add_col_if_missing_ref`;
CREATE PROCEDURE `add_col_if_missing_ref`(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END;

CALL add_col_if_missing_ref('referral_records', 'biz_key',
  '`biz_key` VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''幂等口径''');
CALL add_col_if_missing_ref('referral_records', 'invitee_merchant_id',
  '`invitee_merchant_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''被邀请商户''');
CALL add_col_if_missing_ref('referral_records', 'biz_id',
  '`biz_id` VARCHAR(64) DEFAULT NULL COMMENT ''业务单号''');
DROP PROCEDURE IF EXISTS `add_col_if_missing_ref`;

SET @old := (
  SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'referral_records'
    AND index_name = 'uk_invitee_trigger'
);
SET @sql := IF(@old > 0, 'ALTER TABLE referral_records DROP INDEX uk_invitee_trigger', 'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @nw := (
  SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'referral_records'
    AND index_name = 'uk_invitee_trigger_biz'
);
SET @sql2 := IF(@nw = 0,
  'ALTER TABLE referral_records ADD UNIQUE KEY uk_invitee_trigger_biz (invitee_user_id, trigger_type, biz_key)',
  'SELECT 1');
PREPARE st2 FROM @sql2; EXECUTE st2; DEALLOCATE PREPARE st2;

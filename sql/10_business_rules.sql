-- =============================================================================
-- 万业互联云 · 业务规则补全（对齐 BRD V1.0 第 9 章「已确认」条款）
--   #4 抽成按角色 × 价格区间（含规则版本，历史订单按下单时版本）
--   #5 推荐触发点后台全局可配（独立开关 / 奖励值 / 可叠加 / 限频）
--   #7 经营城市开通 + 异业地图点位
--   #8 平台收费：体验期后续费、成交费、等级定制服务费
--   §4.1 推荐人在入驻时写入，形成商户级推荐关系
-- 幂等：可重复执行
-- =============================================================================
USE `wanyehulian`;

-- -----------------------------------------------------------------------------
-- BRD #4：抽成规则（角色 × 价格区间 × 版本）
-- amount_min 含、amount_max 不含；amount_max IS NULL 表示不设上限
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `commission_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role` ENUM('stall','cross','supply') NOT NULL COMMENT '计费角色',
  `amount_min` DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '区间下限（含）',
  `amount_max` DECIMAL(14,2) DEFAULT NULL COMMENT '区间上限（不含）；NULL=无上限',
  `rate` DECIMAL(10,6) NOT NULL COMMENT '抽成比例',
  `rule_version` VARCHAR(32) NOT NULL COMMENT '规则版本号',
  `effective_from` DATETIME NOT NULL COMMENT '生效时间',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  `remark` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_min_version` (`role`,`amount_min`,`rule_version`),
  KEY `idx_lookup` (`role`,`status`,`effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='抽成规则（角色×区间×版本）';

-- 首版规则 v1：三角色各三档；1/1000 落在最低档作为成交服务费底线
INSERT INTO `commission_rules`
  (`role`,`amount_min`,`amount_max`,`rate`,`rule_version`,`effective_from`,`status`,`remark`) VALUES
('supply',   0.00, 100.00, 0.001000, 'v1', '2026-01-01 00:00:00', 1, '供应链 0-100 成交服务费千分之一'),
('supply', 100.00, 500.00, 0.008000, 'v1', '2026-01-01 00:00:00', 1, '供应链 100-500'),
('supply', 500.00,   NULL, 0.015000, 'v1', '2026-01-01 00:00:00', 1, '供应链 500 以上'),
('stall',    0.00, 100.00, 0.001000, 'v1', '2026-01-01 00:00:00', 1, '地摊 0-100 成交服务费千分之一'),
('stall',  100.00, 500.00, 0.005000, 'v1', '2026-01-01 00:00:00', 1, '地摊 100-500'),
('stall',  500.00,   NULL, 0.010000, 'v1', '2026-01-01 00:00:00', 1, '地摊 500 以上'),
('cross',    0.00, 100.00, 0.001000, 'v1', '2026-01-01 00:00:00', 1, '异业 0-100 成交服务费千分之一'),
('cross',  100.00, 500.00, 0.010000, 'v1', '2026-01-01 00:00:00', 1, '异业 100-500'),
('cross',  500.00,   NULL, 0.020000, 'v1', '2026-01-01 00:00:00', 1, '异业 500 以上')
ON DUPLICATE KEY UPDATE
  `amount_max`=VALUES(`amount_max`), `rate`=VALUES(`rate`),
  `effective_from`=VALUES(`effective_from`), `status`=VALUES(`status`), `remark`=VALUES(`remark`);

-- -----------------------------------------------------------------------------
-- BRD #5：推荐触发点（全局可配 + 预留扩展位）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `referral_triggers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `trigger_key` VARCHAR(32) NOT NULL COMMENT 'register/first_order/merchant_approved/first_cross_order/repurchase/...',
  `name` VARCHAR(64) NOT NULL,
  `enabled` TINYINT NOT NULL DEFAULT 0 COMMENT '1启用 0停用',
  `reward_points` INT NOT NULL DEFAULT 0 COMMENT '奖励积分',
  `stackable` TINYINT NOT NULL DEFAULT 0 COMMENT '1同一被推荐人可重复触发',
  `daily_limit` INT NOT NULL DEFAULT 0 COMMENT '同一推荐人每日上限；0=不限',
  `sort_order` INT NOT NULL DEFAULT 0,
  `remark` VARCHAR(255) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_trigger_key` (`trigger_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推荐奖励触发点配置';

INSERT INTO `referral_triggers`
  (`trigger_key`,`name`,`enabled`,`reward_points`,`stackable`,`daily_limit`,`sort_order`,`remark`) VALUES
('register',          '注册成功',      1, 10, 0, 20, 10, '被推荐人绑定推荐人即发放'),
('first_order',       '首单完成',      1, 50, 0, 20, 20, '被推荐人首笔点餐完成'),
('merchant_approved', '商户入驻审核通过', 1, 200, 0, 10, 30, '被推荐商户审核通过'),
('first_cross_order', '首次异业消费',  0, 30, 0, 20, 40, '预留：被推荐人首次异业兑换'),
('repurchase',        '复购',          0, 5, 1, 10, 50, '预留：可叠加触发点')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `remark`=VALUES(`remark`);

-- -----------------------------------------------------------------------------
-- BRD #7：经营城市开通
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `operating_cities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL COMMENT '经营城市名，与 merchants.city 同口径',
  `province` VARCHAR(32) DEFAULT NULL,
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1已开通 0未开通',
  `opened_at` DATETIME DEFAULT NULL,
  `remark` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_city_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已开通经营城市';

-- 与存量商户城市保持一致，避免历史数据变成「未开通城市」
INSERT INTO `operating_cities` (`name`,`province`,`status`,`opened_at`,`remark`) VALUES
('九江·瑞昌', '江西', 1, '2026-01-01 00:00:00', '首批试点'),
('九江·浔阳', '江西', 1, '2026-01-01 00:00:00', '首批试点'),
('九江·柴桑', '江西', 1, '2026-01-01 00:00:00', '首批试点'),
('九江·庐山', '江西', 1, '2026-01-01 00:00:00', '首批试点')
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `province`=VALUES(`province`);

-- -----------------------------------------------------------------------------
-- BRD #8：客户等级与服务费账单
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `merchant_levels` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL COMMENT 'normal/gold/chain',
  `name` VARCHAR(64) NOT NULL,
  `monthly_fee` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '软件服务费·月',
  `yearly_fee` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '软件服务费·年',
  `level_fee` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '等级定制服务费·按周期',
  `trial_months` INT NOT NULL DEFAULT 1 COMMENT '免费体验期月数（1-3）',
  `commission_discount` DECIMAL(6,4) NOT NULL DEFAULT 1.0000 COMMENT '抽成折扣，1=不打折',
  `sort_order` INT NOT NULL DEFAULT 0,
  `remark` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_level_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商户等级与服务费档位';

INSERT INTO `merchant_levels`
  (`code`,`name`,`monthly_fee`,`yearly_fee`,`level_fee`,`trial_months`,`commission_discount`,`sort_order`,`remark`) VALUES
('normal', '普通', 99.00,  999.00,    0.00, 3, 1.0000, 10, '体验 3 个月后按月/年续费'),
('gold',   '金牌', 199.00, 1999.00, 500.00, 2, 0.9000, 20, '含等级定制服务包，抽成 9 折'),
('chain',  '连锁', 399.00, 3999.00, 2000.00, 1, 0.8000, 30, '连锁多点位，抽成 8 折')
ON DUPLICATE KEY UPDATE
  `name`=VALUES(`name`), `monthly_fee`=VALUES(`monthly_fee`), `yearly_fee`=VALUES(`yearly_fee`),
  `level_fee`=VALUES(`level_fee`), `trial_months`=VALUES(`trial_months`),
  `commission_discount`=VALUES(`commission_discount`), `remark`=VALUES(`remark`);

CREATE TABLE IF NOT EXISTS `service_fee_bills` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bill_no` VARCHAR(32) NOT NULL,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `bill_type` ENUM('subscription','level','transaction') NOT NULL COMMENT '软件服务费/等级定制费/成交服务费',
  `period_start` DATE NOT NULL,
  `period_end` DATE NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `status` ENUM('pending','paid','waived','overdue') NOT NULL DEFAULT 'pending',
  `due_date` DATE DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `remark` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bill_no` (`bill_no`),
  UNIQUE KEY `uk_merchant_period` (`merchant_id`,`bill_type`,`period_start`),
  KEY `idx_merchant_status` (`merchant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台服务费账单';

-- -----------------------------------------------------------------------------
-- 字段补全（MySQL 不支持 ADD COLUMN IF NOT EXISTS，用 information_schema 判断）
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `add_col_if_missing`;
CREATE PROCEDURE `add_col_if_missing`(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END;

-- 入驻申请：推荐人 + 异业地图点位（BRD §4.1 第 2、3 步）
CALL add_col_if_missing('merchant_applications', 'referrer_code',
  '`referrer_code` VARCHAR(32) DEFAULT NULL COMMENT ''推荐人邀请码（如有）''');
CALL add_col_if_missing('merchant_applications', 'latitude',
  '`latitude` DECIMAL(10,7) DEFAULT NULL COMMENT ''地图点位纬度（异业必填）''');
CALL add_col_if_missing('merchant_applications', 'longitude',
  '`longitude` DECIMAL(10,7) DEFAULT NULL COMMENT ''地图点位经度（异业必填）''');

-- 商户：商户级推荐关系 + 等级 + 体验期 / 服务状态（BRD §4.1、#8）
CALL add_col_if_missing('merchants', 'referrer_user_id',
  '`referrer_user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''商户级推荐人''');
CALL add_col_if_missing('merchants', 'level_code',
  '`level_code` VARCHAR(32) NOT NULL DEFAULT ''normal'' COMMENT ''客户等级''');
CALL add_col_if_missing('merchants', 'trial_end_at',
  '`trial_end_at` DATE DEFAULT NULL COMMENT ''免费体验期截止''');
CALL add_col_if_missing('merchants', 'service_status',
  '`service_status` ENUM(''trial'',''active'',''overdue'',''suspended'') NOT NULL DEFAULT ''trial'' COMMENT ''服务费状态''');

DROP PROCEDURE IF EXISTS `add_col_if_missing`;

-- 存量商户：按 normal 档补体验期，避免立刻判为欠费
UPDATE `merchants` m
JOIN `merchant_levels` l ON l.code = m.level_code
SET m.trial_end_at = DATE_ADD(DATE(m.created_at), INTERVAL l.trial_months MONTH)
WHERE m.trial_end_at IS NULL;

UPDATE `merchants` SET `service_status`='trial'
WHERE `trial_end_at` IS NOT NULL AND `trial_end_at` >= CURDATE() AND `service_status`='trial';

-- -----------------------------------------------------------------------------
-- 推荐记录：支持可叠加触发点 + 商户级推荐关系
-- biz_key 承担幂等口径：不可叠加触发点固定为 ''（同人同触发点只能一条）；
-- 可叠加触发点写业务单号，同一单号仍只能发一次奖
-- 商户级推荐用 invitee_user_id=0 + invitee_merchant_id 表达
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS `add_col_if_missing2`;
CREATE PROCEDURE `add_col_if_missing2`(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END;

CALL add_col_if_missing2('referral_records', 'biz_key',
  '`biz_key` VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''幂等口径：不可叠加为空，可叠加存业务单号''');
CALL add_col_if_missing2('referral_records', 'invitee_merchant_id',
  '`invitee_merchant_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''商户级推荐时的被推荐商户''');
CALL add_col_if_missing2('referral_records', 'biz_id',
  '`biz_id` VARCHAR(64) DEFAULT NULL COMMENT ''触发行为的业务单号''');
DROP PROCEDURE IF EXISTS `add_col_if_missing2`;

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

-- 平台配置补充口径
INSERT INTO `platform_config` (`config_key`, `config_value`, `remark`) VALUES
('commission_rule_version', 'v1', '当前生效的抽成规则版本'),
('referral_risk_daily_cap', '10', '单个推荐人每日奖励次数上限（风控兜底）'),
('service_fee_enabled', '1', '是否启用平台服务费账单'),
('service_fee_cycle', 'monthly', '软件服务费默认周期 monthly/yearly'),
('overdue_policy', 'readonly', '欠费策略 readonly只读 / block禁止新单')
ON DUPLICATE KEY UPDATE `remark`=VALUES(`remark`);

-- 后台新增页面权限（配合 04_admin_rbac）
INSERT INTO `admin_permissions` (`page_key`,`page_name`,`group_name`,`sort_order`) VALUES
('cities',    '经营城市', '业务运营', 125),
('commission','抽成规则', '业务运营', 130),
('referral_triggers','推荐触发点','业务运营', 135),
('fees',      '服务费账单','业务运营', 140)
ON DUPLICATE KEY UPDATE `page_name`=VALUES(`page_name`), `sort_order`=VALUES(`sort_order`);

-- 超级管理员补齐新页面权限
INSERT INTO `admin_role_permissions` (`role_id`,`page_key`,`can_view`,`can_edit`)
SELECT 1, p.page_key, 1, 1 FROM `admin_permissions` p
WHERE p.page_key IN ('cities','commission','referral_triggers','fees')
ON DUPLICATE KEY UPDATE `can_view`=1, `can_edit`=1;

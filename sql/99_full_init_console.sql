-- AUTO combined init for WeChat Cloud MySQL console
-- Run as root or an account with CREATE privilege

-- =============================================================================
-- 仅创建业务库（在云托管 MySQL「SQL窗口」先执行这一段）
-- 库名：wanyehulian
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `wanyehulian`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

SHOW DATABASES LIKE 'wanyehulian';

-- 若账号不是 root，在「账号管理」里给 Cby_xw 勾选 wanyehulian 的全部权限
-- 或执行（需有授权权限的账号）：
-- GRANT ALL PRIVILEGES ON `wanyehulian`.* TO 'Cby_xw'@'%';
-- FLUSH PRIVILEGES;


-- =============================================================================
-- 万业互联云 · 数据库初始化脚本
-- 适用：微信云托管 MySQL 8.0+
-- 字符集：utf8mb4
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `wanyehulian`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `wanyehulian`;

-- -----------------------------------------------------------------------------
-- 平台配置
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `platform_config` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_key` VARCHAR(64) NOT NULL COMMENT '配置键',
  `config_value` TEXT NOT NULL COMMENT '配置值 JSON/字符串',
  `remark` VARCHAR(255) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台全局配置';

-- -----------------------------------------------------------------------------
-- 用户（消费者 / 也可关联商户账号）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `openid` VARCHAR(64) DEFAULT NULL COMMENT '微信 openid',
  `unionid` VARCHAR(64) DEFAULT NULL,
  `invite_code` VARCHAR(32) NOT NULL COMMENT '本人邀请码',
  `referrer_user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '唯一推荐人',
  `nickname` VARCHAR(64) DEFAULT NULL,
  `avatar_url` VARCHAR(512) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `points_balance` INT NOT NULL DEFAULT 0 COMMENT '消费者可用积分',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1正常 0禁用',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invite_code` (`invite_code`),
  UNIQUE KEY `uk_openid` (`openid`),
  KEY `idx_referrer` (`referrer_user_id`),
  KEY `idx_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='C端用户';

-- -----------------------------------------------------------------------------
-- 商户主体（地摊/异业/供应链）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `merchants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_no` VARCHAR(32) NOT NULL COMMENT '商户编号',
  `role` ENUM('stall','cross','supply') NOT NULL COMMENT '地摊/异业/供应链',
  `name` VARCHAR(128) NOT NULL,
  `credit_code` VARCHAR(32) DEFAULT NULL COMMENT '统一社会信用代码',
  `legal_person` VARCHAR(64) DEFAULT NULL,
  `contact_name` VARCHAR(64) DEFAULT NULL,
  `contact_phone` VARCHAR(20) DEFAULT NULL,
  `city` VARCHAR(64) DEFAULT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `latitude` DECIMAL(10,7) DEFAULT NULL,
  `longitude` DECIMAL(10,7) DEFAULT NULL,
  `cover_hue` VARCHAR(16) DEFAULT '#E60012',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '0待审 1营业 2停业 3驳回',
  `invite_code` VARCHAR(32) NOT NULL COMMENT '商户登录邀请码',
  `owner_user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '绑定登录用户',
  `wx_sub_mch_id` VARCHAR(64) DEFAULT NULL COMMENT '微信支付二级商户号',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_merchant_no` (`merchant_no`),
  UNIQUE KEY `uk_invite_code` (`invite_code`),
  KEY `idx_role_status` (`role`,`status`),
  KEY `idx_owner` (`owner_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商户';

-- -----------------------------------------------------------------------------
-- 入驻申请
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `merchant_applications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `apply_no` VARCHAR(32) NOT NULL,
  `role` ENUM('stall','cross','supply') NOT NULL,
  `shop_name` VARCHAR(128) NOT NULL,
  `credit_code` VARCHAR(32) NOT NULL,
  `legal_person` VARCHAR(64) NOT NULL,
  `contact_name` VARCHAR(64) NOT NULL,
  `contact_phone` VARCHAR(20) NOT NULL,
  `city` VARCHAR(64) NOT NULL,
  `address` VARCHAR(255) NOT NULL,
  `license_json` JSON NOT NULL COMMENT '证照文件URL集合',
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reject_reason` VARCHAR(255) DEFAULT NULL,
  `reviewer_id` BIGINT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `merchant_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '通过后生成的商户ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_apply_no` (`apply_no`),
  KEY `idx_phone_status` (`contact_phone`,`status`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商户入驻申请';

-- -----------------------------------------------------------------------------
-- 供应链商品
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `supply_goods` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL COMMENT '供应链商户',
  `name` VARCHAR(128) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL COMMENT '采购价',
  `stock` INT NOT NULL DEFAULT 0,
  `points_grant` INT NOT NULL DEFAULT 0 COMMENT '买方采购成交获积分额度',
  `points_ratio_text` VARCHAR(64) DEFAULT NULL,
  `status` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='供应链商品';

-- -----------------------------------------------------------------------------
-- 地摊销售商品（点餐菜单）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `stall_goods` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `points_grant` INT NOT NULL DEFAULT 0 COMMENT '消费后预计划拨积分',
  `category` VARCHAR(32) DEFAULT '主食',
  `desc_text` VARCHAR(255) DEFAULT NULL,
  `stock` INT NOT NULL DEFAULT 9999,
  `on_sale` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='地摊菜单商品';

-- -----------------------------------------------------------------------------
-- 异业兑换商品
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cross_goods` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `points_need` INT NOT NULL COMMENT '所需积分',
  `cash_price` DECIMAL(10,2) NOT NULL COMMENT '现金价（积分不足时全额现金）',
  `desc_text` VARCHAR(255) DEFAULT NULL,
  `on_sale` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='异业兑换商品';

-- -----------------------------------------------------------------------------
-- 商家积分额度池（核心）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `merchant_points_pool` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `balance` INT NOT NULL DEFAULT 0 COMMENT '可划拨额度',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_merchant` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家积分额度池';

CREATE TABLE IF NOT EXISTS `merchant_pool_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `change_amount` INT NOT NULL COMMENT '正增负减',
  `balance_after` INT NOT NULL,
  `biz_type` ENUM('purchase','admin_grant','allocate','adjust') NOT NULL,
  `biz_id` VARCHAR(64) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_time` (`merchant_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='额度池流水';

-- -----------------------------------------------------------------------------
-- 消费者积分流水
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_points_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `change_amount` INT NOT NULL,
  `balance_after` INT NOT NULL,
  `biz_type` ENUM('grant','spend','referral','adjust') NOT NULL,
  `biz_id` VARCHAR(64) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `cash_value` DECIMAL(10,4) DEFAULT NULL COMMENT '按当时汇率折算',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_time` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户积分流水';

-- -----------------------------------------------------------------------------
-- 采购订单（地摊/异业 → 供应链）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(32) NOT NULL,
  `buyer_merchant_id` BIGINT UNSIGNED NOT NULL,
  `seller_merchant_id` BIGINT UNSIGNED NOT NULL,
  `fulfill_type` ENUM('online','offline') NOT NULL DEFAULT 'online' COMMENT '线上物流/线下补记',
  `total_amount` DECIMAL(12,2) NOT NULL,
  `points_grant` INT NOT NULL DEFAULT 0 COMMENT '买方获额度合计',
  `status` ENUM('pending','shipped','confirmed','cancelled') NOT NULL DEFAULT 'pending',
  `paid_at` DATETIME DEFAULT NULL,
  `confirmed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_buyer` (`buyer_merchant_id`),
  KEY `idx_seller` (`seller_merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购订单';

CREATE TABLE IF NOT EXISTS `purchase_order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `goods_id` BIGINT UNSIGNED NOT NULL,
  `goods_name` VARCHAR(128) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `qty` INT NOT NULL,
  `points_grant` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购订单明细';

-- -----------------------------------------------------------------------------
-- C端消费订单（地摊点餐）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `consumer_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `merchant_id` BIGINT UNSIGNED NOT NULL COMMENT '地摊',
  `total_amount` DECIMAL(10,2) NOT NULL,
  `points_want` INT NOT NULL DEFAULT 0 COMMENT '预计划拨',
  `points_allocated` INT NOT NULL DEFAULT 0 COMMENT '实际划拨',
  `pay_status` ENUM('unpaid','paid','refunded') NOT NULL DEFAULT 'unpaid',
  `order_status` ENUM('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
  `wx_transaction_id` VARCHAR(64) DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user` (`user_id`),
  KEY `idx_merchant` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='C端点餐订单';

CREATE TABLE IF NOT EXISTS `consumer_order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `goods_id` BIGINT UNSIGNED NOT NULL,
  `goods_name` VARCHAR(128) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `points_grant` INT NOT NULL DEFAULT 0,
  `qty` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='点餐明细';

-- -----------------------------------------------------------------------------
-- 异业兑换/现金单
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cross_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `goods_id` BIGINT UNSIGNED NOT NULL,
  `goods_name` VARCHAR(128) NOT NULL,
  `pay_mode` ENUM('points','cash') NOT NULL,
  `points_spend` INT NOT NULL DEFAULT 0,
  `cash_amount` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `status` ENUM('pending','completed','cancelled') NOT NULL DEFAULT 'completed',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user` (`user_id`),
  KEY `idx_merchant` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='异业兑换订单';

-- -----------------------------------------------------------------------------
-- 商户资金账户（货款 / 应收 / 供应链积分折现权益）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `merchant_accounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `account_type` ENUM('cash_goods','cash_settlement','points_redeem') NOT NULL
    COMMENT '货款现金/异业应收/供应链积分折现',
  `balance` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `frozen` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_merchant_type` (`merchant_id`,`account_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商户资金账户';

CREATE TABLE IF NOT EXISTS `withdraw_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_no` VARCHAR(32) NOT NULL,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `account_type` ENUM('cash_goods','cash_settlement','points_redeem') NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `status` ENUM('pending','approved','paid','rejected') NOT NULL DEFAULT 'pending',
  `remark` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_request_no` (`request_no`),
  KEY `idx_merchant` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='提现申请';

-- -----------------------------------------------------------------------------
-- 商户资金流水（货款 / 应收 / 积分折现权益）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `merchant_account_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT UNSIGNED NOT NULL,
  `account_type` ENUM('cash_goods','cash_settlement','points_redeem') NOT NULL,
  `change_amount` DECIMAL(14,2) NOT NULL COMMENT '对可用余额的变动；打款核销可为0',
  `balance_after` DECIMAL(14,2) NOT NULL,
  `frozen_after` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `biz_type` VARCHAR(32) NOT NULL COMMENT 'purchase/commission/settle/withdraw_*',
  `biz_id` VARCHAR(64) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_time` (`merchant_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商户资金流水';

-- -----------------------------------------------------------------------------
-- 抽成流水（简化：默认费率版本）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `commission_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `biz_type` VARCHAR(32) NOT NULL COMMENT 'purchase/cross/stall',
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

-- -----------------------------------------------------------------------------
-- 广告 Banner
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `banners` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_scope` ENUM('consumer','stall','cross','supply','login') NOT NULL,
  `title` VARCHAR(64) NOT NULL,
  `sub_title` VARCHAR(128) DEFAULT NULL,
  `image_url` VARCHAR(512) NOT NULL,
  `link_url` VARCHAR(255) DEFAULT NULL,
  `link_type` ENUM('navigate','switchTab','none') NOT NULL DEFAULT 'none',
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` TINYINT NOT NULL DEFAULT 1,
  `start_at` DATETIME DEFAULT NULL,
  `end_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_role_status` (`role_scope`,`status`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='广告位';

-- -----------------------------------------------------------------------------
-- 推荐记录
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `referral_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `inviter_user_id` BIGINT UNSIGNED NOT NULL,
  `invitee_user_id` BIGINT UNSIGNED NOT NULL,
  `trigger_type` VARCHAR(32) NOT NULL DEFAULT 'register' COMMENT 'register/first_order...',
  `reward_points` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invitee_trigger` (`invitee_user_id`,`trigger_type`),
  KEY `idx_inviter` (`inviter_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='单级推荐记录';

-- -----------------------------------------------------------------------------
-- 投诉
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `complaints` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `target_type` ENUM('merchant','order','other') NOT NULL DEFAULT 'other',
  `target_id` BIGINT UNSIGNED DEFAULT NULL,
  `content` TEXT NOT NULL,
  `status` ENUM('open','processing','closed') NOT NULL DEFAULT 'open',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投诉反馈';

-- -----------------------------------------------------------------------------
-- 原料供应需求
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `supply_needs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED DEFAULT NULL,
  `goods_name` VARCHAR(128) NOT NULL,
  `qty_text` VARCHAR(64) DEFAULT NULL,
  `expect_time` VARCHAR(64) DEFAULT NULL,
  `note` VARCHAR(512) DEFAULT NULL,
  `status` ENUM('open','quoted','closed') NOT NULL DEFAULT 'open',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='原材料供应需求';

-- -----------------------------------------------------------------------------
-- 会话 / Token（简化：服务端签发 JWT，此表可选存 refresh）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `merchant_id` BIGINT UNSIGNED DEFAULT NULL,
  `role` ENUM('consumer','stall','cross','supply','admin') NOT NULL,
  `token_jti` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_jti` (`token_jti`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录会话';

SET FOREIGN_KEY_CHECKS = 1;

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

-- =============================================================================
-- 万业互联云 · 演示种子数据（闭环样例）
-- 执行前请先执行 01_schema.sql；存量库请先执行 03_patch.sql
-- 可重复执行（固定主键 + ON DUPLICATE KEY UPDATE）
-- =============================================================================

USE `wanyehulian`;

INSERT INTO `platform_config` (`config_key`, `config_value`, `remark`) VALUES
('points_cash_rate', '0.01', '1积分=多少元（抵现汇率）'),
('referral_first_order_reward', '50', '好友首单推荐奖励积分'),
('commission_rate_default', '0.001', '默认成交抽成约千分之一'),
('pool_shortage_policy', 'partial', '额度不足时：partial部分划拨 / block限制完单'),
('withdraw_t_plus', '1', '提现 T+N 工作日（演示配置）')
ON DUPLICATE KEY UPDATE `config_value`=VALUES(`config_value`), `remark`=VALUES(`remark`);

-- ---------- 用户 ----------
INSERT INTO `users` (`id`, `openid`, `invite_code`, `referrer_user_id`, `nickname`, `phone`, `points_balance`, `status`) VALUES
(1, 'demo_openid_c001', 'C001', NULL, '演示消费者', '13800000001', 286, 1),
(2, 'demo_openid_c002', 'C002', 1, '好友小李', '13800000002', 80, 1),
(3, 'demo_openid_c003', 'C003', 1, '夜市常客阿强', '13800000003', 120, 1)
ON DUPLICATE KEY UPDATE
  `nickname`=VALUES(`nickname`),
  `referrer_user_id`=VALUES(`referrer_user_id`),
  `points_balance`=VALUES(`points_balance`),
  `phone`=VALUES(`phone`);

-- ---------- 商户（含坐标，便于附近/地图演示） ----------
INSERT INTO `merchants` (
  `id`, `merchant_no`, `role`, `name`, `credit_code`, `legal_person`, `contact_name`, `contact_phone`,
  `city`, `address`, `latitude`, `longitude`, `cover_hue`, `status`, `invite_code`, `owner_user_id`
) VALUES
(1, 'M_STALL_01', 'stall', '张记夜市炒面', '91360481MA39U4GA9B', '张老板', '张老板', '13800001001',
 '九江·瑞昌', '夜市一条街 A12', 29.6761000, 115.6810000, '#E60012', 1, 'D001', NULL),
(2, 'M_STALL_02', 'stall', '阿姐烤串档', '91360481MA39U4GA9C', '阿姐', '阿姐', '13800001002',
 '九江·瑞昌', '夜市一条街 B03', 29.6765000, 115.6818000, '#FF4757', 1, 'D002', NULL),
(3, 'M_CROSS_01', 'cross', '瑞昌果切小屋', '91360481MA39U4GA9D', '果切店长', '果切店长', '13800002001',
 '九江·瑞昌', '步行街 B12', 29.6752000, 115.6795000, '#F5A623', 1, 'Y001', NULL),
(4, 'M_SUPPLY_01', 'supply', '赣北粮油供应链', '91360481MA39U4GA9E', '供应链经理', '供应链经理', '13800003001',
 '九江·瑞昌', '工业园 8 号仓', 29.6900000, 115.7000000, '#E60012', 1, 'G001', NULL),
(5, 'M_CROSS_02', 'cross', '老街奶茶铺', '91360481MA39U4GA9F', '奶茶店长', '奶茶店长', '13800002002',
 '九江·瑞昌', '老街 16 号', 29.6748000, 115.6788000, '#2EC4B6', 1, 'Y002', NULL)
ON DUPLICATE KEY UPDATE
  `name`=VALUES(`name`), `city`=VALUES(`city`), `address`=VALUES(`address`),
  `latitude`=VALUES(`latitude`), `longitude`=VALUES(`longitude`), `status`=VALUES(`status`);

-- 额度池终值（与下方流水对上）
INSERT INTO `merchant_points_pool` (`merchant_id`, `balance`) VALUES
(1, 5000), (2, 3200), (3, 2600), (5, 880)
ON DUPLICATE KEY UPDATE `balance`=VALUES(`balance`);

-- 资金账户终值
INSERT INTO `merchant_accounts` (`merchant_id`, `account_type`, `balance`, `frozen`) VALUES
(1, 'cash_settlement', 2860.00, 0.00),
(2, 'cash_settlement', 420.00, 0.00),
(3, 'cash_settlement', 1820.00, 200.00),
(4, 'cash_goods', 20900.00, 500.00),
(4, 'points_redeem', 8600.00, 0.00),
(5, 'cash_settlement', 96.00, 0.00)
ON DUPLICATE KEY UPDATE `balance`=VALUES(`balance`), `frozen`=VALUES(`frozen`);

-- ---------- 商品（固定 ID） ----------
INSERT INTO `stall_goods` (`id`, `merchant_id`, `name`, `price`, `points_grant`, `category`, `desc_text`, `stock`, `on_sale`) VALUES
(1, 1, '招牌炒面', 12.00, 18, '主食', '宽面现炒', 9999, 1),
(2, 1, '加蛋', 2.00, 3, '配料', '配料', 9999, 1),
(3, 1, '加火腿肠', 3.00, 4, '配料', '配料', 9999, 1),
(4, 1, '酸辣粉', 10.00, 15, '主食', '可选微辣', 9999, 1),
(5, 1, '冰红茶', 4.00, 5, '饮品', '饮品', 9999, 1),
(6, 2, '羊肉串 ×5', 20.00, 28, '主食', '现烤', 9999, 1),
(7, 2, '烤茄子', 8.00, 10, '主食', '蒜香', 9999, 1)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `price`=VALUES(`price`), `points_grant`=VALUES(`points_grant`);

INSERT INTO `cross_goods` (`id`, `merchant_id`, `name`, `points_need`, `cash_price`, `desc_text`, `on_sale`) VALUES
(1, 3, '时令果切拼盘', 200, 18.00, '当日鲜切', 1),
(2, 3, '椰子水', 80, 8.00, '冷藏', 1),
(3, 5, '招牌奶茶', 100, 12.00, '少糖去冰可选', 1)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `points_need`=VALUES(`points_need`), `cash_price`=VALUES(`cash_price`);

INSERT INTO `supply_goods` (`id`, `merchant_id`, `name`, `price`, `stock`, `points_grant`, `points_ratio_text`, `status`) VALUES
(1, 4, '宽面 5kg', 28.00, 118, 280, '货值约1000:1', 1),
(2, 4, '菜籽油 5L', 68.00, 39, 680, '货值约1000:1', 1),
(3, 4, '火腿肠箱装', 45.00, 66, 360, '货值约800:1', 1),
(4, 4, '时令水果箱', 88.00, 28, 880, '异业采购可获额度', 1)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `price`=VALUES(`price`), `stock`=VALUES(`stock`), `points_grant`=VALUES(`points_grant`);

-- ---------- Banner ----------
DELETE FROM `banners`;
INSERT INTO `banners` (`role_scope`, `title`, `sub_title`, `image_url`, `link_url`, `link_type`, `sort_order`, `status`) VALUES
('consumer', '新客专享', '首单立减 · 扫码点餐', '/assets/banners/consumer-1.png', '/pages/stall-menu/stall-menu?id=1&from=scan', 'navigate', 1, 1),
('consumer', '积分抵现周', '100积分=1元 · 异业通用', '/assets/banners/consumer-2.png', '/pages/points/points', 'switchTab', 2, 1),
('stall', '采购获额度', '向供应链进货 · 划拨给顾客', '/assets/banners/stall-2.png', '/merchant/purchase/purchase', 'navigate', 1, 1),
('cross', '承接积分客', '自定兑换规则 · 全现金兜底', '/assets/banners/cross-1.png', '/merchant/goods/goods', 'navigate', 1, 1),
('supply', '拓展地摊客户', '货款与积分权益分账户', '/assets/banners/supply-1.png', '/merchant/customers/customers', 'navigate', 1, 1),
('login', '商户入驻', '地摊 / 异业 / 供应链', '/assets/banners/login-2.png', '/pages/apply/apply', 'navigate', 1, 1);

-- ---------- 入驻申请（待审 + 历史） ----------
INSERT INTO `merchant_applications` (
  `id`, `apply_no`, `role`, `shop_name`, `credit_code`, `legal_person`, `contact_name`, `contact_phone`,
  `city`, `address`, `license_json`, `status`, `reject_reason`, `merchant_id`, `reviewed_at`
) VALUES
(1, 'AP20260301001', 'stall', '路边凉皮摊', '91360481MA39U4GA9G', '王师傅', '王师傅', '13800001999',
 '九江·瑞昌', '夜市 C08', CAST('{"businessLicense":"demo","foodLicense":"demo","idCardFront":"demo","idCardBack":"demo"}' AS JSON),
 'pending', NULL, NULL, NULL),
(2, 'AP20260220001', 'cross', '老街奶茶铺', '91360481MA39U4GA9F', '奶茶店长', '奶茶店长', '13800002002',
 '九江·瑞昌', '老街 16 号', CAST('{"businessLicense":"demo","idCardFront":"demo","idCardBack":"demo","storePhoto":"demo"}' AS JSON),
 'approved', NULL, 5, NOW() - INTERVAL 10 DAY),
(3, 'AP20260210001', 'supply', '资料不全供应链', '91360481MA39U4GA9H', '李某', '李某', '13800003999',
 '九江·瑞昌', '开发区', CAST('{"businessLicense":"demo","idCardFront":"demo"}' AS JSON),
 'rejected', '证照不齐，请补传身份证反面', NULL, NOW() - INTERVAL 20 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `reject_reason`=VALUES(`reject_reason`);

-- ---------- 采购订单闭环 ----------
INSERT INTO `purchase_orders` (
  `id`, `order_no`, `buyer_merchant_id`, `seller_merchant_id`, `fulfill_type`,
  `total_amount`, `points_grant`, `status`, `paid_at`, `confirmed_at`, `created_at`
) VALUES
(1, 'PSEED0001', 1, 4, 'offline', 56.00, 560, 'confirmed', NOW() - INTERVAL 15 DAY, NOW() - INTERVAL 15 DAY, NOW() - INTERVAL 15 DAY),
(2, 'PSEED0002', 3, 4, 'online', 88.00, 880, 'confirmed', NOW() - INTERVAL 12 DAY, NOW() - INTERVAL 11 DAY, NOW() - INTERVAL 12 DAY),
(3, 'PSEED0003', 1, 4, 'online', 68.00, 680, 'shipped', NOW() - INTERVAL 2 DAY, NULL, NOW() - INTERVAL 2 DAY),
(4, 'PSEED0004', 5, 4, 'online', 88.00, 880, 'pending', NOW() - INTERVAL 1 DAY, NULL, NOW() - INTERVAL 1 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `total_amount`=VALUES(`total_amount`);

INSERT INTO `purchase_order_items` (`id`, `order_id`, `goods_id`, `goods_name`, `price`, `qty`, `points_grant`) VALUES
(1, 1, 1, '宽面 5kg', 28.00, 2, 280),
(2, 2, 4, '时令水果箱', 88.00, 1, 880),
(3, 3, 2, '菜籽油 5L', 68.00, 1, 680),
(4, 4, 4, '时令水果箱', 88.00, 1, 880)
ON DUPLICATE KEY UPDATE `qty`=VALUES(`qty`);

-- ---------- C端点餐 ----------
INSERT INTO `consumer_orders` (
  `id`, `order_no`, `user_id`, `merchant_id`, `total_amount`, `points_want`, `points_allocated`,
  `pay_status`, `order_status`, `paid_at`, `created_at`
) VALUES
(1, 'OSEED0001', 1, 1, 14.00, 21, 21, 'paid', 'completed', NOW() - INTERVAL 8 DAY, NOW() - INTERVAL 8 DAY),
(2, 'OSEED0002', 2, 1, 12.00, 18, 18, 'paid', 'completed', NOW() - INTERVAL 7 DAY, NOW() - INTERVAL 7 DAY),
(3, 'OSEED0003', 1, 2, 20.00, 28, 28, 'paid', 'completed', NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 5 DAY),
(4, 'OSEED0004', 3, 1, 16.00, 23, 23, 'paid', 'completed', NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY)
ON DUPLICATE KEY UPDATE `points_allocated`=VALUES(`points_allocated`), `total_amount`=VALUES(`total_amount`);

INSERT INTO `consumer_order_items` (`id`, `order_id`, `goods_id`, `goods_name`, `price`, `points_grant`, `qty`) VALUES
(1, 1, 1, '招牌炒面', 12.00, 18, 1),
(2, 1, 2, '加蛋', 2.00, 3, 1),
(3, 2, 1, '招牌炒面', 12.00, 18, 1),
(4, 3, 6, '羊肉串 ×5', 20.00, 28, 1),
(5, 4, 1, '招牌炒面', 12.00, 18, 1),
(6, 4, 5, '冰红茶', 4.00, 5, 1)
ON DUPLICATE KEY UPDATE `qty`=VALUES(`qty`);

-- ---------- 异业兑换 ----------
INSERT INTO `cross_orders` (
  `id`, `order_no`, `user_id`, `merchant_id`, `goods_id`, `goods_name`,
  `pay_mode`, `points_spend`, `cash_amount`, `status`, `created_at`
) VALUES
(1, 'CSEED0001', 1, 3, 1, '时令果切拼盘', 'points', 200, 0.00, 'completed', NOW() - INTERVAL 6 DAY),
(2, 'CSEED0002', 1, 3, 2, '椰子水', 'cash', 0, 8.00, 'completed', NOW() - INTERVAL 4 DAY),
(3, 'CSEED0003', 3, 5, 3, '招牌奶茶', 'points', 100, 0.00, 'completed', NOW() - INTERVAL 2 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`);

-- ---------- 额度池流水 ----------
DELETE FROM `merchant_pool_ledger`;
INSERT INTO `merchant_pool_ledger` (`merchant_id`, `change_amount`, `balance_after`, `biz_type`, `biz_id`, `title`, `created_at`) VALUES
(1, 560, 560, 'purchase', 'PSEED0001', '采购成交 · 宽面 5kg · 获额度 +560', NOW() - INTERVAL 15 DAY),
(1, 5000, 5560, 'admin_grant', 'AGSEED01', '平台后台发放积分额度 +5000', NOW() - INTERVAL 14 DAY),
(1, -21, 5539, 'allocate', 'OSEED0001', '划拨给消费者 · OSEED0001', NOW() - INTERVAL 8 DAY),
(1, -18, 5521, 'allocate', 'OSEED0002', '划拨给消费者 · OSEED0002', NOW() - INTERVAL 7 DAY),
(1, -23, 5498, 'allocate', 'OSEED0004', '划拨给消费者 · OSEED0004', NOW() - INTERVAL 3 DAY),
(1, -498, 5000, 'adjust', 'SEED_ADJ1', '演示对齐终值', NOW() - INTERVAL 1 DAY),
(2, 3200, 3200, 'admin_grant', 'AGSEED02', '平台后台发放积分额度 +3200', NOW() - INTERVAL 14 DAY),
(2, -28, 3172, 'allocate', 'OSEED0003', '划拨给消费者 · OSEED0003', NOW() - INTERVAL 5 DAY),
(2, 28, 3200, 'adjust', 'SEED_ADJ2', '演示对齐终值', NOW() - INTERVAL 1 DAY),
(3, 880, 880, 'purchase', 'PSEED0002', '采购成交 · 时令水果箱 · 获额度 +880', NOW() - INTERVAL 11 DAY),
(3, 2000, 2880, 'admin_grant', 'AGSEED03', '平台后台发放积分额度 +2000', NOW() - INTERVAL 10 DAY),
(3, -280, 2600, 'adjust', 'SEED_ADJ3', '演示对齐终值', NOW() - INTERVAL 1 DAY),
(5, 880, 880, 'admin_grant', 'AGSEED05', '开业赠送额度 +880', NOW() - INTERVAL 9 DAY);

-- ---------- 用户积分流水 ----------
DELETE FROM `user_points_ledger`;
INSERT INTO `user_points_ledger` (`user_id`, `change_amount`, `balance_after`, `biz_type`, `biz_id`, `title`, `cash_value`, `created_at`) VALUES
(1, 21, 21, 'grant', 'OSEED0001', '张记夜市炒面 · 消费划拨', 0.2100, NOW() - INTERVAL 8 DAY),
(1, 50, 71, 'referral', 'OSEED0002', '好友首单推荐奖励 +50', 0.5000, NOW() - INTERVAL 7 DAY),
(1, 28, 99, 'grant', 'OSEED0003', '阿姐烤串档 · 消费划拨', 0.2800, NOW() - INTERVAL 5 DAY),
(1, 387, 486, 'adjust', 'SEED_U1', '历史累计对齐', 3.8700, NOW() - INTERVAL 5 DAY),
(1, -200, 286, 'spend', 'CSEED0001', '时令果切拼盘 · 兑换扣减', 2.0000, NOW() - INTERVAL 6 DAY),
(2, 18, 18, 'grant', 'OSEED0002', '张记夜市炒面 · 消费划拨', 0.1800, NOW() - INTERVAL 7 DAY),
(2, 62, 80, 'adjust', 'SEED_U2', '历史累计对齐', 0.6200, NOW() - INTERVAL 1 DAY),
(3, 23, 23, 'grant', 'OSEED0004', '张记夜市炒面 · 消费划拨', 0.2300, NOW() - INTERVAL 3 DAY),
(3, 197, 220, 'adjust', 'SEED_U3', '历史累计对齐', 1.9700, NOW() - INTERVAL 2 DAY),
(3, -100, 120, 'spend', 'CSEED0003', '招牌奶茶 · 兑换扣减', 1.0000, NOW() - INTERVAL 2 DAY);

-- ---------- 资金流水（摘要） ----------
DELETE FROM `merchant_account_ledger`;
INSERT INTO `merchant_account_ledger`
  (`merchant_id`, `account_type`, `change_amount`, `balance_after`, `frozen_after`, `biz_type`, `biz_id`, `title`, `created_at`) VALUES
(4, 'cash_goods', 55.94, 55.94, 0.00, 'purchase_cash', 'PSEED0001', '采购货款入账 · PSEED0001', NOW() - INTERVAL 15 DAY),
(4, 'points_redeem', 5.60, 5.60, 0.00, 'purchase_points_equity', 'PSEED0001', '买方获额对应折现权益 · PSEED0001', NOW() - INTERVAL 15 DAY),
(4, 'cash_goods', 87.91, 143.85, 0.00, 'purchase_cash', 'PSEED0002', '采购货款入账 · PSEED0002', NOW() - INTERVAL 11 DAY),
(4, 'points_redeem', 8.80, 14.40, 0.00, 'purchase_points_equity', 'PSEED0002', '买方获额对应折现权益 · PSEED0002', NOW() - INTERVAL 11 DAY),
(4, 'cash_goods', 21256.15, 21400.00, 0.00, 'adjust', 'SEED_AC4', '历史货款对齐终值', NOW() - INTERVAL 10 DAY),
(4, 'points_redeem', 8585.60, 8600.00, 0.00, 'adjust', 'SEED_AC4B', '历史权益对齐终值', NOW() - INTERVAL 10 DAY),
(4, 'cash_goods', -500.00, 20900.00, 500.00, 'withdraw_freeze', 'WDSEED02', '提现申请冻结 · WDSEED02', NOW() - INTERVAL 1 DAY),
(1, 'cash_settlement', 13.99, 13.99, 0.00, 'stall_settle', 'OSEED0001', '点餐货款入账 · OSEED0001', NOW() - INTERVAL 8 DAY),
(1, 'cash_settlement', 2846.01, 2860.00, 0.00, 'adjust', 'SEED_AC1', '历史应收对齐终值', NOW() - INTERVAL 1 DAY),
(3, 'cash_settlement', 1.99, 1.99, 0.00, 'cross_points_settle', 'CSEED0001', '积分兑换结算 · CSEED0001', NOW() - INTERVAL 6 DAY),
(3, 'cash_settlement', 7.99, 9.98, 0.00, 'cross_cash_settle', 'CSEED0002', '全现金兑换结算 · CSEED0002', NOW() - INTERVAL 4 DAY),
(3, 'cash_settlement', 2010.02, 2020.00, 0.00, 'adjust', 'SEED_AC3', '历史应收对齐终值', NOW() - INTERVAL 1 DAY),
(3, 'cash_settlement', -200.00, 1820.00, 200.00, 'withdraw_freeze', 'WDSEED01', '提现申请冻结 · WDSEED01', NOW() - INTERVAL 1 DAY),
(2, 'cash_settlement', 19.98, 19.98, 0.00, 'stall_settle', 'OSEED0003', '点餐货款入账 · OSEED0003', NOW() - INTERVAL 5 DAY),
(2, 'cash_settlement', 400.02, 420.00, 0.00, 'adjust', 'SEED_AC2', '历史应收对齐终值', NOW() - INTERVAL 1 DAY),
(5, 'cash_settlement', 0.99, 0.99, 0.00, 'cross_points_settle', 'CSEED0003', '积分兑换结算 · CSEED0003', NOW() - INTERVAL 2 DAY),
(5, 'cash_settlement', 95.01, 96.00, 0.00, 'adjust', 'SEED_AC5', '历史应收对齐终值', NOW() - INTERVAL 1 DAY);

-- ---------- 抽成流水 ----------
DELETE FROM `commission_ledger`;
INSERT INTO `commission_ledger` (`biz_type`, `biz_id`, `payer_merchant_id`, `amount_gross`, `rate`, `commission`, `rule_version`, `created_at`) VALUES
('purchase', 'PSEED0001', 4, 56.00, 0.001000, 0.06, 'default', NOW() - INTERVAL 15 DAY),
('purchase', 'PSEED0002', 4, 88.00, 0.001000, 0.09, 'default', NOW() - INTERVAL 11 DAY),
('stall', 'OSEED0001', 1, 14.00, 0.001000, 0.01, 'default', NOW() - INTERVAL 8 DAY),
('stall', 'OSEED0002', 1, 12.00, 0.001000, 0.01, 'default', NOW() - INTERVAL 7 DAY),
('stall', 'OSEED0003', 2, 20.00, 0.001000, 0.02, 'default', NOW() - INTERVAL 5 DAY),
('stall', 'OSEED0004', 1, 16.00, 0.001000, 0.02, 'default', NOW() - INTERVAL 3 DAY),
('cross', 'CSEED0001', 3, 2.00, 0.001000, 0.00, 'default', NOW() - INTERVAL 6 DAY),
('cross', 'CSEED0002', 3, 8.00, 0.001000, 0.01, 'default', NOW() - INTERVAL 4 DAY),
('cross', 'CSEED0003', 5, 1.00, 0.001000, 0.00, 'default', NOW() - INTERVAL 2 DAY);

-- ---------- 提现 ----------
INSERT INTO `withdraw_requests` (`id`, `request_no`, `merchant_id`, `account_type`, `amount`, `status`, `remark`, `created_at`) VALUES
(1, 'WDSEED01', 3, 'cash_settlement', 200.00, 'pending', '异业应收提现', NOW() - INTERVAL 1 DAY),
(2, 'WDSEED02', 4, 'cash_goods', 500.00, 'pending', '供应链货款提现', NOW() - INTERVAL 1 DAY),
(3, 'WDSEED03', 1, 'cash_settlement', 100.00, 'paid', '地摊历史提现已打款', NOW() - INTERVAL 20 DAY),
(4, 'WDSEED04', 4, 'points_redeem', 50.00, 'rejected', '资料不全已驳回', NOW() - INTERVAL 18 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `amount`=VALUES(`amount`), `remark`=VALUES(`remark`);

-- ---------- 推荐 ----------
INSERT INTO `referral_records` (`id`, `inviter_user_id`, `invitee_user_id`, `trigger_type`, `reward_points`, `created_at`) VALUES
(1, 1, 2, 'register', 0, NOW() - INTERVAL 10 DAY),
(2, 1, 2, 'first_order', 50, NOW() - INTERVAL 7 DAY),
(3, 1, 3, 'register', 0, NOW() - INTERVAL 9 DAY)
ON DUPLICATE KEY UPDATE `reward_points`=VALUES(`reward_points`);

-- ---------- 投诉 / 供应需求 ----------
INSERT INTO `complaints` (`id`, `user_id`, `target_type`, `target_id`, `content`, `status`, `created_at`) VALUES
(1, 1, 'merchant', 1, '上次炒面等太久，希望加快出餐', 'processing', NOW() - INTERVAL 4 DAY),
(2, 3, 'order', 3, '烤串少送了一串', 'open', NOW() - INTERVAL 2 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `content`=VALUES(`content`);

INSERT INTO `supply_needs` (`id`, `user_id`, `goods_name`, `qty_text`, `expect_time`, `note`, `status`, `created_at`) VALUES
(1, NULL, '冷冻鸡翅', '每周 2 箱', '本周五前', '地摊档口询价', 'open', NOW() - INTERVAL 3 DAY),
(2, 1, '现切水果原料', '每天 1 箱', '长期', '异业果切补货', 'quoted', NOW() - INTERVAL 6 DAY)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`), `note`=VALUES(`note`);

-- 运营后台登录码默认 A001（环境变量 ADMIN_CODE，不写入 merchants 表）
-- 演示码：C001/C002/C003 消费者 / D001 D002 地摊 / Y001 Y002 异业 / G001 供应链 / A001 运营

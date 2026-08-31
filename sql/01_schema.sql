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

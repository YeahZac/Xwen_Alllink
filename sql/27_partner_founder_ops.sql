-- 合伙人采购单 + 创始人操作日志（说明书 Tab 能力）

CREATE TABLE IF NOT EXISTS `partner_purchase_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `goods_name` VARCHAR(128) NOT NULL,
  `qty_text` VARCHAR(64) DEFAULT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('pending','sent','accepted','shipped','done','cancelled') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user` (`user_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合伙人采购单';

CREATE TABLE IF NOT EXISTS `operation_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_user_id` BIGINT UNSIGNED DEFAULT NULL,
  `actor_role` VARCHAR(32) DEFAULT NULL,
  `action` VARCHAR(64) NOT NULL,
  `target_type` VARCHAR(32) DEFAULT NULL,
  `target_id` VARCHAR(64) DEFAULT NULL,
  `detail` VARCHAR(512) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_actor` (`actor_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台操作日志';

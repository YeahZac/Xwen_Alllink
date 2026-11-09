-- 商品类目表结构（不再自动灌演示类目；类目由运营台维护）
CREATE TABLE IF NOT EXISTS `goods_categories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role` VARCHAR(16) NOT NULL COMMENT 'stall/cross/supply',
  `name` VARCHAR(64) NOT NULL COMMENT '类目名称',
  `image_url` VARCHAR(1024) DEFAULT NULL COMMENT '小程序类目封面',
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_name` (`role`, `name`),
  KEY `idx_role_status` (`role`, `status`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品类目';

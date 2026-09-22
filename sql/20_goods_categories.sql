-- 商品类目（按地摊 / 异业 / 供应链角色区分）
CREATE TABLE IF NOT EXISTS `goods_categories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role` VARCHAR(16) NOT NULL COMMENT 'stall/cross/supply',
  `name` VARCHAR(64) NOT NULL COMMENT '类目名称',
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_name` (`role`, `name`),
  KEY `idx_role_status` (`role`, `status`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品类目';

INSERT INTO `goods_categories` (`role`, `name`, `sort_order`, `status`) VALUES
('stall', '烧烤', 10, 1),
('stall', '小吃', 20, 1),
('stall', '主食', 30, 1),
('stall', '烫捞', 40, 1),
('stall', '饮品', 50, 1),
('cross', '果切', 10, 1),
('cross', '茶饮', 20, 1),
('cross', '花艺', 30, 1),
('cross', '洗车', 40, 1),
('cross', '足道', 50, 1),
('cross', '服务', 60, 1),
('supply', '粮油', 10, 1),
('supply', '冻品', 20, 1),
('supply', '调味', 30, 1),
('supply', '包装', 40, 1),
('supply', '生鲜', 50, 1),
('supply', '原料', 60, 1)
ON DUPLICATE KEY UPDATE
  `sort_order` = VALUES(`sort_order`),
  `status` = 1;

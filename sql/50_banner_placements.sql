-- Banner 多端多位置：一个 Banner 可挂多个展示槽位
CREATE TABLE IF NOT EXISTS `banner_placements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `banner_id` BIGINT UNSIGNED NOT NULL,
  `role_scope` VARCHAR(32) NOT NULL COMMENT '端 consumer/stall/...',
  `page_key` VARCHAR(32) NOT NULL COMMENT '位置 index/home/...',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_banner_slot` (`banner_id`, `role_scope`, `page_key`),
  KEY `idx_slot` (`role_scope`, `page_key`),
  KEY `idx_banner` (`banner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Banner 展示位置';

-- 存量 Banner：把原 role_scope + page_key 迁入 placements
INSERT IGNORE INTO `banner_placements` (`banner_id`, `role_scope`, `page_key`)
SELECT
  `id`,
  `role_scope`,
  IFNULL(NULLIF(`page_key`, ''), IF(`role_scope` = 'consumer', 'index', IF(`role_scope` = 'login', 'apply', 'home')))
FROM `banners`;

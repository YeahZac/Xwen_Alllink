-- =============================================================================
-- 媒体资源表 + 业务表图片字段（兼容 MySQL 5.7）
-- =============================================================================
USE `wanyehulian`;

CREATE TABLE IF NOT EXISTS `media_assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `file_key` VARCHAR(255) NOT NULL COMMENT '对象 Key / cloud path',
  `file_url` VARCHAR(1024) NOT NULL COMMENT '可访问 URL',
  `cloud_file_id` VARCHAR(512) DEFAULT NULL COMMENT '云托管 fileid',
  `mime` VARCHAR(64) DEFAULT NULL,
  `size_bytes` INT UNSIGNED NOT NULL DEFAULT 0,
  `width` INT UNSIGNED DEFAULT NULL,
  `height` INT UNSIGNED DEFAULT NULL,
  `biz_type` VARCHAR(64) DEFAULT 'general' COMMENT 'banner/goods/merchant/license/...',
  `original_name` VARCHAR(255) DEFAULT NULL,
  `created_by` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_file_key` (`file_key`),
  KEY `idx_biz` (`biz_type`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运营上传媒体资源';

DROP PROCEDURE IF EXISTS `sp_add_col_if_missing`;
DELIMITER $$
CREATE PROCEDURE `sp_add_col_if_missing`(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_ddl);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL sp_add_col_if_missing('stall_goods', 'image_url', '`image_url` VARCHAR(1024) DEFAULT NULL COMMENT ''商品图'' AFTER `desc_text`');
CALL sp_add_col_if_missing('cross_goods', 'image_url', '`image_url` VARCHAR(1024) DEFAULT NULL COMMENT ''商品图'' AFTER `desc_text`');
CALL sp_add_col_if_missing('supply_goods', 'image_url', '`image_url` VARCHAR(1024) DEFAULT NULL COMMENT ''商品图'' AFTER `points_ratio_text`');
CALL sp_add_col_if_missing('merchants', 'cover_url', '`cover_url` VARCHAR(1024) DEFAULT NULL COMMENT ''门店封面图'' AFTER `cover_hue`');

DROP PROCEDURE IF EXISTS `sp_add_col_if_missing`;

INSERT INTO `admin_permissions` (`page_key`, `page_name`, `group_name`, `sort_order`) VALUES
('sys_media', '媒体资源', '系统管理', 220)
ON DUPLICATE KEY UPDATE
  `page_name`=VALUES(`page_name`),
  `group_name`=VALUES(`group_name`),
  `sort_order`=VALUES(`sort_order`);

INSERT INTO `admin_role_permissions` (`role_id`, `page_key`, `can_view`, `can_edit`)
SELECT 1, 'sys_media', 1, 1 FROM DUAL
ON DUPLICATE KEY UPDATE `can_view`=1, `can_edit`=1;

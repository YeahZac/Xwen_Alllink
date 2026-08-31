-- =============================================================================
-- 运营扩展：SKU/销量/访问统计/软删除
-- =============================================================================
USE `wanyehulian`;

CREATE TABLE IF NOT EXISTS `visit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_scope` VARCHAR(32) DEFAULT 'consumer' COMMENT '访问端',
  `page_key` VARCHAR(64) DEFAULT NULL,
  `merchant_id` BIGINT UNSIGNED DEFAULT NULL,
  `user_id` BIGINT UNSIGNED DEFAULT NULL,
  `city` VARCHAR(64) DEFAULT NULL,
  `latitude` DECIMAL(10,7) DEFAULT NULL,
  `longitude` DECIMAL(10,7) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_time` (`created_at`),
  KEY `idx_merchant` (`merchant_id`),
  KEY `idx_city` (`city`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='访问埋点（大屏统计）';

-- 商品 SKU / 销量 / 软删除（兼容 5.7）
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

CALL sp_add_col_if_missing('stall_goods', 'sku_code', "`sku_code` VARCHAR(64) DEFAULT NULL COMMENT 'SKU编码' AFTER `name`");
CALL sp_add_col_if_missing('stall_goods', 'sales_count', "`sales_count` INT NOT NULL DEFAULT 0 COMMENT '销量' AFTER `stock`");
CALL sp_add_col_if_missing('stall_goods', 'deleted_at', "`deleted_at` DATETIME DEFAULT NULL COMMENT '软删除' AFTER `on_sale`");

CALL sp_add_col_if_missing('cross_goods', 'sku_code', "`sku_code` VARCHAR(64) DEFAULT NULL COMMENT 'SKU编码' AFTER `name`");
CALL sp_add_col_if_missing('cross_goods', 'sales_count', "`sales_count` INT NOT NULL DEFAULT 0 COMMENT '销量' AFTER `cash_price`");
CALL sp_add_col_if_missing('cross_goods', 'deleted_at', "`deleted_at` DATETIME DEFAULT NULL COMMENT '软删除' AFTER `on_sale`");

CALL sp_add_col_if_missing('supply_goods', 'sku_code', "`sku_code` VARCHAR(64) DEFAULT NULL COMMENT 'SKU编码' AFTER `name`");
CALL sp_add_col_if_missing('supply_goods', 'sales_count', "`sales_count` INT NOT NULL DEFAULT 0 COMMENT '销量' AFTER `stock`");
CALL sp_add_col_if_missing('supply_goods', 'deleted_at', "`deleted_at` DATETIME DEFAULT NULL COMMENT '软删除' AFTER `status`");

CALL sp_add_col_if_missing('merchants', 'materials_json', "`materials_json` JSON DEFAULT NULL COMMENT '门店资料文件' AFTER `cover_url`");
CALL sp_add_col_if_missing('merchants', 'deleted_at', "`deleted_at` DATETIME DEFAULT NULL COMMENT '软删除' AFTER `status`");
CALL sp_add_col_if_missing('users', 'deleted_at', "`deleted_at` DATETIME DEFAULT NULL COMMENT '软删除' AFTER `status`");

DROP PROCEDURE IF EXISTS `sp_add_col_if_missing`;

-- 回填 SKU
UPDATE stall_goods SET sku_code = CONCAT('ST', LPAD(id, 6, '0')) WHERE sku_code IS NULL OR sku_code='';
UPDATE cross_goods SET sku_code = CONCAT('CR', LPAD(id, 6, '0')) WHERE sku_code IS NULL OR sku_code='';
UPDATE supply_goods SET sku_code = CONCAT('SP', LPAD(id, 6, '0')) WHERE sku_code IS NULL OR sku_code='';

-- 从入驻申请拷贝证照到商户资料（若空）
UPDATE merchants m
JOIN merchant_applications a ON a.merchant_id = m.id AND a.status='approved'
SET m.materials_json = a.license_json
WHERE m.materials_json IS NULL;

-- 演示访问日志
INSERT INTO visit_logs (role_scope, page_key, merchant_id, city, latitude, longitude, created_at)
SELECT 'consumer', 'index', 1, '九江·瑞昌', 29.6761000, 115.6810000, NOW() - INTERVAL n DAY
FROM (
  SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
  UNION SELECT 5 UNION SELECT 6 UNION SELECT 1 UNION SELECT 2 UNION SELECT 3
) t;

INSERT INTO visit_logs (role_scope, page_key, merchant_id, city, latitude, longitude, created_at) VALUES
('consumer', 'stall-menu', 1, '九江·瑞昌', 29.6761000, 115.6810000, NOW() - INTERVAL 1 HOUR),
('consumer', 'cross', 3, '九江·瑞昌', 29.6752000, 115.6795000, NOW() - INTERVAL 2 HOUR),
('consumer', 'stall-menu', 2, '九江·瑞昌', 29.6765000, 115.6818000, NOW() - INTERVAL 3 HOUR),
('consumer', 'index', 5, '九江·瑞昌', 29.6748000, 115.6788000, NOW() - INTERVAL 4 HOUR),
('stall', 'purchase', 1, '九江·瑞昌', 29.6761000, 115.6810000, NOW() - INTERVAL 5 HOUR),
('supply', 'goods', 4, '九江·瑞昌', 29.6900000, 115.7000000, NOW() - INTERVAL 6 HOUR);

-- 回填销量演示
UPDATE stall_goods SET sales_count = id * 17 WHERE sales_count = 0;
UPDATE cross_goods SET sales_count = id * 11 WHERE sales_count = 0;
UPDATE supply_goods SET sales_count = id * 9 WHERE sales_count = 0;

-- 新权限页
INSERT INTO `admin_permissions` (`page_key`, `page_name`, `group_name`, `sort_order`) VALUES
('screen', '数据大屏', '数据洞察', 5),
('users_all', '用户总览', '用户与门店', 15),
('users_consumer', 'C端用户', '用户与门店', 16),
('stores_stall', '地摊门店', '用户与门店', 17),
('stores_cross', '异业门店', '用户与门店', 18),
('stores_supply', '供应链', '用户与门店', 19),
('goods_sku', '商品SKU', '内容管理', 55)
ON DUPLICATE KEY UPDATE
  `page_name`=VALUES(`page_name`),
  `group_name`=VALUES(`group_name`),
  `sort_order`=VALUES(`sort_order`);

INSERT INTO `admin_role_permissions` (`role_id`, `page_key`, `can_view`, `can_edit`)
SELECT 1, p.page_key, 1, 1 FROM admin_permissions p
ON DUPLICATE KEY UPDATE can_view=1, can_edit=1;

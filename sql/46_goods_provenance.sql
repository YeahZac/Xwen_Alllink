-- 商品数据来源 / 创建人追溯（mysql2 可直接执行，无 DELIMITER）
-- data_source: manual | placeholder | system | test
-- created_by_type: admin | merchant | system | script

USE `wanyehulian`;

-- stall_goods
SET @db := DATABASE();
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='stall_goods' AND COLUMN_NAME='data_source');
SET @sql := IF(@exist=0, "ALTER TABLE stall_goods ADD COLUMN `data_source` VARCHAR(16) NOT NULL DEFAULT 'manual' COMMENT '数据来源 manual/placeholder/system/test' AFTER `on_sale`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='stall_goods' AND COLUMN_NAME='created_by_type');
SET @sql := IF(@exist=0, "ALTER TABLE stall_goods ADD COLUMN `created_by_type` VARCHAR(16) NULL COMMENT 'admin/merchant/system/script' AFTER `data_source`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='stall_goods' AND COLUMN_NAME='created_by_id');
SET @sql := IF(@exist=0, "ALTER TABLE stall_goods ADD COLUMN `created_by_id` BIGINT UNSIGNED NULL COMMENT '创建人账号ID' AFTER `created_by_type`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='stall_goods' AND COLUMN_NAME='created_by_name');
SET @sql := IF(@exist=0, "ALTER TABLE stall_goods ADD COLUMN `created_by_name` VARCHAR(64) NULL COMMENT '创建人展示名' AFTER `created_by_id`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- cross_goods
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='cross_goods' AND COLUMN_NAME='data_source');
SET @sql := IF(@exist=0, "ALTER TABLE cross_goods ADD COLUMN `data_source` VARCHAR(16) NOT NULL DEFAULT 'manual' COMMENT '数据来源' AFTER `on_sale`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='cross_goods' AND COLUMN_NAME='created_by_type');
SET @sql := IF(@exist=0, "ALTER TABLE cross_goods ADD COLUMN `created_by_type` VARCHAR(16) NULL AFTER `data_source`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='cross_goods' AND COLUMN_NAME='created_by_id');
SET @sql := IF(@exist=0, "ALTER TABLE cross_goods ADD COLUMN `created_by_id` BIGINT UNSIGNED NULL AFTER `created_by_type`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='cross_goods' AND COLUMN_NAME='created_by_name');
SET @sql := IF(@exist=0, "ALTER TABLE cross_goods ADD COLUMN `created_by_name` VARCHAR(64) NULL AFTER `created_by_id`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- supply_goods
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='supply_goods' AND COLUMN_NAME='data_source');
SET @sql := IF(@exist=0, "ALTER TABLE supply_goods ADD COLUMN `data_source` VARCHAR(16) NOT NULL DEFAULT 'manual' COMMENT '数据来源' AFTER `status`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='supply_goods' AND COLUMN_NAME='created_by_type');
SET @sql := IF(@exist=0, "ALTER TABLE supply_goods ADD COLUMN `created_by_type` VARCHAR(16) NULL AFTER `data_source`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='supply_goods' AND COLUMN_NAME='created_by_id');
SET @sql := IF(@exist=0, "ALTER TABLE supply_goods ADD COLUMN `created_by_id` BIGINT UNSIGNED NULL AFTER `created_by_type`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='supply_goods' AND COLUMN_NAME='created_by_name');
SET @sql := IF(@exist=0, "ALTER TABLE supply_goods ADD COLUMN `created_by_name` VARCHAR(64) NULL AFTER `created_by_id`", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 回填：占位
UPDATE stall_goods
SET data_source='placeholder',
    created_by_type=IFNULL(created_by_type,'system'),
    created_by_name=IFNULL(created_by_name,'系统')
WHERE (name='到店消费' OR sku_code LIKE 'SCAN%');

-- 回填：测试品名（含已软删，便于溯源）
UPDATE stall_goods
SET data_source='test',
    created_by_type=IFNULL(created_by_type,'system'),
    created_by_name=IFNULL(created_by_name,'系统·联调')
WHERE (
    name REGEXP '^__'
    OR LOWER(name) IN ('gate-draft','gate_draft','__audit_draft__','__t_off__')
    OR name LIKE 'PAYTEST%'
    OR name LIKE '测试小食%'
    OR name LIKE '%audit_draft%'
  );

UPDATE stall_goods
SET created_by_type=IFNULL(created_by_type,'unknown'),
    created_by_name=IFNULL(created_by_name,'历史数据')
WHERE IFNULL(data_source,'manual')='manual'
  AND created_by_name IS NULL;

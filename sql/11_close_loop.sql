-- =============================================================================
-- 万业互联云 · 业务闭环补丁（支付以外）
-- 对齐 BRD：出餐后划拨、采购冲正、需求报价、订单状态机
-- 可重复执行
-- =============================================================================
USE `wanyehulian`;

-- 点餐状态机：支付后制作中 → 出餐完成再划拨积分
ALTER TABLE `consumer_orders`
  MODIFY COLUMN `order_status`
  ENUM('pending','preparing','ready','completed','cancelled')
  NOT NULL DEFAULT 'pending';

-- 采购冲正：已结算单标记 refunded
ALTER TABLE `purchase_orders`
  MODIFY COLUMN `status`
  ENUM('pending','shipped','confirmed','cancelled','refunded')
  NOT NULL DEFAULT 'pending';

DROP PROCEDURE IF EXISTS `add_col_if_missing11`;
CREATE PROCEDURE `add_col_if_missing11`(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END;

CALL add_col_if_missing11('consumer_orders', 'points_allocated_at',
  '`points_allocated_at` DATETIME DEFAULT NULL COMMENT ''出餐完成后实际划拨时间''');

CALL add_col_if_missing11('purchase_orders', 'cancel_reason',
  '`cancel_reason` VARCHAR(255) DEFAULT NULL');
CALL add_col_if_missing11('purchase_orders', 'cancelled_at',
  '`cancelled_at` DATETIME DEFAULT NULL');

CALL add_col_if_missing11('supply_needs', 'quote_price',
  '`quote_price` DECIMAL(12,2) DEFAULT NULL COMMENT ''供应链报价''');
CALL add_col_if_missing11('supply_needs', 'quote_note',
  '`quote_note` VARCHAR(512) DEFAULT NULL');
CALL add_col_if_missing11('supply_needs', 'quoted_merchant_id',
  '`quoted_merchant_id` BIGINT UNSIGNED DEFAULT NULL');
CALL add_col_if_missing11('supply_needs', 'quoted_at',
  '`quoted_at` DATETIME DEFAULT NULL');

DROP PROCEDURE IF EXISTS `add_col_if_missing11`;

-- 冲正流水：额度池 biz_type 从 ENUM 放宽；资金流水加长
ALTER TABLE `merchant_pool_ledger`
  MODIFY COLUMN `biz_type` VARCHAR(32) NOT NULL;
ALTER TABLE `merchant_account_ledger`
  MODIFY COLUMN `biz_type` VARCHAR(48) NOT NULL;

-- 历史已支付但状态仍是 pending 的单，视为制作中，便于出餐动作命中
UPDATE `consumer_orders`
SET `order_status`='preparing'
WHERE `pay_status`='paid' AND `order_status`='pending';

-- 演示：至少保证招牌炒面有规格；并放一条待报价需求供供应链大厅验收
INSERT INTO stall_goods_option_groups (goods_id, name, type, required, multi_select, min_select, max_select, sort_order)
SELECT g.id, '口味', 'flavor', 1, 0, 1, 1, 10
FROM stall_goods g
WHERE g.id = 1 AND g.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM stall_goods_option_groups og WHERE og.goods_id = g.id);

INSERT INTO stall_goods_options (group_id, name, price_delta, points_delta, is_default, sort_order)
SELECT og.id, v.name, v.pd, v.ptd, v.def, v.so
FROM stall_goods_option_groups og
JOIN (
  SELECT '微辣' AS name, 0 AS pd, 0 AS ptd, 1 AS def, 1 AS so
  UNION ALL SELECT '中辣', 0, 0, 0, 2
  UNION ALL SELECT '特辣', 1, 1, 0, 3
) v
WHERE og.goods_id = 1 AND og.type = 'flavor'
  AND NOT EXISTS (SELECT 1 FROM stall_goods_options o WHERE o.group_id = og.id);

INSERT INTO `supply_needs` (`user_id`, `goods_name`, `qty_text`, `expect_time`, `note`, `status`)
SELECT 1, '宽面 5kg 补货', '2 箱', '本周内', '地摊演示需求，供供应链报价验收', 'open'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM supply_needs WHERE goods_name = '宽面 5kg 补货' AND status = 'open'
);

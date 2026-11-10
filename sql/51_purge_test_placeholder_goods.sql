-- 软删测试/占位商品；可重复执行。不碰 manual 正式商品。
UPDATE stall_goods
SET on_sale = 0, deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    IFNULL(data_source, 'manual') IN ('test', 'placeholder', 'system')
    OR name LIKE '\\_\\_%' ESCAPE '\\'
    OR LOWER(name) IN ('gate-draft', 'gate_draft', '到店消费')
    OR name LIKE 'PAYTEST%'
    OR name LIKE '测试小食%'
    OR sku_code LIKE 'SCAN%'
  );

UPDATE cross_goods
SET on_sale = 0, deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    IFNULL(data_source, 'manual') IN ('test', 'placeholder', 'system')
    OR name LIKE '\\_\\_%' ESCAPE '\\'
    OR LOWER(name) IN ('gate-draft', 'gate_draft')
    OR name LIKE 'PAYTEST%'
    OR name LIKE '测试%'
  );

UPDATE supply_goods
SET status = 0, deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    IFNULL(data_source, 'manual') IN ('test', 'placeholder', 'system')
    OR name LIKE '\\_\\_%' ESCAPE '\\'
    OR name LIKE 'PAYTEST%'
    OR name LIKE '测试%'
  );

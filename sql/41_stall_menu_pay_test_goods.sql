-- 支付联调：为营业中地摊补一批低价测试菜（0.02–0.10 元）
-- 可重复执行：同 merchant + sku_code 已存在则跳过

INSERT INTO stall_goods
  (merchant_id, name, sku_code, price, points_grant, category, unit, desc_text, stock, on_sale)
SELECT
  m.id,
  v.name,
  CONCAT(v.sku_suffix, '-', m.id),
  v.price,
  v.pts,
  '支付测试',
  '份',
  '联调测试菜，可下架',
  9999,
  1
FROM merchants m
JOIN (
  SELECT '测试小食A' AS name, 'PAYTEST-A' AS sku_suffix, 0.02 AS price, 0 AS pts UNION ALL
  SELECT '测试小食B', 'PAYTEST-B', 0.05, 0 UNION ALL
  SELECT '测试小食C', 'PAYTEST-C', 0.08, 0 UNION ALL
  SELECT '测试小食D', 'PAYTEST-D', 0.10, 1
) v
WHERE m.role = 'stall'
  AND m.status = 1
  AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM stall_goods g
    WHERE g.merchant_id = m.id
      AND g.sku_code = CONCAT(v.sku_suffix, '-', m.id)
      AND g.deleted_at IS NULL
  );

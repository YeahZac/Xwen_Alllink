-- 支付联调专用：为营业中地摊补低价测试菜（0.02–0.10 元）
-- ⚠️ 正式/生产环境禁止执行。后端已拦截「测试小食* / PAYTEST*」品名写入。
-- 可重复执行：同 merchant + sku_code 已存在则跳过。
-- 执行前须显式设置：SET @ALLOW_TEST_GOODS = 1;

SET @ALLOW_TEST_GOODS = IFNULL(@ALLOW_TEST_GOODS, 0);

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
  0
FROM merchants m
JOIN (
  SELECT '测试小食A' AS name, 'PAYTEST-A' AS sku_suffix, 0.02 AS price, 0 AS pts UNION ALL
  SELECT '测试小食B', 'PAYTEST-B', 0.05, 0 UNION ALL
  SELECT '测试小食C', 'PAYTEST-C', 0.08, 0 UNION ALL
  SELECT '测试小食D', 'PAYTEST-D', 0.10, 1
) v
WHERE @ALLOW_TEST_GOODS = 1
  AND m.role = 'stall'
  AND m.status = 1
  AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM stall_goods g
    WHERE g.merchant_id = m.id
      AND g.sku_code = CONCAT(v.sku_suffix, '-', m.id)
      AND g.deleted_at IS NULL
  );

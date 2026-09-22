-- 为缺坐标门店补城市周边坐标，便于按用户 GPS 计算真实距离
-- 中心点与 backend/src/utils/geo.js CITY_CENTERS 对齐

UPDATE merchants m
JOIN (
  SELECT '九江·瑞昌' AS city, 29.6761 AS lat, 115.681 AS lng
  UNION ALL SELECT '九江·浔阳', 29.7054, 116.0015
  UNION ALL SELECT '九江·柴桑', 29.6712, 115.9918
  UNION ALL SELECT '九江·庐山', 29.4478, 116.0452
) c ON c.city = m.city
SET
  m.latitude = ROUND(
    c.lat + ((MOD(m.id * 17, 21) - 10) * 0.0018)
      + (CASE m.role WHEN 'cross' THEN 0.004 WHEN 'supply' THEN 0.012 ELSE 0 END),
    6
  ),
  m.longitude = ROUND(
    c.lng + ((MOD(m.id * 31, 21) - 10) * 0.0018)
      + (CASE m.role WHEN 'cross' THEN 0.003 WHEN 'supply' THEN 0.01 ELSE 0 END),
    6
  )
WHERE m.deleted_at IS NULL
  AND (m.latitude IS NULL OR m.longitude IS NULL);

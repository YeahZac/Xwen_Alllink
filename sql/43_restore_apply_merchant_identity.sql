-- 修复 sql/23 演示数据回写导致的真实入驻店名/封面被覆盖。
-- 以已审核申请的 shop_name 与证照中的店招图为准回写 merchants。

-- 1) 店名 / 地址：申请名与当前名不一致时，恢复为申请资料
UPDATE merchants m
INNER JOIN merchant_applications a
  ON a.merchant_id = m.id
 AND a.status = 'approved'
 AND a.shop_name IS NOT NULL
 AND TRIM(a.shop_name) <> ''
 AND a.shop_name <> m.name
SET
  m.name = a.shop_name,
  m.address = COALESCE(NULLIF(TRIM(a.address), ''), m.address),
  m.city = COALESCE(NULLIF(TRIM(a.city), ''), m.city),
  m.latitude = COALESCE(a.latitude, m.latitude),
  m.longitude = COALESCE(a.longitude, m.longitude)
WHERE m.deleted_at IS NULL;

-- 2) 封面：若当前封面是平台演示 mp-static，且 materials 里有店招图，则换回店招
UPDATE merchants m
SET m.cover_url = COALESCE(
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.materials_json, '$.storePhoto')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.materials_json, '$.stallPhoto')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.materials_json, '$.warehousePhoto')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.materials_json, '$.shopCover')), ''),
  m.cover_url
)
WHERE m.deleted_at IS NULL
  AND m.materials_json IS NOT NULL
  AND (
    m.cover_url IS NULL
    OR m.cover_url = ''
    OR m.cover_url LIKE '%/admin/mp-static/%'
    OR m.cover_url LIKE '%/admin/cover/%'
  );

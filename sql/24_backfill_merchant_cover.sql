-- 审核通过后门店封面/资料回填：历史数据 approve 时未写入 cover_url / materials_json
-- 从已通过申请的 license_json 回填；封面优先 storePhoto / stallPhoto / warehousePhoto

UPDATE merchants m
JOIN merchant_applications a ON a.merchant_id = m.id AND a.status = 'approved'
SET m.materials_json = a.license_json
WHERE m.materials_json IS NULL
  AND a.license_json IS NOT NULL
  AND m.deleted_at IS NULL;

UPDATE merchants m
JOIN merchant_applications a ON a.merchant_id = m.id AND a.status = 'approved'
SET m.cover_url = COALESCE(
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.storePhoto')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.storePhoto.url')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.stallPhoto')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.stallPhoto.url')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.warehousePhoto')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.warehousePhoto.url')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.foodLicense')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.foodLicense.url')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.businessLicense')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.license_json, '$.businessLicense.url')), '')
)
WHERE (m.cover_url IS NULL OR m.cover_url = '')
  AND a.license_json IS NOT NULL
  AND m.deleted_at IS NULL;

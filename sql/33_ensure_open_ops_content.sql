-- 保障审核/首屏可见：营业中的正式运营门店（非测试文案），并强制落到深圳商圈坐标
USE `wanyehulian`;

-- 种子门店保持上架
UPDATE `merchants`
SET `status` = 1, `deleted_at` = NULL
WHERE `invite_code` IN (
  'D001','D002','D003','D004','D005',
  'Y001','Y002','Y003','Y004','Y005',
  'G001','G002','G003','G004','G005'
)
AND (`status` <> 1 OR `deleted_at` IS NOT NULL);

-- 若仍无深圳坐标门店，再跑一遍商场坐标回填（幂等）
UPDATE `merchants` SET
  `city` = '深圳·罗湖',
  `address` = '深圳市罗湖区宝安南路1881号万象城 B1',
  `latitude` = 22.537800, `longitude` = 114.111600
WHERE `id` = 1;

UPDATE `merchants` SET
  `city` = '深圳·罗湖',
  `address` = '深圳市罗湖区人民南路2002号金光华广场 3F',
  `latitude` = 22.544500, `longitude` = 114.114800
WHERE `id` = 2;

UPDATE `merchants` SET
  `city` = '深圳·福田',
  `address` = '深圳市福田区益田路4068号益田假日广场 L1',
  `latitude` = 22.535200, `longitude` = 114.053100
WHERE `id` = 3;

UPDATE `merchants` SET
  `city` = '深圳·南山',
  `address` = '深圳市南山区科苑南路2888号深圳湾万象城 B2 仓储通道',
  `latitude` = 22.517500, `longitude` = 113.941500
WHERE `id` = 4;

UPDATE `merchants` SET
  `city` = '深圳·南山',
  `address` = '深圳市南山区文心五路33号海岸城 2F',
  `latitude` = 22.517200, `longitude` = 113.934800
WHERE `id` = 5;

UPDATE `merchants` SET
  `city` = '深圳·福田',
  `address` = '深圳市福田区福华三路 COCO Park 负一楼美食街',
  `latitude` = 22.534000, `longitude` = 114.055500
WHERE `id` = 6;

UPDATE `merchants` SET
  `city` = '深圳·南山',
  `address` = '深圳市南山区白石路8号欢乐海岸购物中心',
  `latitude` = 22.522800, `longitude` = 113.990500
WHERE `id` = 7;

UPDATE `merchants` SET
  `city` = '深圳·宝安',
  `address` = '深圳市宝安区新湖路99号壹方城 B1',
  `latitude` = 22.560500, `longitude` = 113.887200
WHERE `id` = 8;

UPDATE `merchants` SET
  `city` = '深圳·福田',
  `address` = '深圳市福田区福华一路3号中心城花艺区',
  `latitude` = 22.541000, `longitude` = 114.059800
WHERE `id` = 9;

UPDATE `merchants` SET
  `city` = '深圳·南山',
  `address` = '深圳市南山区深南大道9668号万象天地地下停车场入口旁',
  `latitude` = 22.540200, `longitude` = 113.945800
WHERE `id` = 10;

UPDATE `merchants` SET
  `city` = '深圳·龙华',
  `address` = '深圳市龙华区民塘路壹方天地 4F 足道',
  `latitude` = 22.657000, `longitude` = 114.036000
WHERE `id` = 11;

UPDATE `merchants` SET
  `city` = '深圳·宝安',
  `address` = '深圳市宝安区桂湾四路前海壹方中心冷链仓',
  `latitude` = 22.524800, `longitude` = 113.889500
WHERE `id` = 12;

-- 保证可兑商品在售
UPDATE `cross_goods` SET `on_sale` = 1, `deleted_at` = NULL
WHERE `merchant_id` IN (3,5,9,10,11) AND (`on_sale` <> 1 OR `deleted_at` IS NOT NULL);

UPDATE `stall_goods` SET `on_sale` = 1, `deleted_at` = NULL
WHERE `merchant_id` IN (1,2,6,7,8) AND (`on_sale` <> 1 OR `deleted_at` IS NOT NULL);

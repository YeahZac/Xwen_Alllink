-- 门店封面 / Banner 统一指向云端 COS 实景图（不再依赖小程序包内本地图）
-- CDN 与 miniprogram/utils/cdn-manifest.js 保持一致

SET @cdn := 'https://7072-prod-d3g1vkrj3290d085e-1467541248.tcb.qcloud.la/admin/mp-static/20261102';

UPDATE merchants
SET cover_url = CASE
  WHEN name REGEXP '超市|百货|便利|日用|邻里' THEN CONCAT(@cdn, '/b348459d6195838b.webp')
  WHEN name REGEXP '花|花艺|鲜花' THEN CONCAT(@cdn, '/0168ba78d752f002.webp')
  WHEN name REGEXP '蛋糕|烘焙|甜品' THEN CONCAT(@cdn, '/e85759a7147886c8.webp')
  WHEN name REGEXP '果|果切|鲜果' THEN CONCAT(@cdn, '/673e6599ea9a8f70.webp')
  WHEN name REGEXP '奶茶|茶饮|咖啡' THEN CONCAT(@cdn, '/727fdce69c23d17a.webp')
  WHEN name REGEXP '洗车' THEN CONCAT(@cdn, '/4c20198e1c0cf66a.webp')
  WHEN name REGEXP '烤串|烧烤|串' THEN CONCAT(@cdn, '/26d02cda44689532.webp')
  WHEN name REGEXP '麻辣烫|冒菜|火锅' THEN CONCAT(@cdn, '/6f0506640cd043cc.webp')
  WHEN name REGEXP '煎饼|灌饼|豆浆' THEN CONCAT(@cdn, '/8534668a3d421afb.webp')
  WHEN name REGEXP '臭豆腐|豆腐' THEN CONCAT(@cdn, '/768037b9e15b0223.webp')
  WHEN role = 'supply' OR name REGEXP '仓|供货|粮油|冻品|调味|包装|集配|供应链' THEN CONCAT(@cdn, '/8904b797e9dc2b41.webp')
  WHEN role = 'cross' THEN CONCAT(@cdn, '/b348459d6195838b.webp')
  ELSE CONCAT(@cdn, '/26ff62910b5f2547.webp')
END
WHERE deleted_at IS NULL
  AND (
    cover_url IS NULL
    OR cover_url = ''
    OR cover_url LIKE '/assets/%'
    OR cover_url LIKE '%placehold%'
    OR cover_url LIKE '%picsum%'
    OR cover_url LIKE '%unsplash%'
    OR cover_url NOT LIKE '%/admin/mp-static/%'
  );

UPDATE banners
SET image_url = CASE
  WHEN title LIKE '%扫码%' OR title LIKE '%点餐%' THEN CONCAT(@cdn, '/3cdd06ea70c160cb.webp')
  WHEN title LIKE '%积分%' OR title LIKE '%鲜花%' OR title LIKE '%蛋糕%' THEN CONCAT(@cdn, '/bcf4837bfb8f2347.webp')
  WHEN title LIKE '%夜市%' OR title LIKE '%好店%' THEN CONCAT(@cdn, '/c24ce20a00c6790e.webp')
  WHEN title LIKE '%采购%' OR title LIKE '%地摊%' THEN CONCAT(@cdn, '/809fc9e17ef933b6.webp')
  WHEN title LIKE '%核销%' OR title LIKE '%承接%' OR role_scope = 'cross' THEN CONCAT(@cdn, '/742baf46d2be8680.webp')
  WHEN title LIKE '%仓%' OR title LIKE '%供货%' OR role_scope = 'supply' THEN CONCAT(@cdn, '/821f8b62aeaa627a.webp')
  WHEN role_scope = 'login' OR title LIKE '%入驻%' THEN CONCAT(@cdn, '/8f773fae68a0ba0e.webp')
  WHEN role_scope = 'stall' THEN CONCAT(@cdn, '/809fc9e17ef933b6.webp')
  ELSE CONCAT(@cdn, '/c24ce20a00c6790e.webp')
END
WHERE status = 1
  AND (
    image_url IS NULL
    OR image_url = ''
    OR image_url LIKE '/assets/%'
    OR image_url LIKE '%placehold%'
    OR image_url LIKE '%picsum%'
    OR image_url NOT LIKE '%/admin/mp-static/%'
  );

-- 开通深圳各区，并将全部门店迁到深圳真实商场坐标（GCJ-02）

INSERT INTO operating_cities (name, province, status, opened_at, remark)
VALUES
  ('深圳·罗湖', '广东', 1, NOW(), '万象城/东门商圈'),
  ('深圳·福田', '广东', 1, NOW(), '中心区商场'),
  ('深圳·南山', '广东', 1, NOW(), '海岸城/深圳湾'),
  ('深圳·宝安', '广东', 1, NOW(), '壹方城/前海'),
  ('深圳·龙华', '广东', 1, NOW(), '壹方天地/大悦城'),
  ('深圳·龙岗', '广东', 1, NOW(), '星河COCO/坂田'),
  ('深圳·盐田', '广东', 1, NOW(), '壹海城'),
  ('深圳·光明', '广东', 1, NOW(), '大仟里'),
  ('深圳·坪山', '广东', 1, NOW(), '天虹')
ON DUPLICATE KEY UPDATE status = 1, opened_at = IFNULL(opened_at, NOW()), province = VALUES(province);

UPDATE merchants SET
  city = '深圳·罗湖',
  address = '深圳市罗湖区宝安南路1881号万象城 B1',
  latitude = 22.537800, longitude = 114.111600
WHERE id = 1;

UPDATE merchants SET
  city = '深圳·罗湖',
  address = '深圳市罗湖区人民南路2002号金光华广场 3F',
  latitude = 22.544500, longitude = 114.114800
WHERE id = 2;

UPDATE merchants SET
  city = '深圳·福田',
  address = '深圳市福田区益田路4068号益田假日广场 L1',
  latitude = 22.535200, longitude = 114.053100
WHERE id = 3;

UPDATE merchants SET
  city = '深圳·南山',
  address = '深圳市南山区科苑南路2888号深圳湾万象城 B2 仓储通道',
  latitude = 22.517500, longitude = 113.941500
WHERE id = 4;

UPDATE merchants SET
  city = '深圳·南山',
  address = '深圳市南山区文心五路33号海岸城 2F',
  latitude = 22.517200, longitude = 113.934800
WHERE id = 5;

UPDATE merchants SET
  city = '深圳·福田',
  address = '深圳市福田区福华三路 COCO Park 负一楼美食街',
  latitude = 22.534000, longitude = 114.055500
WHERE id = 6;

UPDATE merchants SET
  city = '深圳·南山',
  address = '深圳市南山区白石路8号欢乐海岸购物中心',
  latitude = 22.522800, longitude = 113.990500
WHERE id = 7;

UPDATE merchants SET
  city = '深圳·宝安',
  address = '深圳市宝安区新湖路99号壹方城 B1',
  latitude = 22.560500, longitude = 113.887200
WHERE id = 8;

UPDATE merchants SET
  city = '深圳·福田',
  address = '深圳市福田区福华一路3号中心城花艺区',
  latitude = 22.541000, longitude = 114.059800
WHERE id = 9;

UPDATE merchants SET
  city = '深圳·南山',
  address = '深圳市南山区深南大道9668号万象天地地下停车场入口旁',
  latitude = 22.540200, longitude = 113.945800
WHERE id = 10;

UPDATE merchants SET
  city = '深圳·龙华',
  address = '深圳市龙华区民塘路壹方天地 4F 足道',
  latitude = 22.657000, longitude = 114.036000
WHERE id = 11;

UPDATE merchants SET
  city = '深圳·宝安',
  address = '深圳市宝安区桂湾四路前海壹方中心冷链仓',
  latitude = 22.524800, longitude = 113.889500
WHERE id = 12;

UPDATE merchants SET
  city = '深圳·龙岗',
  address = '深圳市龙岗区坂雪岗大道万科广场供货点',
  latitude = 22.640000, longitude = 114.068000
WHERE id = 13;

UPDATE merchants SET
  city = '深圳·龙岗',
  address = '深圳市龙岗区龙翔大道7188号星河COCO City 仓储区',
  latitude = 22.720800, longitude = 114.247500
WHERE id = 14;

UPDATE merchants SET
  city = '深圳·罗湖',
  address = '深圳市罗湖区深南东路5001号京基100 配送站',
  latitude = 22.540600, longitude = 114.106500
WHERE id = 15;

UPDATE merchants SET
  city = '深圳·光明',
  address = '深圳市光明区光侨路大仟里生鲜配送仓',
  latitude = 22.748000, longitude = 113.945000
WHERE id = 16;

UPDATE merchants SET
  city = '深圳·坪山',
  address = '深圳市坪山区坪山大道天虹商场冷链点',
  latitude = 22.690000, longitude = 114.346000
WHERE id = 17;

UPDATE merchants SET
  city = '深圳·罗湖',
  address = '深圳市罗湖区东门中路2048号茂业天地美食档口',
  latitude = 22.548200, longitude = 114.122100
WHERE id = 18;

UPDATE merchants SET
  city = '深圳·盐田',
  address = '深圳市盐田区海山路壹海城 B1 美食区',
  latitude = 22.557000, longitude = 114.237000
WHERE id = 19;

UPDATE merchants SET
  city = '深圳·福田',
  address = '深圳市福田区民田路178号皇庭广场便利店',
  latitude = 22.538500, longitude = 114.068200
WHERE id = 20;

UPDATE merchants SET
  city = '深圳·龙华',
  address = '深圳市龙华区民治大道深圳龙华大悦城 B1',
  latitude = 22.645500, longitude = 114.025000
WHERE id = 21;

UPDATE merchants SET
  city = '深圳·宝安',
  address = '深圳市宝安区宝源路海雅缤纷城外摆区',
  latitude = 22.555000, longitude = 113.895000
WHERE id = 22;

UPDATE merchants SET
  city = '深圳·南山',
  address = '深圳市南山区海德三道宝能太古城美发',
  latitude = 22.509800, longitude = 113.919500
WHERE id = 23;

UPDATE merchants SET
  city = '深圳·福田',
  address = '深圳市福田区笋岗东路3012号深业上城美食街',
  latitude = 22.555800, longitude = 114.091200
WHERE id = 24;

UPDATE merchants SET
  city = '深圳·龙岗',
  address = '深圳市龙岗区布吉龙岗大道佳兆业广场夜市档',
  latitude = 22.606000, longitude = 114.126000
WHERE id = 25;

UPDATE merchants SET
  city = '深圳·南山',
  address = '深圳市南山区文心五路海岸城西座茶饮区',
  latitude = 22.516800, longitude = 113.933500
WHERE id = 26;

UPDATE merchants SET
  city = '深圳·福田',
  address = '深圳市福田区益田路益田假日广场果切档',
  latitude = 22.534800, longitude = 114.052500
WHERE id = 27;

UPDATE merchants SET
  city = '深圳·罗湖',
  address = '深圳市罗湖区解放路3001号天河城美食层',
  latitude = 22.546000, longitude = 114.112000
WHERE id = 28;

UPDATE merchants SET
  city = '深圳·南山',
  address = '深圳市南山区科苑南路深圳湾万象城外摆',
  latitude = 22.518200, longitude = 113.942200
WHERE id = 29;

UPDATE merchants SET
  city = '深圳·福田',
  address = '深圳市福田区福华路领展中心城美食街',
  latitude = 22.531000, longitude = 114.022000
WHERE id = 30;

UPDATE merchants SET
  city = '深圳·龙华',
  address = '深圳市龙华区红山六九七九北站天虹 B1',
  latitude = 22.610000, longitude = 114.028000
WHERE id = 31;

UPDATE merchants SET
  city = '深圳·福田',
  address = '深圳市福田区梅林路卓悦汇夜市烤串档',
  latitude = 22.570000, longitude = 114.055000
WHERE id = 32;

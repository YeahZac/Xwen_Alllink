-- 补一批门店和商品，让四个经营城市的首页不再只有一两家。
-- 按店名 / 商品名去重，已通过入驻接口写入的同一批数据不会重复插入。

INSERT INTO `merchants` (
  `merchant_no`, `role`, `name`, `credit_code`, `legal_person`, `contact_name`, `contact_phone`,
  `city`, `address`, `latitude`, `longitude`, `cover_hue`, `status`, `invite_code`
)
SELECT seed.`merchant_no`, seed.`role`, seed.`name`, seed.`credit_code`, seed.`legal_person`, seed.`contact_name`, seed.`contact_phone`,
  seed.`city`, seed.`address`, seed.`latitude`, seed.`longitude`, seed.`cover_hue`, seed.`status`, seed.`invite_code`
FROM (
  SELECT 'M_STALL_16' AS merchant_no, 'stall' AS role, '湓浦烤串王' AS name, '91360402MA11000001' AS credit_code, '周磊' AS legal_person, '周磊' AS contact_name, '13876011001' AS contact_phone, '九江·浔阳' AS city, '湓浦路夜市A12' AS address, 29.7052000 AS latitude, 116.0012000 AS longitude, '#E24E12' AS cover_hue, 1 AS status, 'D016' AS invite_code
  UNION ALL SELECT 'M_STALL_17', 'stall', '浔阳豆浆铺', '91360402MA11000002', '李芳', '李芳', '13876011002', '九江·浔阳', '甘棠南路18号', 29.7188000, 115.9921000, '#C47A2B', 1, 'D017'
  UNION ALL SELECT 'M_STALL_18', 'stall', '烟火炒饭档', '91360402MA11000003', '陈凯', '陈凯', '13876011003', '九江·浔阳', '大中路步行街口', 29.7241000, 116.0088000, '#E08A1E', 1, 'D018'
  UNION ALL SELECT 'M_STALL_19', 'stall', '江边柠檬茶', '91360402MA11000004', '吴婷', '吴婷', '13876011004', '九江·浔阳', '滨江路码头旁', 29.6995000, 116.0124000, '#2F8F6B', 1, 'D019'
  UNION ALL SELECT 'M_STALL_20', 'stall', '甘棠炸鸡', '91360402MA11000005', '赵鹏', '赵鹏', '13876011005', '九江·浔阳', '甘棠湖东岸摊位', 29.7312000, 115.9865000, '#D4532B', 1, 'D020'
  UNION ALL SELECT 'M_CROSS_16', 'cross', '浔阳鲜果切', '91360402MA11000006', '孙梅', '孙梅', '13876011006', '九江·浔阳', '浔阳路66号', 29.7101000, 116.0066000, '#3D8B4A', 1, 'Y016'
  UNION ALL SELECT 'M_CROSS_17', 'cross', '大中路茶饮', '91360402MA11000007', '钱浩', '钱浩', '13876011007', '九江·浔阳', '大中路128号', 29.7220000, 115.9980000, '#C45A2A', 1, 'Y017'
  UNION ALL SELECT 'M_STALL_21', 'stall', '沙河烤鱼', '91360402MA11000008', '郑强', '郑强', '13876011008', '九江·柴桑', '沙河街夜市3号', 29.6701000, 115.9652000, '#B33A1A', 1, 'D021'
  UNION ALL SELECT 'M_STALL_22', 'stall', '柴桑豆腐脑', '91360402MA11000009', '冯霞', '冯霞', '13876011009', '九江·柴桑', '柴桑大道早市', 29.6588000, 115.9821000, '#C9A227', 1, 'D022'
  UNION ALL SELECT 'M_CROSS_18', 'cross', '沙河美发', '91360402MA11000010', '何静', '何静', '13876011010', '九江·柴桑', '沙河中路42号', 29.6620000, 115.9700000, '#5B4A8A', 1, 'Y018'
  UNION ALL SELECT 'M_STALL_23', 'stall', '牯岭烧烤', '91360402MA11000011', '林海', '林海', '13876011011', '九江·庐山', '牯岭街夜市', 29.5688000, 115.9782000, '#A33B1F', 1, 'D023'
  UNION ALL SELECT 'M_STALL_24', 'stall', '庐山豆浆', '91360402MA11000012', '黄丽', '黄丽', '13876011012', '九江·庐山', '正街12号', 29.5821000, 115.9904000, '#8A6A2F', 1, 'D024'
  UNION ALL SELECT 'M_CROSS_19', 'cross', '牯岭便利', '91360402MA11000013', '马超', '马超', '13876011013', '九江·庐山', '牯岭正街8号', 29.5715000, 115.9830000, '#2E6B8A', 1, 'Y019'
  UNION ALL SELECT 'M_STALL_25', 'stall', '码头小龙虾', '91360402MA11000014', '徐波', '徐波', '13876011014', '九江·瑞昌', '码头路夜市', 29.6855000, 115.6810000, '#C23B22', 1, 'D025'
  UNION ALL SELECT 'M_STALL_26', 'stall', '瑞昌米线', '91360402MA11000015', '邓敏', '邓敏', '13876011015', '九江·瑞昌', '人民路45号', 29.6722000, 115.6944000, '#B86A1C', 1, 'D026'
  UNION ALL SELECT 'M_SUPPLY_16', 'supply', '庐山冷链仓', '91360402MA11000016', '曹伟', '曹伟', '13876011016', '九江·庐山', '庐山工业园冷库', 29.5900000, 115.9700000, '#3A6EA5', 1, 'G016'
  UNION ALL SELECT 'M_SUPPLY_17', 'supply', '柴桑蔬菜基地', '91360402MA11000017', '彭军', '彭军', '13876011017', '九江·柴桑', '沙河农业园', 29.6500000, 115.9600000, '#3E7A3A', 1, 'G017'
) AS seed
LEFT JOIN (SELECT `name` FROM `merchants` WHERE `deleted_at` IS NULL) AS existing
  ON existing.`name` = seed.`name`
WHERE existing.`name` IS NULL;

INSERT INTO `merchant_points_pool` (`merchant_id`, `balance`)
SELECT m.id, 800 FROM `merchants` m
WHERE m.`invite_code` IN ('D016','D017','D018','D019','D020','D021','D022','D023','D024','D025','D026','Y016','Y017','Y018','Y019','G016','G017')
  AND NOT EXISTS (SELECT 1 FROM `merchant_points_pool` p WHERE p.`merchant_id` = m.id);

INSERT INTO `merchant_accounts` (`merchant_id`, `account_type`, `balance`, `frozen`)
SELECT m.id, IF(m.role='supply', 'cash_goods', 'cash_settlement'), 0, 0
FROM `merchants` m
WHERE m.`invite_code` IN ('D016','D017','D018','D019','D020','D021','D022','D023','D024','D025','D026','Y016','Y017','Y018','Y019','G016','G017')
  AND NOT EXISTS (
    SELECT 1 FROM `merchant_accounts` a
    WHERE a.`merchant_id` = m.id AND a.`account_type` = IF(m.role='supply', 'cash_goods', 'cash_settlement')
  );

-- 地摊商品
INSERT INTO `stall_goods` (`merchant_id`, `name`, `price`, `points_grant`, `category`, `desc_text`, `stock`, `on_sale`, `sales_count`)
SELECT m.id, g.name, g.price, g.pg, g.cat, g.descr, 200, 1, g.sales
FROM `merchants` m
JOIN (
  SELECT '湓浦烤串王' AS shop, '羊肉串' AS name, 4.00 AS price, 4 AS pg, '烤串' AS cat, '现烤不隔夜' AS descr, 186 AS sales
  UNION ALL SELECT '湓浦烤串王', '鸡翅', 8, 8, '烤串', '秘制腌料', 142
  UNION ALL SELECT '湓浦烤串王', '烤茄子', 12, 12, '烤串', '蒜香', 96
  UNION ALL SELECT '湓浦烤串王', '扎啤', 8, 8, '酒水', '冰镇', 210
  UNION ALL SELECT '浔阳豆浆铺', '现磨豆浆', 5, 5, '饮品', '热/冰', 320
  UNION ALL SELECT '浔阳豆浆铺', '油条', 3, 3, '主食', '现炸', 280
  UNION ALL SELECT '浔阳豆浆铺', '茶叶蛋', 2, 2, '小吃', '卤香', 190
  UNION ALL SELECT '浔阳豆浆铺', '小笼包', 8, 8, '主食', '8只', 150
  UNION ALL SELECT '烟火炒饭档', '扬州炒饭', 16, 16, '主食', '蛋香', 168
  UNION ALL SELECT '烟火炒饭档', '腊味煲仔饭', 22, 22, '主食', '砂锅', 120
  UNION ALL SELECT '烟火炒饭档', '紫菜蛋花汤', 6, 6, '汤', '免费续', 88
  UNION ALL SELECT '江边柠檬茶', '柠檬红茶', 12, 12, '饮品', '大杯', 240
  UNION ALL SELECT '江边柠檬茶', '百香果绿', 14, 14, '饮品', '少冰', 180
  UNION ALL SELECT '江边柠檬茶', '杨枝甘露', 18, 18, '饮品', '芒果椰奶', 96
  UNION ALL SELECT '甘棠炸鸡', '香辣炸鸡', 18, 18, '炸物', '半只', 210
  UNION ALL SELECT '甘棠炸鸡', '薯条', 8, 8, '炸物', '大份', 160
  UNION ALL SELECT '甘棠炸鸡', '鸡米花', 12, 12, '炸物', '酥脆', 140
  UNION ALL SELECT '沙河烤鱼', '烤鱼', 48, 48, '烤鱼', '2斤', 86
  UNION ALL SELECT '沙河烤鱼', '凉拌黄瓜', 8, 8, '凉菜', '拍黄瓜', 70
  UNION ALL SELECT '沙河烤鱼', '米饭', 2, 2, '主食', '一碗', 200
  UNION ALL SELECT '柴桑豆腐脑', '豆腐脑', 6, 6, '早餐', '甜/咸', 260
  UNION ALL SELECT '柴桑豆腐脑', '豆浆油条套餐', 8, 8, '早餐', '套餐', 180
  UNION ALL SELECT '柴桑豆腐脑', '葱油饼', 5, 5, '早餐', '现烙', 120
  UNION ALL SELECT '牯岭烧烤', '烤五花', 6, 6, '烧烤', '一串', 300
  UNION ALL SELECT '牯岭烧烤', '烤生蚝', 8, 8, '烧烤', '蒜蓉', 160
  UNION ALL SELECT '牯岭烧烤', '烤韭菜', 5, 5, '烧烤', '一串', 140
  UNION ALL SELECT '庐山豆浆', '甜豆浆', 5, 5, '饮品', '热', 210
  UNION ALL SELECT '庐山豆浆', '咸豆浆', 6, 6, '饮品', '配油条', 90
  UNION ALL SELECT '庐山豆浆', '鸡蛋灌饼', 8, 8, '主食', '加蛋', 130
  UNION ALL SELECT '瑞昌米线', '牛肉米线', 16, 16, '主食', '大碗', 220
  UNION ALL SELECT '瑞昌米线', '番茄米线', 14, 14, '主食', '酸甜', 150
  UNION ALL SELECT '瑞昌米线', '卤蛋', 2, 2, '小吃', '一枚', 80
  UNION ALL SELECT '码头小龙虾', '麻辣小龙虾', 68, 68, '夜宵', '一斤', 96
  UNION ALL SELECT '码头小龙虾', '蒜蓉小龙虾', 72, 72, '夜宵', '一斤', 70
  UNION ALL SELECT '码头小龙虾', '毛豆', 8, 8, '小吃', '一碟', 110
  UNION ALL SELECT '深夜麻辣烫', '麻辣烫小份', 18, 18, '主食', '自选', 260
  UNION ALL SELECT '深夜麻辣烫', '麻辣烫大份', 28, 28, '主食', '加料', 180
  UNION ALL SELECT '深夜麻辣烫', '关东煮', 12, 12, '小吃', '三件', 90
  UNION ALL SELECT '张记夜市炒面', '炒面', 12, 12, '主食', '加蛋', 240
  UNION ALL SELECT '张记夜市炒面', '炒河粉', 13, 13, '主食', '牛肉', 160
  UNION ALL SELECT '阿强煎饼果子', '煎饼果子', 10, 10, '主食', '薄脆', 200
  UNION ALL SELECT '阿强煎饼果子', '手抓饼', 8, 8, '主食', '加肠', 140
) g ON g.shop = m.name
WHERE m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `stall_goods` sg
    WHERE sg.merchant_id = m.id AND sg.name = g.name AND sg.deleted_at IS NULL
  );

-- 异业商品
INSERT INTO `cross_goods` (`merchant_id`, `name`, `points_need`, `cash_price`, `category`, `desc_text`, `stock`, `on_sale`, `allow_mix`, `sales_count`)
SELECT m.id, g.name, g.points_need, g.cash_price, g.cat, g.descr, 200, 1, 1, g.sales
FROM `merchants` m
JOIN (
  SELECT '浔阳鲜果切' AS shop, '芒果拼盘' AS name, 800 AS points_need, 19.90 AS cash_price, '水果' AS cat, '当日切' AS descr, 86 AS sales
  UNION ALL SELECT '浔阳鲜果切', '草莓盒', 600, 16.00, '水果', '一盒', 64
  UNION ALL SELECT '浔阳鲜果切', '西瓜杯', 300, 9.90, '水果', '冰镇', 120
  UNION ALL SELECT '大中路茶饮', '珍珠奶茶', 400, 12.00, '茶饮', '中杯', 210
  UNION ALL SELECT '大中路茶饮', '杨枝甘露', 500, 16.00, '茶饮', '大杯', 150
  UNION ALL SELECT '大中路茶饮', '柠檬水', 200, 8.00, '茶饮', '现榨', 180
  UNION ALL SELECT '沙河美发', '洗剪吹', 1200, 39.00, '美发', '含吹', 48
  UNION ALL SELECT '沙河美发', '烫染套餐', 3000, 128.00, '美发', '到店', 22
  UNION ALL SELECT '牯岭便利', '矿泉水', 100, 2.00, '便利', '550ml', 300
  UNION ALL SELECT '牯岭便利', '关东煮', 400, 12.00, '便利', '加热', 90
  UNION ALL SELECT '牯岭便利', '面包', 300, 8.00, '便利', '当日', 70
  UNION ALL SELECT '浔阳花艺馆', '小花束', 1500, 39.00, '花艺', '当日', 40
  UNION ALL SELECT '浔阳花艺馆', '向日葵', 800, 29.00, '花艺', '一支装', 36
) g ON g.shop = m.name
WHERE m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `cross_goods` cg
    WHERE cg.merchant_id = m.id AND cg.name = g.name AND cg.deleted_at IS NULL
  );

-- 供应链商品
INSERT INTO `supply_goods` (`merchant_id`, `name`, `price`, `stock`, `points_grant`, `category`, `desc_text`, `status`, `sales_count`)
SELECT m.id, g.name, g.price, g.stock, 1, g.cat, g.descr, 1, g.sales
FROM `merchants` m
JOIN (
  SELECT '柴桑蔬菜基地' AS shop, '有机青菜' AS name, 3.50 AS price, 200 AS stock, '蔬菜' AS cat, '当日采' AS descr, 80 AS sales
  UNION ALL SELECT '柴桑蔬菜基地', '西红柿', 4.20, 180, '蔬菜', '精品', 60
  UNION ALL SELECT '柴桑蔬菜基地', '土豆', 2.80, 300, '蔬菜', '整箱', 90
  UNION ALL SELECT '庐山冷链仓', '冻虾仁', 28.00, 80, '冻品', '1kg', 40
  UNION ALL SELECT '庐山冷链仓', '鸡腿肉', 16.00, 120, '冻品', '1kg', 55
  UNION ALL SELECT '庐山冷链仓', '肥牛卷', 42.00, 60, '冻品', '500g', 30
  UNION ALL SELECT '鄱阳湖冻品仓', '鲈鱼片', 36.00, 40, '冻品', '去刺', 28
  UNION ALL SELECT '浔阳生鲜集配', '生菜', 2.60, 200, '蔬菜', '净菜', 70
  UNION ALL SELECT '浔阳生鲜集配', '五花肉', 22.00, 50, '生鲜', '冷鲜', 36
  UNION ALL SELECT '赣北粮油供应链', '食用油', 68.00, 40, '粮油', '5L', 24
  UNION ALL SELECT '昌九调味品厂', '辣椒面', 12.00, 100, '调味', '1kg', 48
) g ON g.shop = m.name
WHERE m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `supply_goods` sg
    WHERE sg.merchant_id = m.id AND sg.name = g.name AND sg.deleted_at IS NULL
  );

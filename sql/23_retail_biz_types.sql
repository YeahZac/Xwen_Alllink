-- 全站内容改成：餐饮 / 鲜花 / 蛋糕 / 百货商店（清除夜市烧烤等旧品类）

UPDATE `goods_categories` SET `status` = 0 WHERE `status` = 1;

INSERT INTO `goods_categories` (`role`, `name`, `sort_order`, `status`) VALUES
('stall', '餐饮', 10, 1),
('stall', '鲜花', 20, 1),
('stall', '蛋糕', 30, 1),
('stall', '百货商店', 40, 1),
('cross', '餐饮', 10, 1),
('cross', '鲜花', 20, 1),
('cross', '蛋糕', 30, 1),
('cross', '百货商店', 40, 1),
('supply', '餐饮', 10, 1),
('supply', '鲜花', 20, 1),
('supply', '蛋糕', 30, 1),
('supply', '百货商店', 40, 1)
ON DUPLICATE KEY UPDATE
  `sort_order` = VALUES(`sort_order`),
  `status` = 1;

UPDATE `merchants`
SET `biz_type` = ELT(1 + MOD(`id` - 1, 4), '餐饮', '鲜花', '蛋糕', '百货商店')
WHERE `deleted_at` IS NULL;

UPDATE `merchants`
SET
  `name` = CASE `biz_type`
    WHEN '餐饮' THEN ELT(1 + MOD(`id` DIV 4, 4), '味满分餐厅', '巷口小厨', '粤潮港餐厅', '轻食厨房')
    WHEN '鲜花' THEN ELT(1 + MOD(`id` DIV 4, 4), '花事馆', '花漾坊', '拾光花艺', '绽放鲜花')
    WHEN '蛋糕' THEN ELT(1 + MOD(`id` DIV 4, 4), '甜森蛋糕', '云朵烘焙', '蜜语蛋糕屋', '奶油日记')
    ELSE ELT(1 + MOD(`id` DIV 4, 4), '邻里百货', '日用百货商店', '精选超市', '生活百货')
  END,
  `cover_hue` = CASE `biz_type`
    WHEN '餐饮' THEN '#FF4D4F'
    WHEN '鲜花' THEN '#EB2F96'
    WHEN '蛋糕' THEN '#FA8C16'
    ELSE '#1677FF'
  END
WHERE `deleted_at` IS NULL;

UPDATE `merchants`
SET `address` = CASE `biz_type`
  WHEN '餐饮' THEN CONCAT(IFNULL(`city`, '深圳'), '商场餐饮区')
  WHEN '鲜花' THEN CONCAT(IFNULL(`city`, '深圳'), '商场花艺区')
  WHEN '蛋糕' THEN CONCAT(IFNULL(`city`, '深圳'), '商场烘焙区')
  ELSE CONCAT(IFNULL(`city`, '深圳'), '商场百货区')
END
WHERE `deleted_at` IS NULL
  AND (
    `address` LIKE '%夜市%'
    OR `address` LIKE '%摊%'
    OR `address` LIKE '%档%'
    OR `address` LIKE '%足道%'
    OR `address` LIKE '%冷链%'
    OR `address` LIKE '%仓储%'
    OR `address` LIKE '%农业%'
    OR `address` IS NULL
    OR `address` = ''
  );

UPDATE `stall_goods` g
INNER JOIN `merchants` m ON m.id = g.merchant_id
SET
  g.`category` = m.`biz_type`,
  g.`name` = CASE m.`biz_type`
    WHEN '餐饮' THEN ELT(1 + MOD(g.id, 5), '招牌套餐', '今日例汤', '时令小炒', '米饭套餐', '凉菜拼盘')
    WHEN '鲜花' THEN ELT(1 + MOD(g.id, 5), '日常花束', '玫瑰礼盒', '桌花', '向日葵束', '绿植盆栽')
    WHEN '蛋糕' THEN ELT(1 + MOD(g.id, 5), '奶油蛋糕', '芝士蛋糕', '纸杯蛋糕', '慕斯蛋糕', '生日蛋糕')
    ELSE ELT(1 + MOD(g.id, 5), '日用纸巾', '洗护套装', '零食组合', '家居收纳', '进口饮料')
  END,
  g.`desc_text` = CASE m.`biz_type`
    WHEN '餐饮' THEN '堂食 · 可外带'
    WHEN '鲜花' THEN '新鲜直送 · 可自提'
    WHEN '蛋糕' THEN '当日现做 · 可预订'
    ELSE '商场自提 · 积分可兑'
  END
;

UPDATE `cross_goods` g
INNER JOIN `merchants` m ON m.id = g.merchant_id
SET
  g.`category` = m.`biz_type`,
  g.`name` = CASE m.`biz_type`
    WHEN '餐饮' THEN ELT(1 + MOD(g.id, 4), '餐饮代金券', '双人套餐券', '午市特惠券', '甜品兑换券')
    WHEN '鲜花' THEN ELT(1 + MOD(g.id, 4), '鲜花兑换券', '迷你花束', '节日花礼', '绿植兑换')
    WHEN '蛋糕' THEN ELT(1 + MOD(g.id, 4), '蛋糕兑换券', '甜点兑换', '切片蛋糕', '生日蛋糕券')
    ELSE ELT(1 + MOD(g.id, 4), '百货满减券', '日用品兑换', '零食兑换包', '洗护兑换')
  END,
  g.`desc_text` = CONCAT(m.`biz_type`, ' · 积分可兑 · 不够可补现金')
;

UPDATE `supply_goods` g
INNER JOIN `merchants` m ON m.id = g.merchant_id
SET
  g.`category` = m.`biz_type`,
  g.`name` = CASE m.`biz_type`
    WHEN '餐饮' THEN ELT(1 + MOD(g.id, 4), '餐饮食材箱', '冷冻半成品', '调味料套装', '餐具耗材包')
    WHEN '鲜花' THEN ELT(1 + MOD(g.id, 4), '鲜切花批发', '花泥耗材', '包装纸套装', '绿植批货')
    WHEN '蛋糕' THEN ELT(1 + MOD(g.id, 4), '烘焙原料箱', '奶油乳制品', '蛋糕盒耗材', '裱花工具包')
    ELSE ELT(1 + MOD(g.id, 4), '百货日用品箱', '洗护批货', '纸品批货', '饮料整箱')
  END,
  g.`desc_text` = CONCAT(m.`biz_type`, '供货 · 采购获额度')
;

UPDATE `banners`
SET
  `title` = CASE
    WHEN `role_scope` = 'consumer' AND MOD(`id`, 3) = 0 THEN '商场好店上新'
    WHEN `role_scope` = 'consumer' AND MOD(`id`, 3) = 1 THEN '积分兑鲜花蛋糕'
    WHEN `role_scope` = 'consumer' THEN '餐饮百货附近可兑'
    WHEN `role_scope` = 'stall' THEN '门店采购获额度'
    WHEN `role_scope` = 'cross' THEN '承接积分客流'
    WHEN `role_scope` = 'supply' THEN '供货餐饮花蛋糕百货'
    ELSE '商户入驻'
  END,
  `sub_title` = CASE
    WHEN `role_scope` = 'consumer' THEN '餐饮 · 鲜花 · 蛋糕 · 百货'
    ELSE '本地生活经营工具'
  END;

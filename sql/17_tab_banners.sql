-- 四个 C 端 Tab 各自一套 Banner，避免首页 / 兑换 / 积分 / 我的看到同一组图。
-- page_key：index / cross / points / mine。排序区间与小程序兜底一致：1-9 / 10-19 / 20-29 / 30-39。

SET @has_page := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'banners' AND COLUMN_NAME = 'page_key'
);
SET @ddl := IF(@has_page = 0,
  'ALTER TABLE `banners` ADD COLUMN `page_key` VARCHAR(32) DEFAULT NULL COMMENT ''C端页面 index/cross/points/mine'' AFTER `role_scope`',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `banners`
SET `page_key` = 'index', `sort_order` = 1
WHERE `role_scope` = 'consumer' AND `title` IN ('夜市扫码点餐', '新客专享');

UPDATE `banners`
SET `page_key` = 'index', `sort_order` = 2,
    `image_url` = '/assets/banners/consumer-market.jpg'
WHERE `role_scope` = 'consumer' AND `title` IN ('附近夜市好店', '附近五档夜市');

UPDATE `banners`
SET `page_key` = 'points', `sort_order` = 20,
    `title` = '积分抵现',
    `sub_title` = '100积分=1元 · 明细可追溯',
    `image_url` = '/assets/banners/cross-redeem.jpg',
    `link_url` = '/pages/points/points',
    `link_type` = 'switchTab'
WHERE `role_scope` = 'consumer' AND `title` IN ('积分抵现周', '积分抵现');

INSERT INTO `banners` (`role_scope`, `page_key`, `title`, `sub_title`, `image_url`, `link_url`, `link_type`, `sort_order`, `status`)
SELECT 'consumer', 'cross', '积分兑鲜果', '附近门店可兑 · 不够可补现金', '/assets/banners/consumer-points.jpg', '/pages/cross/cross', 'switchTab', 10, 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `banners` WHERE `role_scope` = 'consumer' AND `title` = '积分兑鲜果'
);

INSERT INTO `banners` (`role_scope`, `page_key`, `title`, `sub_title`, `image_url`, `link_url`, `link_type`, `sort_order`, `status`)
SELECT 'consumer', 'mine', '邀请好友一起逛', '推荐有奖 · 积分马上到账', '/assets/banners/login-join.jpg', '/pages/recommend/recommend', 'navigate', 30, 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `banners` WHERE `role_scope` = 'consumer' AND `title` = '邀请好友一起逛'
);

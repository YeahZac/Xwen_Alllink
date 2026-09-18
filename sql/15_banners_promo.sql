-- 角色首页宣传图（小程序包内资产；后台上传 COS 后会覆盖）
USE `wanyehulian`;

UPDATE `banners`
SET `image_url` = '/assets/banners/consumer-scan.jpg',
    `title` = IF(`title` = '' OR `title` IS NULL, '夜市扫码点餐', `title`),
    `sub_title` = IF(`sub_title` = '' OR `sub_title` IS NULL, '就近下单 · 积分马上到账', `sub_title`)
WHERE `role_scope` = 'consumer' AND `sort_order` = 1;

UPDATE `banners`
SET `image_url` = '/assets/banners/consumer-points.jpg'
WHERE `role_scope` = 'consumer' AND `sort_order` = 2;

UPDATE `banners`
SET `image_url` = '/assets/banners/consumer-market.jpg'
WHERE `role_scope` = 'consumer' AND `sort_order` = 3;

UPDATE `banners`
SET `image_url` = '/assets/banners/stall-purchase.jpg'
WHERE `role_scope` = 'stall';

UPDATE `banners`
SET `image_url` = '/assets/banners/cross-redeem.jpg'
WHERE `role_scope` = 'cross';

UPDATE `banners`
SET `image_url` = '/assets/banners/supply-warehouse.jpg'
WHERE `role_scope` = 'supply';

UPDATE `banners`
SET `image_url` = '/assets/banners/login-join.jpg'
WHERE `role_scope` = 'login';

INSERT INTO `banners` (`role_scope`, `title`, `sub_title`, `image_url`, `link_url`, `link_type`, `sort_order`, `status`)
SELECT 'consumer', '附近夜市好店', '炒面烤串麻辣烫都有', '/assets/banners/consumer-market.jpg', '/pages/index/index', 'switchTab', 3, 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `banners` WHERE `role_scope` = 'consumer' AND `sort_order` = 3
);

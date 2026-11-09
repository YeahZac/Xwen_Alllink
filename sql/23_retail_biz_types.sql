-- 全站内容改成：餐饮 / 鲜花 / 蛋糕 / 百货商店（清除夜市烧烤等旧品类）
-- 重要：禁止再批量改写真实入驻商户的 name / cover / address。
-- 演示店名回写已造成「海川众核科技」被改成「甜森蛋糕」等问题；见 sql/43_restore_apply_merchant_identity.sql

-- 类目收敛为每角色 2 个（详见 sql/44）；此处不再灌 4 类目
UPDATE `goods_categories` SET `status` = 0 WHERE `status` = 1;

INSERT INTO `goods_categories` (`role`, `name`, `sort_order`, `status`) VALUES
('stall', '餐饮', 10, 1),
('stall', '百货商店', 20, 1),
('cross', '餐饮', 10, 1),
('cross', '百货商店', 20, 1),
('supply', '粮油', 10, 1),
('supply', '生鲜', 20, 1)
ON DUPLICATE KEY UPDATE
  `sort_order` = VALUES(`sort_order`),
  `status` = 1;

DELETE FROM `goods_categories` WHERE `status` = 0;

-- 仅给「尚未有 biz_type」的商户补默认品类，不覆盖已有值
UPDATE `merchants`
SET `biz_type` = ELT(1 + MOD(`id` - 1, 4), '餐饮', '鲜花', '蛋糕', '百货商店')
WHERE `deleted_at` IS NULL
  AND (`biz_type` IS NULL OR `biz_type` = '');

-- 仅给无封面色的补默认色，不改店名
UPDATE `merchants`
SET `cover_hue` = CASE IFNULL(NULLIF(`biz_type`, ''), '餐饮')
  WHEN '餐饮' THEN '#FF4D4F'
  WHEN '鲜花' THEN '#EB2F96'
  WHEN '蛋糕' THEN '#FA8C16'
  ELSE '#1677FF'
END
WHERE `deleted_at` IS NULL
  AND (`cover_hue` IS NULL OR `cover_hue` = '');

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
  END
WHERE `role_scope` IN ('consumer', 'stall', 'cross', 'supply');

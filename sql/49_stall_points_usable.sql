-- 地摊商品：单件「可用积分」抵现上限；组合支付须留至少 ¥0.01 现金
ALTER TABLE `stall_goods`
  ADD COLUMN `points_usable` INT NOT NULL DEFAULT 0 COMMENT '单件可用积分（抵现上限）' AFTER `mix_enabled`;

-- 已开启抵现的在售商品：按默认汇率 0.01 回填，并预留 1 分现金空间
UPDATE `stall_goods`
SET `points_usable` = GREATEST(0, FLOOR(`price` / 0.01) - 1)
WHERE IFNULL(`mix_enabled`, 1) = 1
  AND IFNULL(`points_usable`, 0) = 0
  AND `price` >= 0.01
  AND `deleted_at` IS NULL;

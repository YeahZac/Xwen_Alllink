-- 已退役：旧版会在每次 ensureSchema 时：
-- 1) 复活种子邀请码门店（deleted_at=NULL）
-- 2) 强制改写 id=1..N 门店地址
-- 3) 把 merchant 1/2 等下的已软删 stall_goods 全部复活（含测试脏 SKU）
-- 现改为空操作，避免冲掉线上正式数据。地理坐标请运营台手工维护。
SELECT 1;

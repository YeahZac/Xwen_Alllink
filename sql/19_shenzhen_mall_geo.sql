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

-- 以下门店坐标强制改写已退役：避免每次启动覆盖运营台维护的正式地址。
-- 如需一次性回填请手工执行历史备份，勿挂在 ensureSchema。

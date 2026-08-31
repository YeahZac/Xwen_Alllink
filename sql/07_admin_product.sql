-- 产品对齐：交易运营 / 积分结算权限页
INSERT INTO admin_permissions (page_key, page_name, group_name, sort_order) VALUES
  ('points', '积分与额度', '交易运营', 62),
  ('settlements', '结算抽成', '交易运营', 63),
  ('orders', '订单中心', '交易运营', 60),
  ('withdraws', '提现审核', '交易运营', 64),
  ('referrals', '推荐记录', '交易运营', 65)
ON DUPLICATE KEY UPDATE page_name=VALUES(page_name), group_name=VALUES(group_name), sort_order=VALUES(sort_order);

INSERT INTO admin_role_permissions (role_id, page_key, can_view, can_edit)
SELECT 1, page_key, 1, 1 FROM admin_permissions
ON DUPLICATE KEY UPDATE can_view=1, can_edit=1;

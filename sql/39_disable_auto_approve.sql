-- 前期联调：关闭自动审核 / 自动进件（改回 1 即可重新开启）
USE `wanyehulian`;

INSERT INTO `platform_config` (`config_key`, `config_value`, `remark`) VALUES
('apply_auto_approve', '0', '商家入驻是否自动审核：0=关（前期人工审），1=开'),
('apply_auto_approve_roles', 'stall', '自动审核角色，逗号分隔：stall,cross,supply'),
('wx_applyment_auto_submit', '0', '审核通过后是否自动提交微信进件：0=关（运营台手工提交），1=开')
ON DUPLICATE KEY UPDATE
  `config_value` = VALUES(`config_value`),
  `remark` = VALUES(`remark`);

-- 将超级管理员密码重置为 123456
USE `wanyehulian`;

UPDATE `admin_accounts`
SET
  `password_hash` = 'b6a192c0d4d4ff4c8d9ced0f7b33d5a6644580696c38088ece51bacb03edfa3e',
  `password_salt` = 'xwen_admin_salt_v1',
  `status` = 1,
  `role_id` = 1
WHERE `username` = 'admin';

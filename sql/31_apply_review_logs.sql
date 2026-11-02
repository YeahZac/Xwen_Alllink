-- 入驻/身份申请审核流水（通过、驳回、改审均可追溯）
CREATE TABLE IF NOT EXISTS apply_review_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  apply_type VARCHAR(32) NOT NULL COMMENT 'merchant|partner|platform_role',
  apply_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(32) DEFAULT NULL,
  to_status VARCHAR(32) NOT NULL,
  reason VARCHAR(512) DEFAULT NULL,
  reviewer_id BIGINT UNSIGNED DEFAULT NULL,
  reviewer_name VARCHAR(64) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_apply_type_id (apply_type, apply_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='申请审核操作日志';

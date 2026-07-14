-- qi_request.title 由 VARCHAR(512) 改为 TEXT，从根本上避免旧数据迁移/长标题越界。
-- VARCHAR → TEXT 转换无损（原有数据原样保留），NOT NULL 约束保持不变。
BEGIN;

ALTER TABLE qi_request ALTER COLUMN title TYPE TEXT;

COMMIT;

-- 责任田二级模块责任人（一级下的第二层节点，如「存储引擎/段页管理」中的「段页管理」）
ALTER TABLE duty_field_node
  ADD COLUMN IF NOT EXISTS owner VARCHAR(256) NOT NULL DEFAULT '';

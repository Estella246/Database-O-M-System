-- dfx_gap 退役：新单 schema 不再包含该字段（is_active=FALSE）。
-- 旧单（任一节点已存非空 dfx_gap 值）由后端按工单复活该字段定义（见 backend/utils/dfx_gap.py），
-- 仍可渲染/继承/编辑。required 一并置 FALSE，避免旧单编辑时被必填校验卡住。
BEGIN;

UPDATE node_field_def f
SET is_active = FALSE,
    required = FALSE,
    updated_at = NOW()
FROM workflow_node n
WHERE f.node_id = n.id
  AND n.node_key IN ('dev_analysis', 'dev_closure', 'ops_closure', 'audit_close')
  AND f.field_key = 'dfx_gap';

COMMIT;

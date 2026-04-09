BEGIN;

-- 1) Ensure full node chain exists for template HCS_INCIDENT.
WITH t AS (
  SELECT id FROM workflow_template WHERE template_code = 'HCS_INCIDENT'
)
INSERT INTO workflow_node (template_id, node_key, node_name, node_order)
SELECT t.id, v.node_key, v.node_name, v.node_order
FROM t
JOIN (
  VALUES
    ('problem_review', '问题审核', 2),
    ('ops_analysis', '运维分析', 3),
    ('dev_analysis', '开发分析', 4),
    ('dev_closure', '开发闭环', 5),
    ('ops_closure', '运维闭环', 6),
    ('audit_close', '审核关闭', 7)
) AS v(node_key, node_name, node_order) ON TRUE
ON CONFLICT (template_id, node_key) DO NOTHING;

-- 2) Option-set metadata.
INSERT INTO option_set (set_code, set_name, source_type, source_config)
VALUES
  ('OS_PROBLEM_REVIEW_HANDLE_MODE', '问题审核-处理方式', 'static', NULL),
  ('OS_PROBLEM_REVIEW_TYPE_JUDGE', '问题审核-问题类型初步判断', 'static', NULL),
  ('OS_PROBLEM_REVIEW_NEXT_HANDLER', '问题审核-下一步处理人', 'external_api', '{"desc":"公司人员名单接口"}'::jsonb),

  ('OS_OPS_ANALYSIS_HANDLE_MODE', '运维分析-处理方式', 'static', NULL),
  ('OS_OPS_ANALYSIS_NEXT_HANDLER', '运维分析-下一步处理人', 'external_api', '{"desc":"公司人员名单接口"}'::jsonb),
  ('OS_RESPONSIBILITY_INTRO', '问题引入模块', 'external_api', '{"desc":"参数配置-责任田模块（级联）"}'::jsonb),
  ('OS_RESPONSIBILITY_OWNER', '问题归属模块', 'external_api', '{"desc":"参数配置-责任田模块（级联）"}'::jsonb),
  ('OS_ISSUE_TYPE', '问题类型', 'static', NULL),
  ('OS_PRODUCT_LINE', '产品线', 'static', NULL),
  ('OS_ROOT_CAUSE_CATEGORY', '根因分类', 'external_api', '{"desc":"按问题类型动态白名单"}'::jsonb),
  ('OS_EVENT_LEVEL', '事件级别', 'static', NULL),
  ('OS_CUSTOMER_VOICE', '客户声音', 'static', NULL),
  ('OS_GAUSS_VERSION', '高斯版本', 'external_api', '{"desc":"参数配置-版本模块"}'::jsonb),
  ('OS_DEPLOY_MODE', '部署形态', 'static', NULL),
  ('OS_YES_NO', '是否/否是', 'static', NULL),
  ('OS_UPGRADE_BASELINE', '升级前基线版本', 'external_api', '{"desc":"参数配置-版本模块"}'::jsonb),
  ('OS_UPGRADE_STATUS', '升级状态', 'static', NULL),

  ('OS_DEV_ANALYSIS_HANDLE_MODE', '开发分析-处理方式', 'static', NULL),
  ('OS_DEV_ANALYSIS_PASS_THROUGH', '开发分析-是否透传', 'static', NULL),
  ('OS_DEV_ANALYSIS_QUALITY', '开发分析-是否质量问题', 'static', NULL),
  ('OS_DEV_ANALYSIS_ROCK_VER', '开发分析-磐石版本是否涉及', 'static', NULL),
  ('OS_DEV_ANALYSIS_CONSULT', '开发分析-是否咨询问题', 'static', NULL),
  ('OS_DEV_ANALYSIS_COLLAB', '开发分析-协同处理人', 'external_api', '{"desc":"公司人员名单接口，可搜索"}'::jsonb),

  ('OS_DEV_CLOSURE_HANDLE_MODE', '开发闭环-处理方式', 'static', NULL),
  ('OS_WARNING_NEEDED', '是否需要预警', 'static', NULL),
  ('OS_IMPACT_LEVEL', '业务影响程度', 'static', NULL),

  ('OS_OPS_CLOSURE_HANDLE_MODE', '运维闭环-处理方式', 'static', NULL),
  ('OS_AUDIT_CLOSE_HANDLE_MODE', '审核关闭-处理方式', 'static', NULL)
ON CONFLICT (set_code) DO NOTHING;

-- 3) Option items.
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order)
SELECT os.id, v.option_value, v.option_label, v.sort_order
FROM option_set os
JOIN (
  VALUES
    ('OS_PROBLEM_REVIEW_HANDLE_MODE', '确认问题', '确认问题', 1),
    ('OS_PROBLEM_REVIEW_HANDLE_MODE', '提交其他运维审核', '提交其他运维审核', 2),
    ('OS_PROBLEM_REVIEW_HANDLE_MODE', '返回HCS修改', '返回HCS修改', 3),
    ('OS_PROBLEM_REVIEW_HANDLE_MODE', '非问题关闭', '非问题关闭', 4),

    ('OS_PROBLEM_REVIEW_TYPE_JUDGE', '慢SQL（SQL调优）', '慢SQL（SQL调优）', 1),
    ('OS_PROBLEM_REVIEW_TYPE_JUDGE', '整体性能', '整体性能', 2),
    ('OS_PROBLEM_REVIEW_TYPE_JUDGE', '升级', '升级', 3),
    ('OS_PROBLEM_REVIEW_TYPE_JUDGE', '容灾', '容灾', 4),
    ('OS_PROBLEM_REVIEW_TYPE_JUDGE', '备份恢复', '备份恢复', 5),
    ('OS_PROBLEM_REVIEW_TYPE_JUDGE', 'SQL引擎-其他问题', 'SQL引擎-其他问题', 6),
    ('OS_PROBLEM_REVIEW_TYPE_JUDGE', '存储引擎-其他问题', '存储引擎-其他问题', 7),
    ('OS_PROBLEM_REVIEW_TYPE_JUDGE', '扩容', '扩容', 8),
    ('OS_PROBLEM_REVIEW_TYPE_JUDGE', '管控问题', '管控问题', 9),

    ('OS_OPS_ANALYSIS_HANDLE_MODE', '提交开发分析', '提交开发分析', 1),
    ('OS_OPS_ANALYSIS_HANDLE_MODE', '提交开发闭环', '提交开发闭环', 2),
    ('OS_OPS_ANALYSIS_HANDLE_MODE', '提交运维闭环', '提交运维闭环', 3),
    ('OS_OPS_ANALYSIS_HANDLE_MODE', '提交其他运维分析', '提交其他运维分析', 4),

    ('OS_ISSUE_TYPE', '慢', '慢', 1),
    ('OS_ISSUE_TYPE', '满', '满', 2),
    ('OS_ISSUE_TYPE', '错', '错', 3),
    ('OS_ISSUE_TYPE', 'hang', 'hang', 4),
    ('OS_ISSUE_TYPE', 'coredump', 'coredump', 5),
    ('OS_ISSUE_TYPE', '集群状态异常', '集群状态异常', 6),
    ('OS_ISSUE_TYPE', '数据不一致', '数据不一致', 7),
    ('OS_ISSUE_TYPE', '咨询问题', '咨询问题', 8),

    ('OS_PRODUCT_LINE', '公有云', '公有云', 1),
    ('OS_PRODUCT_LINE', '混合云', '混合云', 2),
    ('OS_PRODUCT_LINE', '轻量化', '轻量化', 3),

    ('OS_EVENT_LEVEL', '一般问题', '一般问题', 1),
    ('OS_EVENT_LEVEL', '内部通报重大问题', '内部通报重大问题', 2),
    ('OS_EVENT_LEVEL', '管理升级预警', '管理升级预警', 3),
    ('OS_EVENT_LEVEL', '已管理升级', '已管理升级', 4),
    ('OS_EVENT_LEVEL', '事故', '事故', 5),
    ('OS_EVENT_LEVEL', 'P4事件', 'P4事件', 6),
    ('OS_EVENT_LEVEL', 'P1-P3事件', 'P1-P3事件', 7),

    ('OS_CUSTOMER_VOICE', '客户/一线不感知', '客户/一线不感知', 1),
    ('OS_CUSTOMER_VOICE', '客户/一线感知声音可控', '客户/一线感知声音可控', 2),
    ('OS_CUSTOMER_VOICE', '客户/一线感知存在风险', '客户/一线感知存在风险', 3),
    ('OS_CUSTOMER_VOICE', '重大投诉风险', '重大投诉风险', 4),

    ('OS_DEPLOY_MODE', '集中式', '集中式', 1),
    ('OS_DEPLOY_MODE', '分布式', '分布式', 2),
    ('OS_DEPLOY_MODE', '小型化', '小型化', 3),

    ('OS_YES_NO', '是', '是', 1),
    ('OS_YES_NO', '否', '否', 2),

    ('OS_UPGRADE_STATUS', '升级观察期', '升级观察期', 1),
    ('OS_UPGRADE_STATUS', '升级已提交', '升级已提交', 2),

    ('OS_DEV_ANALYSIS_HANDLE_MODE', '提交开发闭环', '提交开发闭环', 1),
    ('OS_DEV_ANALYSIS_HANDLE_MODE', '提交其他开发分析', '提交其他开发分析', 2),
    ('OS_DEV_ANALYSIS_HANDLE_MODE', '返回运维分析', '返回运维分析', 3),

    ('OS_DEV_ANALYSIS_PASS_THROUGH', '否', '否', 1),
    ('OS_DEV_ANALYSIS_PASS_THROUGH', '是', '是', 2),

    ('OS_DEV_ANALYSIS_QUALITY', '是（已知质量问题）', '是（已知质量问题）', 1),
    ('OS_DEV_ANALYSIS_QUALITY', '是（新发现质量问题）', '是（新发现质量问题）', 2),
    ('OS_DEV_ANALYSIS_QUALITY', '否', '否', 3),

    ('OS_DEV_ANALYSIS_ROCK_VER', '505.2.1.SPC0800磐石版本无该问题', '505.2.1.SPC0800磐石版本无该问题', 1),
    ('OS_DEV_ANALYSIS_ROCK_VER', '505.2.1.SPC0800磐石版本涉及-历史版本引入', '505.2.1.SPC0800磐石版本涉及-历史版本引入', 2),
    ('OS_DEV_ANALYSIS_ROCK_VER', '505.2.1.SPC0800磐石版本引入该问题', '505.2.1.SPC0800磐石版本引入该问题', 3),

    ('OS_DEV_ANALYSIS_CONSULT', '否', '否', 1),
    ('OS_DEV_ANALYSIS_CONSULT', '是', '是', 2),

    ('OS_DEV_CLOSURE_HANDLE_MODE', '提交运维闭环', '提交运维闭环', 1),
    ('OS_DEV_CLOSURE_HANDLE_MODE', '提交其他开发闭环', '提交其他开发闭环', 2),
    ('OS_DEV_CLOSURE_HANDLE_MODE', '返回开发分析', '返回开发分析', 3),
    ('OS_DEV_CLOSURE_HANDLE_MODE', '返回运维分析', '返回运维分析', 4),

    ('OS_WARNING_NEEDED', '是', '是', 1),
    ('OS_WARNING_NEEDED', '否', '否', 2),

    ('OS_IMPACT_LEVEL', '结果/数据错误', '结果/数据错误', 1),
    ('OS_IMPACT_LEVEL', 'core/hang/报错', 'core/hang/报错', 2),
    ('OS_IMPACT_LEVEL', '性能下降', '性能下降', 3),
    ('OS_IMPACT_LEVEL', '内存泄露', '内存泄露', 4),
    ('OS_IMPACT_LEVEL', '磁盘满', '磁盘满', 5),
    ('OS_IMPACT_LEVEL', '升级、扩容、安装失败', '升级、扩容、安装失败', 6),
    ('OS_IMPACT_LEVEL', '其他', '其他', 7),

    ('OS_OPS_CLOSURE_HANDLE_MODE', '提交运维审核关闭', '提交运维审核关闭', 1),
    ('OS_OPS_CLOSURE_HANDLE_MODE', '提交其他运维闭环', '提交其他运维闭环', 2),
    ('OS_OPS_CLOSURE_HANDLE_MODE', '返回开发闭环', '返回开发闭环', 3),
    ('OS_OPS_CLOSURE_HANDLE_MODE', '返回运维分析', '返回运维分析', 4),

    ('OS_AUDIT_CLOSE_HANDLE_MODE', '问题解决关闭', '问题解决关闭', 1),
    ('OS_AUDIT_CLOSE_HANDLE_MODE', '提交其他审核关闭', '提交其他审核关闭', 2),
    ('OS_AUDIT_CLOSE_HANDLE_MODE', '返回运维闭环', '返回运维闭环', 3),
    ('OS_AUDIT_CLOSE_HANDLE_MODE', '暂时挂起', '暂时挂起', 4)
) AS v(set_code, option_value, option_label, sort_order)
ON os.set_code = v.set_code
ON CONFLICT (option_set_id, option_value) DO NOTHING;

-- 4) Seed node fields from updated xlsx.
WITH node_map AS (
  SELECT wn.id, wn.node_key
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
),
set_map AS (
  SELECT set_code, id FROM option_set
),
field_seed AS (
  SELECT * FROM (
    VALUES
    -- 问题审核
    ('problem_review', 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_PROBLEM_REVIEW_HANDLE_MODE', NULL, '{"inherit_previous":false}'::jsonb, 1),
    ('problem_review', 'issue_type_judge', '问题类型初步判断', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_PROBLEM_REVIEW_TYPE_JUDGE', NULL, '{"inherit_previous":false}'::jsonb, 2),
    ('problem_review', 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_PROBLEM_REVIEW_NEXT_HANDLER', NULL, '{"inherit_previous":false}'::jsonb, 3),

    -- 运维分析
    ('ops_analysis', 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_OPS_ANALYSIS_HANDLE_MODE', '{"special":"提交其他运维分析时，仅处理方式/下一步处理人必填"}'::jsonb, '{"inherit_previous":false}'::jsonb, 1),
    ('ops_analysis', 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_OPS_ANALYSIS_NEXT_HANDLER', NULL, '{"inherit_previous":false}'::jsonb, 2),
    ('ops_analysis', 'start_date', '起始日期', 'date', TRUE, FALSE, 'today', NULL, NULL, NULL, '{"inherit_previous":true}'::jsonb, 3),
    ('ops_analysis', 'issue_intro_module', '问题引入模块', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_RESPONSIBILITY_INTRO', NULL, '{"inherit_previous":false}'::jsonb, 4),
    ('ops_analysis', 'issue_owner_module', '问题归属模块', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_RESPONSIBILITY_OWNER', NULL, '{"inherit_previous":false}'::jsonb, 5),
    ('ops_analysis', 'severity', '问题严重性', 'whitelist', TRUE, FALSE, 'none', NULL, 'SEVERITY_SET', '{"special":"映射前端Priority列"}'::jsonb, '{"inherit_previous":true}'::jsonb, 6),
    ('ops_analysis', 'location', '局点', 'whitelist', TRUE, FALSE, 'none', NULL, 'LOCATION_SET', '{"source":"external_api"}'::jsonb, '{"inherit_previous":true}'::jsonb, 7),
    ('ops_analysis', 'issue_type', '问题类型', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_ISSUE_TYPE', NULL, '{"inherit_previous":false}'::jsonb, 8),
    ('ops_analysis', 'product_line', '产品线', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_PRODUCT_LINE', NULL, '{"inherit_previous":false}'::jsonb, 9),
    ('ops_analysis', 'root_cause_category', '根因分类', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_ROOT_CAUSE_CATEGORY', '{"special":"按问题类型动态白名单"}'::jsonb, '{"inherit_previous":false}'::jsonb, 10),
    ('ops_analysis', 'biz_env', '业务环境', 'whitelist', TRUE, FALSE, 'none', NULL, 'BIZ_ENV_SET', NULL, '{"inherit_previous":true}'::jsonb, 11),
    ('ops_analysis', 'event_level', '事件级别', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_EVENT_LEVEL', NULL, '{"inherit_previous":false}'::jsonb, 12),
    ('ops_analysis', 'component', '问题组件', 'whitelist', TRUE, FALSE, 'none', NULL, 'COMPONENT_SET', NULL, '{"inherit_previous":true}'::jsonb, 13),
    ('ops_analysis', 'customer_voice', '客户声音', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_CUSTOMER_VOICE', NULL, '{"inherit_previous":false}'::jsonb, 14),
    ('ops_analysis', 'gauss_version', '高斯版本', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_GAUSS_VERSION', NULL, '{"inherit_previous":false}'::jsonb, 15),
    ('ops_analysis', 'deploy_mode', '部署形态', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_DEPLOY_MODE', NULL, '{"inherit_previous":false}'::jsonb, 16),
    ('ops_analysis', 'kernel_upgrade_involved', '是否涉及内核升级', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_YES_NO', NULL, '{"inherit_previous":false}'::jsonb, 17),
    ('ops_analysis', 'kernel_upgrade_time', '内核升级时间', 'date', FALSE, FALSE, 'none', NULL, NULL, '{"required_if":{"kernel_upgrade_involved":"是"}}'::jsonb, '{"inherit_previous":false}'::jsonb, 18),
    ('ops_analysis', 'upgrade_baseline_version', '升级前基线版本', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_UPGRADE_BASELINE', '{"required_if":{"kernel_upgrade_involved":"是"}}'::jsonb, '{"inherit_previous":false}'::jsonb, 19),
    ('ops_analysis', 'control_version', '管控版本', 'text', FALSE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":false}'::jsonb, 20),
    ('ops_analysis', 'upgrade_status', '升级状态', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_UPGRADE_STATUS', '{"required_if":{"kernel_upgrade_involved":"是"}}'::jsonb, '{"inherit_previous":false}'::jsonb, 21),
    ('ops_analysis', 'issue_desc', '问题描述', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":true}'::jsonb, 22),
    ('ops_analysis', 'error_text', '报错信息', 'text', TRUE, FALSE, 'none', NULL, NULL, '{"plain_text_only":true}'::jsonb, '{"inherit_previous":false}'::jsonb, 23),
    ('ops_analysis', 'issue_track', '问题进展跟踪', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":false}'::jsonb, 24),
    ('ops_analysis', 'has_coredump_file', '是否有coredump文件', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_YES_NO', '{"required_if":{"issue_type":"coredump"}}'::jsonb, '{"inherit_previous":false}'::jsonb, 25),
    ('ops_analysis', 'has_core_stack', '是否有core堆栈', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_YES_NO', '{"required_if":{"issue_type":"coredump"}}'::jsonb, '{"inherit_previous":false}'::jsonb, 26),
    ('ops_analysis', 'core_stack_text', 'Core堆栈（文字版）', 'text', FALSE, FALSE, 'none', NULL, NULL, '{"plain_text_only":true,"required_if":{"issue_type":"coredump"}}'::jsonb, '{"inherit_previous":false}'::jsonb, 27),

    -- 开发分析
    ('dev_analysis', 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_HANDLE_MODE', '{"special":"提交其他开发分析/返回运维分析时，仅处理方式和下一步处理人必填"}'::jsonb, '{"inherit_previous":false}'::jsonb, 1),
    ('dev_analysis', 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_PROBLEM_REVIEW_NEXT_HANDLER', NULL, '{"inherit_previous":false}'::jsonb, 2),
    ('dev_analysis', 'issue_intro_module', '问题引入模块', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_RESPONSIBILITY_INTRO', NULL, '{"inherit_previous":true}'::jsonb, 3),
    ('dev_analysis', 'issue_owner_module', '问题归属模块', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_RESPONSIBILITY_OWNER', NULL, '{"inherit_previous":true}'::jsonb, 4),
    ('dev_analysis', 'front_pass_through', '是否前端透传', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_PASS_THROUGH', NULL, '{"inherit_previous":false}'::jsonb, 5),
    ('dev_analysis', 'version_pass_through', '是否透传至版本', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_PASS_THROUGH', NULL, '{"inherit_previous":false}'::jsonb, 6),
    ('dev_analysis', 'is_quality_issue', '是否质量问题', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_QUALITY', NULL, '{"inherit_previous":true}'::jsonb, 7),
    ('dev_analysis', 'dts_no', 'DTS单号', 'text', FALSE, FALSE, 'none', NULL, NULL, '{"required_if":{"is_quality_issue":["是（已知质量问题）","是（新发现质量问题）"]}}'::jsonb, '{"inherit_previous":true}'::jsonb, 8),
    ('dev_analysis', 'version_pass_reason', '版本透传原因分析', 'text', FALSE, FALSE, 'none', NULL, NULL, '{"required_if":{"version_pass_through":"是"}}'::jsonb, '{"inherit_previous":false}'::jsonb, 9),
    ('dev_analysis', 'is_consult_issue', '是否咨询问题', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_CONSULT', NULL, '{"inherit_previous":false}'::jsonb, 10),
    ('dev_analysis', 'rock_version_involved', '磐石版本是否涉及', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_ROCK_VER', '{"required_if":{"is_quality_issue":["是（已知质量问题）","是（新发现质量问题）"]}}'::jsonb, '{"inherit_previous":false}'::jsonb, 11),
    ('dev_analysis', 'collaborator', '协同处理人', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_COLLAB', NULL, '{"inherit_previous":false}'::jsonb, 12),
    ('dev_analysis', 'workaround', '规避措施/恢复方法', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":false}'::jsonb, 13),
    ('dev_analysis', 'root_cause', '问题根因', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":false}'::jsonb, 14),
    ('dev_analysis', 'issue_track', '问题进展跟踪', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":true}'::jsonb, 15),
    ('dev_analysis', 'dfx_gap', 'DFX能力GAP', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":false}'::jsonb, 16),
    ('dev_analysis', 'error_archive_text', '报错信息归档（core、报错、内存堆积上下文文字版）', 'text', FALSE, FALSE, 'none', NULL, NULL, '{"plain_text_only":true}'::jsonb, '{"inherit_previous":false}'::jsonb, 17),

    -- 开发闭环
    ('dev_closure', 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_DEV_CLOSURE_HANDLE_MODE', '{"special":"提交其他开发闭环/返回开发分析/返回运维分析时，仅处理方式和下一步处理人必填"}'::jsonb, '{"inherit_previous":false}'::jsonb, 1),
    ('dev_closure', 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_PROBLEM_REVIEW_NEXT_HANDLER', NULL, '{"inherit_previous":false}'::jsonb, 2),
    ('dev_closure', 'warning_needed', '是否需要预警', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_WARNING_NEEDED', NULL, '{"inherit_previous":false}'::jsonb, 3),
    ('dev_closure', 'impact_level', '业务影响程度', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_IMPACT_LEVEL', '{"required_if":{"warning_needed":"是"}}'::jsonb, '{"inherit_previous":false}'::jsonb, 4),
    ('dev_closure', 'sla_analysis', 'SLA分析', 'richtext', FALSE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":false}'::jsonb, 5),
    ('dev_closure', 'dfx_gap', 'DFX能力GAP', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":true}'::jsonb, 6),

    -- 运维闭环
    ('ops_closure', 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_OPS_CLOSURE_HANDLE_MODE', '{"special":"提交其他运维闭环/返回开发闭环/返回运维分析时，仅处理方式和下一步处理人必填"}'::jsonb, '{"inherit_previous":false}'::jsonb, 1),
    ('ops_closure', 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_PROBLEM_REVIEW_NEXT_HANDLER', NULL, '{"inherit_previous":false}'::jsonb, 2),
    ('ops_closure', 'is_quality_issue', '是否质量问题', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_QUALITY', NULL, '{"inherit_previous":true}'::jsonb, 3),
    ('ops_closure', 'dts_no', 'DTS单号', 'text', FALSE, FALSE, 'none', NULL, NULL, '{"required_if":{"is_quality_issue":["是（已知质量问题）","是（新发现质量问题）"]}}'::jsonb, '{"inherit_previous":true}'::jsonb, 4),
    ('ops_closure', 'rock_version_involved', '磐石版本是否涉及', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_ROCK_VER', '{"required_if":{"is_quality_issue":["是（已知质量问题）","是（新发现质量问题）"]}}'::jsonb, '{"inherit_previous":true}'::jsonb, 5),
    ('ops_closure', 'collaborator', '协同处理人', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_DEV_ANALYSIS_COLLAB', NULL, '{"inherit_previous":true}'::jsonb, 6),
    ('ops_closure', 'workaround', '规避措施/恢复方法', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":true}'::jsonb, 7),
    ('ops_closure', 'root_cause', '问题根因', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":true}'::jsonb, 8),
    ('ops_closure', 'issue_track', '问题进展跟踪', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":true}'::jsonb, 9),
    ('ops_closure', 'dfx_gap', 'DFX能力GAP', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":true}'::jsonb, 10),
    ('ops_closure', 'error_archive_text', '报错信息归档（core、报错、内存堆积上下文文字版）', 'text', FALSE, FALSE, 'none', NULL, NULL, '{"plain_text_only":true}'::jsonb, '{"inherit_previous":false}'::jsonb, 11),

    -- 审核关闭
    ('audit_close', 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_AUDIT_CLOSE_HANDLE_MODE', '{"special":"提交其他审核关闭/返回运维闭环时，仅处理方式和下一步处理人必填"}'::jsonb, '{"inherit_previous":false}'::jsonb, 1),
    ('audit_close', 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_PROBLEM_REVIEW_NEXT_HANDLER', '{"special":"处理方式=问题解决关闭时隐藏"}'::jsonb, '{"inherit_previous":false}'::jsonb, 2),
    ('audit_close', 'warning_needed', '是否需要预警', 'whitelist', TRUE, FALSE, 'none', NULL, 'OS_WARNING_NEEDED', NULL, '{"inherit_previous":true}'::jsonb, 3),
    ('audit_close', 'impact_level', '业务影响程度', 'whitelist', FALSE, FALSE, 'none', NULL, 'OS_IMPACT_LEVEL', '{"required_if":{"warning_needed":"是"}}'::jsonb, '{"inherit_previous":true}'::jsonb, 4),
    ('audit_close', 'dfx_gap', 'DFX能力GAP', 'richtext', TRUE, FALSE, 'none', NULL, NULL, NULL, '{"inherit_previous":true}'::jsonb, 5)
  ) AS t(
    node_key, field_key, field_name, field_type, required, read_only,
    default_type, default_value, option_set_code, constraints_json, ui_props_json, sort_order
  )
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT nm.id, fs.field_key, fs.field_name, fs.field_type, fs.required, fs.read_only,
       fs.default_type, fs.default_value, sm.id, fs.constraints_json, fs.ui_props_json, fs.sort_order
FROM field_seed fs
JOIN node_map nm ON nm.node_key = fs.node_key
LEFT JOIN set_map sm ON sm.set_code = fs.option_set_code
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  read_only = EXCLUDED.read_only,
  default_type = EXCLUDED.default_type,
  default_value = EXCLUDED.default_value,
  option_set_id = EXCLUDED.option_set_id,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

COMMIT;

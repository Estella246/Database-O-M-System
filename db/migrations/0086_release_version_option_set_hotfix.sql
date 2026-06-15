-- 引入/修复版本（OS_RELEASE_VERSION）选项集说明：除基线版本外，亦包含热补丁版本。

UPDATE option_set
SET set_name = '版本（基线+热补丁）',
    source_config = '{"desc":"参数配置-版本模块-基线版本与热补丁版本"}'::jsonb
WHERE set_code = 'OS_RELEASE_VERSION';

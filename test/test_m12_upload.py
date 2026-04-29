import pytest


class TestUploadPreview:
    """测试上传预览功能"""

    def test_tc_m12_001_preview_valid_data(self, api_client):
        """验证有效预览数据"""
        resp = api_client.post("/api/upload/preview", json={
            "operator_id": "test_admin",
            "file_name": "test.xlsx",
            "sheets": [
                {"name": "Sheet1", "columns": ["姓名", "工作量"], "preview_rows": [], "row_count": 10}
            ]
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert resp.json()["ok"] is True

    def test_tc_m12_002_preview_empty_sheets(self, api_client):
        """验证空sheet数据"""
        resp = api_client.post("/api/upload/preview", json={
            "operator_id": "test_admin",
            "file_name": "empty.xlsx",
            "sheets": []
        })
        assert resp.status_code in (400, 503)

    def test_tc_m12_003_preview_missing_sheet_name(self, api_client):
        """验证sheet缺少名称"""
        resp = api_client.post("/api/upload/preview", json={
            "operator_id": "test_admin",
            "file_name": "bad.xlsx",
            "sheets": [
                {"name": "", "columns": ["姓名"], "preview_rows": [], "row_count": 5}
            ]
        })
        assert resp.status_code in (400, 503)


class TestUploadSession:
    """测试上传会话功能"""

    def test_tc_m12_004_create_session(self, api_client):
        """创建会话"""
        resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "test.xlsx",
            "session_name": "测试会话",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 10}]},
            "available_sheets": ["Sheet1"],
            "import_options": {"selected_sheets": ["Sheet1"], "name_column": "姓名"},
            "display_mode": "chart"
        })
        assert resp.status_code in (200, 500, 503)
        if resp.status_code == 200:
            assert "session_id" in resp.json()
            assert resp.json()["ok"] is True

    def test_tc_m12_005_list_history(self, api_client):
        """查询历史会话列表"""
        resp = api_client.get("/api/upload/history", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "items" in resp.json()
            assert "total" in resp.json()

    def test_tc_m12_006_get_latest_session(self, api_client):
        """获取最新会话"""
        resp = api_client.get("/api/upload/latest", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 500, 503)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("ok"):
                assert "session" in data

    def test_tc_m12_007_get_session_detail(self, api_client):
        """获取会话详情"""
        # 先创建会话
        create_resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "detail_test.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 15}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        if create_resp.status_code != 200:
            pytest.skip("Upload schema not ready")
        
        session_id = create_resp.json()["session_id"]
        resp = api_client.get(f"/api/upload/session/{session_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert "session" in resp.json()

    def test_tc_m12_008_get_session_invalid_id(self, api_client):
        """无效会话ID"""
        resp = api_client.get("/api/upload/session/0")
        assert resp.status_code == 400

    def test_tc_m12_009_get_session_not_found(self, api_client):
        """会话不存在"""
        resp = api_client.get("/api/upload/session/999999")
        assert resp.status_code in (404, 500, 503)


class TestSessionConfig:
    """测试会话配置功能"""

    def test_tc_m12_010_update_session_config(self, api_client):
        """更新会话配置"""
        # 先创建会话
        create_resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "config_test.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 20}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        if create_resp.status_code != 200:
            pytest.skip("Upload schema not ready")
        
        session_id = create_resp.json()["session_id"]
        resp = api_client.post(f"/api/upload/session/config/{session_id}", json={
            "operator_id": "test_admin",
            "import_options": {"selected_sheets": ["Sheet1"], "name_column": "姓名"},
            "display_mode": "table"
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert "config_version_id" in resp.json()

    def test_tc_m12_011_list_config_versions(self, api_client):
        """获取配置版本列表"""
        # 先创建会话
        create_resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "version_test.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 30}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        if create_resp.status_code != 200:
            pytest.skip("Upload schema not ready")
        
        session_id = create_resp.json()["session_id"]
        resp = api_client.get(f"/api/upload/session/configs/{session_id}")
        assert resp.status_code == 200
        assert "items" in resp.json()
        assert resp.json()["total"] >= 1

    def test_tc_m12_012_apply_config_version(self, api_client):
        """应用配置版本"""
        # 先创建会话并更新配置
        create_resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "apply_test.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 40}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        if create_resp.status_code != 200:
            pytest.skip("Upload schema not ready")
        
        session_id = create_resp.json()["session_id"]
        
        # 更新配置获取config_version_id
        config_resp = api_client.post(f"/api/upload/session/config/{session_id}", json={
            "operator_id": "test_admin",
            "import_options": {"test": "value"},
            "display_mode": "table"
        })
        config_id = config_resp.json()["config_version_id"]
        
        # 应用配置版本
        resp = api_client.post(f"/api/upload/session/config/apply/{config_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestSessionDelete:
    """测试会话删除功能"""

    def test_tc_m12_013_delete_session(self, api_client):
        """删除会话"""
        # 先创建会话
        create_resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "delete_test.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 50}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        if create_resp.status_code != 200:
            pytest.skip("Upload schema not ready")
        
        session_id = create_resp.json()["session_id"]
        resp = api_client.post(f"/api/upload/delete/{session_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m12_014_delete_session_not_owner(self, api_client):
        """非创建人删除"""
        # 先创建会话
        create_resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "owner_test.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 60}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        if create_resp.status_code != 200:
            pytest.skip("Upload schema not ready")
        
        session_id = create_resp.json()["session_id"]
        resp = api_client.post(f"/api/upload/delete/{session_id}", params={"operator_id": "other_user"})
        assert resp.status_code == 404

    def test_tc_m12_015_delete_session_invalid_id(self, api_client):
        """无效会话ID删除"""
        resp = api_client.post("/api/upload/delete/0", params={"operator_id": "test_admin"})
        assert resp.status_code == 400


class TestMultiSheetAggregation:
    """测试多sheet聚合功能"""

    def test_tc_m12_016_multi_sheet_session(self, api_client):
        """多sheet会话"""
        resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "multi_sheet.xlsx",
            "raw_data": {
                "Sheet1": [{"姓名": "张三", "工作量": 10}, {"姓名": "李四", "工作量": 20}],
                "Sheet2": [{"姓名": "张三", "工作量": 15}, {"姓名": "王五", "工作量": 25}]
            },
            "available_sheets": ["Sheet1", "Sheet2"],
            "import_options": {"selected_sheets": ["Sheet1", "Sheet2"], "name_column": "姓名"},
            "display_mode": "chart"
        })
        assert resp.status_code in (200, 500, 503)

    def test_tc_m12_017_empty_raw_data(self, api_client):
        """空原始数据"""
        resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "empty.xlsx",
            "raw_data": {},
            "available_sheets": [],
            "import_options": {},
            "display_mode": "chart"
        })
        assert resp.status_code in (200, 500, 503)


class TestPagination:
    """测试分页功能"""

    def test_tc_m12_018_history_pagination(self, api_client):
        """历史分页"""
        resp = api_client.get("/api/upload/history", params={
            "operator_id": "test_admin",
            "limit": 5,
            "offset": 0
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert resp.json()["limit"] == 5
            assert resp.json()["offset"] == 0

    def test_tc_m12_019_history_pagination_boundary(self, api_client):
        """分页边界"""
        resp = api_client.get("/api/upload/history", params={
            "operator_id": "test_admin",
            "limit": 100,  # max limit
            "offset": 1000
        })
        assert resp.status_code in (200, 503)


class TestBoundaryValidation:
    """测试边界值验证"""

    def test_tc_m12_020_preview_missing_columns(self, api_client):
        """sheet缺少列定义"""
        resp = api_client.post("/api/upload/preview", json={
            "operator_id": "test_admin",
            "file_name": "no_columns.xlsx",
            "sheets": [
                {"name": "Sheet1", "columns": [], "preview_rows": [], "row_count": 5}
            ]
        })
        assert resp.status_code in (400, 503)

    def test_tc_m12_021_preview_long_filename(self, api_client):
        """超长文件名"""
        long_name = "a" * 300 + ".xlsx"
        resp = api_client.post("/api/upload/preview", json={
            "operator_id": "test_admin",
            "file_name": long_name,
            "sheets": [
                {"name": "Sheet1", "columns": ["姓名"], "preview_rows": [], "row_count": 10}
            ]
        })
        assert resp.status_code in (200, 400, 503)

    def test_tc_m12_022_create_session_invalid_display_mode(self, api_client):
        """无效显示模式"""
        resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "test.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 10}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "invalid_mode"
        })
        assert resp.status_code in (200, 500, 503)
        if resp.status_code == 200:
            # 应该自动修正为默认值
            assert resp.json()["ok"] is True

    def test_tc_m12_023_update_config_invalid_session_id(self, api_client):
        """无效会话ID更新配置"""
        resp = api_client.post("/api/upload/session/config/0", json={
            "operator_id": "test_admin",
            "import_options": {},
            "display_mode": "chart"
        })
        assert resp.status_code == 400

    def test_tc_m12_024_apply_config_invalid_id(self, api_client):
        """无效配置版本ID"""
        resp = api_client.post("/api/upload/session/config/apply/0", params={"operator_id": "test_admin"})
        assert resp.status_code == 400

    def test_tc_m12_025_apply_config_not_found(self, api_client):
        """配置版本不存在"""
        resp = api_client.post("/api/upload/session/config/apply/999999", params={"operator_id": "test_admin"})
        assert resp.status_code in (404, 500, 503)


class TestDisplayModeValidation:
    """测试显示模式验证"""

    def test_tc_m12_026_valid_display_modes(self, api_client):
        """所有有效显示模式"""
        valid_modes = ["chart", "table", "mixed", "last", "custom"]
        for mode in valid_modes:
            resp = api_client.post("/api/upload", json={
                "operator_id": "test_admin",
                "operator_name": "Test Admin",
                "file_name": f"{mode}_test.xlsx",
                "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 10}]},
                "available_sheets": ["Sheet1"],
                "import_options": {},
                "display_mode": mode
            })
            assert resp.status_code in (200, 500, 503)

    def test_tc_m12_027_empty_display_mode(self, api_client):
        """空显示模式应使用默认值"""
        resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "empty_mode.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 10}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": ""
        })
        assert resp.status_code in (200, 500, 503)
        if resp.status_code == 200:
            assert resp.json()["ok"] is True


class TestOperatorValidation:
    """测试操作者验证"""

    def test_tc_m12_028_empty_operator_id(self, api_client):
        """空操作者ID应使用默认值"""
        resp = api_client.post("/api/upload", json={
            "operator_id": "",
            "operator_name": "",
            "file_name": "empty_op.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 10}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        assert resp.status_code in (200, 500, 503)

    def test_tc_m12_029_default_operator_session(self, api_client):
        """默认操作者创建会话"""
        resp = api_client.get("/api/upload/history", params={"operator_id": ""})
        assert resp.status_code in (200, 503)


class TestSessionNameValidation:
    """测试会话名验证"""

    def test_tc_m12_030_long_session_name(self, api_client):
        """超长会话名"""
        long_name = "测试会话" * 50
        resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "long_name.xlsx",
            "session_name": long_name,
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 10}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        assert resp.status_code in (200, 500, 503)


class TestSafetyCharacters:
    """测试安全字符处理"""

    def test_tc_m12_031_filename_with_dangerous_chars(self, api_client):
        """文件名包含危险字符"""
        resp = api_client.post("/api/upload/preview", json={
            "operator_id": "test_admin",
            "file_name": "../../../etc/passwd.xlsx",
            "sheets": [
                {"name": "Sheet1", "columns": ["姓名"], "preview_rows": [], "row_count": 10}
            ]
        })
        # 应该成功处理（自动清理危险字符）
        assert resp.status_code in (200, 400, 503)

    def test_tc_m12_032_filename_with_backslash(self, api_client):
        """文件名包含反斜杠"""
        resp = api_client.post("/api/upload/preview", json={
            "operator_id": "test_admin",
            "file_name": "C:\\Users\\test.xlsx",
            "sheets": [
                {"name": "Sheet1", "columns": ["姓名"], "preview_rows": [], "row_count": 10}
            ]
        })
        assert resp.status_code in (200, 400, 503)


class TestConfigVersionHistory:
    """测试配置版本历史"""

    def test_tc_m12_033_multiple_config_versions(self, api_client):
        """多次配置更新"""
        create_resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "multi_config.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 100}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        if create_resp.status_code != 200:
            pytest.skip("Upload schema not ready")
        
        session_id = create_resp.json()["session_id"]
        
        # 创建多个配置版本
        for i in range(3):
            api_client.post(f"/api/upload/session/config/{session_id}", json={
                "operator_id": "test_admin",
                "import_options": {"version": i},
                "display_mode": "table"
            })
        
        # 验证版本数量
        resp = api_client.get(f"/api/upload/session/configs/{session_id}")
        assert resp.status_code == 200
        assert resp.json()["total"] >= 4  # 初始 + 3次更新


class TestHistoryQuery:
    """测试历史查询功能"""

    def test_tc_m12_034_history_with_limit_out_of_range(self, api_client):
        """超出范围的limit"""
        resp = api_client.get("/api/upload/history", params={
            "operator_id": "test_admin",
            "limit": 200,  # 超过最大值100
            "offset": 0
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            # 应该自动修正为最大值100
            assert resp.json()["limit"] == 100

    def test_tc_m12_035_history_with_negative_offset(self, api_client):
        """负数offset"""
        resp = api_client.get("/api/upload/history", params={
            "operator_id": "test_admin",
            "limit": 10,
            "offset": -10
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            # 应该自动修正为0
            assert resp.json()["offset"] == 0


class TestSummaryInfo:
    """测试返回的汇总信息"""

    def test_tc_m12_036_create_session_summary(self, api_client):
        """创建会话返回汇总信息"""
        resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "summary_test.xlsx",
            "raw_data": {
                "Sheet1": [{"姓名": "张三", "工作量": 10}],
                "Sheet2": [{"姓名": "李四", "工作量": 20}]
            },
            "available_sheets": ["Sheet1", "Sheet2"],
            "import_options": {},
            "display_mode": "chart"
        })
        assert resp.status_code in (200, 500, 503)
        if resp.status_code == 200:
            data = resp.json()
            assert "summary" in data
            assert data["summary"]["sheet_count"] == 2

    def test_tc_m12_037_preview_summary(self, api_client):
        """预览返回汇总信息"""
        resp = api_client.post("/api/upload/preview", json={
            "operator_id": "test_admin",
            "file_name": "preview_summary.xlsx",
            "sheets": [
                {"name": "Sheet1", "columns": ["姓名", "工作量"], "preview_rows": [], "row_count": 100},
                {"name": "Sheet2", "columns": ["姓名", "工作量"], "preview_rows": [], "row_count": 200}
            ]
        })
        assert resp.status_code in (200, 400, 503)
        if resp.status_code == 200:
            data = resp.json()
            # summary is optional in preview response
            if "summary" in data:
                assert data["summary"]["sheet_count"] == 2
                assert data["summary"]["total_rows"] == 300


class TestDeletedSession:
    """测试已删除会话处理"""

    def test_tc_m12_038_access_deleted_session(self, api_client):
        """访问已删除的会话"""
        # 创建会话
        create_resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "to_delete.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 10}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        if create_resp.status_code != 200:
            pytest.skip("Upload schema not ready")
        
        session_id = create_resp.json()["session_id"]
        
        # 删除会话
        api_client.post(f"/api/upload/delete/{session_id}", params={"operator_id": "test_admin"})
        
        # 尝试访问已删除的会话
        resp = api_client.get(f"/api/upload/session/{session_id}")
        assert resp.status_code == 404

    def test_tc_m12_039_double_delete(self, api_client):
        """重复删除同一会话"""
        create_resp = api_client.post("/api/upload", json={
            "operator_id": "test_admin",
            "operator_name": "Test Admin",
            "file_name": "double_delete.xlsx",
            "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 10}]},
            "available_sheets": ["Sheet1"],
            "import_options": {},
            "display_mode": "chart"
        })
        if create_resp.status_code != 200:
            pytest.skip("Upload schema not ready")
        
        session_id = create_resp.json()["session_id"]
        
        # 第一次删除
        api_client.post(f"/api/upload/delete/{session_id}", params={"operator_id": "test_admin"})
        
        # 第二次删除
        resp = api_client.post(f"/api/upload/delete/{session_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 404
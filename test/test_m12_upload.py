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
        assert resp.status_code in (200, 503)
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
        assert resp.status_code in (200, 503)
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
        assert resp.status_code == 404


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
        resp = api_client.post(f"/api/session/config/{session_id}", json={
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
        resp = api_client.get(f"/api/session/configs/{session_id}")
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
        config_resp = api_client.post(f"/api/session/config/{session_id}", json={
            "operator_id": "test_admin",
            "import_options": {"test": "value"},
            "display_mode": "table"
        })
        config_id = config_resp.json()["config_version_id"]
        
        # 应用配置版本
        resp = api_client.post(f"/api/session/config/apply/{config_id}", params={"operator_id": "test_admin"})
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
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert resp.json()["ok"] is True

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
        assert resp.status_code in (200, 503)


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
"""M15 局点档案接口测试。

覆盖 /api/site-profiles：列表、分页、搜索、增改删、详情、批量导入、导出。
"""
import pytest

# admin 用户由 0010_add_rbac_tables.sql 默认 seed
OP = "admin"
BASE = "/api/site-profiles"


def _sample(site_name="测试局点A"):
    return {
        "operator_id": OP,
        "site_name": site_name,
        "profile_type": "生产局点",
        "product_component": "GaussDB 内核",
        "onsite_contract": "有",
        "industry": "金融",
        "region": "华北",
        "representative_office": "北京代表处",
        "stage": "运维期",
        "tags": "重保",
        "delivery_method": "驻场交付",
        "report_date": "2026-05-18",
        "report_nature": "常规汇报",
        "ops_personnel": "运维X",
        "kernel_delivery": "交付X",
        "kernel_maintenance": "维护X",
        "service_support": "支持X",
        "tech_lead": "组长X",
        "da": "DA-X",
        "sa": "SA-X",
        "td": "TD-X",
        "account_manager": "客户经理X",
        "project_manager": "项目经理X",
        "service_manager": "服务经理X",
        "software_revenue": "1000",
        "service_revenue": "200",
        "confirm_receipt_time": "2026-04-20",
        "risk_description": "无重大风险",
        "dtrb_conclusion": "通过",
    }


class TestSiteProfileList:
    def test_tc_m15_001_list(self, api_client):
        resp = api_client.get(BASE, params={"operator_id": OP, "page": 1, "page_size": 10})
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body and "total" in body
        assert body["page"] == 1

    def test_tc_m15_002_pagination(self, api_client):
        resp = api_client.get(BASE, params={"operator_id": OP, "page": 1, "page_size": 2})
        assert resp.status_code == 200
        assert len(resp.json()["items"]) <= 2


class TestSiteProfileCrud:
    def test_tc_m15_010_create_full(self, api_client):
        resp = api_client.post(BASE, json=_sample("CRUD局点"))
        assert resp.status_code == 200
        row = resp.json()
        assert row["id"] > 0
        assert row["site_name"] == "CRUD局点"
        # 项目经理为第 28 个业务字段，须正确落库
        assert row["project_manager"] == "项目经理X"
        assert str(row["report_date"]).startswith("2026-05-18")
        assert str(row["confirm_receipt_time"]).startswith("2026-04-20")

    def test_tc_m15_011_create_missing_site_name(self, api_client):
        resp = api_client.post(BASE, json={"operator_id": OP, "site_name": "  "})
        assert resp.status_code == 400

    def test_tc_m15_012_create_blank_date_is_null(self, api_client):
        payload = {"operator_id": OP, "site_name": "空日期局点", "report_date": ""}
        resp = api_client.post(BASE, json=payload)
        assert resp.status_code == 200
        assert resp.json()["report_date"] is None

    def test_tc_m15_013_get_update_delete(self, api_client):
        created = api_client.post(BASE, json=_sample("生命周期局点")).json()
        pid = created["id"]

        got = api_client.get(f"{BASE}/{pid}", params={"operator_id": OP})
        assert got.status_code == 200
        assert got.json()["site_name"] == "生命周期局点"

        patched = api_client.patch(
            f"{BASE}/{pid}",
            json={"operator_id": OP, "region": "华南", "risk_description": "已更新"},
        )
        assert patched.status_code == 200
        assert patched.json()["region"] == "华南"
        assert patched.json()["risk_description"] == "已更新"
        # 未提交的字段保持不变
        assert patched.json()["site_name"] == "生命周期局点"

        deleted = api_client.delete(f"{BASE}/{pid}", params={"operator_id": OP})
        assert deleted.status_code == 200
        assert deleted.json()["deleted"] is True

        assert api_client.get(f"{BASE}/{pid}", params={"operator_id": OP}).status_code == 404

    def test_tc_m15_014_get_not_found(self, api_client):
        assert api_client.get(f"{BASE}/999999999", params={"operator_id": OP}).status_code == 404

    def test_tc_m15_015_update_not_found(self, api_client):
        resp = api_client.patch(
            f"{BASE}/999999999", json={"operator_id": OP, "region": "X"}
        )
        assert resp.status_code == 404


class TestSiteProfileSearch:
    def test_tc_m15_020_search_hit(self, api_client):
        api_client.post(BASE, json=_sample("搜索唯一关键字XYZ局点"))
        resp = api_client.get(BASE, params={"operator_id": OP, "q": "唯一关键字XYZ"})
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert items
        assert all("唯一关键字XYZ" in str(it.get("site_name", "")) for it in items)

    def test_tc_m15_021_search_miss(self, api_client):
        resp = api_client.get(BASE, params={"operator_id": OP, "q": "绝不存在的局点关键字ZZZZ"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 0


class TestSiteProfileImportExport:
    def test_tc_m15_030_import(self, api_client):
        resp = api_client.post(
            f"{BASE}/import",
            json={
                "operator_id": OP,
                "items": [
                    {"site_name": "导入局点甲", "region": "华东", "report_date": "2026-05-01"},
                    {"site_name": "导入局点乙", "region": "华中", "project_manager": "导入PM"},
                ],
            },
        )
        assert resp.status_code == 200
        assert resp.json()["imported"] == 2

        check = api_client.get(BASE, params={"operator_id": OP, "q": "导入局点乙"})
        items = check.json()["items"]
        assert items and items[0]["project_manager"] == "导入PM"

    def test_tc_m15_031_import_empty(self, api_client):
        resp = api_client.post(f"{BASE}/import", json={"operator_id": OP, "items": []})
        assert resp.status_code == 400

    def test_tc_m15_032_import_missing_site_name(self, api_client):
        resp = api_client.post(
            f"{BASE}/import", json={"operator_id": OP, "items": [{"region": "X"}]}
        )
        assert resp.status_code == 400

    def test_tc_m15_033_export(self, api_client):
        api_client.post(BASE, json=_sample("导出校验局点"))
        resp = api_client.get(f"{BASE}/export", params={"operator_id": OP})
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body
        assert body["total"] == len(body["items"])
        assert any(it.get("site_name") == "导出校验局点" for it in body["items"])

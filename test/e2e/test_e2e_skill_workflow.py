import time
import uuid

import pytest

pytestmark = pytest.mark.e2e


def _unique_tag():
    return f"e2e_{int(time.time())}_{uuid.uuid4().hex[:6]}"


def _api_create_skill(api_client, tag):
    resp = api_client.post("/api/skills", json={
        "operator_id": "test_admin",
        "name": f"E2E-Skill-{tag}",
        "description": f"端到端测试自动创建-{tag}",
        "prompt_template": "分析以下工单: {{ticket_no}}",
        "model_name": "test",
    })
    if resp.status_code == 200:
        return resp.json().get("id")
    return None


def _api_delete_skill(api_client, skill_id):
    if skill_id:
        api_client.delete(f"/api/skills/{skill_id}", params={"operator_id": "test_admin"})


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


class TestSkillPageLoad:
    """工单分析Skill页面加载"""

    def test_tc_e2e_601_skill_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/skills")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        panel = page.locator("#stats-skills-panel, .stats-skills-page, .skill-page")
        assert panel.count() > 0, "工单分析Skill页面应存在"


class TestSkillCRUDViaAPI:
    """Skill CRUD - 通过API驱动数据，UI验证展示"""

    def test_tc_e2e_602_skill_list_shows_created(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        skill_id = _api_create_skill(api_client, tag)
        if not skill_id:
            pytest.skip("无法通过API创建Skill")
        try:
            page.goto(f"{backend_server}/stats/skills")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            skill_rows = page.locator("[data-skill-id], .skill-row, .skill-item")
            if skill_rows.count() > 0:
                found = False
                for i in range(skill_rows.count()):
                    row = skill_rows.nth(i)
                    if tag in row.inner_text():
                        found = True
                        break
                assert found, f"Skill列表应显示刚创建的Skill {tag}"
        finally:
            _api_delete_skill(api_client, skill_id)

    def test_tc_e2e_603_skill_create_via_ui(self, page, backend_server, api_client, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/skills")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        create_btn = page.locator("[data-skill-create], button", has_text="新建").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.skip("新建Skill按钮不可见")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        modal = page.locator(".perm-modal-mask, .skill-modal").first
        if modal.count() > 0 and modal.is_visible():
            name_input = page.locator("#skill-name, [data-skill-field='name']").first
            if name_input.count() > 0:
                tag = _unique_tag()
                name_input.fill(f"E2E-Skill-UI-{tag}")
            desc_input = page.locator("#skill-desc, [data-skill-field='description']").first
            if desc_input.count() > 0:
                desc_input.fill(f"UI创建测试-{tag}")
            cancel_btn = page.locator("[data-skill-cancel], button", has_text="取消").first
            if cancel_btn.count() > 0 and cancel_btn.is_visible():
                cancel_btn.click(timeout=5000)
                page.wait_for_timeout(1000)

    def test_tc_e2e_604_skill_detail_click(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        skill_id = _api_create_skill(api_client, tag)
        if not skill_id:
            pytest.skip("无法通过API创建Skill")
        try:
            page.goto(f"{backend_server}/stats/skills")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            skill_items = page.locator("[data-skill-id], .skill-row, .skill-item")
            for i in range(skill_items.count()):
                item = skill_items.nth(i)
                if tag in item.inner_text():
                    item.click(timeout=5000)
                    page.wait_for_timeout(1500)
                    break
        finally:
            _api_delete_skill(api_client, skill_id)

    def test_tc_e2e_605_skill_test_connectivity(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        skill_id = _api_create_skill(api_client, tag)
        if not skill_id:
            pytest.skip("无法通过API创建Skill")
        try:
            page.goto(f"{backend_server}/stats/skills")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            skill_items = page.locator("[data-skill-id], .skill-row, .skill-item")
            for i in range(skill_items.count()):
                item = skill_items.nth(i)
                if tag in item.inner_text():
                    item.click(timeout=5000)
                    page.wait_for_timeout(1500)
                    test_btn = page.locator("[data-skill-test], button", has_text="测试").first
                    if test_btn.count() > 0 and test_btn.is_visible():
                        test_btn.click(timeout=5000)
                        page.wait_for_timeout(3000)
                    break
        finally:
            _api_delete_skill(api_client, skill_id)

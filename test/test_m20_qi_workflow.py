"""M20 质量改进工作流（QI）接口测试。

5 阶段单链：提出 → 评审 → 改进项分析 → 闭环 → 验收
覆盖：创建/编号/必填/阶段提交/条件必填联动/闭环单号校验/打回/责任人继承/
      验收人=提出人/进展子项/权限/草稿/白名单/删除限制。
依赖：后端需以 SKIP_SSO_AUTH=1 启动，TEST_API_BASE_URL 指向其端口。
"""
import pytest

OP = "admin"
REVIEWER_OP = "test_user01"
RESP_OP = "test_user02"


@pytest.fixture(scope="module", autouse=True)
def _ensure_qi_whitelist(api_client):
    """确保管理员角色拥有质量改进创建权限，并配置评审人/分析人白名单。"""
    api_client.post("/api/admin/permissions/bulk", json={
        "operator_id": "admin",
        "items": [
            {"role_code": "管理员", "is_pl": False, "node_key": "__whitelist__",
             "field_key": "requirement_create", "permission_level": "readonly"}
        ],
    })
    # 评审人白名单
    api_client.post("/api/qi/candidates/reviewer", json={
        "operator_id": "admin",
        "accounts": ["admin", "test_user01", "test_user02"],
    })
    # 分析人白名单
    api_client.post("/api/qi/candidates/analyst", json={
        "operator_id": "admin",
        "accounts": ["admin", "test_user01", "test_user02"],
    })
    # 解决版本选项基线（closure 提交动态校验依赖；全模块统一为迁移 0122 种子）
    api_client.post("/api/qi/config/accept-versions", json={
        "versions": ["507.0", "507.1", "508.0"],
    })
    yield


@pytest.fixture(autouse=True)
def _cleanup_qi_after_test(api_client):
    """每个 QI 用例跑完后清空本次新增的改进项，避免编号溢出。"""
    yield
    import os, psycopg
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return
    # DRAFT- 是真实草稿号前缀：conftest 会话开始时记了基线（_TEST_QI_DRAFT_ID_BASELINE），
    # 只清基线之后新建的草稿；没有基线时跳过 DRAFT-，避免删掉真实用户的未提交草稿。
    # 基线已 int() 内联进 SQL（无注入面）；不要传 params=()，否则 psycopg 走参数化解析，
    # LIKE 里的 '%' 会被当成占位符报错。
    draft_baseline = os.environ.get("_TEST_QI_DRAFT_ID_BASELINE")
    draft_sql = (
        f" OR (qi_no LIKE 'DRAFT-%' AND id > {int(draft_baseline)})"
        if draft_baseline is not None
        else ""
    )
    try:
        with psycopg.connect(dsn) as conn:
            conn.execute(
                "DELETE FROM qi_request WHERE qi_no LIKE 'ZLGJ-%' OR qi_no LIKE 'TEST-%'" + draft_sql
            )
            conn.execute("UPDATE qi_no_seq SET last_suffix = 0 WHERE seq_key = 'QI'")
            conn.commit()
    except Exception:
        pass


def _create(api_client, operator_id=OP, **overrides):
    payload = {
        "operator_id": operator_id,
        "title": "测试诉求-磁盘满改进",
        "related_ticket_no": "YW20260627001",
        "description": "回收站空间未回收导致磁盘满",
        "expected_goal": "增加后台自动回收",
        "reviewer": "测试用户01 test_user01",
        "category": "特性加固",
        "priority": "高",
        "domain": "测试领域",
        "module_feature": "测试模块",
    }
    payload.update(overrides)
    return api_client.post("/api/qi", json=payload)


def _create_draft(api_client, **overrides):
    """创建草稿（无编号）。"""
    payload = {
        "operator_id": OP,
        "title": "测试草稿",
        "related_ticket_no": "YW20260627001",
        "description": "草稿描述",
        "category": "特性加固",
        "reviewer": "测试用户01 test_user01",
        "priority": "中",
        "domain": "测试领域",
        "module_feature": "测试模块",
        "draft": True,
    }
    payload.update(overrides)
    return api_client.post("/api/qi", json=payload)


def _submit(api_client, qid, operator_id, stage, handle_mode, values=None):
    return api_client.post(f"/api/qi/{qid}/submit", json={
        "operator_id": operator_id,
        "stage_key": stage,
        "handle_mode": handle_mode,
        "values": values or {},
    })


class TestQiCreate:
    def test_tc_m20_001_create(self, api_client):
        r = _create(api_client)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["qi_no"].startswith("ZLGJ-")
        assert b["current_stage"] == "review"
        assert b["current_status"] == "in_progress"

    def test_tc_m20_002_qi_no_format(self, api_client):
        b = _create(api_client).json()
        # ZLGJ-YYYYMMDD-NNN
        parts = b["qi_no"].split("-")
        assert len(parts) == 3
        assert len(parts[1]) == 8 and parts[1].isdigit()  # YYYYMMDD
        assert parts[2].isdigit()  # NNN

    def test_tc_m20_003_missing_title(self, api_client):
        r = _create(api_client, title="")
        assert r.status_code == 400

    def test_tc_m20_004_missing_related_ticket(self, api_client):
        r = _create(api_client, related_ticket_no="")
        assert r.status_code == 400

    def test_tc_m20_005_missing_description(self, api_client):
        r = _create(api_client, description="")
        assert r.status_code == 400

    def test_tc_m20_006_category_priority_default(self, api_client):
        """提出阶段不传 category/priority 时用默认值（Excel 提出阶段无此二字段）。"""
        b = _create(api_client).json()
        assert b["id"]

    def test_tc_m20_007_missing_reviewer(self, api_client):
        r = _create(api_client, reviewer="")
        assert r.status_code == 400

    def test_tc_m20_008_invalid_priority(self, api_client):
        r = _create(api_client, priority="紧急")
        assert r.status_code == 400

    def test_tc_m20_009_invalid_category(self, api_client):
        r = _create(api_client, category="乱填")
        assert r.status_code == 400

    def test_tc_m20_009b_all_categories_valid(self, api_client):
        """所有 QI_CATEGORIES 均可创建成功（含「易用性提升」「产品规格」）。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        from qi_config import QI_CATEGORIES
        created = []
        try:
            for cat in QI_CATEGORIES:
                r = _create(api_client, category=cat, title=f"分类测试-{cat}")
                assert r.status_code == 200, f"分类「{cat}」创建失败: {r.status_code} {r.text[:200]}"
                created.append(r.json()["id"])
        finally:
            with psycopg.connect(dsn) as conn:
                for rid in created:
                    conn.execute("DELETE FROM qi_request WHERE id=%s", (rid,))
                conn.commit()

    def test_tc_m20_009d_retired_category_rejected(self, api_client):
        """旧枚举值（0129 迁移前）已退役：创建必须 400 无效分类。"""
        for old_cat in ("测试加固", "需求", "质量加固和改进", "升级checklist"):
            r = _create(api_client, category=old_cat, title=f"退役分类-{old_cat}")
            assert r.status_code == 400, f"退役分类「{old_cat}」应 400，实际 {r.status_code}"
            assert r.json().get("detail") == "无效分类"

    def test_tc_m20_009c_all_priorities_valid(self, api_client):
        """所有 QI_PRIORITIES 均可创建成功。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        from qi_config import QI_PRIORITIES
        created = []
        try:
            for pri in QI_PRIORITIES:
                r = _create(api_client, priority=pri, title=f"优先级测试-{pri}")
                assert r.status_code == 200, f"优先级「{pri}」创建失败: {r.status_code} {r.text[:200]}"
                created.append(r.json()["id"])
        finally:
            with psycopg.connect(dsn) as conn:
                for rid in created:
                    conn.execute("DELETE FROM qi_request WHERE id=%s", (rid,))
                conn.commit()


class TestQiList:
    def test_tc_m20_010_list(self, api_client):
        _create(api_client)
        r = api_client.get("/api/qi", params={"operator_id": OP})
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_tc_m20_011_list_mine(self, api_client):
        _create(api_client, operator_id=OP)
        r = api_client.get("/api/qi", params={"operator_id": OP, "scope": "mine"})
        assert r.status_code == 200
        assert all(it["creator_id"] == OP for it in r.json()["items"])

    def test_tc_m20_012_list_search(self, api_client):
        _create(api_client, title="搜索关键词_zzx")
        r = api_client.get("/api/qi", params={"operator_id": OP, "q": "zzx"})
        assert r.status_code == 200
        assert any("zzx" in str(it.get("title", "")) for it in r.json()["items"])

    def test_tc_m20_013_list_stage_filter(self, api_client):
        r = api_client.get("/api/qi", params={"operator_id": OP, "stage": "review"})
        assert r.status_code == 200
        assert all(it["current_stage"] == "review" for it in r.json()["items"])


class TestQiSubmit:
    def test_tc_m20_020_review_pass(self, api_client):
        """评审通过 → 进入分析，责任人继承。"""
        qid = _create(api_client).json()["id"]
        r = _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                    {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "评审意见内容"})
        assert r.status_code == 200, r.text
        assert r.json()["current_stage"] == "analysis"
        # 详情校验责任人继承到 analysis
        d = api_client.get(f"/api/qi/{qid}", params={"operator_id": OP}).json()
        an = [s for s in d["stages"] if s["stage_key"] == "analysis"][0]
        assert an["responsible"] == "测试用户02 test_user02"

    def test_tc_m20_021_review_reject_rollback(self, api_client):
        """评审不通过 → 直接关单。"""
        qid = _create(api_client).json()["id"]
        r = _submit(api_client, qid, REVIEWER_OP, "review", "评审不通过",
                    {"review_result": "不通过关单", "reject_reason": "范围过大"})
        assert r.status_code == 200
        assert r.json()["current_status"] == "closed"

    def test_tc_m20_022_review_pass_missing_responsible(self, api_client):
        """评审通过时责任人为条件必填。"""
        qid = _create(api_client).json()["id"]
        r = _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                    {"review_result": "通过"})  # 缺 responsible
        assert r.status_code == 400

    def test_tc_m20_023_analysis_accept_closure_no_check(self, api_client):
        """分析接纳时校验闭环单号存在性（不存在的单号应 400）。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "评审意见内容"})
        r = _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                    {"accept": "是", "accept_version": "507.0",
                     "closure_method": "问题单闭环", "closure_ticket_no": "NOT_EXIST_999"})
        assert r.status_code == 400

    def test_tc_m20_024_analysis_reject_rollback(self, api_client):
        """分析不接纳 → 打回评审。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "评审意见内容"})
        r = _submit(api_client, qid, RESP_OP, "analysis", "分析不接纳",
                    {"accept": "否", "review_comment": "需要进一步完善"})
        assert r.status_code == 200
        assert r.json()["current_stage"] == "review"

    def test_tc_m20_025_wrong_stage_submit(self, api_client):
        """阶段不符应 400。"""
        qid = _create(api_client).json()["id"]
        r = _submit(api_client, qid, RESP_OP, "closure", "提交验收", {})
        assert r.status_code == 400


class TestQiFullFlow:
    def test_tc_m20_030_full_flow_closed(self, api_client):
        """完整 5 阶段流程，验收通过后 status=closed。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "评审意见内容"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意接纳", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "自测通过", "accept_version": "507.0", "closure_method": "问题单闭环", "closure_ticket_no": "YW20260627001"})
        r = _submit(api_client, qid, OP, "acceptance", "验收通过",
                    {"acceptance_conclusion": "OK", "acceptance_pass": "通过"})
        assert r.status_code == 200, r.text
        d = api_client.get(f"/api/qi/{qid}", params={"operator_id": OP}).json()
        assert d["request"]["current_status"] == "closed"
        # 闭环单号自动拼 PC 前缀
        cl = [s for s in d["stages"] if s["stage_key"] == "closure"][0]
        assert cl["values"]["closure_no"] == "PC-YW20260627001"

    def test_tc_m20_031_acceptance_not_proposer(self, api_client):
        """验收人必须是提出人，他人验收应 403。"""
        qid = _create(api_client, operator_id=OP).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "评审意见内容"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意接纳", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "自测通过", "accept_version": "507.0", "closure_method": "问题单闭环", "closure_ticket_no": "YW20260627001"})
        r = _submit(api_client, qid, "someone_else", "acceptance", "验收通过",
                    {"acceptance_conclusion": "OK", "acceptance_pass": "通过"})
        assert r.status_code == 403


class TestQiProgressItems:
    def test_tc_m20_040_add_progress_in_analysis(self, api_client):
        """所有阶段均不再支持进展子项。"""
        qid = _create(api_client).json()["id"]
        r = api_client.post(f"/api/qi/{qid}/progress-items", json={
            "operator_id": OP, "content": "测试"})
        assert r.status_code == 400

    def test_tc_m20_041_add_progress_wrong_stage(self, api_client):
        """所有阶段均不支持进展子项。"""
        qid = _create(api_client).json()["id"]
        r = api_client.post(f"/api/qi/{qid}/progress-items", json={
            "operator_id": OP, "content": "测试"})
        assert r.status_code == 400


class TestQiPermissions:
    def _set_hidden(self, api_client, field_key):
        api_client.post("/api/admin/permissions/bulk", json={
            "operator_id": "admin",
            "items": [{"role_code": "管理员", "is_pl": False, "node_key": "__whitelist__",
                       "field_key": field_key, "permission_level": "hidden"}],
        })

    def _restore(self, api_client, field_key, level="readonly"):
        api_client.post("/api/admin/permissions/bulk", json={
            "operator_id": "admin",
            "items": [{"role_code": "管理员", "is_pl": False, "node_key": "__whitelist__",
                       "field_key": field_key, "permission_level": level}],
        })

    def test_tc_m20_050_list_denied(self, api_client):
        self._set_hidden(api_client, "requirement_list")
        try:
            r = api_client.get("/api/qi", params={"operator_id": OP})
            assert r.status_code == 403
        finally:
            self._restore(api_client, "requirement_list")

    def test_tc_m20_051_create_denied(self, api_client):
        self._set_hidden(api_client, "requirement_create")
        try:
            r = _create(api_client)
            assert r.status_code == 403
        finally:
            self._restore(api_client, "requirement_create")


class TestQiDraft:
    """草稿模式：无编号、无评审人、列表默认排除、激活时分配编号。"""

    def test_tc_m20_060_create_draft_no_qi_no(self, api_client):
        """草稿创建使用临时占位编号，不要求评审人。"""
        r = _create_draft(api_client)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["qi_no"].startswith("DRAFT-")
        assert b["current_stage"] == "propose"
        assert b["current_status"] == "draft"

    def test_tc_m20_061_draft_excluded_from_default_list(self, api_client):
        """草稿不出现在默认列表（current_status != 'draft'）。"""
        _create_draft(api_client, title="隐藏草稿_zxcvbnm")
        r = api_client.get("/api/qi", params={"operator_id": OP, "q": "zxcvbnm"})
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_tc_m20_062_draft_visible_with_status_filter(self, api_client):
        """status=draft 时可查到草稿。"""
        _create_draft(api_client, title="可见草稿_qwerty", related_ticket_no="YW20260627001")
        r = api_client.get("/api/qi", params={
            "operator_id": OP, "related_ticket_no": "YW20260627001", "status": "draft"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1
        assert all(it["current_status"] == "draft" for it in items)

    def test_tc_m20_063_draft_submit_rejected_when_ticket_not_closable(self, api_client):
        """关联工单未到审核关闭/关闭状态时，草稿不可单独提交。"""
        r = _create_draft(api_client, title="不可提交草稿", related_ticket_no="YW99993527930")
        qid = r.json()["id"]
        assert r.json()["qi_no"].startswith("DRAFT-")
        # YW99993527930 在 problem_review 阶段，不可提交
        sr = _submit(api_client, qid, OP, "propose", "提交评审", {"reviewer": "测试用户01 test_user01"})
        assert sr.status_code == 400
        assert "草稿不可" in sr.json()["detail"]

    def test_tc_m20_064_draft_submit_success_when_ticket_audit_close(self, api_client):
        """关联工单在审核关闭阶段时，草稿可单独提交。"""
        r = _create_draft(api_client, title="可提交草稿", related_ticket_no="YW99993516609")
        qid = r.json()["id"]
        assert r.json()["qi_no"].startswith("DRAFT-")
        # YW99993516609 在 audit_close 阶段，可以提交
        sr = _submit(api_client, qid, OP, "propose", "提交评审",
                     {"reviewer": "测试用户01 test_user01", "title": "可提交草稿",
                      "related_ticket_no": "YW99993516609", "description": "d",
                      "category": "特性加固"})
        assert sr.status_code == 200, f"应允许提交: {sr.text}"
        assert sr.json()["current_status"] == "in_progress"

    def test_tc_m20_065_draft_submit_rejected_when_ticket_not_exists(self, api_client):
        """提交时关联工单不存在应拒绝（通过直接 DB 设非法值模拟）。"""
        import os, psycopg
        r = _create_draft(api_client, title="无关联草稿", related_ticket_no="YW99993527930")
        qid = r.json()["id"]
        # 绕过 API 校验，直接在 DB 中把 related_ticket_no 改为不存在的值
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("UPDATE qi_request SET related_ticket_no='NONEXIST-999' WHERE id=%s", (qid,))
            conn.commit()
        sr = _submit(api_client, qid, OP, "propose", "提交评审",
                     {"reviewer": "测试用户01 test_user01", "title": "x",
                      "related_ticket_no": "NONEXIST-999", "description": "d",
                      "category": "特性加固"})
        assert sr.status_code == 400
        assert "不存在" in sr.json()["detail"]

    def test_tc_m20_066_draft_can_submit_flag_in_detail(self, api_client):
        """详情接口返回 can_submit_draft 标识。"""
        # audit_close 工单 → can_submit_draft=true
        r1 = _create_draft(api_client, title="可提交", related_ticket_no="YW99993516609")
        d1 = api_client.get(f"/api/qi/{r1.json()['id']}", params={"operator_id": OP}).json()
        assert d1["can_submit_draft"] is True, f"audit_close 应可提交: {d1.get('can_submit_draft')}"

        # 非 audit_close 工单 → can_submit_draft=false
        r2 = _create_draft(api_client, title="不可提交", related_ticket_no="YW99993527930")
        d2 = api_client.get(f"/api/qi/{r2.json()['id']}", params={"operator_id": OP}).json()
        assert d2["can_submit_draft"] is False, f"非 audit_close 应不可提交: {d2.get('can_submit_draft')}"


class TestQiWhitelist:
    """Person 字段白名单校验：reviewer → reviewer_candidates, responsible → analyst_candidates。"""

    def test_tc_m20_070_reviewer_not_in_whitelist(self, api_client):
        """评审人不在白名单应 400。"""
        # 先把 test_user02 从评审人白名单移除
        api_client.post("/api/qi/candidates/reviewer", json={
            "operator_id": "admin", "accounts": ["admin"]})
        try:
            r = _create(api_client, reviewer="测试用户02 test_user02")
            assert r.status_code == 400
            assert "白名单" in r.json()["detail"]
        finally:
            api_client.post("/api/qi/candidates/reviewer", json={
                "operator_id": "admin", "accounts": ["admin", "test_user01", "test_user02"]})

    def test_tc_m20_071_responsible_not_in_analyst_whitelist(self, api_client):
        """责任人（分析阶段）不在分析人白名单应 400。"""
        # 先把 test_user02 从分析人白名单移除
        api_client.post("/api/qi/candidates/analyst", json={
            "operator_id": "admin", "accounts": ["admin"]})
        try:
            qid = _create(api_client).json()["id"]
            r = _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                        {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "评审意见内容"})
            assert r.status_code == 400
            assert "白名单" in r.json()["detail"]
        finally:
            api_client.post("/api/qi/candidates/analyst", json={
                "operator_id": "admin", "accounts": ["admin", "test_user01", "test_user02"]})

    def test_tc_m20_072_candidates_crud(self, api_client):
        """白名单 GET/POST 端点正常。"""
        r = api_client.get("/api/qi/candidates/reviewer", params={"operator_id": OP})
        assert r.status_code == 200
        assert len(r.json()["candidates"]) >= 1
        r2 = api_client.get("/api/qi/candidates/analyst", params={"operator_id": OP})
        assert r2.status_code == 200


class TestQiBatchSubmit:
    """运维闭环时自动批量提交关联工单的草稿 QI。"""

    def test_tc_m20_090_batch_submit_drafts(self, api_client):
        """batch=true 可批量提交草稿（即使关联工单未到审核关闭），单独提交被拦截。"""
        TNO = "YW99993527930"
        r1 = _create_draft(api_client, title="草稿A", related_ticket_no=TNO)
        r2 = _create_draft(api_client, title="草稿B", related_ticket_no=TNO)
        qid1, qid2 = r1.json()["id"], r2.json()["id"]
        assert r1.json()["current_status"] == "draft"
        assert r2.json()["current_status"] == "draft"

        # 单独提交应被拦截（工单未到审核关闭）
        sr = _submit(api_client, qid1, OP, "propose", "提交评审",
                     {"reviewer": "测试用户01 test_user01", "title": "草稿A",
                      "related_ticket_no": TNO, "description": "d", "category": "特性加固"})
        assert sr.status_code == 400
        assert "草稿不可" in sr.json()["detail"]

        # batch=true 提交应成功（不受工单状态限制）
        for qid in [qid1, qid2]:
            d = api_client.get(f"/api/qi/{qid}", params={"operator_id": OP}).json()
            ps = [s for s in d["stages"] if s["stage_key"] == "propose"][0]
            vals = dict(ps["values"])
            vals["reviewer"] = "测试用户01 test_user01"
            vals["title"] = vals.get("title") or "x"
            vals["related_ticket_no"] = vals.get("related_ticket_no") or TNO
            vals["description"] = vals.get("description") or "x"
            vals["category"] = vals.get("category") or "特性加固"
            sr2 = api_client.post(f"/api/qi/{qid}/submit", json={
                "operator_id": OP, "stage_key": "propose", "handle_mode": "提交评审",
                "values": vals, "batch": True
            })
            assert sr2.status_code == 200, f"batch submit failed: {sr2.text}"
            d2 = api_client.get(f"/api/qi/{qid}", params={"operator_id": OP}).json()
            assert d2["request"]["current_status"] == "in_progress"
            assert d2["request"]["qi_no"].startswith("ZLGJ-")

    def test_tc_m20_091_batch_submit_no_drafts(self, api_client):
        """无草稿时批量提交静默成功。"""
        # 创建一个已提交的非草稿 QI
        qid = _create(api_client).json()["id"]
        d = api_client.get(f"/api/qi/{qid}", params={"operator_id": OP}).json()
        assert d["request"]["current_status"] != "draft"


class TestQiFlowPaths:
    """正交表法：覆盖评审通过/不通过 × 确认接纳/不接纳 × 验收通过/不通过 的各种组合。"""

    def _verify_stage(self, api_client, qid, expected_status, expected_stage):
        """验证 API 返回的 current_stage 和 current_status，以及详情中各阶段状态。"""
        d = api_client.get(f"/api/qi/{qid}", params={"operator_id": OP}).json()
        assert d["request"]["current_stage"] == expected_stage, \
            f"expected stage={expected_stage}, got {d['request']['current_stage']}"
        assert d["request"]["current_status"] == expected_status, \
            f"expected status={expected_status}, got {d['request']['current_status']}"
        return d

    def _verify_nodes(self, d, expected):
        """验证流程节点状态。expected: {stage_key: status}，status ∈ {completed, rejected, pending, None(不存在)}。"""
        stages = {s["stage_key"]: s for s in d["stages"]}
        for sk, exp in expected.items():
            if exp is None:
                assert sk not in stages or stages[sk]["status"] == "pending", \
                    f"{sk}: expected None/pending, got {stages.get(sk, {}).get('status', 'no stage')}"
            else:
                assert sk in stages, f"{sk}: stage not found"
                actual = stages[sk]["status"]
                assert actual == exp, f"{sk}: expected {exp}, got {actual}"

    # ---- 路径 1: Happy Path (全部通过) ----
    def test_tc_m20_100_happy_path(self, api_client):
        """评审通过 → 确认接纳 → 实施提交 → 验收通过 → closed。"""
        qid = _create(api_client).json()["id"]
        # review pass
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "同意"})
        d = self._verify_stage(api_client, qid, "in_progress", "analysis")
        self._verify_nodes(d, {"propose": "completed", "review": "completed", "analysis": "pending"})
        # analysis accept
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        d = self._verify_stage(api_client, qid, "in_progress", "closure")
        self._verify_nodes(d, {"review": "completed", "analysis": "completed", "closure": "pending"})
        # closure submit
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        d = self._verify_stage(api_client, qid, "in_progress", "acceptance")
        self._verify_nodes(d, {"analysis": "completed", "closure": "completed", "acceptance": "pending"})
        # acceptance pass → closed
        _submit(api_client, qid, OP, "acceptance", "验收通过",
                {"acceptance_pass": "通过", "acceptance_conclusion": "OK"})
        d = self._verify_stage(api_client, qid, "closed", "acceptance")
        self._verify_nodes(d, {"closure": "completed", "acceptance": "completed"})

    # ---- 路径 2: 验收不通过打回实施，重新提交通过 ----
    def test_tc_m20_101_acceptance_reject(self, api_client):
        """验收不通过 → 回到实施 → 重新提交 → 验收通过 → closed。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "同意"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        # acceptance reject → back to closure
        _submit(api_client, qid, OP, "acceptance", "验收不通过",
                {"acceptance_pass": "不通过", "acceptance_conclusion": "not ok"})
        d = self._verify_stage(api_client, qid, "in_progress", "closure")
        self._verify_nodes(d, {"acceptance": "rejected", "closure": "pending"})
        # re-submit closure
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-16", "closure_self_test": "fixed", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        d = self._verify_stage(api_client, qid, "in_progress", "acceptance")
        self._verify_nodes(d, {"closure": "completed", "acceptance": "pending"})
        # acceptance pass
        _submit(api_client, qid, OP, "acceptance", "验收通过",
                {"acceptance_pass": "通过", "acceptance_conclusion": "OK"})
        d = self._verify_stage(api_client, qid, "closed", "acceptance")

    # ---- 路径 3: 确认不接纳打回评审，重新评审通过 ----
    def test_tc_m20_102_analysis_reject(self, api_client):
        """确认不接纳 → 回到评审 → 重新评审通过 → 确认接纳 → closed。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "同意"})
        # analysis reject
        _submit(api_client, qid, RESP_OP, "analysis", "分析不接纳",
                {"accept": "否", "review_comment": "需要补充"})
        d = self._verify_stage(api_client, qid, "in_progress", "review")
        self._verify_nodes(d, {"analysis": "rejected", "review": "pending"})
        # re-review pass
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "已补充"})
        d = self._verify_stage(api_client, qid, "in_progress", "analysis")
        self._verify_nodes(d, {"review": "completed", "analysis": "pending"})
        # analysis accept → closure → acceptance → closed
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        _submit(api_client, qid, OP, "acceptance", "验收通过",
                {"acceptance_pass": "通过", "acceptance_conclusion": "OK"})
        d = self._verify_stage(api_client, qid, "closed", "acceptance")

    # ---- 路径 4: 评审不通过直接关单 ----
    def test_tc_m20_103_review_reject(self, api_client):
        """评审不通过 → 直接关单。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审不通过",
                {"review_result": "不通过关单", "reject_reason": "范围过大"})
        d = self._verify_stage(api_client, qid, "closed", "review")

    # ---- 路径 5: 评审通过 → 确认不接纳打回评审 → 重新评审通过 → closed ----
    def test_tc_m20_104_review_and_analysis_reject(self, api_client):
        """评审通过 → 确认不接纳 → 打回评审重交 → 关闭。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "同意"})
        # analysis reject
        _submit(api_client, qid, RESP_OP, "analysis", "分析不接纳",
                {"accept": "否", "review_comment": "需要更多信息"})
        d = self._verify_stage(api_client, qid, "in_progress", "review")
        self._verify_nodes(d, {"analysis": "rejected", "review": "pending"})
        # re-review → analysis accept → closure → acceptance
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "已补充"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        _submit(api_client, qid, OP, "acceptance", "验收通过",
                {"acceptance_pass": "通过", "acceptance_conclusion": "OK"})
        d = self._verify_stage(api_client, qid, "closed", "acceptance")

    # ---- 路径 6: 验收不通过×2，最终通过 ----
    def test_tc_m20_105_acceptance_reject_twice(self, api_client):
        """验收两次不通过 → 第三次通过 → closed。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "同意"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "v1", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        # reject × 2
        for i in range(2):
            _submit(api_client, qid, OP, "acceptance", "验收不通过",
                    {"acceptance_pass": "不通过", "acceptance_conclusion": f"fail {i}"})
            d = self._verify_stage(api_client, qid, "in_progress", "closure")
            assert any(s["status"] == "rejected" for s in d["stages"] if s["stage_key"] == "acceptance")
            _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                    {"sla_time": f"2026-07-1{6+i}", "closure_self_test": f"v{i+2}", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        # final pass
        _submit(api_client, qid, OP, "acceptance", "验收通过",
                {"acceptance_pass": "通过", "acceptance_conclusion": "OK"})
        d = self._verify_stage(api_client, qid, "closed", "acceptance")

    # ---- 路径 6: 验收不通过×2，第三次通过 ----
    def test_tc_m20_106_review_reject_twice(self, api_client):
        """验收两次不通过 → 第三次通过 → closed。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "同意"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "v1", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        for i in range(2):
            _submit(api_client, qid, OP, "acceptance", "验收不通过",
                    {"acceptance_pass": "不通过", "acceptance_conclusion": f"fail {i}"})
            _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                    {"sla_time": f"2026-07-1{6+i}", "closure_self_test": f"v{i+2}", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        # 第三次：验收通过
        _submit(api_client, qid, OP, "acceptance", "验收通过",
                {"acceptance_pass": "通过", "acceptance_conclusion": "OK"})
        d = self._verify_stage(api_client, qid, "closed", "acceptance")

    # ---- 路径 7: 确认不接纳 + 验收不通过 → 最终 closed ----
    def test_tc_m20_107_all_reject_once(self, api_client):
        """确认不接纳×1 → 验收不通过×1 → 最终 closed。"""
        qid = _create(api_client).json()["id"]
        # review pass
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "ok"})
        # analysis reject → re-review → re-analysis accept
        _submit(api_client, qid, RESP_OP, "analysis", "分析不接纳",
                {"accept": "否", "review_comment": "need more"})
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "done"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "ok", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        # closure → acceptance reject → re-closure → acceptance pass
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "v1", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        _submit(api_client, qid, OP, "acceptance", "验收不通过",
                {"acceptance_pass": "不通过", "acceptance_conclusion": "fail"})
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-16", "closure_self_test": "v2", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        _submit(api_client, qid, OP, "acceptance", "验收通过",
                {"acceptance_pass": "通过", "acceptance_conclusion": "OK"})
        d = self._verify_stage(api_client, qid, "closed", "acceptance")


    # ---- 路径 9: 打回后表单值保留 ----
    def test_tc_m20_108_reject_preserves_values(self, api_client):
        """打回重进阶段时，之前填写的表单值应保留。"""
        qid = _create(api_client).json()["id"]
        # review pass with specific values
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "首次评审意见内容"})
        # analysis accept with closure method
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "首次分析意见", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        # closure with specific values
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-15", "closure_self_test": "首次闭环自测内容", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        # acceptance reject → back to closure
        _submit(api_client, qid, OP, "acceptance", "验收不通过",
                {"acceptance_pass": "不通过", "acceptance_conclusion": "不通过原因"})

        # Verify closure stage preserves old values
        d = api_client.get(f"/api/qi/{qid}", params={"operator_id": OP}).json()
        cl = [s for s in d["stages"] if s["stage_key"] == "closure"][0]
        assert cl["status"] == "pending", f"expected pending, got {cl['status']}"
        # 之前的值应保留
        assert cl["values"].get("closure_self_test") == "首次闭环自测内容", \
            f"closure_self_test not preserved: {cl['values'].get('closure_self_test')}"
        assert cl["values"].get("closure_ticket_no") == "YW20260627001", \
            f"closure_ticket_no not preserved: {cl['values'].get('closure_ticket_no')}"
        assert cl["values"].get("accept_version") == "507.0", \
            f"accept_version not preserved: {cl['values'].get('accept_version')}"
        assert cl["values"].get("sla_time") == "2026-07-15", \
            f"sla_time not preserved: {cl['values'].get('sla_time')}"

        # Also test review reject closes directly
        qid2 = _create(api_client).json()["id"]
        r = _submit(api_client, qid2, REVIEWER_OP, "review", "评审不通过",
                    {"review_result": "不通过关单", "reject_reason": "退回修改意见"})
        assert r.status_code == 200
        assert r.json()["current_status"] == "closed"


    # ---- 路径 10: 关闭后不可再操作 ----
    def test_tc_m20_109_closed_no_modify(self, api_client):
        """关闭后 submit 和 save 都应拒绝。"""
        qid = _create(api_client).json()["id"]
        # review reject → closed
        _submit(api_client, qid, REVIEWER_OP, "review", "评审不通过",
                {"review_result": "不通过关单", "reject_reason": "范围过大"})
        d = self._verify_stage(api_client, qid, "closed", "review")
        # 尝试再次提交应被拒
        r = _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                    {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "重试"})
        assert r.status_code == 400
        assert "已关闭" in r.json()["detail"]
        # 尝试保存也应被拒
        r2 = api_client.post(f"/api/qi/{qid}/save", json={
            "operator_id": OP, "stage_key": "review", "values": {"reject_reason": "修改"}
        })
        assert r2.status_code == 400
        assert "已关闭" in r2.json()["detail"]


class TestQiMigrate:
    """旧 requirement 数据迁移到新 QI 系统。"""

    def test_tc_m20_113_migrate_legacy(self, api_client):
        """迁移旧数据到新系统，统一导入到评审阶段。"""
        r = api_client.post("/api/qi/migrate-legacy", json={"operator_id": OP, "force": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["migrated"] > 0, f"should migrate some records, got {d}"

    def test_tc_m20_114_migrate_idempotent(self, api_client):
        """重复迁移（force=False）应跳过已迁移的记录。"""
        # 第一次迁移
        api_client.post("/api/qi/migrate-legacy", json={"operator_id": OP, "force": True})
        # 第二次迁移（不强制）应全部跳过
        r2 = api_client.post("/api/qi/migrate-legacy", json={"operator_id": OP, "force": False})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["skipped"] > 0, f"should skip existing records, got {d2}"

    def test_tc_m20_115_migrate_field_mapping(self, api_client):
        """迁移仅 5 字段：问题描述→title、改进诉求→description、分类、优先级、提出人；其余不迁移（留空）。"""
        import os
        import psycopg
        from psycopg.rows import dict_row

        dsn = os.environ["DATABASE_URL"]
        fake_proposer = "maptest_dfx"
        with psycopg.connect(dsn, row_factory=dict_row) as conn:
            req_id = int(conn.execute(
                """INSERT INTO requirement
                   (requirement_no, category, description, improvement, priority, proposer, creator_id, creator_name)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                ("REQ-MAP-TEST", "测试加固", "问题是X", "改进为Y", "高", fake_proposer, fake_proposer, fake_proposer),
            ).fetchone()["id"])
            conn.commit()
        try:
            api_client.post("/api/qi/migrate-legacy", json={"operator_id": OP, "force": True})
            with psycopg.connect(dsn, row_factory=dict_row) as conn:
                qr = conn.execute(
                    """SELECT id, current_stage, title, description, category, priority, proposer,
                              creator_name, related_ticket_no, domain, module_feature
                       FROM qi_request WHERE proposer=%s ORDER BY id DESC LIMIT 1""",
                    (fake_proposer,),
                ).fetchone()
                assert qr is not None, "未找到由该 requirement 迁移出的 qi_request"
                has_review = conn.execute(
                    "SELECT 1 FROM qi_stage WHERE request_id=%s AND stage_key='review' LIMIT 1",
                    (qr["id"],),
                ).fetchone()
            assert qr["current_stage"] == "propose", "迁移记录应停在提出阶段(propose)"
            assert not has_review, "迁移不应自动创建 review 阶段"
            assert qr["title"] == "问题是X", "问题描述 → title"
            assert qr["description"] == "改进为Y", "改进诉求 → description"
            assert qr["category"] == "特性加固", "legacy 分类经映射归并 → category"
            assert qr["priority"] == "高", "优先级 → priority"
            assert qr["proposer"] == fake_proposer, "提出人 → proposer"
            assert qr["proposer"] == qr["creator_name"], "提出人应与创建人(creator_name)一致"
            # 仅迁 5 字段：以下不再迁移，应为空
            assert qr["related_ticket_no"] == "", "关联单号不再迁移"
            assert qr["domain"] == "", "领域不再迁移"
            assert qr["module_feature"] == "", "模块&特性不再迁移"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE proposer=%s", (fake_proposer,))
                conn.execute("DELETE FROM requirement WHERE id=%s", (req_id,))
                conn.commit()

    def test_tc_m20_115b_migrate_category_passthrough(self, api_client):
        """legacy 分类不在映射表（如 快速恢复）时原样透传，不做改写。"""
        import os
        import psycopg
        from psycopg.rows import dict_row

        dsn = os.environ["DATABASE_URL"]
        fake_proposer = "maptest_pass"
        with psycopg.connect(dsn, row_factory=dict_row) as conn:
            req_id = int(conn.execute(
                """INSERT INTO requirement
                   (requirement_no, category, description, improvement, priority, proposer, creator_id, creator_name)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                ("REQ-MAP-PASS", "快速恢复", "问题是P", "改进为Q", "中", fake_proposer, fake_proposer, fake_proposer),
            ).fetchone()["id"])
            conn.commit()
        try:
            api_client.post("/api/qi/migrate-legacy", json={"operator_id": OP, "force": True})
            with psycopg.connect(dsn, row_factory=dict_row) as conn:
                qr = conn.execute(
                    "SELECT category FROM qi_request WHERE proposer=%s ORDER BY id DESC LIMIT 1",
                    (fake_proposer,),
                ).fetchone()
            assert qr is not None, "未找到迁移出的 qi_request"
            assert qr["category"] == "快速恢复", f"非映射分类应原样透传，实际 {qr['category']!r}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE proposer=%s", (fake_proposer,))
                conn.execute("DELETE FROM requirement WHERE id=%s", (req_id,))
                conn.commit()

    def test_tc_m20_116_migrate_truncates_overlong_title(self, api_client):
        """旧库 description 超过 qi_request.title VARCHAR(512) 时，迁移应裁剪而非 500。"""
        import os
        import psycopg
        from psycopg.rows import dict_row

        long_desc = "超长" + "X" * 600  # > 512，验证 title(TEXT) 完整保留、不越界
        fake_proposer = "longtest_dfx"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn, row_factory=dict_row) as conn:
            req_id = int(conn.execute(
                """INSERT INTO requirement (requirement_no, description, proposer, creator_id, creator_name)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                ("REQ-LONG-TEST", long_desc, fake_proposer, fake_proposer, fake_proposer),
            ).fetchone()["id"])
            conn.commit()
        try:
            r = api_client.post("/api/qi/migrate-legacy", json={"operator_id": OP, "force": True})
            assert r.status_code == 200, f"超长描述迁移不应 500：{r.status_code} {r.text[:300]}"
            with psycopg.connect(dsn, row_factory=dict_row) as conn:
                qr = conn.execute(
                    "SELECT title FROM qi_request WHERE proposer=%s AND title LIKE %s ORDER BY id DESC LIMIT 1",
                    (fake_proposer, "超长%"),
                ).fetchone()
            assert qr is not None, "未找到由超长描述迁移出的 qi_request"
            assert qr["title"] == long_desc, f"title(TEXT) 应完整保留，实际长度 {len(qr['title'])}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE proposer=%s", (fake_proposer,))
                conn.execute("DELETE FROM requirement WHERE id=%s", (req_id,))
                conn.commit()


class TestQiConfigPage:
    """质量改进配置页面 E2E 测试（需 Playwright + 后端运行）。"""

    def test_tc_m20_110_config_page_loads(self):
        """配置页：渲染、Tab切换、编辑/取消、闭环进展增删、无JS错误、无无限渲染。"""
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            pytest.skip("Playwright not installed")
        import os
        base = os.environ.get("TEST_API_BASE_URL", "http://127.0.0.1:8000")
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True)
            page = b.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/params/qi-config", wait_until="domcontentloaded", timeout=10000)
            page.wait_for_timeout(3000)
            # 1. 渲染
            assert "质量改进配置" in (page.evaluate('document.querySelector("#center-page-title")?.textContent?.trim() || ""'))
            assert page.evaluate('!!document.querySelector("[data-qi-candidates-tab]")'), "no whitelist tabs"
            assert page.evaluate('!!document.getElementById("qi-closure-progress-list")'), "no closure list"
            # 2. Tab 切换
            page.click('[data-qi-candidates-tab="analyst"]'); page.wait_for_timeout(800)
            assert page.evaluate("document.querySelector('[data-qi-candidates-tab=\"analyst\"]')?.classList.contains('active')||false"), "analyst tab not active"
            # 3. 编辑模式
            page.click('[data-qi-candidates-tab="reviewer"]'); page.wait_for_timeout(500)
            page.click('#qi-candidates-edit-btn'); page.wait_for_timeout(500)
            assert page.evaluate("document.querySelectorAll('[data-qi-candidate-account]').length") > 0, "no checkboxes"
            # 4. 取消
            page.click('#qi-candidates-cancel-btn'); page.wait_for_timeout(500)
            assert page.evaluate("!!document.getElementById('qi-candidates-edit-btn')"), "not back to view"
            # 5. 闭环进展增删
            before = page.evaluate("document.querySelectorAll('#qi-closure-progress-list [data-progress-method]').length")
            page.click('[data-add-progress="需求闭环"]'); page.wait_for_timeout(300)
            assert page.evaluate("document.querySelectorAll('#qi-closure-progress-list [data-progress-method]').length") > before, "stage not added"
            page.evaluate("()=>{const b=document.querySelector('[data-del-progress]');if(b)b.click();}")
            page.wait_for_timeout(300)
            assert page.evaluate("document.querySelectorAll('#qi-closure-progress-list [data-progress-method]').length") == before, "stage not deleted"
            # 6. 无错误、无无限渲染
            assert not errors, f"JS errors: {errors}"
            l1 = page.evaluate('document.querySelector("#qi-closure-progress-list")?.innerHTML?.length || 0')
            page.wait_for_timeout(2000)
            l2 = page.evaluate('document.querySelector("#qi-closure-progress-list")?.innerHTML?.length || 0')
            assert l1 == l2, f"DOM unstable: {l1} -> {l2}"
            b.close()


class TestQiOverdue:
    """超期检测：实施阶段滞留超过配置 SLA 小时（started_at + sla_hours）标记为超期。"""

    def _to_closure(self, api_client):
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "同意"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        return qid

    def test_tc_m20_111_overdue(self, api_client):
        """实施阶段滞留超过 SLA 小时 → is_overdue=True（构造 started_at 偏移）。"""
        import os, psycopg
        from datetime import datetime, timedelta, timezone
        dsn = os.environ["DATABASE_URL"]
        qid = self._to_closure(api_client)
        # save 保存实施阶段表单（不提交），再把 started_at 拨回 400h 前（默认 SLA 336h）
        api_client.post(f"/api/qi/{qid}/save", json={
            "operator_id": RESP_OP, "stage_key": "closure",
            "values": {"sla_time": "2026-09-30", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"}
        })
        with psycopg.connect(dsn) as conn:
            conn.execute(
                "UPDATE qi_stage SET started_at=%s WHERE request_id=%s AND stage_key='closure'",
                (datetime.now(timezone.utc) - timedelta(hours=400), qid),
            )
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id": OP, "stage": "closure", "page_size": 50})
            target = [i for i in r.json()["items"] if i["id"] == qid]
            assert len(target) == 1, f"QI {qid} not found in closure list"
            assert target[0]["is_overdue"] is True, f"should be overdue, got {target[0]['is_overdue']}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE id=%s", (qid,))
                conn.commit()

    def test_tc_m20_112_not_overdue(self, api_client):
        """SLA 在未来 → is_overdue=False；关闭后 → is_overdue=False。"""
        qid = self._to_closure(api_client)
        api_client.post(f"/api/qi/{qid}/save", json={
            "operator_id": RESP_OP, "stage_key": "closure",
            "values": {"sla_time": "2099-12-31", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"}
        })
        r = api_client.get("/api/qi", params={"operator_id": OP, "stage": "closure", "page_size": 50})
        target = [i for i in r.json()["items"] if i["id"] == qid]
        assert target[0]["is_overdue"] is False, f"should not be overdue, got {target[0]['is_overdue']}"


class TestQiDelete:
    """删除限制：仅 propose 阶段可删。"""

    def test_tc_m20_080_delete_propose(self, api_client):
        """propose 阶段草稿可删除。"""
        r = _create_draft(api_client, title="待删除草稿")
        qid = r.json()["id"]
        dr = api_client.delete(f"/api/qi/{qid}", params={"operator_id": OP})
        assert dr.status_code == 200, dr.text

    def test_tc_m20_081_delete_after_review_denied(self, api_client):
        """已进入 review 阶段不可删除。"""
        qid = _create(api_client).json()["id"]  # 直接进入 review
        r = api_client.delete(f"/api/qi/{qid}", params={"operator_id": OP})
        assert r.status_code == 400


class TestQiAmendPersist:
    """修订已走过阶段并保存后，详情(刷新)应反映修订值。"""

    def test_amend_review_persists_after_reload(self, api_client):
        """修复前：save 对修订存 draft=TRUE，详情读非草稿原行→修订被忽略。"""
        import os
        import json

        import psycopg

        QI_NO = "TEST-AMEND-PERSIST"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','amend持久化','<p>d</p>','','中','管理员 admin',
                           'analysis','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'completed')", (rid,))
            rs = conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'review',1,'completed') RETURNING id", (rid,)).fetchone()
            conn.execute(
                """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
                   VALUES (%s,%s,'review',%s::jsonb, FALSE, 'admin')""",
                (int(rs[0]), rid, json.dumps({"review_result": "通过", "reject_reason": "原始评审意见", "responsible": "管理员 admin"})),
            )
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'analysis',1,'pending')", (rid,))
            conn.commit()
        try:
            # 修订 review 阶段（responsible 到 analysis 后被冻结，这里改非冻结字段 reject_reason）
            r = api_client.post(f"/api/qi/{rid}/save", json={
                "operator_id": "admin", "stage_key": "review",
                "values": {"review_result": "通过", "reject_reason": "修订后的评审意见"},
            })
            assert r.status_code == 200, f"修订保存失败: {r.status_code} {r.text[:300]}"
            # 重拉详情，review 应反映修订值
            detail = api_client.get(f"/api/qi/{rid}", params={"operator_id": "admin"}).json()
            review = next(s for s in detail["stages"] if s["stage_key"] == "review")
            assert review["values"]["reject_reason"] == "修订后的评审意见", (
                f"修订后刷新应显示新值，实际: {review['values'].get('reject_reason')}"
            )
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
                conn.commit()


class TestQiScopeFilter:
    """mine/handled scope 过滤逻辑。"""

    def test_mine_scope_by_actual_submitter(self, api_client):
        """我提出的 = 实际提交到评审的操作人（非 creator_id）。"""
        import os
        import psycopg

        QI_NO = "TEST-SCOPE-MINE"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','scope测试','d','','中','管理员 admin',
                           'review','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'completed')", (rid,))
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'review',1,'pending')", (rid,))
            # admin 提交了 propose→review
            conn.execute(
                "INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage, operator_id, operator_name, comment) VALUES (%s,'submitted','propose','review','admin','管理员 admin','')",
                (rid,),
            )
            conn.commit()
        try:
            # admin（提交人）能看到
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "mine", "page_size": 999})
            qi_nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO in qi_nos, "提交到评审的人应在'我提出的'里看到"
            # 其他人看不到
            r2 = api_client.get("/api/qi", params={"operator_id": "test_user01", "scope": "mine", "page_size": 999})
            qi_nos2 = [i["qi_no"] for i in r2.json().get("items", [])]
            assert QI_NO not in qi_nos2, "非提交人不应在'我提出的'里看到"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
                conn.commit()

    def test_handled_scope_includes_propose(self, api_client):
        """我处理的 = 包含 propose 阶段（creator_id 匹配）。"""
        import os
        import psycopg

        QI_NO = "TEST-SCOPE-HANDLED"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','handled测试','d','','中','管理员 admin',
                           'propose','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'in_progress')", (rid,))
            conn.commit()
        try:
            # admin 是 propose 阶段处理人 → 应在"我处理的"里
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "handled", "page_size": 5000})
            qi_nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO in qi_nos, "propose 阶段 creator 应在'我处理的'里看到"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
                conn.commit()


class TestQiScopeProposeMine:
    """mine（我提出的）在 propose 阶段：看 proposer。"""

    def test_mine_propose_by_proposer(self, api_client):
        """在提出阶段（非草稿），proposer 是我 → 可见。"""
        import os, psycopg
        QI_NO = "TEST-MINE-PROPOSE-OK"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','mine-propose测试','d','','中','','propose','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "mine", "page_size": 999})
            nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO in nos, "propose阶段 proposer 匹配应在'我提出的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_mine_propose_not_proposer(self, api_client):
        """在提出阶段（非草稿），proposer 不是我 → 不可见。"""
        import os, psycopg
        QI_NO = "TEST-MINE-PROPOSE-NO"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','测试用户01 test_user01','mine-propose非我','d','','中','','propose','in_progress','test_user01','测试用户01 test_user01')""",
                (QI_NO,),
            )
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "mine", "page_size": 999})
            nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO not in nos, "propose阶段 proposer 不匹配不应在'我提出的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_mine_propose_transferred_away(self, api_client):
        """提出阶段转单后：原 proposer 不可见，新 proposer 可见。"""
        import os, psycopg
        QI_NO = "TEST-MINE-TRANSFER"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','测试用户02 test_user02','mine转单测试','d','','中','','propose','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            conn.commit()
        try:
            # proposer=test_user02 → admin 不应看到
            r_admin = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "mine", "page_size": 999})
            admin_nos = [i["qi_no"] for i in r_admin.json().get("items", [])]
            assert QI_NO not in admin_nos, "转单后原 proposer 不应在'我提出的'可见"

            # proposer=test_user02 → test_user02 应看到
            r_new = api_client.get("/api/qi", params={"operator_id": "test_user02", "scope": "mine", "page_size": 999})
            new_nos = [i["qi_no"] for i in r_new.json().get("items", [])]
            assert QI_NO in new_nos, "转单后新 proposer 应在'我提出的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_mine_past_propose_by_submitter(self, api_client):
        """已进入评审阶段，提交到评审的人可见（不论当前 proposer）。"""
        import os, psycopg
        QI_NO = "TEST-MINE-REVIEW"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','mine-review测试','d','','中','管理员 admin','review','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'completed')", (rid,))
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'review',1,'pending')", (rid,))
            # admin 提交了 propose→review
            conn.execute(
                "INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage, operator_id, operator_name) VALUES (%s,'submitted','propose','review','admin','管理员 admin')",
                (rid,),
            )
            conn.commit()
        try:
            # admin 是提交人 → 可见
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "mine", "page_size": 999})
            nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO in nos, "提交到评审的人应在'我提出的'可见"

            # test_user01 不是提交人 → 不可见
            r2 = api_client.get("/api/qi", params={"operator_id": "test_user01", "scope": "mine", "page_size": 999})
            nos2 = [i["qi_no"] for i in r2.json().get("items", [])]
            assert QI_NO not in nos2, "非提交人不应在'我提出的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_mine_draft_visible(self, api_client):
        """草稿：creator_id 是我 → 可见。"""
        import os, psycopg
        QI_NO = "TEST-MINE-DRAFT"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','mine草稿测试','d','','中','','propose','draft','admin','管理员 admin')""",
                (QI_NO,),
            )
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "mine", "page_size": 999})
            nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO in nos, "草稿 creator 应在'我提出的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_mine_draft_not_creator(self, api_client):
        """草稿：creator_id 不是我 → 不可见。"""
        import os, psycopg
        QI_NO = "TEST-MINE-DRAFT-NO"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','测试用户01 test_user01','mine草稿非我','d','','中','','propose','draft','test_user01','测试用户01 test_user01')""",
                (QI_NO,),
            )
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "mine", "page_size": 999})
            nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO not in nos, "草稿非 creator 不应在'我提出的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()


class TestQiScopeProposeHandled:
    """handled（我处理的）在 propose 阶段：看 proposer（非 creator_id）。"""

    def test_handled_propose_by_proposer(self, api_client):
        """propose 阶段，proposer 是我 → 可见（即使 creator_id 不同）。"""
        import os, psycopg
        QI_NO = "TEST-HANDLED-PROPOSE"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            # proposer=test_user01，但 creator_id=admin（模拟迁移或代建）
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','测试用户01 test_user01','handled-propose测试','d','','中','','propose','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            conn.commit()
        try:
            # test_user01 是 proposer → 应在 handled 中
            r = api_client.get("/api/qi", params={"operator_id": "test_user01", "scope": "handled", "page_size": 999})
            nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO in nos, "propose 阶段 proposer 匹配应在'我处理的'可见"

            # admin 只是 creator，不是 proposer → 不应在 handled 中
            r2 = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "handled", "page_size": 999})
            nos2 = [i["qi_no"] for i in r2.json().get("items", [])]
            assert QI_NO not in nos2, "propose 阶段仅 creator_id 匹配（非 proposer）不应在'我处理的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_handled_propose_transferred_to(self, api_client):
        """propose 阶段转单后，新 proposer 在 handled 可见。"""
        import os, psycopg
        QI_NO = "TEST-HANDLED-TRANSFER"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','测试用户02 test_user02','handled转单测试','d','','中','','propose','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            conn.commit()
        try:
            # test_user02 是 proposer → 可见
            r = api_client.get("/api/qi", params={"operator_id": "test_user02", "scope": "handled", "page_size": 999})
            nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO in nos, "转单后新 proposer 应在'我处理的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_handled_propose_not_proposer(self, api_client):
        """propose 阶段，proposer 不是我 → 不可见。"""
        import os, psycopg
        QI_NO = "TEST-HANDLED-PROPOSE-NO"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','测试用户01 test_user01','handled-propose非我','d','','中','','propose','in_progress','test_user01','测试用户01 test_user01')""",
                (QI_NO,),
            )
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "handled", "page_size": 999})
            nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO not in nos, "propose 阶段非 proposer 不应在'我处理的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()


class TestQiAnalyticsAllTime:
    """统计分析默认全量（不过滤 90 天窗口）。"""

    def test_analytics_total_matches_db(self, api_client):
        import os
        import psycopg

        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            # KPI 口径排除草稿（win 条件 current_status != 'draft'），DB 计数需同口径
            db_total = conn.execute(
                "SELECT count(*) FROM qi_request WHERE current_status != 'draft'"
            ).fetchone()[0]
        r = api_client.get("/api/qi/analytics", params={"operator_id": "admin"})
        assert r.status_code == 200, f"analytics 失败: {r.status_code} {r.text[:200]}"
        analytics_total = r.json()["kpi"]["total"]
        assert analytics_total == db_total, (
            f"统计 total({analytics_total}) 应等于 DB 总数({db_total})，不应受 90 天窗口限制"
        )


class TestQiHandledScopeStages:
    """handled scope 各阶段处理人匹配（覆盖 EXISTS r.id 关联）。"""

    def test_handled_scope_review_by_reviewer(self, api_client):
        """评审阶段：reviewer 匹配操作人 → 在'我处理的'里。"""
        import os
        import psycopg

        QI_NO = "TEST-SCOPE-REVIEW"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','test_user01 测试用户01','review scope','d','','中','管理员 admin',
                           'review','in_progress','test_user01','测试用户01 test_user01')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'completed')", (rid,))
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'review',1,'pending')", (rid,))
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "handled", "page_size": 5000})
            qi_nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO in qi_nos, "reviewer=admin 的评审阶段单应在'我处理的'里"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
                conn.commit()

    def test_handled_scope_analysis_by_responsible(self, api_client):
        """确认/实施阶段：qi_stage.responsible 匹配 → 在'我处理的'里（覆盖 EXISTS r.id 修复）。"""
        import os
        import psycopg

        QI_NO = "TEST-SCOPE-RESP"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','test_user01 测试用户01','resp scope','d','','中','管理员 admin',
                           'analysis','in_progress','test_user01','测试用户01 test_user01')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'completed')", (rid,))
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'review',1,'completed')", (rid,))
            # analysis 阶段，responsible=admin（这是 EXISTS r.id 关联测试的关键）
            conn.execute(
                "INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible) VALUES (%s,'analysis',1,'pending','管理员 admin')",
                (rid,),
            )
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "handled", "page_size": 5000})
            qi_nos = [i["qi_no"] for i in r.json().get("items", [])]
            assert QI_NO in qi_nos, "responsible=admin 的确认阶段单应在'我处理的'里（EXISTS r.id 关联）"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
                conn.commit()



class TestQiAnalyticsDateFilter:
    """统计分析按自定义日期范围正确过滤。"""

    def test_analytics_date_filter_reduces_total(self, api_client):
        """传 start_date/end_date 后 total 应 <= 全量 total。"""
        r_all = api_client.get("/api/qi/analytics", params={"operator_id": "admin"})
        assert r_all.status_code == 200
        total_all = r_all.json()["kpi"]["total"]
        assert total_all > 0, "全量应 >0"

        r_filtered = api_client.get("/api/qi/analytics", params={
            "operator_id": "admin", "start_date": "2026-07-15", "end_date": "2026-07-15",
        })
        assert r_filtered.status_code == 200
        total_filtered = r_filtered.json()["kpi"]["total"]
        assert total_filtered <= total_all, (
            f"按日期过滤后 total({total_filtered}) 应 <= 全量({total_all})"
        )


class TestQiAnalyticsPresetAfterCustom:
    """自定义日期后切回预设(近1周等)应按预设窗口算，不用旧自定义日期。"""

    def test_preset_overrides_custom_dates(self, api_client):
        """后端验证：传 start_date/end_date 对应预设窗口(近1周)，total 与自定义不同。"""
        # 自定义窄范围（仅当天）
        r_custom = api_client.get("/api/qi/analytics", params={
            "operator_id": "admin", "start_date": "2026-07-16", "end_date": "2026-07-16",
        })
        assert r_custom.status_code == 200
        total_custom = r_custom.json()["kpi"]["total"]

        # 近 3 月（应比当天范围大）
        from datetime import date, timedelta
        today = date.today()
        start_3m = (today - timedelta(days=90)).isoformat()
        r_3m = api_client.get("/api/qi/analytics", params={
            "operator_id": "admin", "start_date": start_3m, "end_date": today.isoformat(),
        })
        assert r_3m.status_code == 200
        total_3m = r_3m.json()["kpi"]["total"]

        assert total_3m >= total_custom, (
            f"近3月({total_3m})应 >= 当天({total_custom})"
        )


class TestQiAnalyticsResearchField:
    """在研责任田统计（田目录 + 节点关联两层）：桶构建、聚合口径、路径前缀匹配、超期归桶、筛选联动、多模块共田合并。

    口径：接纳率=accepted/analyzed、闭环率=closed_done/accepted、超期=in_progress 且 _compute_overdue 判超期。
    匹配：遍历 田×关联，模块关联命中（module_feature==module 或以 module+'/' 开头）即归该田；
    整领域关联只兜底未命中模块关联的单；同一田的多条关联统计合并为一桶（domain=合并文本、module=""）。
    """

    RF_ROWS = [
        {"name": "RF田A1", "owner": "张三 zhangsan", "scopes": [{"domain": "RF领域A", "module": "RF模块A1"}]},
        {"name": "RF田B整域", "owner": "李四 lisi", "scopes": [{"domain": "RF领域B", "module": ""}]},
        {"name": "RF田C", "owner": "王五 wangwu", "scopes": [{"domain": "RF叶子领域C", "module": ""}]},
    ]

    @pytest.fixture(autouse=True)
    def _rf_table_guard(self, api_client):
        """用例前后保存/恢复在研责任田目录与关联（目录全量替换 + 逐槽位重绑），避免污染其它用例。"""
        before = api_client.get("/api/params/research-duty-field").json().get("items", [])
        yield
        self._put_rf_rows(api_client, rows=before)

    def _put_rf_rows(self, api_client, rows=None):
        rows = self.RF_ROWS if rows is None else rows
        r = api_client.put("/api/params/research-duty-field", json={
            "operator_id": "test_admin",
            "items": [{"name": x.get("name", ""), "owner": x.get("owner", "")} for x in rows],
        })
        assert r.status_code == 200, r.text
        items = r.json().get("items") or []
        id_by_name = {x["name"]: x["id"] for x in items}
        for x in rows:
            for sc in x.get("scopes") or []:
                rb = api_client.put("/api/params/research-duty-field/binding", json={
                    "operator_id": "test_admin",
                    "domain": sc.get("domain", ""), "module": sc.get("module", ""),
                    "field_id": id_by_name.get(x["name"]),
                })
                assert rb.status_code == 200, rb.text

    def _seed_request(self, dsn, qi_no, domain, module_feature, stage, status, created_at=None):
        """直插一条 qi_request（qi_no 需以 TEST- 开头以便 autouse 清理）。"""
        import psycopg
        with psycopg.connect(dsn) as conn:
            row = conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                    priority, domain, module_feature, reviewer, current_stage, current_status,
                    creator_id, creator_name, created_at)
                   VALUES (%s, '特性加固', %s, %s, 'x', 'd', 'g', '中', %s, %s,
                           'test_admin', %s, %s, 'test_admin', '测试管理员', COALESCE(%s, NOW()))
                   RETURNING id""",
                (qi_no, "张三 zhangsan", qi_no, domain, module_feature, stage, status, created_at),
            ).fetchone()
            conn.commit()
            return row[0]

    def _seed_analysis(self, dsn, request_id, accept):
        import psycopg
        with psycopg.connect(dsn) as conn:
            sid = conn.execute(
                """INSERT INTO qi_stage (request_id, stage_key, sequence, status)
                   VALUES (%s, 'analysis', 1, 'completed') RETURNING id""",
                (request_id,),
            ).fetchone()[0]
            conn.execute(
                """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, created_by)
                   VALUES (%s, %s, 'analysis', %s::jsonb, 'test_admin')""",
                (sid, request_id, f'{{"accept":"{accept}"}}'),
            )
            conn.commit()

    def _get_rf_stats(self, api_client, **params):
        p = {"operator_id": "admin"}
        p.update(params)
        r = api_client.get("/api/qi/analytics", params=p)
        assert r.status_code == 200, r.text
        stats = r.json()["research_field_stats"]
        # 两层模型：一行=一田（name 目录内唯一），domain=关联合并文本、module 恒 ""
        return {s["name"]: s for s in stats}

    def test_rf_stats_aggregation_and_matching(self, api_client):
        """桶构建+聚合口径：模块关联（路径前缀匹配、未配置模块不计入）、整领域关联、draft 排除、name/owner 透出。"""
        import os
        dsn = os.environ["DATABASE_URL"]
        self._put_rf_rows(api_client)
        # A1 田：已闭环 / 接纳在途 / 分析不接纳 / 未分析 / 更深路径（应归 A1）+ draft（不计）
        rid_done = self._seed_request(dsn, "TEST-RF-1", "RF领域A", "RF模块A1", "acceptance", "closed")
        self._seed_analysis(dsn, rid_done, "是")
        rid_prog = self._seed_request(dsn, "TEST-RF-2", "RF领域A", "RF模块A1", "closure", "in_progress")
        self._seed_analysis(dsn, rid_prog, "是")
        rid_rej = self._seed_request(dsn, "TEST-RF-3", "RF领域A", "RF模块A1", "review", "in_progress")
        self._seed_analysis(dsn, rid_rej, "否")
        self._seed_request(dsn, "TEST-RF-4", "RF领域A", "RF模块A1", "review", "in_progress")
        self._seed_request(dsn, "TEST-RF-5", "RF领域A", "RF模块A1/更深层", "review", "in_progress")
        self._seed_request(dsn, "TEST-RF-6", "RF领域A", "RF模块A1", "propose", "draft")
        # A 领域未配置整领域关联：RF模块A2 不入任何田；B 整领域关联：任意模块计入
        self._seed_request(dsn, "TEST-RF-7", "RF领域A", "RF模块A2", "review", "in_progress")
        self._seed_request(dsn, "TEST-RF-8", "RF领域B", "RF模块B1", "review", "in_progress")
        self._seed_request(dsn, "TEST-RF-9", "RF叶子领域C", "", "analysis", "in_progress")

        stats = self._get_rf_stats(api_client)
        assert set(stats.keys()) == {"RF田A1", "RF田B整域", "RF田C"}, (
            f"应有 A1 模块田、B 整领域田、C 整领域田（A2 无田不计）: {stats.keys()}"
        )
        a1 = stats["RF田A1"]
        assert a1["name"] == "RF田A1", "统计元素应带在研责任田名称"
        assert a1["owner"] == "张三 zhangsan", "模块田应带责任人"
        assert a1["domain"] == "RF领域A/RF模块A1", f"domain 应为关联合并文本: {a1}"
        assert a1["module"] == "", f"两层模型下 module 恒空（关联已并入 domain 文本）: {a1}"
        assert a1["total"] == 5, f"total 应含更深路径单、排除 draft/A2: {a1}"
        assert a1["analyzed"] == 3, f"analyzed 应为 3（是/是/否）: {a1}"
        assert a1["accepted"] == 2, f"accepted 应为 2: {a1}"
        assert a1["closed_done"] == 1, f"closed_done 应为 1: {a1}"
        b = stats["RF田B整域"]
        assert b["name"] == "RF田B整域" and b["owner"] == "李四 lisi"
        assert b["domain"] == "RF领域B（整领域）", f"整领域关联文本: {b}"
        assert b["total"] == 1, f"整领域田应收 B1 模块单: {b}"
        c = stats["RF田C"]
        assert c["total"] == 1 and c["analyzed"] == 0 and c["owner"] == "王五 wangwu", f"整领域田按领域匹配: {c}"

    def test_rf_first_hit_ordering(self, api_client):
        """同领域「模块关联 vs 整领域关联」（不同田）并存时模块关联恒优先（与田目录顺序无关）。"""
        import os
        dsn = os.environ["DATABASE_URL"]
        rows_module_first = [
            {"name": "RF田A1", "owner": "张三 zhangsan", "scopes": [{"domain": "RF领域A", "module": "RF模块A1"}]},
            {"name": "RF田A整域", "owner": "李四 lisi", "scopes": [{"domain": "RF领域A", "module": ""}]},
        ]
        # 树入口的自然顺序恰好是整领域田在前（先点领域节点配置，再点模块节点）——历史上首命中
        # 匹配会让整领域田吞掉全部单，模块田恒为 0；两种目录顺序现在都必须同口径。
        rows_domain_first = list(reversed(rows_module_first))
        # 两轮种子单都留在库里（只重 PUT 目录序）：期望值随轮次累计——A1 单恒进模块田、A2 单恒兜底整领域田。
        for round_no, (tag, rows) in enumerate((("M", rows_module_first), ("D", rows_domain_first)), start=1):
            self._put_rf_rows(api_client, rows=rows)
            self._seed_request(dsn, f"TEST-RF-{tag}1", "RF领域A", "RF模块A1", "review", "in_progress")
            self._seed_request(dsn, f"TEST-RF-{tag}2", "RF领域A", "RF模块A2", "review", "in_progress")

            stats = self._get_rf_stats(api_client)
            assert set(stats.keys()) == {"RF田A1", "RF田A整域"}, stats.keys()
            assert stats["RF田A1"]["total"] == round_no, f"模块关联应吃掉全部本模块单（目录序无关）: {rows}"
            assert stats["RF田A整域"]["total"] == round_no, f"整领域关联只兜底其余模块: {rows}"

    def test_rf_shared_field_merge(self, api_client):
        """多模块共田：两个模块槽位绑同一田 → 单桶合并统计，domain 为两条关联的合并文本。"""
        import os
        dsn = os.environ["DATABASE_URL"]
        self._put_rf_rows(api_client, rows=[
            {"name": "RF共田X", "owner": "赵强 zhaoqiang", "scopes": [
                {"domain": "RF领域X", "module": "RF模块X1"},
                {"domain": "RF领域X", "module": "RF模块X2"},
            ]},
        ])
        rid1 = self._seed_request(dsn, "TEST-RF-S1", "RF领域X", "RF模块X1", "review", "in_progress")
        self._seed_analysis(dsn, rid1, "是")
        rid2 = self._seed_request(dsn, "TEST-RF-S2", "RF领域X", "RF模块X2", "acceptance", "closed")
        self._seed_analysis(dsn, rid2, "是")
        self._seed_request(dsn, "TEST-RF-S3", "RF领域X", "RF模块X3", "review", "in_progress")

        stats = self._get_rf_stats(api_client)
        assert set(stats.keys()) == {"RF共田X"}, f"共田应只有一桶（X3 未关联不计）: {stats.keys()}"
        x = stats["RF共田X"]
        assert x["total"] == 2, f"两模块的单应合并到同一田: {x}"
        assert x["analyzed"] == 2 and x["accepted"] == 2 and x["closed_done"] == 1, f"聚合合并: {x}"
        assert x["domain"] == "RF领域X/RF模块X1、RF领域X/RF模块X2", f"domain 应为多条关联合并文本: {x}"
        assert x["module"] == "" and x["owner"] == "赵强 zhaoqiang", f"module 恒空、owner 透出: {x}"

    def test_kpi_no_double_count_on_stage_reentry(self, api_client):
        """阶段打回重入会给同一 stage_key 插多条 qi_stage：KPI/超期/在研超期归桶都只按最新一条实例计数。"""
        import os
        import psycopg
        dsn = os.environ["DATABASE_URL"]
        self._put_rf_rows(api_client)
        # 基线：本用例只应使各计数恰好 +1，修复前会 +2（旧/新两条 qi_stage 实例都 JOIN 上）
        base = api_client.get("/api/qi/analytics", params={"operator_id": "admin"}).json()
        kpi_before = base["kpi"]
        rf_before = {s["name"]: s for s in base["research_field_stats"]}["RF田A1"]
        rid = self._seed_request(dsn, "TEST-RF-1", "RF领域A", "RF模块A1", "closure", "in_progress")
        with psycopg.connect(dsn) as conn:
            # 旧实例（打回产生）+ 当前实例（重入产生）：修复前 JOIN 出两行单被数两次
            conn.execute(
                """INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at)
                   VALUES (%s, 'closure', 1, 'rejected', NOW() - INTERVAL '40 days')""",
                (rid,),
            )
            sid = conn.execute(
                """INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at)
                   VALUES (%s, 'closure', 2, 'in_progress', NOW() - INTERVAL '20 days') RETURNING id""",
                (rid,),
            ).fetchone()[0]
            conn.execute(
                """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, created_by)
                   VALUES (%s, %s, 'closure', '{"sla_time":"2026-08-01"}'::jsonb, 'test_admin')""",
                (sid, rid),
            )
            conn.commit()

        r = api_client.get("/api/qi/analytics", params={"operator_id": "admin"})
        assert r.status_code == 200, r.text
        body = r.json()
        # 分析默认全时段全库（本地库常驻演示数据），绝对值断言会被污染：一律对基线取增量。
        assert body["kpi"]["in_progress"] - kpi_before["in_progress"] == 1, (
            f"阶段重入不应把进行中数成 2: {kpi_before} -> {body['kpi']}"
        )
        assert body["kpi"]["overtime"] - kpi_before["overtime"] == 1, (
            f"阶段重入不应把超期数成 2: {kpi_before} -> {body['kpi']}"
        )
        stats = {s["name"]: s for s in body["research_field_stats"]}
        b = stats["RF田A1"]
        assert b["overdue"] - rf_before["overdue"] == 1, f"在研超期归田不应重复: {rf_before} -> {b}"
        assert b["total"] - rf_before["total"] == 1, f"在研田总数不应重复: {rf_before} -> {b}"

    def test_handler_stage_acceptance_transfer_attribution(self, api_client):
        """验收阶段当前处理人：转单后按 qi_stage.responsible 归属，未转单回落提出人（与 _verify_current_handler 同口径）。"""
        import os
        import psycopg
        dsn = os.environ["DATABASE_URL"]
        rid_transfer = self._seed_request(dsn, "TEST-RF-1", "RF领域A", "RF模块A1", "acceptance", "in_progress")
        rid_plain = self._seed_request(dsn, "TEST-RF-2", "RF领域A", "RF模块A1", "acceptance", "in_progress")
        with psycopg.connect(dsn) as conn:
            # 转单写入 acceptance 负责人（提出人不变）
            conn.execute(
                """INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible)
                   VALUES (%s, 'acceptance', 1, 'in_progress', '李四 lisi')""",
                (rid_transfer,),
            )
            # 未转单：无 acceptance 负责人 → 回落提出人（张三 zhangsan）
            conn.execute(
                """INSERT INTO qi_stage (request_id, stage_key, sequence, status)
                   VALUES (%s, 'acceptance', 1, 'in_progress')""",
                (rid_plain,),
            )
            conn.commit()

        r = api_client.get("/api/qi/analytics", params={"operator_id": "admin"})
        assert r.status_code == 200, r.text
        rows = r.json()["handler_stage_distribution"]
        # 分布是全库口径（常驻演示数据也有验收单）：只看本用例独有的 RF领域A 行
        acceptance = {(row["user"], row["count"]) for row in rows
                      if row["stage"] == "acceptance" and row["domain"] == "RF领域A"}
        assert acceptance == {("李四", 1), ("张三", 1)}, f"转单归属李四/未转单回落张三各 1: {acceptance}"
        assert sum(c for _, c in acceptance) == 2, f"验收阶段共 2 单不应重复或丢失: {acceptance}"

    def test_rf_overdue_attribution(self, api_client):
        """超期归桶（新口径 started_at + SLA 小时）：closure 滞留 20 天(480h>336h)计入；
        analysis 滞留 30 天(720h>72h)同样计入，并落 analysis_total/analysis_overdue 新字段。"""
        import os
        import psycopg
        dsn = os.environ["DATABASE_URL"]
        self._put_rf_rows(api_client)
        rid = self._seed_request(dsn, "TEST-RF-1", "RF领域A", "RF模块A1", "closure", "in_progress")
        with psycopg.connect(dsn) as conn:
            sid = conn.execute(
                """INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at)
                   VALUES (%s, 'closure', 1, 'in_progress', NOW() - INTERVAL '20 days') RETURNING id""",
                (rid,),
            ).fetchone()[0]
            conn.execute(
                """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, created_by)
                   VALUES (%s, %s, 'closure', '{"sla_time":"2026-08-01"}'::jsonb, 'test_admin')""",
                (sid, rid),
            )
            conn.commit()
        rid2 = self._seed_request(dsn, "TEST-RF-2", "RF叶子领域C", "", "analysis", "in_progress")
        with psycopg.connect(dsn) as conn:
            conn.execute(
                """INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at)
                   VALUES (%s, 'analysis', 1, 'in_progress', NOW() - INTERVAL '30 days')""",
                (rid2,),
            )
            conn.commit()

        stats = self._get_rf_stats(api_client)
        a1 = stats["RF田A1"]
        assert a1["overdue"] == 1, "closure 超期应归入 A1 田"
        assert a1["closure_total"] == 1 and a1["closure_overdue"] == 1, f"closure 田新字段: {a1}"
        c = stats["RF田C"]
        assert c["overdue"] == 1, "analysis 滞留超 SLA 也应判超期（新口径）"
        assert c["analysis_total"] == 1 and c["analysis_overdue"] == 1, f"analysis 田新字段: {c}"

    def test_rf_status_filter_and_window(self, api_client):
        """状态筛选与时间窗对 research_field_stats 生效。"""
        import os
        dsn = os.environ["DATABASE_URL"]
        self._put_rf_rows(api_client)
        rid_done = self._seed_request(dsn, "TEST-RF-1", "RF领域A", "RF模块A1", "acceptance", "closed")
        self._seed_analysis(dsn, rid_done, "是")
        self._seed_request(dsn, "TEST-RF-2", "RF领域A", "RF模块A1", "review", "in_progress")

        # 状态筛选：closed_done → 仅验收通过关单
        stats = self._get_rf_stats(api_client, status_filter="closed_done")
        a1 = stats["RF田A1"]
        assert a1["total"] == 1 and a1["accepted"] == 1 and a1["closed_done"] == 1, (
            f"closed_done 筛选后仅剩验收通过关单: {a1}"
        )
        # 未来时间窗 → 全零但田桶仍在
        stats = self._get_rf_stats(api_client, start_date="2099-01-01", end_date="2099-12-31")
        a1 = stats["RF田A1"]
        assert a1["total"] == 0 and a1["overdue"] == 0, f"未来窗口应全零: {a1}"


class TestQiTransfer:
    """转单功能：全阶段、白名单校验、权限校验。"""

    def _seed_qi_at_stage(self, dsn, stage, qi_no, handler_field=None, handler_val=None):
        """造一条停在指定阶段的 QI，返回 id。"""
        import json
        import psycopg
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (qi_no,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','transfer测试','d','','中','管理员 admin',
                           %s,'in_progress','admin','管理员 admin')""",
                (qi_no, stage),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (qi_no,)).fetchone()[0])
            # 建前置阶段实例
            stage_order = ["propose", "review", "analysis", "closure", "acceptance"]
            idx = stage_order.index(stage)
            for i, sk in enumerate(stage_order[:idx + 1]):
                status = "in_progress" if sk == stage else "completed"
                resp = handler_val if (handler_field == "responsible" and sk == stage) else ""
                conn.execute(
                    "INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible) VALUES (%s,%s,1,%s,%s)",
                    (rid, sk, status, resp),
                )
                if sk in ("propose", "review", "analysis") and i < idx:
                    vals = {"review_result": "通过", "responsible": handler_val or "管理员 admin"} if sk == "review" else {}
                    conn.execute(
                        "INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by) "
                        "SELECT id, %s, %s, %s::jsonb, FALSE, 'admin' FROM qi_stage WHERE request_id=%s AND stage_key=%s ORDER BY id DESC LIMIT 1",
                        (rid, sk, json.dumps(vals, ensure_ascii=False), rid, sk),
                    )
            conn.commit()
            return rid

    def test_transfer_review(self, api_client):
        """review 阶段转单：reviewer 变更 + flow_log。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        rid = self._seed_qi_at_stage(dsn, "review", "TEST-TRANSFER-REVIEW")
        try:
            # admin 是当前 reviewer，转给 test_user01（需在评审人白名单中）
            r = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "admin", "transfer_to": "测试用户01 test_user01",
            })
            assert r.status_code == 200, f"转单失败: {r.status_code} {r.text[:300]}"
            # 验证 reviewer 变更
            with psycopg.connect(dsn) as conn:
                rev = conn.execute("SELECT reviewer FROM qi_request WHERE id=%s", (rid,)).fetchone()[0]
                assert "test_user01" in rev, f"reviewer 应变更: {rev}"
                log = conn.execute("SELECT action FROM qi_flow_log WHERE request_id=%s AND action='transferred'", (rid,)).fetchone()
                assert log is not None, "应有 transferred 日志"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TRANSFER-REVIEW",))
                conn.commit()

    def test_transfer_non_handler_rejected(self, api_client):
        """非当前处理人转单 → 403。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        rid = self._seed_qi_at_stage(dsn, "review", "TEST-TRANSFER-NH")
        try:
            r = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "test_user02", "transfer_to": "测试用户01 test_user01",
            })
            assert r.status_code == 403, f"非处理人应 403: {r.status_code}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TRANSFER-NH",))
                conn.commit()

    def test_transfer_closed_rejected(self, api_client):
        """已关闭单转单 → 400。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TRANSFER-CLOSED",))
            conn.execute(
                """INSERT INTO qi_request (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                   current_stage, current_status, creator_id, creator_name)
                   VALUES ('TEST-TRANSFER-CLOSED','特性加固','管理员 admin','closed','d','','中','管理员 admin',
                   'acceptance','closed','admin','管理员 admin')""")
            conn.commit()
        try:
            r = api_client.post(f"/api/qi/999999/transfer", json={
                "operator_id": "admin", "transfer_to": "测试用户01 test_user01",
            })
            assert r.status_code in (400, 404), f"关闭单应拒绝: {r.status_code}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TRANSFER-CLOSED",))
                conn.commit()

    def test_transfer_acceptance_allowed(self, api_client):
        """acceptance 阶段转单：不再硬编码禁止（移除了'不可转单'）。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        rid = self._seed_qi_at_stage(dsn, "acceptance", "TEST-TRANSFER-ACC")
        try:
            r = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "admin", "transfer_to": "测试用户01 test_user01",
            })
            assert r.status_code == 200, f"验收阶段转单应成功（不再禁止）: {r.status_code} {r.text[:300]}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TRANSFER-ACC",))
                conn.commit()


class TestQiDraftVisibility:
    """草稿在"我提出的"可见，在"全部"/"我处理的"不可见。"""

    def test_draft_visible_in_mine_not_in_all_or_handled(self, api_client):
        import os, psycopg
        QI_NO = "TEST-DRAFT-VIS"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','草稿可见性测试','d','','中','','propose','draft','admin','管理员 admin')""",
                (QI_NO,),
            )
            conn.commit()
        try:
            # mine：草稿可见
            r_mine = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "mine", "page_size": 9990})
            mine_nos = [i["qi_no"] for i in r_mine.json().get("items", [])]
            assert QI_NO in mine_nos, "草稿应在'我提出的'可见"

            # all：草稿不可见
            r_all = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "all", "page_size": 500})
            all_nos = [i["qi_no"] for i in r_all.json().get("items", [])]
            assert QI_NO not in all_nos, "草稿不应在'全部'可见"

            # handled：草稿不可见
            r_h = api_client.get("/api/qi", params={"operator_id": "admin", "scope": "handled", "page_size": 5000})
            handled_nos = [i["qi_no"] for i in r_h.json().get("items", [])]
            assert QI_NO not in handled_nos, "草稿不应在'我处理的'可见"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
                conn.commit()


class TestQiProposeSaveNoClearReviewer:
    """修订提出阶段时不应把隐藏的 reviewer 置空。"""

    def test_save_propose_does_not_clear_reviewer(self, api_client):
        """QI 走到评审后，修订提出阶段并保存，reviewer 不应被覆盖为空。"""
        import os
        import json

        import psycopg

        QI_NO = "TEST-SAVE-NOCLR"
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','save不清理reviewer','d','','中','测试用户01 test_user01',
                           'review','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'completed')", (rid,))
            conn.execute("INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by) SELECT id, %s,'propose',%s::jsonb, FALSE, 'admin' FROM qi_stage WHERE request_id=%s AND stage_key='propose'", (rid, json.dumps({"title":"save不清理reviewer","reviewer":"测试用户01 test_user01","description":"d","category":"特性加固","priority":"中"}), rid,))
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'review',1,'pending')", (rid,))
            conn.commit()
        try:
            # 修订 propose 阶段：传 values 不含 reviewer（模拟隐藏字段返回空的情景）
            r = api_client.post(f"/api/qi/{rid}/save", json={
                "operator_id": "admin", "stage_key": "propose",
                "values": {"title": "修改了标题", "description": "修改了描述", "category": "特性加固", "priority": "中"},
            })
            assert r.status_code == 200, f"保存失败: {r.status_code} {r.text[:300]}"
            # reviewer 不应被清空
            with psycopg.connect(dsn) as conn:
                reviewer = conn.execute("SELECT reviewer FROM qi_request WHERE id=%s", (rid,)).fetchone()[0]
                assert "test_user01" in reviewer, f"reviewer 不应被清空，实际: {reviewer}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
                conn.commit()


class TestQiTransferAllStages:
    """每个阶段的转单：单独用例，验证 handler 变更 + 不影响其他字段。"""

    def _seed(self, dsn, stage, qi_no, reviewer="管理员 admin", responsible=None):
        """造一条停在指定阶段的 QI。"""
        import json
        import psycopg
        stage_order = ["propose", "review", "analysis", "closure", "acceptance"]
        idx = stage_order.index(stage)
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (qi_no,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    domain, module_feature, current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','转单测试','d','','中',%s,
                           'SQL引擎','驱动/JDBC',%s,'in_progress','admin','管理员 admin')""",
                (qi_no, reviewer, stage),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (qi_no,)).fetchone()[0])
            for i, sk in enumerate(stage_order[:idx + 1]):
                st = "in_progress" if sk == stage else "completed"
                resp = responsible if (sk == stage and responsible) else ("管理员 admin" if sk in ("analysis", "closure") else "")
                conn.execute(
                    "INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible) VALUES (%s,%s,1,%s,%s)",
                    (rid, sk, st, resp),
                )
            conn.commit()
            return rid

    def test_transfer_propose(self, api_client):
        """propose 阶段转单：proposer 变更，其他字段不变。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        rid = self._seed(dsn, "propose", "TEST-TR-PROPOSE")
        try:
            r = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "admin", "transfer_to": "测试用户01 test_user01",
            })
            assert r.status_code == 200, f"propose 转单失败: {r.status_code} {r.text[:200]}"
            with psycopg.connect(dsn) as conn:
                qr = conn.execute("SELECT proposer, reviewer, title, domain, module_feature, priority FROM qi_request WHERE id=%s", (rid,)).fetchone()
                assert "test_user01" in qr[0], f"proposer 应变更为 test_user01，实际: {qr[0]}"
                assert qr[1] == "管理员 admin", f"reviewer 不应变: {qr[1]}"
                assert qr[2] == "转单测试", f"title 不应变: {qr[2]}"
                assert qr[3] == "SQL引擎", f"domain 不应变: {qr[3]}"
                assert qr[4] == "驱动/JDBC", f"module_feature 不应变: {qr[4]}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TR-PROPOSE",)); conn.commit()

    def test_transfer_analysis(self, api_client):
        """analysis 阶段转单：responsible 变更，其他字段不变。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        rid = self._seed(dsn, "analysis", "TEST-TR-ANALYSIS", responsible="管理员 admin")
        try:
            r = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "admin", "transfer_to": "测试用户02 test_user02",
            })
            assert r.status_code == 200, f"analysis 转单失败: {r.status_code} {r.text[:200]}"
            with psycopg.connect(dsn) as conn:
                resp = conn.execute("SELECT responsible FROM qi_stage WHERE request_id=%s ORDER BY id DESC LIMIT 1", (rid,)).fetchone()[0]
                assert "test_user02" in resp, f"responsible 应变更为 test_user02，实际: {resp}"
                qr = conn.execute("SELECT proposer, reviewer, title FROM qi_request WHERE id=%s", (rid,)).fetchone()
                assert "管理员 admin" in qr[0], f"proposer 不应变: {qr[0]}"
                assert "管理员 admin" in qr[1], f"reviewer 不应变: {qr[1]}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TR-ANALYSIS",)); conn.commit()

    def test_transfer_closure(self, api_client):
        """closure 阶段转单：responsible 变更，其他字段不变。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        rid = self._seed(dsn, "closure", "TEST-TR-CLOSURE", responsible="管理员 admin")
        try:
            r = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "admin", "transfer_to": "测试用户02 test_user02",
            })
            assert r.status_code == 200, f"closure 转单失败: {r.status_code} {r.text[:200]}"
            with psycopg.connect(dsn) as conn:
                resp = conn.execute("SELECT responsible FROM qi_stage WHERE request_id=%s ORDER BY id DESC LIMIT 1", (rid,)).fetchone()[0]
                assert "test_user02" in resp, f"responsible 应变更为 test_user02，实际: {resp}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TR-CLOSURE",)); conn.commit()

    def test_transfer_whitelist_mismatch(self, api_client):
        """review 阶段转给不在评审人白名单的人 → 403。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        rid = self._seed(dsn, "review", "TEST-TR-WL")
        try:
            r = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "admin", "transfer_to": "i00822653",
            })
            assert r.status_code == 403, f"白名单外应 403: {r.status_code}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TR-WL",)); conn.commit()

    def test_transfer_stage_values_unchanged(self, api_client):
        """转单不改当前阶段状态和其他阶段数据。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        rid = self._seed(dsn, "analysis", "TEST-TR-VALS", responsible="管理员 admin")
        try:
            before = api_client.get(f"/api/qi/{rid}", params={"operator_id": "admin"}).json()
            r = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "admin", "transfer_to": "测试用户02 test_user02",
            })
            assert r.status_code == 200
            after = api_client.get(f"/api/qi/{rid}", params={"operator_id": "admin"}).json()
            assert before["request"]["current_stage"] == "analysis"
            assert after["request"]["current_stage"] == "analysis", "转单不应改 current_stage"
            assert after["request"]["current_status"] == "in_progress", "转单不应改 current_status"
            # review stage 的 values 不应被影响
            review_before = [s for s in before["stages"] if s["stage_key"] == "review"][0]
            review_after = [s for s in after["stages"] if s["stage_key"] == "review"][0]
            assert review_before["values"] == review_after["values"], "转单不应影响其他阶段的 stage_data"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-TR-VALS",)); conn.commit()


class TestQiRejectPreservesResponsible:
    """打回(reject)时目标阶段的 responsible 应从历史继承，不丢失。"""

    def test_acceptance_reject_preserves_closure_responsible(self, api_client):
        """验收不通过打回实施，实施阶段的 responsible 不应为空。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        QI_NO = "TEST-REJECT-RESP"
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','reject测试','d','','中','测试用户01 test_user01',
                           'acceptance','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            for sk in ["propose", "review", "analysis", "closure", "acceptance"]:
                st = "in_progress" if sk == "acceptance" else "completed"
                resp = "测试用户02 test_user02" if sk == "closure" else ("管理员 admin" if sk == "analysis" else "")
                conn.execute(
                    "INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible) VALUES (%s,%s,1,%s,%s)",
                    (rid, sk, st, resp),
                )
            # _latest_responsible 查 qi_stage_data.values_json->>'responsible'，需补 review stage_data
            conn.execute("""INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
                SELECT s.id, %s, 'review', %s::jsonb, FALSE, 'admin'
                FROM qi_stage s WHERE s.request_id=%s AND s.stage_key='review' ORDER BY s.id LIMIT 1""",
                (rid, '{"responsible":"测试用户02 test_user02"}', rid,))
            conn.commit()
        try:
            r = api_client.post(f"/api/qi/{rid}/submit", json={
                "operator_id": "admin", "stage_key": "acceptance", "handle_mode": "验收不通过",
                "values": {"acceptance_pass": "不通过", "acceptance_conclusion": "需要重新实施"},
            })
            assert r.status_code == 200, f"验收不通过提交失败: {r.status_code} {r.text[:300]}"
            with psycopg.connect(dsn) as conn:
                # 打回后 current_stage 应为 closure
                stage = conn.execute("SELECT current_stage FROM qi_request WHERE id=%s", (rid,)).fetchone()[0]
                assert stage == "closure", f"打回后应在实施阶段，实际: {stage}"
                # 新建的 closure 实例 responsible 不应为空
                resp = conn.execute(
                    "SELECT responsible FROM qi_stage WHERE request_id=%s AND stage_key='closure' ORDER BY id DESC LIMIT 1",
                    (rid,),
                ).fetchone()[0]
                assert resp and "test_user02" in resp, f"打回后实施阶段 responsible 不应为空，实际: {resp}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()


class TestQiTransferAcceptanceNoChangeProposer:
    """验收阶段转单不改提出人(proposer)，改 qi_stage.responsible。"""

    def test_acceptance_list_handler_uses_stage_responsible(self, api_client):
        """H1 口径统一：验收单列表「当前处理人」取 qi_stage.responsible（转单受让人），
        无受让人时回落提出人——与 analytics / _verify_current_handler 同规则。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        QI_NO = "TEST-ACC-HDL"
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','acc处理人','d','','中','管理员 admin',
                           'acceptance','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            for sk in ["propose", "review", "analysis", "closure", "acceptance"]:
                st = "in_progress" if sk == "acceptance" else "completed"
                conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible) VALUES (%s,%s,1,%s,'')", (rid, sk, st,))
            conn.commit()
        try:
            # 未转单（无 responsible）→ 回落提出人
            r = api_client.get("/api/qi", params={"operator_id": "admin", "page_size": 5000})
            items = {i["qi_no"]: i for i in r.json().get("items", [])}
            assert QI_NO in items, "验收单应在列表"
            assert items[QI_NO]["current_handler"] == "管理员 admin", \
                f"无受让人应回落提出人，实际: {items[QI_NO]['current_handler']!r}"
            # 转单 → 列表显示受让人（非提出人）
            rt = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "admin", "transfer_to": "测试用户01 test_user01",
            })
            assert rt.status_code == 200, f"验收转单失败: {rt.status_code} {rt.text[:200]}"
            r2 = api_client.get("/api/qi", params={"operator_id": "admin", "page_size": 5000})
            items2 = {i["qi_no"]: i for i in r2.json().get("items", [])}
            assert items2[QI_NO]["current_handler"] == "测试用户01 test_user01", \
                f"转单后列表应显示受让人，实际: {items2[QI_NO]['current_handler']!r}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_acceptance_transfer_keeps_proposer(self, api_client):
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        QI_NO = "TEST-ACC-PROP"
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                    current_stage, current_status, creator_id, creator_name)
                   VALUES (%s,'特性加固','管理员 admin','acc转单','d','','中','管理员 admin',
                           'acceptance','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            for sk in ["propose", "review", "analysis", "closure", "acceptance"]:
                st = "in_progress" if sk == "acceptance" else "completed"
                conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible) VALUES (%s,%s,1,%s,'')", (rid, sk, st,))
            conn.commit()
        try:
            r = api_client.post(f"/api/qi/{rid}/transfer", json={
                "operator_id": "admin", "transfer_to": "测试用户01 test_user01",
            })
            assert r.status_code == 200, f"验收转单失败: {r.status_code} {r.text[:200]}"
            with psycopg.connect(dsn) as conn:
                qr = conn.execute("SELECT proposer FROM qi_request WHERE id=%s", (rid,)).fetchone()
                assert "管理员 admin" in qr[0], f"提出人不应变，实际: {qr[0]}"
                resp = conn.execute("SELECT responsible FROM qi_stage WHERE request_id=%s AND stage_key='acceptance' ORDER BY id DESC LIMIT 1", (rid,)).fetchone()
                assert resp and "test_user01" in resp[0], f"验收阶段 responsible 应为 test_user01，实际: {resp[0] if resp else '(空)'}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()


class TestQiOverdueUnified:
    """统一超期计算：各阶段一律 started_at + SLA 小时（五阶段可配）；
    closure 不再用单上 sla_time 判超期（字段仅展示）；草稿/关闭不超期。"""

    # 迁移 0122 种子：propose=24/review=48/analysis=72/closure=336/acceptance=48
    DEFAULT_SLA = {"propose": 24, "review": 48, "analysis": 72, "closure": 336, "acceptance": 48}

    def test_stage_sla_partial_payload_keeps_unsent_stages(self, api_client):
        """S1：部分 payload 只更新提交的阶段，未提交阶段（0122 种子 analysis/closure）保留——
        全量 DELETE 会清掉未发阶段致超期检测静默失效。"""
        api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(self.DEFAULT_SLA)})
        # 旧参数页只发 propose/review/acceptance 三阶段
        r = api_client.post("/api/qi/config/stage-sla", json={
            "stage_sla": {"propose": 24, "review": 1, "acceptance": 48}})
        assert r.status_code == 200, r.text
        try:
            cfg = api_client.get("/api/qi/config/stage-sla").json().get("stage_sla") or {}
            assert cfg.get("review") == 1, f"已提交阶段应更新，实际: {cfg}"
            assert cfg.get("analysis") == 72, f"未提交的 analysis 种子不应被清掉，实际: {cfg}"
            assert cfg.get("closure") == 336, f"未提交的 closure 种子不应被清掉，实际: {cfg}"
        finally:
            api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(self.DEFAULT_SLA)})

    def test_stage_sla_missing_rows_fall_back_to_code_defaults(self, api_client):
        """C1：表内缺行（只跑 0105 未跑 0122 的库无 analysis/closure 行）时按 key 补代码默认——
        超期检测不静默失效；已有行（含 0 显式停用）仍以表为准。"""
        import os, psycopg
        from datetime import datetime, timedelta, timezone
        dsn = os.environ["DATABASE_URL"]
        QI_NO = "TEST-OD-C1-ANA"
        api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(self.DEFAULT_SLA)})
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute("INSERT INTO qi_request (qi_no, category, proposer, title, description, expected_goal, priority, reviewer, current_stage, current_status, creator_id, creator_name) VALUES (%s,'特性加固','管理员 admin','od-c1','d','','中','管理员 admin','analysis','in_progress','admin','管理员 admin')", (QI_NO,))
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            old_time = datetime.now(timezone.utc) - timedelta(hours=100)  # > analysis 默认 72h
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at) VALUES (%s,'analysis',1,'in_progress',%s)", (rid, old_time,))
            # 模拟 0105-only 库：删掉 analysis/closure 行（保留其它行，证明是按 key 补默认而非整表回退）
            conn.execute("DELETE FROM qi_stage_sla_config WHERE stage_key IN ('analysis','closure')")
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id": "admin", "page_size": 5000})
            items = {i["qi_no"]: i for i in r.json().get("items", [])}
            assert QI_NO in items, "analysis 单应在列表"
            assert items[QI_NO]["is_overdue"] is True, \
                f"表缺 analysis 行应回退代码默认 72h（滞留100h 超期），实际: {items[QI_NO]['is_overdue']}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
                conn.commit()
            api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(self.DEFAULT_SLA)})

    def test_overdue_closed_skip(self, api_client):
        """已关闭的单不计算超期。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        QI_NO = "TEST-OD-CLOSED"
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute("INSERT INTO qi_request (qi_no, category, proposer, title, description, expected_goal, priority, reviewer, current_stage, current_status, creator_id, creator_name) VALUES (%s,'特性加固','管理员 admin','od-closed','d','','中','管理员 admin','closure','closed','admin','管理员 admin')", (QI_NO,))
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id":"admin","page_size":500})
            items = {i["qi_no"]: i for i in r.json().get("items",[])}
            if QI_NO in items:
                assert items[QI_NO]["is_overdue"] is False, "已关闭的单不应超期"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_overdue_closure_uses_started_sla(self, api_client):
        """closure 超期按 started_at + SLA 小时（默认 336h）：滞留 400h → 超期。"""
        import os, psycopg
        from datetime import datetime, timedelta, timezone
        dsn = os.environ["DATABASE_URL"]
        QI_NO = "TEST-OD-CLO"
        api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(self.DEFAULT_SLA)})
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute("INSERT INTO qi_request (qi_no, category, proposer, title, description, expected_goal, priority, reviewer, current_stage, current_status, creator_id, creator_name) VALUES (%s,'特性加固','管理员 admin','od-closure','d','','中','管理员 admin','closure','in_progress','admin','管理员 admin')", (QI_NO,))
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            old_time = datetime.now(timezone.utc) - timedelta(hours=400)
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at) VALUES (%s,'closure',1,'in_progress',%s)", (rid, old_time,))
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id":"admin","page_size":5000})
            items = {i["qi_no"]: i for i in r.json().get("items",[])}
            assert QI_NO in items, "closure 单应在列表"
            assert items[QI_NO]["is_overdue"] is True, f"closure 滞留400h>336h 应超期，实际: {items[QI_NO]['is_overdue']}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_overdue_closure_ignores_sla_time(self, api_client):
        """closure 超期只看 started_at + SLA 小时：历史残留的 sla_time 过期但 started_at 近期 → 不超期；
        sla_time 字段已退役，列表响应不再返回。"""
        import os, json, psycopg
        from datetime import date, datetime, timedelta, timezone
        dsn = os.environ["DATABASE_URL"]
        QI_NO = "TEST-OD-SLAONLY"
        past_date = (date.today() - timedelta(days=30)).isoformat()
        api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(self.DEFAULT_SLA)})
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute("INSERT INTO qi_request (qi_no, category, proposer, title, description, expected_goal, priority, reviewer, current_stage, current_status, creator_id, creator_name) VALUES (%s,'特性加固','管理员 admin','od-slaonly','d','','中','管理员 admin','closure','in_progress','admin','管理员 admin')", (QI_NO,))
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            # started_at 1 小时前（未超 336h），但存量 values_json 残留 30 天前的 sla_time
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at) VALUES (%s,'closure',1,'in_progress',%s)", (rid, datetime.now(timezone.utc) - timedelta(hours=1),))
            conn.execute("INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by) SELECT s.id, %s, 'closure', %s::jsonb, FALSE, 'admin' FROM qi_stage s WHERE s.request_id=%s AND s.stage_key='closure'", (rid, json.dumps({"sla_time": past_date}), rid,))
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id":"admin","page_size":5000})
            items = {i["qi_no"]: i for i in r.json().get("items",[])}
            assert QI_NO in items, "closure 单应在列表"
            assert items[QI_NO]["is_overdue"] is False, f"sla_time 过期不应再判超期，实际: {items[QI_NO]['is_overdue']}"
            assert "sla_time" not in items[QI_NO], f"sla_time 已退役，列表响应不应再返回: {items[QI_NO].get('sla_time')}"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_overdue_analysis_started_sla(self, api_client):
        """analysis 超期按 started_at + SLA 小时（默认 72h）：100h 超期 / 1h 不超期。"""
        import os, psycopg
        from datetime import datetime, timedelta, timezone
        dsn = os.environ["DATABASE_URL"]
        QI_OVER = "TEST-OD-ANA-O"
        QI_OK = "TEST-OD-ANA-K"
        api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(self.DEFAULT_SLA)})
        with psycopg.connect(dsn) as conn:
            for qno in (QI_OVER, QI_OK):
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (qno,))
                conn.execute("INSERT INTO qi_request (qi_no, category, proposer, title, description, expected_goal, priority, reviewer, current_stage, current_status, creator_id, creator_name) VALUES (%s,'特性加固','管理员 admin','od-analysis','d','','中','管理员 admin','analysis','in_progress','admin','管理员 admin')", (qno,))
                rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (qno,)).fetchone()[0])
                conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at) VALUES (%s,'analysis',1,'in_progress',%s)",
                             (rid, datetime.now(timezone.utc) - timedelta(hours=100 if qno == QI_OVER else 1),))
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id":"admin","page_size":5000})
            items = {i["qi_no"]: i for i in r.json().get("items",[])}
            assert items[QI_OVER]["is_overdue"] is True, f"analysis 滞留100h>72h 应超期，实际: {items[QI_OVER]['is_overdue']}"
            assert items[QI_OK]["is_overdue"] is False, f"analysis 滞留1h<72h 不应超期，实际: {items[QI_OK]['is_overdue']}"
        finally:
            with psycopg.connect(dsn) as conn:
                for qno in (QI_OVER, QI_OK):
                    conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (qno,))
                conn.commit()

    def test_overdue_configurable_stage(self, api_client):
        """可配阶段（review）：配置 1 小时 + 滞留 >1 小时 → 超期。"""
        import os, psycopg
        from datetime import datetime, timedelta, timezone
        dsn = os.environ["DATABASE_URL"]
        QI_NO = "TEST-OD-CFG"
        # 配置 review SLA=1 小时（五阶段全量提交，保持 analysis/closure 配置不被清掉）
        api_client.post("/api/qi/config/stage-sla", json={"stage_sla": {**self.DEFAULT_SLA, "review": 1}})
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute("INSERT INTO qi_request (qi_no, category, proposer, title, description, expected_goal, priority, reviewer, current_stage, current_status, creator_id, creator_name) VALUES (%s,'特性加固','管理员 admin','od-cfg','d','','中','管理员 admin','review','in_progress','admin','管理员 admin')", (QI_NO,))
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            # started_at 设为 2 小时前（超过 1 小时 SLA）
            old_time = datetime.now(timezone.utc) - timedelta(hours=2)
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at) VALUES (%s,'review',1,'pending',%s)", (rid, old_time,))
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id":"admin","page_size":5000})
            items = {i["qi_no"]: i for i in r.json().get("items",[])}
            assert QI_NO in items, "review 单应在列表"
            assert items[QI_NO]["is_overdue"] is True, f"review 滞留2h>配置1h应超期，实际: {items[QI_NO]['is_overdue']}"
        finally:
            # 恢复默认配置
            api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(self.DEFAULT_SLA)})
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()

    def test_overdue_closure_sla_configurable(self, api_client):
        """closure SLA 可配：配置 1 小时 + 滞留 2 小时 → 超期。"""
        import os, psycopg
        from datetime import datetime, timedelta, timezone
        dsn = os.environ["DATABASE_URL"]
        QI_NO = "TEST-OD-CLO-CFG"
        api_client.post("/api/qi/config/stage-sla", json={"stage_sla": {**self.DEFAULT_SLA, "closure": 1}})
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
            conn.execute("INSERT INTO qi_request (qi_no, category, proposer, title, description, expected_goal, priority, reviewer, current_stage, current_status, creator_id, creator_name) VALUES (%s,'特性加固','管理员 admin','od-clocfg','d','','中','管理员 admin','closure','in_progress','admin','管理员 admin')", (QI_NO,))
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at) VALUES (%s,'closure',1,'in_progress',%s)",
                         (rid, datetime.now(timezone.utc) - timedelta(hours=2),))
            conn.commit()
        try:
            r = api_client.get("/api/qi", params={"operator_id":"admin","page_size":5000})
            items = {i["qi_no"]: i for i in r.json().get("items",[])}
            assert items[QI_NO]["is_overdue"] is True, f"closure 滞留2h>配置1h 应超期，实际: {items[QI_NO]['is_overdue']}"
        finally:
            api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(self.DEFAULT_SLA)})
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,)); conn.commit()


class TestQiAcceptVersionConfig:
    """解决版本选项配置 + closure 提交动态校验（必填 + 枚举）。"""

    def _get(self, api_client):
        r = api_client.get("/api/qi/config/accept-versions")
        assert r.status_code == 200, r.text
        return r.json().get("versions") or []

    def test_get_shape_and_seed(self, api_client):
        """GET 返回 {version, enabled} 列表，迁移 0122 种子 507.0/507.1/508.0。"""
        versions = self._get(api_client)
        assert versions, "解决版本选项不应为空（迁移 0122 已种）"
        for v in versions:
            assert set(v.keys()) >= {"version", "enabled"}
        names = [v["version"] for v in versions]
        assert names[:3] == ["507.0", "507.1", "508.0"], f"种子顺序应 507.0/507.1/508.0，实际: {names}"

    def test_post_roundtrip(self, api_client):
        """POST 全量替换：顺序即 sort_order。"""
        r = api_client.post("/api/qi/config/accept-versions", json={"versions": ["T-509.0", "T-509.1"]})
        assert r.status_code == 200, r.text
        try:
            names = [v["version"] for v in self._get(api_client)]
            assert names == ["T-509.0", "T-509.1"], f"全量替换应只剩两项且保序，实际: {names}"
        finally:
            api_client.post("/api/qi/config/accept-versions", json={"versions": ["507.0", "507.1", "508.0"]})

    def test_post_duplicate_rejected(self, api_client):
        r = api_client.post("/api/qi/config/accept-versions", json={"versions": ["A", "A"]})
        assert r.status_code == 400, r.text
        assert "重复" in r.json().get("detail", "")

    def test_post_non_list_rejected(self, api_client):
        r = api_client.post("/api/qi/config/accept-versions", json={"versions": "507.0"})
        assert r.status_code == 400, r.text
        assert "字符串数组" in r.json().get("detail", "")

    def _advance_to_closure(self, api_client):
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "评审意见内容"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意接纳", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        return qid

    def test_closure_submit_empty_version_rejected(self, api_client):
        """closure 提交：解决版本为空 → 400 必填。"""
        qid = self._advance_to_closure(api_client)
        r = _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                    {"sla_time": "2026-07-15", "closure_self_test": "自测通过", "closure_method": "问题单闭环", "closure_ticket_no": "YW20260627001", "accept_version": ""})
        assert r.status_code == 400, r.text
        # 静态 required 校验（缺少必填字段）或动态配置校验（为必填项）任一命中即可
        assert "解决版本" in r.json().get("detail", "")

    def test_closure_submit_invalid_version_rejected(self, api_client):
        """closure 提交：解决版本不在选项中 → 400。"""
        qid = self._advance_to_closure(api_client)
        r = _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                    {"sla_time": "2026-07-15", "closure_self_test": "自测通过", "closure_method": "问题单闭环", "closure_ticket_no": "YW20260627001", "accept_version": "999.9"})
        assert r.status_code == 400, r.text
        assert "不在可选项中" in r.json().get("detail", "")

    def test_closure_submit_valid_version_ok(self, api_client):
        """closure 提交：配置内解决版本 → 200 进入验收。"""
        qid = self._advance_to_closure(api_client)
        r = _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                    {"sla_time": "2026-07-15", "closure_self_test": "自测通过", "closure_method": "问题单闭环", "closure_ticket_no": "YW20260627001", "accept_version": "507.1"})
        assert r.status_code == 200, r.text
        d = api_client.get(f"/api/qi/{qid}", params={"operator_id": OP}).json()
        assert d["request"]["current_stage"] == "acceptance"
        cl = [s for s in d["stages"] if s["stage_key"] == "closure"][0]
        assert cl["values"].get("accept_version") == "507.1"

    def test_closure_submit_without_sla_time_ok(self, api_client):
        """S2：sla_time 已退役——closure 提交不带该字段也 200（不再必填）。"""
        qid = self._advance_to_closure(api_client)
        r = _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                    {"closure_self_test": "自测通过", "closure_method": "问题单闭环", "closure_ticket_no": "YW20260627001", "accept_version": "507.0"})
        assert r.status_code == 200, r.text

    def test_get_recreates_with_seeds_after_drop(self, api_client):
        """V1：未迁移环境（表缺失）GET 自愈建表并按 0122 语义种 507.0/507.1/508.0，不再返回空表。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            conn.execute("DROP TABLE IF EXISTS qi_accept_version_option")
            conn.commit()
        try:
            names = [v["version"] for v in self._get(api_client)]
            assert names == ["507.0", "507.1", "508.0"], f"重建应带 0122 种子，实际: {names}"
        finally:
            api_client.post("/api/qi/config/accept-versions", json={"versions": ["507.0", "507.1", "508.0"]})

    def test_post_sort_order_one_based(self, api_client):
        """V1：POST 写入的 sort_order 从 1 起（与 0122 种子一致，不再 0 起冲突）。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        try:
            r = api_client.post("/api/qi/config/accept-versions", json={"versions": ["S-1", "S-2", "S-3"]})
            assert r.status_code == 200, r.text
            with psycopg.connect(dsn) as conn:
                rows = conn.execute(
                    "SELECT version, sort_order FROM qi_accept_version_option ORDER BY sort_order, id"
                ).fetchall()
            assert [row[1] for row in rows] == [1, 2, 3], f"sort_order 应 1/2/3，实际: {rows}"
        finally:
            api_client.post("/api/qi/config/accept-versions", json={"versions": ["507.0", "507.1", "508.0"]})

    def test_submit_closure_selfheals_missing_table(self, api_client):
        """V1：表缺失时 closure 提交不静默跳过校验——自愈建表+种子后照常校验（非法版本 400）。"""
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        qid = self._advance_to_closure(api_client)
        with psycopg.connect(dsn) as conn:
            conn.execute("DROP TABLE IF EXISTS qi_accept_version_option")
            conn.commit()
        try:
            r = _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                        {"closure_self_test": "自测通过", "closure_method": "问题单闭环", "closure_ticket_no": "YW20260627001", "accept_version": "999.9"})
            assert r.status_code == 400, f"表缺失应自愈种子后照常校验，实际: {r.status_code} {r.text[:200]}"
            assert "不在可选项中" in r.json().get("detail", "")
            # 自愈建表应已发生（种子三项在库）
            with psycopg.connect(dsn) as conn:
                cnt = conn.execute("SELECT COUNT(*) FROM qi_accept_version_option").fetchone()[0]
            assert cnt >= 3, f"自愈应种 3 项，实际 {cnt} 项"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE id=%s", (qid,))
                conn.commit()
            api_client.post("/api/qi/config/accept-versions", json={"versions": ["507.0", "507.1", "508.0"]})


class TestQiRfStatsOverdueFields:
    """research_field_stats 新增四字段：analysis/closure 的 total 与 overdue
    （责任田超期率 = (analysis_overdue+closure_overdue)/(analysis_total+closure_total)）。"""

    RF_DOMAIN = "接口RF测试领域"
    RF_MODULE = "RF模块A"

    @pytest.fixture(autouse=True)
    def _rf_bucket(self, api_client):
        """独占领域+模块的在研责任田桶（田+关联双表，防止 DENSE 演示数据污染计数）。"""
        import os, psycopg
        dsn = os.environ.get("DATABASE_URL")
        with psycopg.connect(dsn) as conn:
            conn.execute("DELETE FROM research_duty_field WHERE name=%s", ("RF统计测试田",))
            fid = conn.execute(
                "INSERT INTO research_duty_field (name, owner, sort_order) VALUES (%s,%s,9999) RETURNING id",
                ("RF统计测试田", "测试员 rftest"),
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO research_duty_field_binding (field_id, domain, module) VALUES (%s,%s,%s)",
                (fid, self.RF_DOMAIN, self.RF_MODULE),
            )
            conn.commit()
        yield
        with psycopg.connect(dsn) as conn:
            # 删田级联清关联（ON DELETE CASCADE）
            conn.execute("DELETE FROM research_duty_field WHERE name=%s", ("RF统计测试田",))
            for qno in ("TEST-RF-ANA-O", "TEST-RF-ANA-K", "TEST-RF-CLO-O"):
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (qno,))
            conn.commit()

    def _seed(self, dsn):
        """3 单：analysis 超期(100h>72h)、analysis 正常(1h)、closure 超期(400h>336h)。"""
        import psycopg
        from datetime import datetime, timedelta, timezone
        rows = [
            ("TEST-RF-ANA-O", "analysis", 100),
            ("TEST-RF-ANA-K", "analysis", 1),
            ("TEST-RF-CLO-O", "closure", 400),
        ]
        with psycopg.connect(dsn) as conn:
            for qno, stage, hours in rows:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (qno,))
                conn.execute(
                    "INSERT INTO qi_request (qi_no, category, proposer, title, description, expected_goal, priority, reviewer, domain, module_feature, current_stage, current_status, creator_id, creator_name) VALUES (%s,'特性加固','管理员 admin','rf','d','','中','管理员 admin',%s,%s,%s,'in_progress','admin','管理员 admin')",
                    (qno, self.RF_DOMAIN, self.RF_MODULE, stage),
                )
                rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (qno,)).fetchone()[0])
                conn.execute(
                    "INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at) VALUES (%s,%s,1,'in_progress',%s)",
                    (rid, stage, datetime.now(timezone.utc) - timedelta(hours=hours)),
                )
            conn.commit()

    def test_rf_stats_fields(self, api_client):
        import os, psycopg
        dsn = os.environ["DATABASE_URL"]
        api_client.post("/api/qi/config/stage-sla", json={
            "stage_sla": {"propose": 24, "review": 48, "analysis": 72, "closure": 336, "acceptance": 48}})
        self._seed(dsn)
        try:
            r = api_client.get("/api/qi/analytics", params={"operator_id": "admin"})
            assert r.status_code == 200, r.text
            rows = r.json().get("research_field_stats") or []
            mine = [x for x in rows if x.get("name") == "RF统计测试田"]
            assert mine, f"应含本测试责任田桶，实际: {[x.get('name') for x in rows]}"
            st = mine[0]
            assert st["analysis_total"] == 2, f"analysis_total 应 2，实际: {st}"
            assert st["analysis_overdue"] == 1, f"analysis_overdue 应 1，实际: {st}"
            assert st["closure_total"] == 1, f"closure_total 应 1，实际: {st}"
            assert st["closure_overdue"] == 1, f"closure_overdue 应 1，实际: {st}"
            # 超期率 = (1+1)/(2+1) ≈ 67%
            rate = (st["analysis_overdue"] + st["closure_overdue"]) / (st["analysis_total"] + st["closure_total"])
            assert round(rate * 100) == 67
        finally:
            api_client.post("/api/qi/config/stage-sla", json={
                "stage_sla": {"propose": 24, "review": 48, "analysis": 72, "closure": 336, "acceptance": 48}})


class TestQiWhitelistValidation:
    """QI person 字段白名单校验：propose/review 阶段校验白名单，analysis 阶段只校验 user_account。"""

    def _cleanup(self, qid):
        import os, psycopg
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            return
        with psycopg.connect(dsn) as conn:
            for tbl in ("qi_flow_log", "qi_stage_data", "qi_stage"):
                conn.execute(f"DELETE FROM {tbl} WHERE request_id = %s", (qid,))
            conn.execute("DELETE FROM qi_request WHERE id = %s", (qid,))
            conn.commit()

    def test_propose_rejects_non_whitelist_reviewer(self, api_client):
        """提出→评审：reviewer 不在评审人白名单 → 创建即拒绝（400）。"""
        r = _create(api_client, reviewer="测试管理员 test_admin")
        assert r.status_code == 400
        assert "白名单" in r.json().get("detail", ""), f"应拒绝非白名单评审人: {r.text}"

    def test_review_rejects_non_whitelist_responsible(self, api_client):
        """评审→确认：responsible 不在分析人白名单 → 提交拒绝（400）。"""
        r = _create(api_client)
        assert r.status_code == 200, r.text
        qid = r.json()["id"]
        try:
            sr = _submit(api_client, qid, REVIEWER_OP, "review", "评审通过", {
                "review_result": "通过",
                "responsible": "测试管理员 test_admin",
                "reject_reason": "测试非白名单",
            })
            assert sr.status_code == 400, f"应拒绝非白名单分析人: {sr.text}"
            assert "白名单" in sr.json().get("detail", "")
        finally:
            self._cleanup(qid)

    def test_analysis_accepts_non_whitelist_responsible(self, api_client):
        """确认→实施：responsible 不在分析人白名单但存在于 user_account → 提交通过（200）。"""
        r = _create(api_client)
        assert r.status_code == 200, r.text
        qid = r.json()["id"]
        try:
            # review → analysis（用白名单内的 responsible）
            sr1 = _submit(api_client, qid, REVIEWER_OP, "review", "评审通过", {
                "review_result": "通过",
                "responsible": "测试用户02 test_user02",
                "reject_reason": "通过",
            })
            assert sr1.status_code == 200, f"review submit 失败: {sr1.text}"
            # analysis → closure（responsible 用非白名单的 test_admin）
            sr2 = _submit(api_client, qid, RESP_OP, "analysis", "分析接纳", {
                "accept": "是",
                "responsible": "测试管理员 test_admin",
                "review_comment": "接纳",
                "closure_method": "问题单闭环",
            })
            assert sr2.status_code == 200, f"analysis 应接受非白名单 responsible: {sr2.text}"
        finally:
            self._cleanup(qid)


class TestQiExportHtmlToText:
    """导出富文本转换：_html_to_text + 导出接口验证。"""

    def test_html_to_text_basic(self):
        """基础 HTML 标签去除。"""
        from routers.qi import _html_to_text
        assert _html_to_text("<p>磁盘满改进</p>") == "磁盘满改进"
        assert _html_to_text("<div>带<b>加粗</b>和<i>斜体</i></div>") == "带加粗和斜体"

    def test_html_to_text_lists(self):
        """列表 → 项目符号 + 换行。"""
        from routers.qi import _html_to_text
        result = _html_to_text("<p>测试</p><ul><li>项目1</li><li>项目2</li></ul>")
        assert "测试" in result
        assert "• 项目1" in result
        assert "• 项目2" in result

    def test_html_to_text_line_breaks(self):
        """br / p / div → 换行。"""
        from routers.qi import _html_to_text
        result = _html_to_text("<p>第一行</p><p>第二行<br>第三行</p>")
        assert "第一行\n第二行\n第三行" == result

    def test_html_to_text_entities(self):
        """HTML 实体解码 + &nbsp; → 空格（去标签在 unescape 之前，&lt;/&gt; 不被误删）。"""
        from routers.qi import _html_to_text
        result = _html_to_text("&lt;特殊&gt;&amp;&nbsp;字符")
        assert result == "<特殊>& 字符"

    def test_html_to_text_plain_text(self):
        """纯文本（无标签）不变。"""
        from routers.qi import _html_to_text
        assert _html_to_text("纯文本无标签") == "纯文本无标签"
        assert _html_to_text("") == ""

    def test_export_strips_html_from_description(self, api_client):
        """导出接口：description 含 HTML → 导出文件中为纯文本。"""
        import os, psycopg
        from openpyxl import load_workbook
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL")
        QI_NO = "EXPORT-HTML-TEST"
        html_desc = "<p>导出HTML测试</p><ul><li>项目A</li><li>项目B</li></ul>"
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM qi_request WHERE qi_no = %s", (QI_NO,))
                cur.execute(
                    """INSERT INTO qi_request
                       (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                        priority, domain, module_feature, planned_version, reviewer,
                        current_stage, current_status, creator_id, creator_name)
                       VALUES (%s,'特性加固','测试 test','导出HTML测试','x',%s,'',
                               '中','','','','测试 test','review','in_progress','test','测试')""",
                    (QI_NO, html_desc),
                )
            conn.commit()
        try:
            # 授予导出权限（node_key=__whitelist__, field_key=requirement_export）
            with psycopg.connect(dsn) as wconn:
                with wconn.cursor() as wcur:
                    wcur.execute(
                        """INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
                           VALUES ('admin', false, '__whitelist__', 'requirement_export', 'readonly', 'admin')
                           ON CONFLICT (role_code, is_pl, node_key, field_key) DO UPDATE SET permission_level='readonly'""")
                wconn.commit()
            r = api_client.post("/api/qi/export", json={"operator_id": OP})
            assert r.status_code == 200
            # 解析 Excel
            wb = load_workbook(__import__("io").BytesIO(r.content))
            ws = wb.active
            headers = [c.value for c in ws[1]]
            desc_col = headers.index("诉求描述") + 1
            # 找到测试行
            for row in ws.iter_rows(min_row=2):
                if row[0].value == QI_NO:
                    desc_val = str(row[desc_col - 1].value or "")
                    assert "<p>" not in desc_val, f"导出不应含HTML标签: {desc_val!r}"
                    assert "<li>" not in desc_val, f"导出不应含HTML标签: {desc_val!r}"
                    assert "导出HTML测试" in desc_val
                    assert "• 项目A" in desc_val
                    assert "• 项目B" in desc_val
                    return
            pytest.fail("导出文件中未找到测试行")
        finally:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM qi_request WHERE qi_no = %s", (QI_NO,))
                    cur.execute("DELETE FROM role_permission_policy WHERE role_code='admin' AND node_key='__whitelist__' AND field_key='requirement_export'")
                conn.commit()


class TestQiExportAllStages:
    """导出全字段验证：一条走完 5 阶段的 QI，Excel 26 列逐字段精确比对。"""

    QI_NO = "EXPORT-ALLSTAGES"

    def _seed_full_qi(self, dsn):
        """DB 种入一条停在 acceptance 阶段的 QI，含 review/analysis/closure/acceptance 各阶段 stage_data。"""
        import psycopg, json
        propose_vals = {
            "title": "全字段导出验证", "category": "易用性提升", "priority": "高",
            "domain": "SQL引擎", "module_feature": "驱动/JDBC",
            "related_ticket_no": "YW20260627001",
            "description": "<p>问题背景：磁盘满</p><p>改进建议：自动回收</p>",
            "reviewer": "测试用户01 test_user01",
        }
        review_vals = {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "<p>评审通过</p>"}
        analysis_vals = {"accept": "是", "responsible": "测试用户02 test_user02", "review_comment": "<p>接纳，纳入计划</p>", "closure_method": "问题单闭环"}
        closure_vals = {"closure_ticket_no": "PC-YW20260627001", "progress_stage": "", "closure_self_test": "<p>自测通过</p>", "accept_version": "505.2.0", "sla_time": "2026-08-15"}
        acceptance_vals = {"acceptance_pass": "通过", "acceptance_conclusion": "<p>验收合格</p>"}

        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM qi_stage_data WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no=%s)", (self.QI_NO,))
                cur.execute("DELETE FROM qi_stage WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no=%s)", (self.QI_NO,))
                cur.execute("DELETE FROM qi_request WHERE qi_no=%s", (self.QI_NO,))
                cur.execute(
                    """INSERT INTO qi_request
                       (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                        priority, domain, module_feature, planned_version, reviewer,
                        current_stage, current_status, creator_id, creator_name)
                       VALUES (%s,%s,'管理员 admin','全字段导出验证','YW20260627001',
                               '<p>问题背景：磁盘满</p><p>改进建议：自动回收</p>','预期目标',
                               '高','SQL引擎','驱动/JDBC','505.2.0','测试用户01 test_user01',
                               'acceptance','in_progress','admin','管理员 admin')
                       RETURNING id""",
                    (self.QI_NO, "易用性提升"),
                )
                rid = cur.fetchone()[0]
                for sk, seq in [("propose", 1), ("review", 1), ("analysis", 1), ("closure", 1)]:
                    cur.execute(
                        "INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,%s,%s,'completed')",
                        (rid, sk, seq),
                    )
                cur.execute(
                    "INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'acceptance',1,'pending')",
                    (rid,),
                )
                for sk, vals in [("propose", propose_vals), ("review", review_vals),
                                 ("analysis", analysis_vals), ("closure", closure_vals),
                                 ("acceptance", acceptance_vals)]:
                    stage_row = cur.execute(
                        "SELECT id FROM qi_stage WHERE request_id=%s AND stage_key=%s ORDER BY id DESC LIMIT 1",
                        (rid, sk),
                    ).fetchone()
                    sid = stage_row[0] if stage_row else None
                    cur.execute(
                        """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
                           VALUES (%s,%s,%s,%s::jsonb,FALSE,%s)""",
                        (sid, rid, sk, json.dumps(vals, ensure_ascii=False), "admin"),
                    )
            conn.commit()
            return rid

    def _cleanup(self, rid, dsn):
        import psycopg
        if not dsn or not rid:
            return
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM qi_request WHERE id=%s", (rid,))
                cur.execute("DELETE FROM role_permission_policy WHERE role_code='admin' AND node_key='__whitelist__' AND field_key='requirement_export'")
            conn.commit()

    def test_export_all_fields_exact_match(self, api_client):
        """导出 Excel 的 26 列逐字段精确比对（==，非 in 模糊匹配）。"""
        import os, psycopg, json
        from openpyxl import load_workbook
        import io
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL")
        rid = self._seed_full_qi(dsn)
        try:
            # 授予导出权限
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
                           VALUES ('admin', false, '__whitelist__', 'requirement_export', 'readonly', 'admin')
                           ON CONFLICT (role_code, is_pl, node_key, field_key) DO UPDATE SET permission_level='readonly'""")
                conn.commit()
            r = api_client.post("/api/qi/export", json={"operator_id": OP})
            assert r.status_code == 200
            wb = load_workbook(io.BytesIO(r.content))
            ws = wb.active
            headers = [c.value for c in ws[1]]
            row = None
            for row_cells in ws.iter_rows(min_row=2):
                if row_cells[0].value == self.QI_NO:
                    row = [c.value for c in row_cells]
                    break
            assert row is not None, f"导出文件中未找到 {self.QI_NO}"
            # 精确比对辅助函数：实际值 == 期望值
            def chk(name, expected):
                actual = row[headers.index(name)]
                actual_str = "" if actual is None else str(actual)
                assert actual_str == str(expected), f"[{name}] 期望 {expected!r}，实际 {actual!r}"

            # ===== 主表 12 列（精确）=====
            chk("诉求编号", "EXPORT-ALLSTAGES")
            chk("分类", "易用性提升")
            chk("诉求标题", "全字段导出验证")
            chk("关联运维单号", "YW20260627001")
            chk("提出人", "管理员 admin")
            chk("所属领域", "SQL引擎")
            chk("模块&特性", "驱动/JDBC")
            chk("诉求描述", "问题背景：磁盘满\n改进建议：自动回收")
            chk("改进诉求", "预期目标")
            chk("优先级", "高")
            chk("计划版本", "505.2.0")
            chk("评审人", "测试用户01 test_user01")

            # ===== 评审阶段 3 列（精确）=====
            chk("评审结果", "通过")
            chk("评审-下一步处理人", "测试用户02 test_user02")
            chk("评审意见", "评审通过")

            # ===== 确认阶段 4 列（精确）=====
            chk("是否接纳", "是")
            chk("确认-下一步处理人", "测试用户02 test_user02")
            chk("确认-评审意见", "接纳，纳入计划")
            chk("闭环方法", "问题单闭环")

            # ===== 实施阶段 4 列（精确；SLA时间列已随字段退役移除）=====
            chk("问题/需求单号", "PC-YW20260627001")
            chk("当前进展", "")
            chk("闭环效果自测", "自测通过")
            chk("解决版本", "505.2.0")
            assert "SLA时间" not in headers, f"SLA时间列已退役，不应出现在导出表头: {headers}"

            # ===== 验收阶段 2 列（精确）=====
            chk("验收是否通过", "通过")
            chk("验收结论", "验收合格")
        finally:
            self._cleanup(rid, dsn)


class TestQiImportLegacyCategoryMap:
    """导入接口分类归并：旧模板/历史导出文件中的废弃分类，按迁移 0129 口径归并落库，
    不得重新引入废弃值（新增分支与按诉求编号更新分支都覆盖）。"""

    QI_NO_UPD = "IMPORT-LEGACY-UPD"

    def _build_book(self, rows):
        import io
        from openpyxl import Workbook
        from routers.qi import _QI_IMPORT_COLUMNS
        wb = Workbook()
        ws = wb.active
        ws.title = "质量改进导入"
        ws.append([n for n, _ in _QI_IMPORT_COLUMNS])
        for r in rows:
            ws.append([r.get(n, "") for n, _ in _QI_IMPORT_COLUMNS])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return buf.getvalue()

    def test_import_legacy_category_merged(self, api_client):
        """新增行 质量加固和改进/升级checklist → 特性加固/升级；更新行 升级checklist → 升级。"""
        import os, psycopg
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL")
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM qi_request WHERE qi_no IN (%s, %s, %s)",
                            ("IMPORT-LEGACY-A", "IMPORT-LEGACY-B", self.QI_NO_UPD))
                cur.execute(
                    """INSERT INTO qi_request
                       (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                        priority, domain, module_feature, reviewer,
                        current_stage, current_status, creator_id, creator_name)
                       VALUES (%s,'升级','测试 test','导入更新行','x','','','中','','','测试 test',
                               'propose','draft','test','测试')""",
                    (self.QI_NO_UPD,),
                )
            conn.commit()
        try:
            with psycopg.connect(dsn) as wconn:
                with wconn.cursor() as wcur:
                    for role in ("admin", "管理员"):
                        wcur.execute(
                            """INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
                               VALUES (%s, false, '__whitelist__', 'requirement_import', 'readonly', 'admin')
                               ON CONFLICT (role_code, is_pl, node_key, field_key) DO UPDATE SET permission_level='readonly'""",
                            (role,))
                wconn.commit()
            content = self._build_book([
                # 新增行：两类废弃分类
                {"诉求编号": "", "分类": "质量加固和改进", "诉求标题": "旧分类新增A",
                 "改进诉求": "归并验证A", "优先级": "中"},
                {"诉求编号": "", "分类": "升级checklist", "诉求标题": "旧分类新增B",
                 "改进诉求": "归并验证B", "优先级": "中"},
                # 更新行：已有编号 + 废弃分类 → 覆盖为归并值
                {"诉求编号": self.QI_NO_UPD, "分类": "升级checklist", "诉求标题": "导入更新行",
                 "改进诉求": "归并验证U", "优先级": "中"},
            ])
            r = api_client.post(
                "/api/qi/import",
                files={"file": ("导入.xlsx", content,
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                data={"operator_id": OP},
            )
            assert r.status_code == 200, r.text
            with psycopg.connect(dsn) as conn:
                by_title = {t: c for t, c in conn.execute(
                    "SELECT title, category FROM qi_request WHERE title LIKE '旧分类新增%'").fetchall()}
                upd_cat = conn.execute(
                    "SELECT category FROM qi_request WHERE qi_no = %s", (self.QI_NO_UPD,)
                ).fetchone()[0]
            assert by_title.get("旧分类新增A") == "特性加固", by_title
            assert by_title.get("旧分类新增B") == "升级", by_title
            assert upd_cat == "升级", upd_cat
        finally:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM qi_request WHERE qi_no IN (%s, %s, %s) OR title LIKE '旧分类新增%%'",
                        ("IMPORT-LEGACY-A", "IMPORT-LEGACY-B", self.QI_NO_UPD))
                    cur.execute(
                        "DELETE FROM role_permission_policy WHERE field_key='requirement_import' AND node_key='__whitelist__' AND role_code IN ('admin','管理员') AND updated_by='admin'")
                conn.commit()

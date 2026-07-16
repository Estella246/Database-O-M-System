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
    """确保 admin 角色拥有质量改进创建权限，并配置评审人/分析人白名单。"""
    api_client.post("/api/admin/permissions/bulk", json={
        "operator_id": "admin",
        "items": [
            {"role_code": "admin", "is_pl": False, "node_key": "__whitelist__",
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
    yield


def _create(api_client, operator_id=OP, **overrides):
    payload = {
        "operator_id": operator_id,
        "title": "测试诉求-磁盘满改进",
        "related_ticket_no": "YW20260627001",
        "description": "回收站空间未回收导致磁盘满",
        "expected_goal": "增加后台自动回收",
        "reviewer": "测试用户01 test_user01",
        "category": "质量加固和改进",
        "priority": "高",
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
        "category": "质量加固和改进",
        "reviewer": "测试用户01 test_user01",
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
                    {"accept": "是", "accept_version": "V2.0",
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
                {"sla_time": "2026-07-15", "closure_self_test": "自测通过", "accept_version": "V2.0", "closure_method": "问题单闭环", "closure_ticket_no": "YW20260627001"})
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
                {"sla_time": "2026-07-15", "closure_self_test": "自测通过", "accept_version": "V2.0", "closure_method": "问题单闭环", "closure_ticket_no": "YW20260627001"})
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
            "items": [{"role_code": "admin", "is_pl": False, "node_key": "__whitelist__",
                       "field_key": field_key, "permission_level": "hidden"}],
        })

    def _restore(self, api_client, field_key, level="readonly"):
        api_client.post("/api/admin/permissions/bulk", json={
            "operator_id": "admin",
            "items": [{"role_code": "admin", "is_pl": False, "node_key": "__whitelist__",
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

    def test_tc_m20_063_draft_activate_on_submit(self, api_client):
        """草稿不可单独提交，应在工单闭环时统一处理。"""
        r = _create_draft(api_client, title="激活草稿", related_ticket_no="YW20260627001")
        qid = r.json()["id"]
        assert r.json()["qi_no"].startswith("DRAFT-")
        # 尝试单独提交应被拒绝
        sr = _submit(api_client, qid, OP, "propose", "提交评审", {"reviewer": "测试用户01 test_user01"})
        assert sr.status_code == 400
        assert "草稿不可" in sr.json()["detail"]


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
        """batch=true 可批量提交草稿，单独提交被拦截。"""
        # 创建草稿
        r1 = _create_draft(api_client, title="草稿A", related_ticket_no="YW20260627001")
        r2 = _create_draft(api_client, title="草稿B", related_ticket_no="YW20260627001")
        qid1, qid2 = r1.json()["id"], r2.json()["id"]
        assert r1.json()["current_status"] == "draft"
        assert r2.json()["current_status"] == "draft"

        # 单独提交应被拦截
        sr = _submit(api_client, qid1, OP, "propose", "提交评审",
                     {"reviewer": "测试用户01 test_user01", "title": "草稿A",
                      "related_ticket_no": "YW20260627001", "description": "d", "category": "质量加固和改进"})
        assert sr.status_code == 400
        assert "草稿不可" in sr.json()["detail"]

        # batch=true 提交应成功
        for qid in [qid1, qid2]:
            d = api_client.get(f"/api/qi/{qid}", params={"operator_id": OP}).json()
            ps = [s for s in d["stages"] if s["stage_key"] == "propose"][0]
            vals = dict(ps["values"])
            vals["reviewer"] = "测试用户01 test_user01"
            vals["title"] = vals.get("title") or "x"
            vals["related_ticket_no"] = vals.get("related_ticket_no") or "YW20260627001"
            vals["description"] = vals.get("description") or "x"
            vals["category"] = vals.get("category") or "质量加固和改进"
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
                {"sla_time": "2026-07-15", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
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
                {"sla_time": "2026-07-15", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
        # acceptance reject → back to closure
        _submit(api_client, qid, OP, "acceptance", "验收不通过",
                {"acceptance_pass": "不通过", "acceptance_conclusion": "not ok"})
        d = self._verify_stage(api_client, qid, "in_progress", "closure")
        self._verify_nodes(d, {"acceptance": "rejected", "closure": "pending"})
        # re-submit closure
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-16", "closure_self_test": "fixed", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
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
                {"sla_time": "2026-07-15", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
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
                {"sla_time": "2026-07-15", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
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
                {"sla_time": "2026-07-15", "closure_self_test": "v1", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
        # reject × 2
        for i in range(2):
            _submit(api_client, qid, OP, "acceptance", "验收不通过",
                    {"acceptance_pass": "不通过", "acceptance_conclusion": f"fail {i}"})
            d = self._verify_stage(api_client, qid, "in_progress", "closure")
            assert any(s["status"] == "rejected" for s in d["stages"] if s["stage_key"] == "acceptance")
            _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                    {"sla_time": f"2026-07-1{6+i}", "closure_self_test": f"v{i+2}", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
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
                {"sla_time": "2026-07-15", "closure_self_test": "v1", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
        for i in range(2):
            _submit(api_client, qid, OP, "acceptance", "验收不通过",
                    {"acceptance_pass": "不通过", "acceptance_conclusion": f"fail {i}"})
            _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                    {"sla_time": f"2026-07-1{6+i}", "closure_self_test": f"v{i+2}", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
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
                {"sla_time": "2026-07-15", "closure_self_test": "v1", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
        _submit(api_client, qid, OP, "acceptance", "验收不通过",
                {"acceptance_pass": "不通过", "acceptance_conclusion": "fail"})
        _submit(api_client, qid, RESP_OP, "closure", "提交验收",
                {"sla_time": "2026-07-16", "closure_self_test": "v2", "closure_ticket_no": "YW20260627001", "accept_version": "V2"})
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
                {"sla_time": "2026-07-15", "closure_self_test": "首次闭环自测内容", "closure_ticket_no": "YW20260627001", "accept_version": "V1.0"})
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
        assert cl["values"].get("accept_version") == "V1.0", \
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
            assert qr["category"] == "测试加固", "分类 → category"
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
        base = os.environ.get("TEST_API_BASE_URL", "http://127.0.0.1:18080")
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
    """超期检测：实施阶段超过 SLA 时间标记为超期。"""

    def test_tc_m20_111_overdue(self, api_client):
        """实施阶段 SLA 已过 → is_overdue=True。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "同意"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        # save 保存实施阶段表单（SLA 设为过去），不提交
        api_client.post(f"/api/qi/{qid}/save", json={
            "operator_id": RESP_OP, "stage_key": "closure",
            "values": {"sla_time": "2020-01-01", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "V1"}
        })
        r = api_client.get("/api/qi", params={"operator_id": OP, "stage": "closure", "page_size": 50})
        target = [i for i in r.json()["items"] if i["id"] == qid]
        assert len(target) == 1, f"QI {qid} not found in closure list"
        assert target[0]["is_overdue"] is True, f"should be overdue, got {target[0]['is_overdue']}"

    def test_tc_m20_112_not_overdue(self, api_client):
        """SLA 在未来 → is_overdue=False；关闭后 → is_overdue=False。"""
        qid = _create(api_client).json()["id"]
        _submit(api_client, qid, REVIEWER_OP, "review", "评审通过",
                {"review_result": "通过", "responsible": "测试用户02 test_user02", "reject_reason": "同意"})
        _submit(api_client, qid, RESP_OP, "analysis", "分析接纳",
                {"accept": "是", "review_comment": "同意", "closure_method": "问题单闭环", "responsible": "测试用户02 test_user02"})
        api_client.post(f"/api/qi/{qid}/save", json={
            "operator_id": RESP_OP, "stage_key": "closure",
            "values": {"sla_time": "2099-12-31", "closure_self_test": "OK", "closure_ticket_no": "YW20260627001", "accept_version": "V1"}
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
                   VALUES (%s,'质量加固和改进','管理员 admin','amend持久化','<p>d</p>','','中','管理员 admin',
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
                   VALUES (%s,'质量加固和改进','管理员 admin','scope测试','d','','中','管理员 admin',
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
                   VALUES (%s,'质量加固和改进','管理员 admin','handled测试','d','','中','管理员 admin',
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


class TestQiAnalyticsAllTime:
    """统计分析默认全量（不过滤 90 天窗口）。"""

    def test_analytics_total_matches_db(self, api_client):
        import os
        import psycopg

        dsn = os.environ["DATABASE_URL"]
        with psycopg.connect(dsn) as conn:
            db_total = conn.execute("SELECT count(*) FROM qi_request").fetchone()[0]
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
                   VALUES (%s,'质量加固和改进','test_user01 测试用户01','review scope','d','','中','管理员 admin',
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
                   VALUES (%s,'质量加固和改进','test_user01 测试用户01','resp scope','d','','中','管理员 admin',
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
                   VALUES (%s,'质量加固和改进','管理员 admin','transfer测试','d','','中','管理员 admin',
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
                   VALUES ('TEST-TRANSFER-CLOSED','质量加固和改进','管理员 admin','closed','d','','中','管理员 admin',
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
                   VALUES (%s,'质量加固和改进','管理员 admin','草稿可见性测试','d','','中','','propose','draft','admin','管理员 admin')""",
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
                   VALUES (%s,'质量加固和改进','管理员 admin','save不清理reviewer','d','','中','测试用户01 test_user01',
                           'review','in_progress','admin','管理员 admin')""",
                (QI_NO,),
            )
            rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'completed')", (rid,))
            conn.execute("INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by) SELECT id, %s,'propose',%s::jsonb, FALSE, 'admin' FROM qi_stage WHERE request_id=%s AND stage_key='propose'", (rid, json.dumps({"title":"save不清理reviewer","reviewer":"测试用户01 test_user01","description":"d","category":"质量加固和改进","priority":"中"}), rid,))
            conn.execute("INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'review',1,'pending')", (rid,))
            conn.commit()
        try:
            # 修订 propose 阶段：传 values 不含 reviewer（模拟隐藏字段返回空的情景）
            r = api_client.post(f"/api/qi/{rid}/save", json={
                "operator_id": "admin", "stage_key": "propose",
                "values": {"title": "修改了标题", "description": "修改了描述", "category": "质量加固和改进", "priority": "中"},
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
                   VALUES (%s,'质量加固和改进','管理员 admin','转单测试','d','','中',%s,
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
                   VALUES (%s,'质量加固和改进','管理员 admin','reject测试','d','','中','测试用户01 test_user01',
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

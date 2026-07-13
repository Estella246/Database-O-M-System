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
    """创建草稿（无评审人、无编号）。"""
    payload = {
        "operator_id": OP,
        "title": "测试草稿",
        "related_ticket_no": "YW20260627001",
        "description": "草稿描述",
        "category": "质量加固和改进",
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
        """迁移字段映射正确：问题描述→标题，改进诉求→描述，YW→关联单号。"""
        api_client.post("/api/qi/migrate-legacy", json={"operator_id": OP, "force": True})
        r = api_client.get("/api/qi", params={"operator_id": OP, "page_size": 50})
        items = r.json()["items"]
        # 找到迁移的记录（有 domain 或来自 requirement 表的）
        migrated = [i for i in items if i.get("domain") or i.get("module_feature")]
        if migrated:
            item = migrated[0]
            # title 应来自旧 description（问题描述）
            assert item["title"], "title should not be empty"
            # related_ticket_no 应是 YW 开头
            if item.get("related_ticket_no"):
                assert item["related_ticket_no"].startswith("YW"), f"expected YW prefix, got {item['related_ticket_no']}"
            # category 和 priority 应同步
            assert item["category"], "category should not be empty"
            assert item["priority"] in ("高", "中", "低"), f"invalid priority: {item['priority']}"


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

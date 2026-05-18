"""热补丁并行 frontier 纯函数契约（无 DB）。"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))

from hotpatch_config import HOTPATCH_PARALLEL_SELF_MERGE
from hotpatch_flow import (
    hotpatch_frontier_handlers_display,
    hotpatch_frontier_stage_labels,
    sort_hotpatch_frontier_keys,
    sync_hotpatch_frontier_after_submit,
)
def test_sort_hotpatch_frontier_keys_order_and_dedupe():
    assert sort_hotpatch_frontier_keys(["hp_assign_test", "hp_assign_dev", "hp_assign_test"]) == [
        "hp_assign_dev",
        "hp_assign_test",
    ]


def test_hotpatch_frontier_stage_labels_joins_cn():
    s = hotpatch_frontier_stage_labels(["hp_assign_dev", "hp_assign_test"])
    assert "指定开发" in s and "指定测试" in s
    assert "，" in s


def test_hotpatch_frontier_handlers_display_parallel_handlers_and_plan_fallback():
    fc = {"parallel_handlers": {"hp_assign_dev": "张三 zhang", "hp_assign_test": "李四 li"}}
    fbn = {"hp_plan": {"开发人员": "王五 w", "测试人员": "赵六 z"}}
    h = hotpatch_frontier_handlers_display(fc, fbn, ["hp_assign_dev", "hp_assign_test"])
    assert "张三" in h and "李四" in h


def test_hotpatch_frontier_handlers_display_fallback_plan_fields():
    fc: dict = {}
    fbn = {"hp_plan": {"开发人员": "张三 a", "测试人员": "李四 b"}}
    h = hotpatch_frontier_handlers_display(fc, fbn, ["hp_dev_analysis", "hp_assign_test"])
    assert "张三" in h and "李四" in h


class _DummyConn:
    pass


def test_sync_hotpatch_frontier_noop_when_no_parallel_wave(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        "hotpatch_flow.save_flow_context", lambda conn, tid, ctx: calls.append((tid, ctx))
    )
    fc = {}
    out = sync_hotpatch_frontier_after_submit(
        _DummyConn(), 1, fc, "hp_ccb", "提交计划制定", "hp_plan", False
    )
    assert out == fc
    assert calls == []


def test_sync_assign_dev_forward_updates_frontier(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        "hotpatch_flow.save_flow_context", lambda conn, tid, ctx: calls.append((tid, dict(ctx)))
    )
    fc = {"p1": {"merge": "hp_walkthrough", "done": []}, "frontier": ["hp_assign_dev", "hp_assign_test"]}
    out = sync_hotpatch_frontier_after_submit(
        _DummyConn(), 1, fc, "hp_assign_dev", "提交开发分析", "hp_dev_analysis", False
    )
    assert set(out["frontier"]) == {"hp_dev_analysis", "hp_assign_test"}
    assert len(calls) == 1


def test_sync_four_self_checks_merge_sets_frontier_when_p2_already_cleared(monkeypatch):
    """汇合后 adjust 已移除 p2，sync 仍应根据 nxt=转测发起 写入 frontier（避免列表/详情阶段回退为四自检）。"""
    calls: list = []
    monkeypatch.setattr(
        "hotpatch_flow.save_flow_context", lambda conn, tid, ctx: calls.append((tid, dict(ctx)))
    )
    # 与 submit 成功后 load_flow_context 一致：无 p2，仅残留并行期 frontier
    fc = {"frontier": ["hp_eng_check"]}
    out = sync_hotpatch_frontier_after_submit(
        _DummyConn(),
        1,
        fc,
        "hp_eng_check",
        "提交转测发起",
        HOTPATCH_PARALLEL_SELF_MERGE,
        False,
    )
    assert out["frontier"] == [HOTPATCH_PARALLEL_SELF_MERGE]
    assert len(calls) == 1

"""HPM / YW 工单号正则与 ticket_global_seq 全局序号 a 分配。"""

from unittest.mock import MagicMock


def test_hpm_ticket_no_regex():
    from utils.ticket_no import _HPM_TICKET_NO_RE, _YW_TICKET_NO_RE

    assert _HPM_TICKET_NO_RE.fullmatch("HPM20260509001")
    assert not _HPM_TICKET_NO_RE.fullmatch("YW20260509001")
    assert not _HPM_TICKET_NO_RE.fullmatch("HPM2026050901")
    assert not _HPM_TICKET_NO_RE.fullmatch("HPM202605090012")
    assert _YW_TICKET_NO_RE.fullmatch("YW20260509001")


def test_allocate_yw_skips_taken_suffix_and_bumps_a(monkeypatch):
    from utils import ticket_no as mod

    monkeypatch.setattr(mod, "_today_ymd", lambda: "20260605")
    state = {"a": 41, "taken": {"YW20260605042"}}

    def fake_execute(sql, params=None):
        s = " ".join(str(sql).split())
        if "information_schema.tables" in s:
            return MagicMock(fetchone=lambda: {"x": 1})
        if "FROM ticket_global_seq" in s and "FOR UPDATE" in s:
            return MagicMock(fetchone=lambda: {"last_suffix": state["a"]})
        if "UPDATE ticket_global_seq" in s:
            state["a"] = int(params[0])
            return MagicMock()
        if "INSERT INTO ticket_global_seq" in s:
            return MagicMock()
        if "SELECT 1 FROM ticket WHERE ticket_no" in s:
            taken = params and params[0] in state["taken"]
            return MagicMock(fetchone=(lambda: {"x": 1} if taken else None))
        raise AssertionError(f"unexpected sql: {sql} params={params}")

    conn = MagicMock()
    conn.execute.side_effect = fake_execute

    result = mod.allocate_yw_ticket_no(conn)
    assert result == "YW20260605043"
    assert state["a"] == 43


def test_allocate_yw_wraps_999_to_000(monkeypatch):
    from utils import ticket_no as mod

    monkeypatch.setattr(mod, "_today_ymd", lambda: "20260605")
    state = {"a": 999, "taken": set()}

    def fake_execute(sql, params=None):
        s = " ".join(str(sql).split())
        if "information_schema.tables" in s:
            return MagicMock(fetchone=lambda: {"x": 1})
        if "FROM ticket_global_seq" in s and "FOR UPDATE" in s:
            return MagicMock(fetchone=lambda: {"last_suffix": state["a"]})
        if "UPDATE ticket_global_seq" in s:
            state["a"] = int(params[0])
            return MagicMock()
        if "INSERT INTO ticket_global_seq" in s:
            return MagicMock()
        if "SELECT 1 FROM ticket WHERE ticket_no" in s:
            no = params[0]
            if no.endswith("000"):
                state["taken"].add(no)
                return MagicMock(fetchone=lambda: {"x": 1})
            return MagicMock(fetchone=lambda: None)
        raise AssertionError(f"unexpected sql: {sql} params={params}")

    conn = MagicMock()
    conn.execute.side_effect = fake_execute

    result = mod.allocate_yw_ticket_no(conn)
    assert result == "YW20260605001"
    assert state["a"] == 1


def test_allocate_yw_retries_when_suffix_taken(monkeypatch):
    from utils import ticket_no as mod

    monkeypatch.setattr(mod, "_today_ymd", lambda: "20260605")
    state = {"a": 4, "taken": {"YW20260605005", "YW20260605006"}}

    def fake_execute(sql, params=None):
        s = " ".join(str(sql).split())
        if "information_schema.tables" in s:
            return MagicMock(fetchone=lambda: {"x": 1})
        if "FROM ticket_global_seq" in s and "FOR UPDATE" in s:
            return MagicMock(fetchone=lambda: {"last_suffix": state["a"]})
        if "UPDATE ticket_global_seq" in s:
            state["a"] = int(params[0])
            return MagicMock()
        if "INSERT INTO ticket_global_seq" in s:
            return MagicMock()
        if "SELECT 1 FROM ticket WHERE ticket_no" in s:
            taken = params and params[0] in state["taken"]
            return MagicMock(fetchone=(lambda: {"x": 1} if taken else None))
        raise AssertionError(f"unexpected sql: {sql} params={params}")

    conn = MagicMock()
    conn.execute.side_effect = fake_execute

    result = mod.allocate_yw_ticket_no(conn)
    assert result == "YW20260605007"
    assert state["a"] == 7

"""HPM / YW 工单号正则与 YW 序号分配（与 utils/ticket_no 一致）。"""

from unittest.mock import MagicMock


def test_hpm_ticket_no_regex():
    from utils.ticket_no import _HPM_TICKET_NO_RE, _YW_TICKET_NO_RE

    assert _HPM_TICKET_NO_RE.fullmatch("HPM20260509001")
    assert not _HPM_TICKET_NO_RE.fullmatch("YW20260509001")
    assert not _HPM_TICKET_NO_RE.fullmatch("HPM2026050901")
    assert not _HPM_TICKET_NO_RE.fullmatch("HPM202605090012")
    assert _YW_TICKET_NO_RE.fullmatch("YW20260509001")


def test_allocate_yw_ticket_no_increments_globally(monkeypatch):
    from utils import ticket_no as mod

    monkeypatch.setattr(mod, "datetime", MagicMock(now=lambda: MagicMock(strftime=lambda fmt: "20260605")))

    def fake_execute(sql, params=None):
        if "ORDER BY id DESC" in sql and "YW" in sql:
            return MagicMock(fetchone=lambda: {"suf": "042"})
        if "SELECT 1 FROM ticket WHERE ticket_no" in sql:
            return MagicMock(fetchone=lambda: None)
        raise AssertionError(f"unexpected sql: {sql}")

    conn = MagicMock()
    conn.execute.side_effect = fake_execute

    result = mod.allocate_yw_ticket_no(conn)
    assert result == "YW20260605043"


def test_allocate_yw_ticket_no_wraps_999_to_000(monkeypatch):
    from utils import ticket_no as mod

    monkeypatch.setattr(mod, "datetime", MagicMock(now=lambda: MagicMock(strftime=lambda fmt: "20260605")))

    def fake_execute(sql, params=None):
        if "ORDER BY id DESC" in sql and "YW" in sql:
            return MagicMock(fetchone=lambda: {"suf": "999"})
        if "SELECT 1 FROM ticket WHERE ticket_no" in sql:
            if params and params[0].endswith("000"):
                return MagicMock(fetchone=lambda: {"x": 1})
            return MagicMock(fetchone=lambda: None)
        raise AssertionError(f"unexpected sql: {sql}")

    conn = MagicMock()
    conn.execute.side_effect = fake_execute

    result = mod.allocate_yw_ticket_no(conn)
    assert result == "YW20260605001"


def test_allocate_hpm_ticket_no_increments_globally(monkeypatch):
    from utils import ticket_no as mod

    monkeypatch.setattr(mod, "datetime", MagicMock(now=lambda: MagicMock(strftime=lambda fmt: "20260605")))

    def fake_execute(sql, params=None):
        if "ORDER BY id DESC" in sql and "HPM" in sql:
            return MagicMock(fetchone=lambda: {"suf": "042"})
        if "SELECT 1 FROM ticket WHERE ticket_no" in sql:
            return MagicMock(fetchone=lambda: None)
        raise AssertionError(f"unexpected sql: {sql}")

    conn = MagicMock()
    conn.execute.side_effect = fake_execute

    result = mod.allocate_hpm_ticket_no(conn)
    assert result == "HPM20260605043"

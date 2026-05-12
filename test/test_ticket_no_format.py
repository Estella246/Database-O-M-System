"""HPM / YW 工单号正则（与 utils/ticket_no 一致）。"""


def test_hpm_ticket_no_regex():
    from utils.ticket_no import _HPM_TICKET_NO_RE, _YW_TICKET_NO_RE

    assert _HPM_TICKET_NO_RE.fullmatch("HPM20260509001")
    assert not _HPM_TICKET_NO_RE.fullmatch("YW20260509001")
    assert not _HPM_TICKET_NO_RE.fullmatch("HPM2026050901")
    assert not _HPM_TICKET_NO_RE.fullmatch("HPM202605090012")
    assert _YW_TICKET_NO_RE.fullmatch("YW20260509001")

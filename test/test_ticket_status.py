from utils.ticket_status import ticket_status_is_closed


def test_ticket_status_is_closed_english():
    assert ticket_status_is_closed("closed") is True
    assert ticket_status_is_closed("open") is False


def test_ticket_status_is_closed_legacy_chinese():
    assert ticket_status_is_closed("关闭") is True
    assert ticket_status_is_closed("进行中") is False
    assert ticket_status_is_closed("暂停") is False
    assert ticket_status_is_closed("问题审核关闭") is False

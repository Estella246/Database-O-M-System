from utils.ticket_status import (
    ticket_status_is_closed,
    ticket_status_is_temporary_suspended,
    ticket_status_writes_close_flow_log,
)


def test_ticket_status_is_closed_english():
    assert ticket_status_is_closed("closed") is True
    assert ticket_status_is_closed("open") is False


def test_ticket_status_is_closed_legacy_chinese():
    assert ticket_status_is_closed("关闭") is True
    assert ticket_status_is_closed("进行中") is False
    assert ticket_status_is_closed("暂停") is False
    assert ticket_status_is_closed("问题审核关闭") is False


def test_ticket_status_is_temporary_suspended():
    assert ticket_status_is_temporary_suspended("暂时挂起") is True
    assert ticket_status_is_temporary_suspended("suspended") is True
    assert ticket_status_is_temporary_suspended("暂停") is False
    assert ticket_status_is_temporary_suspended("进行中") is False


def test_ticket_status_writes_close_flow_log_only_close_and_non_issue():
    assert ticket_status_writes_close_flow_log("关闭") is True
    assert ticket_status_writes_close_flow_log("非问题关闭") is True
    assert ticket_status_writes_close_flow_log("closed") is True
    assert ticket_status_writes_close_flow_log("问题审核关闭") is False
    assert ticket_status_writes_close_flow_log("进行中") is False
    assert ticket_status_writes_close_flow_log("完成") is False
    assert ticket_status_writes_close_flow_log("已关闭") is False

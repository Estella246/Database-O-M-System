"""whitelist_policy：未配置键的默认级别须与前端 getWhitelistLevel 一致，避免误判仅问题填写导致全站 403。"""

from whitelist_policy import ticket_detail_only_problem_fill, ticket_list_only_self_created


def test_missing_ticket_detail_passed_nodes_not_treated_as_problem_fill_only():
    wl = {"ticket_list": "readonly"}
    assert ticket_list_only_self_created(wl) is False
    assert ticket_detail_only_problem_fill(wl) is False


def test_ticket_list_editable_means_only_self():
    wl = {"ticket_list": "editable"}
    assert ticket_list_only_self_created(wl) is True


def test_ticket_detail_passed_nodes_hidden_means_problem_fill_only():
    wl = {"ticket_detail_passed_nodes": "hidden"}
    assert ticket_detail_only_problem_fill(wl) is True

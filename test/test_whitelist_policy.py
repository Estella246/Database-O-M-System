"""whitelist_policy：未配置键的默认级别须与前端 getWhitelistLevel 一致，避免误判仅问题填写导致全站 403。"""

from whitelist_policy import (
    leave_application_all_only_self_applicant,
    ticket_detail_only_problem_fill,
    ticket_list_only_self_created,
    whitelist_permission_level,
)


def test_missing_ticket_detail_passed_nodes_not_treated_as_problem_fill_only():
    wl = {"ticket_list": "readonly"}
    assert ticket_list_only_self_created(wl) is False
    assert ticket_detail_only_problem_fill(wl) is False


def test_ticket_list_editable_means_only_self():
    wl = {"ticket_list": "editable"}
    assert ticket_list_only_self_created(wl) is True


def test_leave_application_all_editable_means_only_self_applicant():
    wl = {"leave_application_all": "editable"}
    assert leave_application_all_only_self_applicant(wl) is True


def test_leave_application_all_unconfigured_means_all():
    wl = {"leave_application": "readonly"}
    assert leave_application_all_only_self_applicant(wl) is False


def test_ticket_detail_passed_nodes_hidden_means_problem_fill_only():
    wl = {"ticket_detail_passed_nodes": "hidden"}
    assert ticket_detail_only_problem_fill(wl) is True


def test_workbench_delete_unconfigured_defaults_allow():
    wl = {}
    assert whitelist_permission_level(wl, "workbench_delete") == "readonly"


def test_workbench_delete_hidden_denies():
    wl = {"workbench_delete": "hidden"}
    assert whitelist_permission_level(wl, "workbench_delete") == "hidden"


def test_leave_delete_unconfigured_defaults_allow():
    wl = {}
    assert whitelist_permission_level(wl, "leave_delete") == "readonly"


def test_leave_delete_hidden_denies():
    wl = {"leave_delete": "hidden"}
    assert whitelist_permission_level(wl, "leave_delete") == "hidden"


def test_whitelist_field_levels_effective_pl_falls_back_to_non_pl():
    base = {"workbench_delete": "readonly", "ticket_list": "readonly"}
    overlay = {"ticket_list": "editable"}
    merged = {**base, **overlay}
    assert merged["workbench_delete"] == "readonly"
    assert merged["ticket_list"] == "editable"

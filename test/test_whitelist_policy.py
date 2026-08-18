"""whitelist_policy：未配置键的默认级别须与前端 getWhitelistLevel 一致，避免误判仅问题填写导致全站 403。"""

from whitelist_policy import (
    leave_application_all_only_self_applicant,
    ticket_detail_only_problem_fill,
    ticket_list_only_self_created,
    tool_plaza_can_edit_item,
    tool_plaza_edit_all_items,
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


def test_workbench_migrate_unconfigured_defaults_allow():
    wl = {}
    assert whitelist_permission_level(wl, "workbench_migrate") == "readonly"


def test_workbench_migrate_hidden_denies():
    wl = {"workbench_migrate": "hidden"}
    assert whitelist_permission_level(wl, "workbench_migrate") == "hidden"


def test_workbench_snapshot_rebuild_unconfigured_defaults_allow():
    wl = {}
    assert whitelist_permission_level(wl, "workbench_snapshot_rebuild") == "readonly"


def test_workbench_snapshot_rebuild_hidden_denies():
    wl = {"workbench_snapshot_rebuild": "hidden"}
    assert whitelist_permission_level(wl, "workbench_snapshot_rebuild") == "hidden"


def test_ticket_detail_ask_jiuwen_unconfigured_defaults_hidden():
    wl = {}
    assert whitelist_permission_level(wl, "ticket_detail_ask_jiuwen") == "hidden"


def test_ticket_detail_ask_jiuwen_readonly_allows():
    wl = {"ticket_detail_ask_jiuwen": "readonly"}
    assert whitelist_permission_level(wl, "ticket_detail_ask_jiuwen") == "readonly"


def test_leave_delete_unconfigured_defaults_allow():
    wl = {}
    assert whitelist_permission_level(wl, "leave_delete") == "readonly"


def test_leave_delete_hidden_denies():
    wl = {"leave_delete": "hidden"}
    assert whitelist_permission_level(wl, "leave_delete") == "hidden"


def test_tool_plaza_edit_editable_allows_all():
    wl = {"tool_plaza_edit": "editable"}
    assert tool_plaza_edit_all_items(wl) is True
    assert tool_plaza_can_edit_item(wl, "u1", "u2") is True


def test_tool_plaza_edit_readonly_only_publisher():
    wl = {"tool_plaza_edit": "readonly"}
    assert tool_plaza_edit_all_items(wl) is False
    assert tool_plaza_can_edit_item(wl, "u1", "u1") is True
    assert tool_plaza_can_edit_item(wl, "u1", "u2") is False


def test_tool_plaza_edit_hidden_denies():
    wl = {"tool_plaza_edit": "hidden"}
    assert tool_plaza_can_edit_item(wl, "u1", "u1") is False


def test_whitelist_field_levels_effective_pl_falls_back_to_non_pl():
    base = {"workbench_delete": "readonly", "ticket_list": "readonly"}
    overlay = {"ticket_list": "editable"}
    merged = {**base, **overlay}
    assert merged["workbench_delete"] == "readonly"
    assert merged["ticket_list"] == "editable"

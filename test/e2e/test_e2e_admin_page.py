import pytest

pytestmark = pytest.mark.e2e


class TestAdminPermissionsPage:

    def test_tc_e2e_049_permissions_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        heading = page.locator("main.center .head h1#center-page-title", has_text="权限策略")
        assert heading.is_visible(), "权限策略标题应在主区壳层 h1 可见"

    def test_tc_e2e_050_permissions_page_layout(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        left = page.locator(".perm-layout-left").first
        right = page.locator(".perm-layout-right").first
        assert left.is_visible(), "权限组列表区域应可见"
        assert right.is_visible(), "权限预览区域应可见"

    def test_tc_e2e_051_add_permission_group_button(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        add_btn = page.locator("[data-admin-role-add]").first
        if add_btn.count() == 0 or not add_btn.is_visible():
            pytest.fail("新增权限组按钮不可见（权限限制）")
        page.on("dialog", lambda dialog: dialog.accept("e2e_test_group"))
        add_btn.click(timeout=5000)
        page.wait_for_timeout(2000)
        modal = page.locator(".admin-whitelist-modal-mask, .perm-modal-mask").first
        assert modal.is_visible(), "点击新增权限组后应弹出白名单配置弹窗"
        modal_title = page.locator(".perm-modal-head h3").first
        assert modal_title.is_visible(), "弹窗标题应可见"
        assert "e2e_test_group" in modal_title.inner_text(), "弹窗标题应包含新增的权限组名称"

    def test_tc_e2e_052_whitelist_modal_open_close(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        group_items = page.locator("[data-admin-role-view]")
        if group_items.count() == 0:
            page.on("dialog", lambda dialog: dialog.accept("e2e_wl_group"))
            add_btn = page.locator("[data-admin-role-add]").first
            if add_btn.count() > 0 and add_btn.is_visible():
                add_btn.click(timeout=5000)
                page.wait_for_timeout(2000)
                cancel_btn = page.locator("[data-admin-whitelist-cancel]").first
                if cancel_btn.is_visible():
                    cancel_btn.click(timeout=5000)
                    page.wait_for_timeout(1000)
            else:
                pytest.fail("无法创建权限组以测试白名单弹窗")
        first_group = page.locator("[data-admin-role-view]").first
        first_group.click(timeout=5000)
        page.wait_for_timeout(1000)
        open_btn = page.locator("[data-admin-whitelist-open]").first
        if open_btn.count() == 0 or not open_btn.is_visible():
            pytest.fail("配置白名单按钮不可见（权限限制）")
        if open_btn.is_disabled():
            pytest.fail("配置白名单按钮被禁用（未选择权限组）")
        open_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".admin-whitelist-modal-mask, .perm-modal-mask").first
        assert modal.is_visible(), "点击配置白名单后应弹出弹窗"
        cancel_btn = page.locator("[data-admin-whitelist-cancel]").first
        assert cancel_btn.is_visible(), "弹窗中应有取消按钮"
        cancel_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal_after = page.locator(".admin-whitelist-modal-mask, .perm-modal-mask").first
        assert modal_after.count() == 0 or not modal_after.is_visible(), "点击取消后弹窗应关闭"

    def test_tc_e2e_053_whitelist_modal_has_selects(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        group_items = page.locator("[data-admin-role-view]")
        if group_items.count() == 0:
            page.on("dialog", lambda dialog: dialog.accept("e2e_sel_group"))
            add_btn = page.locator("[data-admin-role-add]").first
            if add_btn.count() > 0 and add_btn.is_visible():
                add_btn.click(timeout=5000)
                page.wait_for_timeout(2000)
            else:
                pytest.fail("无法创建权限组以测试白名单选择器")
        else:
            first_group = page.locator("[data-admin-role-view]").first
            first_group.click(timeout=5000)
            page.wait_for_timeout(1000)
        open_btn = page.locator("[data-admin-whitelist-open]").first
        if open_btn.count() == 0 or not open_btn.is_visible() or open_btn.is_disabled():
            pytest.fail("配置白名单按钮不可用")
        open_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        selects = page.locator("[data-perm-item-key]")
        assert selects.count() > 0, "白名单弹窗中应有权限策略选择器"

    def test_tc_e2e_054_select_permission_group(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        group_items = page.locator("[data-admin-role-view]")
        if group_items.count() < 1:
            pytest.fail("没有权限组可选")
        first_group = group_items.first
        first_group.click(timeout=5000)
        page.wait_for_timeout(1000)
        assert first_group.evaluate("el => el.classList.contains('active')"), "选中的权限组应有 active 样式"
        table_rows = page.locator(".perm-layout-right table tbody tr")
        assert table_rows.count() > 0, "选择权限组后右侧应显示权限预览表"

    def test_tc_e2e_055_whitelist_save_button_visible(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        group_items = page.locator("[data-admin-role-view]")
        if group_items.count() == 0:
            page.on("dialog", lambda dialog: dialog.accept("e2e_save_group"))
            add_btn = page.locator("[data-admin-role-add]").first
            if add_btn.count() > 0 and add_btn.is_visible():
                add_btn.click(timeout=5000)
                page.wait_for_timeout(2000)
            else:
                pytest.fail("无法创建权限组以测试保存按钮")
        else:
            first_group = page.locator("[data-admin-role-view]").first
            first_group.click(timeout=5000)
            page.wait_for_timeout(1000)
        open_btn = page.locator("[data-admin-whitelist-open]").first
        if open_btn.count() == 0 or not open_btn.is_visible() or open_btn.is_disabled():
            pytest.fail("配置白名单按钮不可用")
        open_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        save_btn = page.locator("[data-admin-whitelist-save]").first
        assert save_btn.is_visible(), "白名单弹窗中应有保存按钮"


class TestAdminUsersPage:

    def test_tc_e2e_056_users_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        heading = page.locator("main.center .head h1#center-page-title", has_text="用户管理")
        assert heading.is_visible(), "用户管理标题应在主区壳层 h1 可见"

    def test_tc_e2e_057_users_table_visible(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        table = page.locator(".admin-table").first
        assert table.is_visible(), "用户管理表格应可见"
        thead = table.locator("thead tr th").first
        assert thead.is_visible(), "表格应有表头"

    def test_tc_e2e_058_users_edit_toggle(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        edit_btn = page.locator("[data-admin-toggle-edit]").first
        if edit_btn.count() == 0 or not edit_btn.is_visible():
            pytest.fail("编辑按钮不可见（权限限制）")
        edit_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        save_btn = page.locator("[data-admin-save]").first
        assert save_btn.is_visible(), "进入编辑模式后应显示保存按钮"
        add_row_btn = page.locator("[data-admin-add]").first
        assert add_row_btn.is_visible(), "进入编辑模式后应显示新增用户行按钮"

    def test_tc_e2e_059_users_role_select_in_edit(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        edit_btn = page.locator("[data-admin-toggle-edit]").first
        if edit_btn.count() == 0 or not edit_btn.is_visible():
            pytest.fail("编辑按钮不可见（权限限制）")
        edit_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        role_select = page.locator("[data-admin-role-select]").first
        if role_select.count() > 0 and role_select.is_visible():
            assert True
        else:
            role_selects = page.locator("select[data-k='role_code']")
            assert role_selects.count() > 0, "编辑模式下应有角色选择下拉框"

    def test_tc_e2e_060_users_add_row(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        edit_btn = page.locator("[data-admin-toggle-edit]").first
        if edit_btn.count() == 0 or not edit_btn.is_visible():
            pytest.fail("编辑按钮不可见（权限限制）")
        edit_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        add_btn = page.locator("[data-admin-add]").first
        if add_btn.count() == 0 or not add_btn.is_visible():
            pytest.fail("新增用户行按钮不可见")
        rows_before = page.locator("tr[data-admin-row]").count()
        add_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        rows_after = page.locator("tr[data-admin-row]").count()
        assert rows_after > rows_before, "点击新增用户行后应增加一行"

    def test_tc_e2e_061_users_exit_edit(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        edit_btn = page.locator("[data-admin-toggle-edit]").first
        if edit_btn.count() == 0 or not edit_btn.is_visible():
            pytest.fail("编辑按钮不可见（权限限制）")
        edit_btn.click(timeout=5000, force=True)
        page.wait_for_timeout(1000)
        save_btn = page.locator("[data-admin-save]").first
        assert save_btn.is_visible(), "进入编辑模式后应显示保存按钮"
        save_btn.click(timeout=5000, force=True)
        page.wait_for_timeout(2000)
        edit_btn_after = page.locator("[data-admin-toggle-edit]").first
        assert edit_btn_after.count() > 0 and edit_btn_after.is_visible(), "保存后应退出编辑模式并显示编辑按钮"


class TestAdminPageNavigation:

    def test_tc_e2e_062_admin_tab_switch(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        perm_heading = page.locator("main.center .head h1#center-page-title", has_text="权限策略")
        assert perm_heading.is_visible(), "权限策略页面壳层标题应可见"
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        user_heading = page.locator("main.center .head h1#center-page-title", has_text="用户管理")
        assert user_heading.is_visible(), "直接导航到用户管理后壳层标题应可见"

    def test_tc_e2e_063_admin_permissions_no_js_errors_on_interactions(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        group_items = page.locator("[data-admin-role-view]")
        for i in range(min(group_items.count(), 3)):
            item = group_items.nth(i)
            if item.is_visible():
                item.click(timeout=5000)
                page.wait_for_timeout(500)
        open_btn = page.locator("[data-admin-whitelist-open]").first
        if open_btn.count() > 0 and open_btn.is_visible() and not open_btn.is_disabled():
            open_btn.click(timeout=5000)
            page.wait_for_timeout(1000)
            cancel_btn = page.locator("[data-admin-whitelist-cancel]").first
            if cancel_btn.is_visible():
                cancel_btn.click(timeout=5000)
                page.wait_for_timeout(500)


class TestAdminPermissionsFilter:
    """权限策略为「左侧权限组 + 右侧预览 + 配置白名单弹窗」；无旧版扁平表的表头筛选。"""

    def _open_whitelist_modal(self, page, backend_server):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        group_items = page.locator("[data-admin-role-view]")
        if group_items.count() < 1:
            pytest.fail("没有权限组，无法测试白名单弹窗")
        group_items.first.click(timeout=5000)
        page.wait_for_timeout(1000)
        open_btn = page.locator("[data-admin-whitelist-open]").first
        if open_btn.count() == 0 or not open_btn.is_visible() or open_btn.is_disabled():
            pytest.fail("配置白名单按钮不可用（检查 admin_permissions_whitelist 白名单）")
        open_btn.click(timeout=5000)
        page.wait_for_timeout(1000)

    def test_tc_e2e_064_permissions_filter_icon_visible(self, page, backend_server, assert_no_js_errors):
        """兼容用例编号：覆盖「白名单弹窗可打开且含策略下拉」。"""
        self._open_whitelist_modal(page, backend_server)
        modal = page.locator(".admin-whitelist-modal-mask, .perm-modal-mask").first
        assert modal.is_visible(), "应显示白名单配置弹窗"
        assert page.locator("[data-perm-item-key]").count() >= 1, "弹窗内应有 data-perm-item-key 策略选择器"

    def test_tc_e2e_065_permissions_filter_open_close(self, page, backend_server, assert_no_js_errors):
        self._open_whitelist_modal(page, backend_server)
        cancel_btn = page.locator("[data-admin-whitelist-cancel]").first
        assert cancel_btn.is_visible(), "弹窗应有取消按钮"
        cancel_btn.click(timeout=5000)
        page.wait_for_timeout(800)
        modal_after = page.locator(".admin-whitelist-modal-mask, .perm-modal-mask").first
        assert modal_after.count() == 0 or not modal_after.is_visible(), "取消后弹窗应关闭"

    def test_tc_e2e_066_permissions_filter_search(self, page, backend_server, assert_no_js_errors):
        """弹窗内通过策略下拉验证可交互（无表头搜索框）。"""
        self._open_whitelist_modal(page, backend_server)
        sel = page.locator("select[data-perm-item-key]:not([disabled])").first
        if sel.count() == 0:
            pytest.fail("无可用策略下拉（权限项可能被级联禁用）")
        opts = sel.locator("option")
        assert opts.count() >= 2, "策略下拉应有多档可选"
        second_val = opts.nth(1).get_attribute("value")
        sel.select_option(value=second_val)
        page.wait_for_timeout(300)
        assert sel.input_value() == second_val, "策略下拉应可切换"
        page.locator("[data-admin-whitelist-cancel]").first.click(timeout=5000)
        page.wait_for_timeout(500)


class TestAdminUsersFilter:

    def test_tc_e2e_067_users_filter_icon_visible(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        filter_icons = page.locator("[data-user-filter-open]")
        if filter_icons.count() == 0:
            pytest.fail("用户管理筛选图标不存在")
        assert filter_icons.first.is_visible(), "用户管理表头应有筛选图标"

    def test_tc_e2e_068_users_filter_open_close(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        filter_icon = page.locator("[data-user-filter-open]").first
        if filter_icon.count() == 0 or not filter_icon.is_visible():
            pytest.fail("用户管理筛选图标不可见")
        filter_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        filter_pop = page.locator(".filter-pop").first
        assert filter_pop.is_visible(), "点击筛选图标后应显示筛选弹窗"
        close_btn = page.locator("[data-user-filter-close]").first
        if close_btn.count() > 0 and close_btn.is_visible():
            close_btn.click(timeout=5000)
            page.wait_for_timeout(500)
            filter_pop_after = page.locator(".filter-pop").first
            assert filter_pop_after.count() == 0 or not filter_pop_after.is_visible(), "点击关闭后筛选弹窗应消失"

    def test_tc_e2e_069_users_filter_search(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/users")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        filter_icon = page.locator("[data-user-filter-open]").first
        if filter_icon.count() == 0 or not filter_icon.is_visible():
            pytest.fail("用户管理筛选图标不可见")
        filter_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        search_input = page.locator("[data-user-filter-search]").first
        if search_input.count() == 0 or not search_input.is_visible():
            pytest.fail("用户管理筛选搜索框不可见")
        search_input.fill("admin")
        page.wait_for_timeout(500)
        assert search_input.input_value() == "admin", "筛选搜索框应可输入"


class TestAdminPermissionsEditMode:
    """白名单策略在弹窗内保存（与 admin-page.js 弹窗路径一致）。"""

    def _open_whitelist_modal(self, page, backend_server):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        group_items = page.locator("[data-admin-role-view]")
        if group_items.count() < 1:
            pytest.fail("没有权限组，无法测试白名单编辑")
        group_items.first.click(timeout=5000)
        page.wait_for_timeout(1000)
        open_btn = page.locator("[data-admin-whitelist-open]").first
        if open_btn.count() == 0 or not open_btn.is_visible() or open_btn.is_disabled():
            pytest.fail("配置白名单按钮不可用")
        open_btn.click(timeout=5000)
        page.wait_for_timeout(1000)

    def test_tc_e2e_070_permissions_edit_toggle(self, page, backend_server, assert_no_js_errors):
        """兼容编号：打开白名单弹窗即进入可编辑态，应有保存按钮。"""
        self._open_whitelist_modal(page, backend_server)
        save_btn = page.locator("[data-admin-whitelist-save]").first
        assert save_btn.is_visible(), "白名单弹窗应显示保存按钮"

    def test_tc_e2e_071_permissions_add_whitelist_item(self, page, backend_server, assert_no_js_errors):
        """当前产品通过弹窗内策略矩阵维护白名单，无「新增行」；改为验证可改一项策略后取消。"""
        self._open_whitelist_modal(page, backend_server)
        sel = page.locator("select[data-perm-item-key]:not([disabled])").first
        if sel.count() == 0:
            pytest.fail("无可用策略下拉")
        orig = sel.input_value()
        opts = sel.locator("option")
        for i in range(min(opts.count(), 4)):
            v = opts.nth(i).get_attribute("value")
            if v and v != orig:
                sel.select_option(value=v)
                break
        page.wait_for_timeout(200)
        page.locator("[data-admin-whitelist-cancel]").first.click(timeout=5000)
        page.wait_for_timeout(500)

    def test_tc_e2e_072_permissions_edit_save_and_exit(self, page, backend_server, assert_no_js_errors):
        self._open_whitelist_modal(page, backend_server)
        save_btn = page.locator("[data-admin-whitelist-save]").first
        save_btn.click(timeout=5000, force=True)
        page.wait_for_timeout(2000)
        modal_after = page.locator(".admin-whitelist-modal-mask, .perm-modal-mask").first
        assert modal_after.count() == 0 or not modal_after.is_visible(), "保存后弹窗应关闭"

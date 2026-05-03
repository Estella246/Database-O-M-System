import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel, normalizePermissionLevel, getPermissionLevelRank, normalizePermissionLevelForItem, getPermissionStrategyOptions, getWhitelistKeyByActiveKey, applyPermissionWhitelistCascade } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import {
  PERMISSION_WHITELIST_NODE_KEY,
  PERMISSION_WHITELIST_ITEMS,
  PERMISSION_LEVEL_OPTIONS,
  PERMISSION_LEVEL_RANK,
  PERMISSION_DEFAULT_HIDDEN_KEYS,
  PERMISSION_STRATEGY_OPTIONS_BY_KEY,
  PERMISSION_WHITELIST_CASCADE_RELATIONS,
  PERMISSION_WHITELIST_PARENT_MAP,
} from "../constants/permission.js";
import {
  getPermissionWhitelistVisibleItems,
  getPermissionWhitelistDetailText,
  getPermissionStrategyText,
  getPermissionLevelForItem,
  getStrategyOptionsHtml,
  promotePermissionParents,
  getCurrentLevelTextByStrategy,
  buildPermissionWhitelistGroups,
  filterPermissionRows,
  filterUserRows,
  uniqueColumnValues,
  getPermissionWhitelistPageAndDetail,
  getWhitelistScopeSummaryByItemKey,
} from "./admin.js";
import { detachStatsChartZoomMasksFromBody } from "./stats-page.js";

export function ensureAdminTab(kind) {
  const key = `admin:${kind}`;
  const label = kind === "permissions" ? "权限策略" : "用户管理";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label, closable: true });
  }
  return key;
}

export function mountAdminWhitelistModalToBody(maskEl) {
  if (maskEl && maskEl.parentNode !== document.body) {
    document.body.appendChild(maskEl);
  }
}

export function ensureAdminWhitelistModalOnBody() {
  mountAdminWhitelistModalToBody(document.querySelector(".admin-whitelist-modal-mask"));
}

export async function ensureAdminData() {
  while (state.adminLoading) {
    await new Promise((r) => setTimeout(r, 40));
  }
  if (state.adminLoaded) return;
  state.adminLoading = true;
  try {
    const [permResp, userResp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/admin/permissions`),
      fetch(`${API_BASE_URL}/api/admin/users`),
    ]);
    if (permResp.ok) {
      const p = await permResp.json();
      state.adminPermissions = Array.isArray(p.items) ? p.items : [];
      if (!state.adminPermissionRole) {
        const firstRole = state.adminPermissions.find((x) => x.role_code)?.role_code || "";
        state.adminPermissionRole = firstRole;
      }
    }
    if (userResp.ok) {
      const u = await userResp.json();
      state.adminUsers = Array.isArray(u.items) ? u.items : [];
    }
  } finally {
    state.adminLoaded = true;
    state.adminLoading = false;
    requestRender();
  }
}

export function renderAdminPage() {
  const isPermissions = state.activeKey === "admin:permissions";
  const whitelist = getCurrentWhitelistSettings();
  const canManageWhitelist = whitelistAllows("admin_permissions_whitelist", "readonly", whitelist);
  const canAddPermissionGroup = whitelistAllows("admin_permissions_add", "readonly", whitelist);
  const canEditUsers = whitelistAllows("admin_users_edit", "readonly", whitelist);
  const permissionGroups = Array.from(new Set(state.adminPermissions.map((x) => String(x.role_code || "")).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  if (isPermissions) {
    const allPermissionRows = state.adminPermissions;
    const groupNames = Array.from(new Set(allPermissionRows.map((x) => String(x.role_code || "")).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const selectedGroup = state.adminPermissionRole || "";
    const groupRows = allPermissionRows.filter(
      (x) => String(x.role_code || "") === selectedGroup && String(x.node_key || "") === PERMISSION_WHITELIST_NODE_KEY
    );
    const levelByKey = Object.fromEntries(
      groupRows.map((x) => [String(x.field_key || ""), String(x.permission_level || "hidden")])
    );
    const previewCascaded = applyPermissionWhitelistCascade(
      Object.fromEntries(PERMISSION_WHITELIST_ITEMS.map((item) => [item.key, levelByKey[item.key] || "hidden"]))
    );
    const previewLevelByKey = {
      ...levelByKey,
      ...previewCascaded.draft,
    };
    const previewRows = getPermissionWhitelistVisibleItems()
      .map((item) => {
        const { page, detail } = getPermissionWhitelistPageAndDetail(item);
        const detailText = getPermissionWhitelistDetailText(item.key, page, detail);
        return {
          key: item.key,
          page,
          detail: detailText,
          level: previewLevelByKey[item.key] || "hidden",
        };
      })
      .filter(Boolean);
    return `
    <section class="detail-card detail-card-inline admin-wrap">
      <div class="detail-head">
        <h2>权限策略</h2>
        <div class="detail-actions">
          ${canAddPermissionGroup ? '<button class="action" type="button" data-admin-role-add>新增权限组</button>' : ""}
        </div>
      </div>
      ${state.adminMsg ? `<p class="problem-fill-status success">${escapeHtml(state.adminMsg)}</p>` : ""}
      <div class="perm-layout">
        <div class="perm-layout-left">
          <div class="perm-layout-title">权限组</div>
          <div class="perm-group-list">
            ${
              groupNames.length
                ? groupNames
                  .map((role) => `<button class="perm-group-item ${selectedGroup === role ? "active" : ""}" type="button" data-admin-role-view="${escapeAttr(role)}">${escapeHtml(role)}</button>`)
                  .join("")
                : '<div class="perm-group-empty">暂无权限组，请先新增</div>'
            }
          </div>
        </div>
        <div class="perm-layout-right">
          <div class="admin-subtabs">
            ${selectedGroup ? "" : "<span>请先在左侧选择权限组</span>"}
            ${canManageWhitelist ? `<button class="action primary" type="button" data-admin-whitelist-open ${selectedGroup ? "" : "disabled"}>配置白名单</button>` : ""}
          </div>
          <div class="oplog-table-wrap">
            <table class="oplog-table admin-table">
              <thead><tr><th>页面</th><th>详情</th><th>策略</th></tr></thead>
              <tbody>
                ${
                  selectedGroup
                    ? previewRows
                      .map((row) => `<tr><td>${escapeHtml(row.page)}</td><td>${escapeHtml(row.detail)}</td><td>${escapeHtml(getCurrentLevelTextByStrategy(row.key, row.level))}</td></tr>`)
                      .join("")
                    : '<tr><td colspan="3">请先选择或新增权限组</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ${
        state.adminPermissionDialogOpen
          ? `<div class="perm-modal-mask admin-whitelist-modal-mask">
        <div class="perm-modal admin-whitelist-modal">
          <div class="perm-modal-head">
            <h3>配置白名单 · ${escapeHtml(selectedGroup)}</h3>
          </div>
          <div class="perm-modal-body">
            <table class="oplog-table admin-table">
              <thead><tr><th>页面</th><th>详情</th><th>策略</th></tr></thead>
              <tbody>
                ${getPermissionWhitelistVisibleItems().map((item) => renderPermissionWhitelistItemRow(item)).join("")}
              </tbody>
            </table>
          </div>
          <div class="perm-modal-actions">
            <button class="action" type="button" data-admin-whitelist-cancel>取消</button>
            <button class="action primary" type="button" data-admin-whitelist-save>保存</button>
          </div>
        </div>
      </div>`
          : ""
      }
    </section>
  `;
  }
  const isPermissionEditMode = isPermissions && state.adminPermissionEditMode;
  const isUserEditMode = !isPermissions && state.adminUserEditMode;
  const allPermissionRows = state.adminPermissions;
  const roleRows = isPermissions && state.adminPermissionRole
    ? allPermissionRows.filter((x) => String(x.role_code || "") === state.adminPermissionRole)
    : allPermissionRows;
  const rows = isPermissions ? roleRows : state.adminUsers;
  const filteredRows = isPermissions
    ? filterPermissionRows(rows, state.adminPermissionFilters)
    : filterUserRows(rows, state.adminUserFilters);
  const title = isPermissions ? "权限策略" : "用户管理";
  const subtitle = "";
  const columnCount = isPermissions ? (isPermissionEditMode ? 6 : 5) : (isUserEditMode ? 6 : 5);
  const tableHead = isPermissions
    ? renderPermissionTableHead(rows, isPermissionEditMode)
    : renderUserTableHead(filteredRows, rows, isUserEditMode);
  const body = filteredRows
    .map((r, idx) => {
      if (isPermissions) {
        if (!isPermissionEditMode) {
          return `<tr>
          <td>${escapeHtml(String(r.role_code || ""))}</td>
          <td>${r.is_pl ? "是" : "否"}</td>
          <td>${escapeHtml(String(r.node_key || ""))}</td>
          <td>${escapeHtml(String(r.field_key || ""))}</td>
          <td>${escapeHtml(String(r.permission_level || ""))}</td>
        </tr>`;
        }
        return `<tr data-admin-row="${idx}">
          <td><input data-k="role_code" value="${escapeAttr(r.role_code || "")}" /></td>
          <td><input data-k="is_pl" type="checkbox" ${r.is_pl ? "checked" : ""} /></td>
          <td><input data-k="node_key" value="${escapeAttr(r.node_key || "")}" /></td>
          <td><input data-k="field_key" value="${escapeAttr(r.field_key || "")}" /></td>
          <td>
            <select data-k="permission_level">
              ${["hidden", "readonly", "editable"]
                .map((x) => `<option value="${x}" ${r.permission_level === x ? "selected" : ""}>${x}</option>`)
                .join("")}
            </select>
          </td>
          <td><button class="icon-delete-btn" type="button" data-row-delete="${idx}" title="删除" aria-label="删除">🗑</button></td>
        </tr>`;
      }
      if (!isUserEditMode) {
        return `<tr>
        <td>${escapeHtml(String(r.account || ""))}</td>
        <td>${escapeHtml(String(r.user_name || ""))}</td>
        <td>${escapeHtml(String(r.role_code || ""))}</td>
        <td>${escapeHtml(String(r.group_name || ""))}</td>
        <td>${r.is_pl ? "是" : "否"}</td>
      </tr>`;
      }
      return `<tr data-admin-row="${idx}">
        <td><input data-k="account" value="${escapeAttr(r.account || "")}" /></td>
        <td><input data-k="user_name" value="${escapeAttr(r.user_name || "")}" /></td>
        <td>
          <select data-k="role_code">
            <option value="">请选择权限组</option>
            ${Array.from(new Set([...(permissionGroups || []), String(r.role_code || "")].filter(Boolean)))
              .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
              .map((role) => `<option value="${escapeAttr(role)}" ${String(r.role_code || "") === role ? "selected" : ""}>${escapeHtml(role)}</option>`)
              .join("")}
          </select>
        </td>
        <td><input data-k="group_name" value="${escapeAttr(r.group_name || "")}" /></td>
        <td><input data-k="is_pl" type="checkbox" ${r.is_pl ? "checked" : ""} /></td>
        <td><button class="icon-delete-btn" type="button" data-row-delete="${idx}" title="删除" aria-label="删除">🗑</button></td>
      </tr>`;
    })
    .join("");
  return `
    <section class="detail-card detail-card-inline admin-wrap">
      <div class="detail-head">
        <h2>${title}</h2>
        <div class="detail-actions">
          ${
            isPermissions
              ? `${!isPermissionEditMode ? '<button class="action primary" data-admin-toggle-edit>编辑</button>' : ""}
          ${
            isPermissionEditMode
              ? `<button class="action" data-admin-add>新增白名单项</button>
          <button class="action primary" data-admin-save>保存</button>`
              : ""
          }`
              : `${canEditUsers ? `${!isUserEditMode ? '<button class="action primary" data-admin-toggle-edit>编辑</button>' : ""}
          ${
            isUserEditMode
              ? `<button class="action" data-admin-add>新增用户行</button>
          <button class="action primary" data-admin-save>保存</button>`
              : ""
          }` : ""}`
          }
        </div>
      </div>
      <p class="problem-fill-status">${subtitle}</p>
      ${state.adminMsg ? `<p class="problem-fill-status success">${escapeHtml(state.adminMsg)}</p>` : ""}
      ${
        isPermissions
          ? `<div class="admin-subtabs">
        <select data-admin-role-select>
          <option value="">全部角色</option>
          ${Array.from(new Set(allPermissionRows.map((x) => String(x.role_code || "")).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
            .map((role) => `<option value="${escapeAttr(role)}" ${state.adminPermissionRole === role ? "selected" : ""}>${escapeHtml(role)}</option>`)
            .join("")}
        </select>
        ${canAddPermissionGroup ? '<button class="action" type="button" data-admin-role-add>新增角色</button>' : ""}
      </div>`
          : ""
      }
      <div class="oplog-table-wrap">
        <table class="oplog-table admin-table">
          <thead>${tableHead}</thead>
          <tbody>${body || `<tr><td colspan="${columnCount}">No data</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

export function bindAdminPage() {
  ensureAdminData();
  const isPermissions = state.activeKey === "admin:permissions";
  if (isPermissions) {
    const roleAddBtn = document.querySelector("[data-admin-role-add]");
    const openBtn = document.querySelector("[data-admin-whitelist-open]");
    const cancelBtn = document.querySelector("[data-admin-whitelist-cancel]");
    const saveBtn = document.querySelector("[data-admin-whitelist-save]");
    document.querySelectorAll("[data-admin-role-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-admin-role-view") || "";
        state.adminPermissionRole = role;
        state.adminPermissionDialogOpen = false;
        requestRender();
      });
    });
    if (roleAddBtn) {
      roleAddBtn.addEventListener("click", () => {
        const group = (window.prompt("请输入用户权限组名称") || "").trim();
        if (!group) return;
        state.adminPermissionRole = group;
        state.adminPermissionDialogOpen = true;
        state.adminPermissionExpandedGroups = {};
        const cascaded = applyPermissionWhitelistCascade(
          Object.fromEntries(PERMISSION_WHITELIST_ITEMS.map((x) => [x.key, "hidden"]))
        );
        state.adminPermissionDraft = cascaded.draft;
        requestRender();
      });
    }
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        const group = state.adminPermissionRole || "";
        if (!group) return;
        const rows = state.adminPermissions.filter(
          (x) => String(x.role_code || "") === group && String(x.node_key || "") === PERMISSION_WHITELIST_NODE_KEY
        );
        const draft = {};
        PERMISSION_WHITELIST_ITEMS.forEach((item) => {
          const hit = rows.find((r) => String(r.field_key || "") === item.key);
          draft[item.key] = hit?.permission_level || "hidden";
        });
        const cascaded = applyPermissionWhitelistCascade(draft);
        state.adminPermissionDraft = cascaded.draft;
        state.adminPermissionExpandedGroups = {};
        state.adminPermissionDialogOpen = true;
        requestRender();
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        state.adminPermissionDialogOpen = false;
        requestRender();
      });
    }
    document.querySelectorAll("[data-perm-item-key]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.getAttribute("data-perm-item-key");
        if (!key) return;
        const targetLevel = getPermissionLevelForItem(key, el.value || "hidden");
        state.adminPermissionDraft[key] = targetLevel;
        state.adminPermissionDraft = promotePermissionParents(state.adminPermissionDraft, key, targetLevel);
        const cascaded = applyPermissionWhitelistCascade(state.adminPermissionDraft);
        state.adminPermissionDraft = cascaded.draft;
        requestRender();
      });
    });
    document.querySelectorAll("[data-perm-group-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const title = btn.getAttribute("data-perm-group-toggle") || "";
        if (!title) return;
        const cur = !!state.adminPermissionExpandedGroups[title];
        state.adminPermissionExpandedGroups = { ...state.adminPermissionExpandedGroups, [title]: !cur };
        requestRender();
      });
    });
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const group = state.adminPermissionRole || "";
        if (!group) return;
        const cascaded = applyPermissionWhitelistCascade(state.adminPermissionDraft);
        state.adminPermissionDraft = cascaded.draft;
        const newRows = PERMISSION_WHITELIST_ITEMS.map((item) => ({
          role_code: group,
          is_pl: false,
          node_key: PERMISSION_WHITELIST_NODE_KEY,
          field_key: item.key,
          permission_level: getPermissionLevelForItem(item.key, state.adminPermissionDraft[item.key]),
        }));
        const others = state.adminPermissions.filter(
          (x) => !(String(x.role_code || "") === group && String(x.node_key || "") === PERMISSION_WHITELIST_NODE_KEY)
        );
        const merged = others.concat(newRows);
        const resp = await fetch(`${API_BASE_URL}/api/admin/permissions/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: merged, operator_id: "admin" }),
        });
        if (!resp.ok) {
          state.adminMsg = "保存失败";
          requestRender();
          return;
        }
        state.adminPermissions = merged;
        state.adminPermissionDialogOpen = false;
        state.adminMsg = "保存成功";
        requestRender();
      });
    }
    return;
  }
  const isPermissionEditMode = isPermissions && state.adminPermissionEditMode;
  const isUserEditMode = !isPermissions && state.adminUserEditMode;
  const roleSelect = document.querySelector("[data-admin-role-select]");
  const roleAddBtn = document.querySelector("[data-admin-role-add]");
  if (roleSelect) {
    roleSelect.addEventListener("change", () => {
      state.adminPermissionRole = roleSelect.value || "";
      requestRender();
    });
  }
  if (roleAddBtn) {
    roleAddBtn.addEventListener("click", () => {
      const role = (window.prompt("请输入新角色编码") || "").trim();
      if (!role) return;
      state.adminPermissionRole = role;
      if (!state.adminPermissionEditMode) state.adminPermissionEditMode = true;
      state.adminPermissions.push({
        role_code: role,
        is_pl: false,
        node_key: "",
        field_key: "",
        permission_level: "editable",
      });
      requestRender();
    });
  }
  const toggleEditBtn = document.querySelector("[data-admin-toggle-edit]");
  const addBtn = document.querySelector("[data-admin-add]");
  const saveBtn = document.querySelector("[data-admin-save]");
  if (toggleEditBtn) {
    toggleEditBtn.addEventListener("click", () => {
      if (isPermissions) state.adminPermissionEditMode = !state.adminPermissionEditMode;
      else state.adminUserEditMode = !state.adminUserEditMode;
      requestRender();
    });
  }
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (isPermissions) {
        state.adminPermissions.push({
          role_code: state.adminPermissionRole || "",
          is_pl: false,
          node_key: "",
          field_key: "",
          permission_level: "editable",
        });
      } else {
        state.adminUsers.push({
          account: "",
          user_name: "",
          role_code: "",
          group_name: "",
          is_pl: false,
        });
      }
      requestRender();
    });
  }
  document.querySelectorAll("[data-row-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.getAttribute("data-row-delete"));
      if (!Number.isInteger(idx) || idx < 0) return;
      const baseRows = isPermissions
        ? filterPermissionRows(
          state.adminPermissionRole
            ? state.adminPermissions.filter((x) => String(x.role_code || "") === state.adminPermissionRole)
            : state.adminPermissions,
          state.adminPermissionFilters
        )
        : filterUserRows(state.adminUsers, state.adminUserFilters);
      const row = baseRows[idx];
      if (!row) return;
      if (isPermissions) {
        const qs = new URLSearchParams({
          role_code: String(row.role_code || ""),
          is_pl: String(!!row.is_pl),
          node_key: String(row.node_key || ""),
          field_key: String(row.field_key || ""),
        });
        await fetch(`${API_BASE_URL}/api/admin/permissions?${qs.toString()}`, { method: "DELETE" });
        const pos = state.adminPermissions.findIndex(
          (x) =>
            x.role_code === row.role_code &&
            !!x.is_pl === !!row.is_pl &&
            x.node_key === row.node_key &&
            x.field_key === row.field_key
        );
        if (pos >= 0) state.adminPermissions.splice(pos, 1);
      } else {
        const qs = new URLSearchParams({ account: String(row.account || "") });
        await fetch(`${API_BASE_URL}/api/admin/users?${qs.toString()}`, { method: "DELETE" });
        const pos = state.adminUsers.findIndex((x) => x.account === row.account && x.user_name === row.user_name);
        if (pos >= 0) state.adminUsers.splice(pos, 1);
      }
      requestRender();
    });
  });
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (isPermissions && !isPermissionEditMode) return;
      if (!isPermissions && !isUserEditMode) return;
      const rows = Array.from(document.querySelectorAll("tr[data-admin-row]"));
      const items = rows.map((tr) => {
        const get = (k) => tr.querySelector(`[data-k="${k}"]`);
        if (isPermissions) {
          return {
            role_code: (get("role_code")?.value || "").trim(),
            is_pl: !!get("is_pl")?.checked,
            node_key: (get("node_key")?.value || "").trim(),
            field_key: (get("field_key")?.value || "").trim(),
            permission_level: (get("permission_level")?.value || "editable").trim(),
          };
        }
        return {
          account: (get("account")?.value || "").trim(),
          user_name: (get("user_name")?.value || "").trim(),
          role_code: (get("role_code")?.value || "").trim(),
          group_name: (get("group_name")?.value || "").trim(),
          is_pl: !!get("is_pl")?.checked,
        };
      }).filter((x) => {
        if (isPermissions) return x.role_code && x.node_key && x.field_key;
        return x.account && x.user_name;
      });
      const url = isPermissions ? "/api/admin/permissions/bulk" : "/api/admin/users/bulk";
      const resp = await fetch(`${API_BASE_URL}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, operator_id: "admin" }),
      });
      if (!resp.ok) {
        state.adminMsg = "保存失败";
        requestRender();
        return;
      }
      if (isPermissions) {
        if (state.adminPermissionRole) {
          const otherRoles = state.adminPermissions.filter((x) => String(x.role_code || "") !== state.adminPermissionRole);
          state.adminPermissions = otherRoles.concat(items);
        } else {
          state.adminPermissions = items;
        }
      } else {
        state.adminUsers = items;
      }
      if (isPermissions) state.adminPermissionEditMode = false;
      else state.adminUserEditMode = false;
      state.adminMsg = "保存成功";
      requestRender();
    });
  }
  if (isPermissions) {
    document.querySelectorAll("[data-perm-filter-open]").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.getAttribute("data-perm-filter-open");
        if (!key) return;
        state.adminPermissionFilters.openKey = state.adminPermissionFilters.openKey === key ? "" : key;
        requestRender();
      });
    });
    const openKey = state.adminPermissionFilters.openKey;
    if (openKey) {
      document.querySelectorAll("[data-perm-filter-search]").forEach((el) => {
        el.addEventListener("input", () => {
          const key = el.getAttribute("data-perm-filter-search");
          if (!key) return;
          state.adminPermissionFilters.search[key] = el.value || "";
          requestRender();
        });
      });
      document.querySelectorAll("[data-perm-filter-value]").forEach((el) => {
        el.addEventListener("change", () => {
          const value = el.getAttribute("data-perm-filter-value") || "";
          const cur = new Set(state.adminPermissionFilters.selected[openKey] || []);
          if (el.checked) cur.add(value);
          else cur.delete(value);
          state.adminPermissionFilters.selected[openKey] = Array.from(cur);
          requestRender();
        });
      });
      document.querySelectorAll("[data-perm-filter-checkall]").forEach((el) => {
        el.addEventListener("change", () => {
          const key = el.getAttribute("data-perm-filter-checkall");
          if (!key) return;
          const all = uniqueColumnValues(state.adminPermissions, key).filter((v) =>
            v.toLowerCase().includes((state.adminPermissionFilters.search[key] || "").toLowerCase())
          );
          const cur = new Set(state.adminPermissionFilters.selected[key] || []);
          if (el.checked) all.forEach((v) => cur.add(v));
          else all.forEach((v) => cur.delete(v));
          state.adminPermissionFilters.selected[key] = Array.from(cur);
          requestRender();
        });
      });
      document.querySelectorAll("[data-perm-filter-reset-col]").forEach((el) => {
        el.addEventListener("click", () => {
          const key = el.getAttribute("data-perm-filter-reset-col");
          if (!key) return;
          state.adminPermissionFilters.selected[key] = [];
          state.adminPermissionFilters.search[key] = "";
          requestRender();
        });
      });
      document.querySelectorAll("[data-perm-filter-close]").forEach((el) => {
        el.addEventListener("click", () => {
          state.adminPermissionFilters.openKey = "";
          requestRender();
        });
      });
    }
    document.addEventListener("click", (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".admin-th-filter")) return;
      if (!state.adminPermissionFilters.openKey) return;
      state.adminPermissionFilters.openKey = "";
      requestRender();
    }, { once: true });
  } else {
    document.querySelectorAll("[data-user-filter-open]").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.getAttribute("data-user-filter-open");
        if (!key) return;
        state.adminUserFilters.openKey = state.adminUserFilters.openKey === key ? "" : key;
        requestRender();
      });
    });
    const openKey = state.adminUserFilters.openKey;
    if (openKey) {
      document.querySelectorAll("[data-user-filter-search]").forEach((el) => {
        el.addEventListener("input", () => {
          const key = el.getAttribute("data-user-filter-search");
          if (!key) return;
          state.adminUserFilters.search[key] = el.value || "";
          requestRender();
        });
      });
      document.querySelectorAll("[data-user-filter-value]").forEach((el) => {
        el.addEventListener("change", () => {
          const value = el.getAttribute("data-user-filter-value") || "";
          const cur = new Set(state.adminUserFilters.selected[openKey] || []);
          if (el.checked) cur.add(value);
          else cur.delete(value);
          state.adminUserFilters.selected[openKey] = Array.from(cur);
          requestRender();
        });
      });
      document.querySelectorAll("[data-user-filter-checkall]").forEach((el) => {
        el.addEventListener("change", () => {
          const key = el.getAttribute("data-user-filter-checkall");
          if (!key) return;
          const all = uniqueColumnValues(state.adminUsers, key).filter((v) =>
            v.toLowerCase().includes((state.adminUserFilters.search[key] || "").toLowerCase())
          );
          const cur = new Set(state.adminUserFilters.selected[key] || []);
          if (el.checked) {
            all.forEach((v) => cur.add(v));
          } else {
            all.forEach((v) => cur.delete(v));
          }
          state.adminUserFilters.selected[key] = Array.from(cur);
          requestRender();
        });
      });
      document.querySelectorAll("[data-user-filter-reset-col]").forEach((el) => {
        el.addEventListener("click", () => {
          const key = el.getAttribute("data-user-filter-reset-col");
          if (!key) return;
          state.adminUserFilters.selected[key] = [];
          state.adminUserFilters.search[key] = "";
          requestRender();
        });
      });
      document.querySelectorAll("[data-user-filter-close]").forEach((el) => {
        el.addEventListener("click", () => {
          state.adminUserFilters.openKey = "";
          requestRender();
        });
      });
    }
    document.addEventListener("click", (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".admin-th-filter")) return;
      if (!state.adminUserFilters.openKey) return;
      state.adminUserFilters.openKey = "";
      requestRender();
    }, { once: true });
    const anySelected = Object.values(state.adminUserFilters.selected).some((arr) => (arr || []).length > 0);
    const resetAll = document.querySelector("[data-user-filter-reset-all]");
    if (resetAll && anySelected) {
      resetAll.addEventListener("click", () => {
        state.adminUserFilters.selected = {
          account: [],
          user_name: [],
          role_code: [],
          group_name: [],
          is_pl: [],
        };
        requestRender();
      });
    }
  }
}

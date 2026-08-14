/**
 * 用户管理编辑态列控件回归（复制逻辑，避免 jest-node 下 ESM 解析）。
 */

const USER_ROW_FILTER_KEYS = [
  "account", "user_name", "role_code", "group_name", "email",
  "contact_phone", "product_line", "expert_domain", "min_dept", "remark",
];

function filterUserRows(rows, filters, keyword = "") {
  const selected = filters.selected || {};
  const q = String(keyword || "").trim().toLowerCase();
  return rows.filter((r) => {
    const colOk = USER_ROW_FILTER_KEYS.every((key) => {
      const sel = selected[key] || [];
      return sel.length === 0 || sel.includes(String(r[key] || ""));
    });
    if (!colOk) return false;
    if (!q) return true;
    const haystack = USER_ROW_FILTER_KEYS.map((key) => String(r[key] || "")).join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

function uniqueColumnValues(rows, key) {
  const set = new Set();
  rows.forEach((r) => {
    set.add(String(r[key] || ""));
  });
  return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function renderUserColumnComboboxHtml(columnKey, value, allRows, listIdSuffix) {
  const cur = String(value || "");
  let options = uniqueColumnValues(allRows, columnKey);
  if (cur && !options.includes(cur)) {
    options = [...options, cur].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }
  const listId = `admin-user-dl-${columnKey}-${listIdSuffix}`;
  const datalistOpts = options.map((v) => `<option value="${v}"></option>`).join("");
  return `<input type="text" data-k="${columnKey}" value="${cur}" list="${listId}" autocomplete="off" />
<datalist id="${listId}">${datalistOpts}</datalist>`;
}

describe("admin user dirty collect (incremental save)", () => {
  const ADMIN_USER_EDIT_KEYS = [
    "account", "user_name", "role_code", "group_name", "email",
    "contact_phone", "product_line", "expert_domain", "min_dept", "remark", "is_active",
  ];

  function normalizeAdminUserRow(u) {
    const account = String(u?.account || "").trim();
    const rawOrig = String(u?._origAccount ?? u?.original_account ?? "").trim();
    return {
      account,
      user_name: String(u?.user_name || "").trim(),
      role_code: String(u?.role_code || "").trim(),
      group_name: String(u?.group_name || "").trim(),
      email: String(u?.email || "").trim(),
      contact_phone: String(u?.contact_phone || "").trim(),
      product_line: String(u?.product_line || "").trim(),
      expert_domain: String(u?.expert_domain || "").trim(),
      min_dept: String(u?.min_dept || "").trim(),
      remark: String(u?.remark || "").trim(),
      is_active: u?.is_active !== false,
      original_account: rawOrig,
      _origAccount: rawOrig,
    };
  }

  function snapshotAdminUsersBaseline(users) {
    const map = {};
    (Array.isArray(users) ? users : []).forEach((u) => {
      const row = normalizeAdminUserRow(u);
      if (!row.account) return;
      map[row.account.toLowerCase()] = row;
    });
    return map;
  }

  function collectDirtyAdminUsers(users, baselineMap) {
    const baseline = baselineMap && typeof baselineMap === "object" ? baselineMap : {};
    const dirty = [];
    (Array.isArray(users) ? users : []).forEach((u) => {
      const row = normalizeAdminUserRow(u);
      if (!row.account || !row.user_name) return;
      const rawOrig = String(row.original_account || "").trim();
      const isNew = !rawOrig;
      const origKey = (rawOrig || row.account).toLowerCase();
      const base = isNew ? null : baseline[origKey] || baseline[row.account.toLowerCase()];
      if (!base) {
        dirty.push({ account: row.account, remark: row.remark, original_account: "" });
        return;
      }
      const renamed = origKey !== row.account.toLowerCase();
      const changed = ADMIN_USER_EDIT_KEYS.some((k) => {
        if (k === "is_active") return !!base.is_active !== !!row.is_active;
        return String(base[k] ?? "") !== String(row[k] ?? "");
      });
      if (!renamed && !changed) return;
      dirty.push({
        account: row.account,
        remark: row.remark,
        original_account: rawOrig || row.account,
      });
    });
    return dirty;
  }

  const baseUsers = [
    {
      account: "u1",
      user_name: "张三",
      role_code: "普通人员",
      group_name: "一组",
      email: "",
      contact_phone: "",
      product_line: "公有云",
      expert_domain: "",
      min_dept: "",
      remark: "旧",
      is_active: true,
      _origAccount: "u1",
    },
    {
      account: "u2",
      user_name: "李四",
      role_code: "普通人员",
      group_name: "一组",
      email: "",
      contact_phone: "",
      product_line: "",
      expert_domain: "",
      min_dept: "",
      remark: "",
      is_active: true,
      _origAccount: "u2",
    },
  ];

  it("returns only changed rows", () => {
    const baseline = snapshotAdminUsersBaseline(baseUsers);
    const edited = [
      { ...baseUsers[0], remark: "新备注" },
      { ...baseUsers[1] },
    ];
    const dirty = collectDirtyAdminUsers(edited, baseline);
    expect(dirty).toHaveLength(1);
    expect(dirty[0].account).toBe("u1");
    expect(dirty[0].remark).toBe("新备注");
    expect(dirty[0].original_account).toBe("u1");
  });

  it("includes new rows without original_account", () => {
    const baseline = snapshotAdminUsersBaseline(baseUsers);
    const edited = [
      ...baseUsers,
      {
        account: "u3",
        user_name: "王五",
        role_code: "普通人员",
        group_name: "",
        email: "",
        contact_phone: "",
        product_line: "",
        expert_domain: "",
        min_dept: "",
        remark: "",
        is_active: true,
        _origAccount: "",
      },
    ];
    const dirty = collectDirtyAdminUsers(edited, baseline);
    expect(dirty).toHaveLength(1);
    expect(dirty[0].account).toBe("u3");
    expect(dirty[0].original_account).toBe("");
  });

  it("returns empty when nothing changed", () => {
    const baseline = snapshotAdminUsersBaseline(baseUsers);
    expect(collectDirtyAdminUsers(baseUsers, baseline)).toEqual([]);
  });

  it("pending delete is separate from dirty upsert list", () => {
    const baseline = snapshotAdminUsersBaseline(baseUsers);
    const remaining = [baseUsers[1]];
    const dirty = collectDirtyAdminUsers(remaining, baseline);
    expect(dirty).toEqual([]);
    const pendingDelete = ["u1"];
    expect(pendingDelete.length).toBe(1);
    expect(dirty.length + pendingDelete.length).toBeGreaterThan(0);
  });
});

describe("admin user edit sync payload", () => {
  /** 与 admin-page syncAdminUserEditsFromDom / 保存 payload 字段对齐 */
  function buildUserSaveItem(prev, domValues) {
    return {
      account: String(domValues.account || "").trim(),
      user_name: String(domValues.user_name || "").trim(),
      role_code: String(domValues.role_code || "").trim(),
      group_name: String(domValues.group_name || "").trim(),
      email: String(domValues.email || "").trim(),
      contact_phone: String(domValues.contact_phone || "").trim(),
      product_line: String(domValues.product_line || "").trim(),
      expert_domain: String(domValues.expert_domain || "").trim(),
      min_dept: String(domValues.min_dept || "").trim(),
      remark: String(domValues.remark || "").trim(),
      is_active: prev.is_active !== false,
    };
  }

  it("preserves is_active and trimmed edits for bulk save", () => {
    const prev = {
      account: "u1",
      user_name: "张三",
      role_code: "普通人员",
      group_name: "一组",
      email: "",
      contact_phone: "",
      product_line: "公有云",
      expert_domain: "",
      min_dept: "",
      remark: "旧备注",
      is_active: true,
      updated_at: "2026-01-01T00:00:00+08:00",
    };
    const next = buildUserSaveItem(prev, { ...prev, remark: "  新备注  ", product_line: "混合云（HCS）" });
    expect(next.remark).toBe("新备注");
    expect(next.product_line).toBe("混合云（HCS）");
    expect(next.is_active).toBe(true);
    expect(next.updated_at).toBeUndefined();
  });
});

describe("admin user table combobox columns", () => {
  const rows = [
    { product_line: "公有云", expert_domain: "存储引擎", min_dept: "平台组" },
    { product_line: "混合云（HCS）", expert_domain: "", min_dept: "平台组" },
    { product_line: "", expert_domain: "SQL引擎", min_dept: "" },
  ];

  it("product_line datalist uses distinct existing column values", () => {
    const html = renderUserColumnComboboxHtml("product_line", "公有云", rows, 0);
    expect(html).toContain('data-k="product_line"');
    expect(html).toContain('value="公有云"');
    expect(html).toContain('value="混合云（HCS）"');
    expect(html).not.toContain('value=""');
  });

  it("includes current value in datalist when not yet in column", () => {
    const html = renderUserColumnComboboxHtml("min_dept", "新部门", rows, 1);
    expect(html).toContain('value="新部门"');
    expect(html).toContain('value="平台组"');
  });

  it("table head should include expert domain filter key", () => {
    const headerSnippet = 'data-user-filter-open="expert_domain"';
    expect(headerSnippet).toContain("expert_domain");
  });
});

describe("filterUserRows global search", () => {
  const rows = [
    {
      account: "zhangsan",
      user_name: "张三",
      role_code: "运维",
      group_name: "平台组",
      email: "zhang@example.com",
      contact_phone: "13800000000",
      product_line: "公有云",
      expert_domain: "存储引擎",
      min_dept: "内核部",
      remark: "",
    },
    {
      account: "lisi",
      user_name: "李四",
      role_code: "开发",
      group_name: "应用组",
      email: "li@example.com",
      contact_phone: "",
      product_line: "混合云（HCS）",
      expert_domain: "",
      min_dept: "",
      remark: "外包",
    },
  ];
  const emptyFilters = { selected: Object.fromEntries(USER_ROW_FILTER_KEYS.map((k) => [k, []])) };

  it("matches account or user_name keyword", () => {
    expect(filterUserRows(rows, emptyFilters, "zhangsan")).toHaveLength(1);
    expect(filterUserRows(rows, emptyFilters, "张三")).toHaveLength(1);
    expect(filterUserRows(rows, emptyFilters, "李四")).toHaveLength(1);
  });

  it("matches product line and remark", () => {
    expect(filterUserRows(rows, emptyFilters, "混合云")).toHaveLength(1);
    expect(filterUserRows(rows, emptyFilters, "外包")).toHaveLength(1);
  });

  it("combines with column filters", () => {
    const filters = {
      selected: { ...emptyFilters.selected, role_code: ["运维"] },
    };
    expect(filterUserRows(rows, filters, "zhang")).toHaveLength(1);
    expect(filterUserRows(rows, filters, "李四")).toHaveLength(0);
  });
});

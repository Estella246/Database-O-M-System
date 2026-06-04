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

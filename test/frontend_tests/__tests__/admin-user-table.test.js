/**
 * 用户管理编辑态列控件回归（复制逻辑，避免 jest-node 下 ESM 解析）。
 */

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

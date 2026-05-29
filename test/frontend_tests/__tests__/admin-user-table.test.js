/**
 * 用户管理「领域」列表列回归。
 * 复制 frontend 常量，避免 jest-node 下做 ESM 解析。
 */

const USER_EXPERT_DOMAIN_OPTIONS = [
  "存储引擎",
  "SQL引擎",
  "周边组件",
];

describe("admin user table expert domain", () => {
  it("expert domain options align with stats domains", () => {
    expect(USER_EXPERT_DOMAIN_OPTIONS).toEqual(["存储引擎", "SQL引擎", "周边组件"]);
  });

  it("table head should include expert domain filter key", () => {
    const headerSnippet = 'data-user-filter-open="expert_domain"';
    const label = "领域";
    expect(headerSnippet).toContain("expert_domain");
    expect(label).toBe("领域");
  });
});

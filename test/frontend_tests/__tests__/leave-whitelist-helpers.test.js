/**
 * 请假审批白名单 - 前端辅助函数
 * 对应模块：frontend/modules/pages/leave-page.js
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/pages/leave-page.js");
const src = fs.readFileSync(SRC_PATH, "utf8");

function initLeaveWhitelistDraftFromItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((x) => String(x.account || "").trim())
    .filter(Boolean);
}

function leaveWhitelistEntryLabel(account, { whitelist = [], adminUsers = [] } = {}) {
  const acc = String(account || "").trim();
  if (!acc) return "";
  const wl = whitelist.find((w) => String(w.account || "") === acc);
  const u = adminUsers.find((x) => String(x.account || "") === acc);
  const name = String(wl?.user_name || u?.user_name || "").trim();
  return name ? `${name} ${acc}` : acc;
}

function personOptionMatchesKeyword(label, keyword) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return true;
  const txt = String(label || "").trim().toLowerCase();
  if (!txt) return false;
  if (txt.includes(kw)) return true;
  const tokens = kw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return txt.includes(kw);
  return tokens.every((t) => txt.includes(t));
}

function filterLeaveWhitelistUsersForAdd(pool, draftAccounts, filterText) {
  const draft = new Set((draftAccounts || []).map((a) => String(a || "")));
  const users = (Array.isArray(pool) ? pool : []).filter((u) => !draft.has(String(u.account || "")));
  const qq = String(filterText || "").trim();
  if (!qq) return [];
  return users.filter((u) => {
    const acc = String(u.account || "");
    const nm = String(u.user_name || "");
    const lab = nm ? `${nm} (${acc})` : acc;
    return personOptionMatchesKeyword(lab, qq) || personOptionMatchesKeyword(acc, qq) || personOptionMatchesKeyword(nm, qq);
  });
}

function leaveApproverPoolFromWhitelist(whitelist) {
  return (Array.isArray(whitelist) ? whitelist : [])
    .map((w) => ({
      account: String(w.account || "").trim(),
      user_name: String(w.user_name || "").trim(),
    }))
    .filter((u) => u.account);
}

function leavePersonLabel(user) {
  const acc = String(user?.account || "").trim();
  const nm = String(user?.user_name || user?.userName || "").trim();
  return nm && acc ? `${nm} ${acc}` : acc || nm;
}

function resolveLeavePersonAccount(raw, users) {
  const q = String(raw || "").trim();
  if (!q) return "";
  const pool = Array.isArray(users) ? users : [];
  const exact = pool.filter((u) => {
    const acc = String(u.account || "").trim();
    if (acc === q) return true;
    if (leavePersonLabel(u) === q) return true;
    const nm = String(u.user_name || u.userName || "").trim();
    return nm === q;
  });
  if (exact.length === 1) return String(exact[0].account || "").trim();
  return "";
}

function parseMultiPersonValue(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  if (s.includes("；")) {
    return s
      .split("；")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [s];
}

function leaveAccountsFromPersonValue(raw, users) {
  return parseMultiPersonValue(raw)
    .map((lab) => resolveLeavePersonAccount(lab, users))
    .filter(Boolean);
}

function resolveLeaveApplicantAccount(raw, users) {
  const q = String(raw || "").trim();
  if (!q) return "";
  const pool = Array.isArray(users) ? users : [];
  const leaveApplicantUserLabel = (user) => {
    const name = String(user?.user_name || user?.userName || "").trim();
    const acc = String(user?.account || "").trim();
    return name ? `${name} ${acc}` : acc;
  };
  const exact = pool.filter((u) => {
    const acc = String(u.account || "").trim();
    if (acc === q) return true;
    if (leaveApplicantUserLabel(u) === q) return true;
    const nm = String(u.user_name || "").trim();
    return nm === q;
  });
  if (exact.length === 1) return String(exact[0].account || "").trim();
  return "";
}

describe("leave-page.js 申请弹窗申请人字段", () => {
  test("申请人使用关键字搜索下拉，与添加审批人交互一致", () => {
    expect(src).toContain('id="leave-create-applicant-input"');
    expect(src).toContain('id="leave-create-applicant-account"');
    expect(src).toContain('id="leave-create-applicant-listbox"');
    expect(src).toContain("leave-app-applicant-combo");
    expect(src).toContain("filterLeaveApplicantUsersForSuggest");
    expect(src).toContain("state.leaveCreateApplicant");
    expect(src).toContain("state.leaveCreateApplicantAccount");
    expect(src).not.toMatch(/id="leave-create-applicant-input"[^>]*readonly/);
  });
});

describe("leave-page.js 申请弹窗审批人与抄送人字段", () => {
  test("审批人保持白名单下拉，抄送人复用工单协同处理人多选扁平下拉", () => {
    expect(src).toContain('id="leave-create-approver"');
    expect(src).toContain('data-field-key="leave_cc"');
    expect(src).toContain("renderWorkflowFlatMultiSelect");
    expect(src).not.toContain("renderWorkflowFlatSelect");
    expect(src).toContain("bindWorkflowFlatSelect");
    expect(src).toContain("leave-app-person-field");
    expect(src).toContain("state.leaveCreateCc");
    expect(src).not.toContain("leave-create-cc-input");
    expect(src).not.toContain("多个账号逗号分隔");
  });
});

describe("leave applicant helpers", () => {
  const users = [
    { account: "u1", user_name: "张三" },
    { account: "u2", user_name: "李四" },
  ];

  test("resolveLeaveApplicantAccount matches account or display label", () => {
    expect(resolveLeaveApplicantAccount("u1", users)).toBe("u1");
    expect(resolveLeaveApplicantAccount("张三 u1", users)).toBe("u1");
    expect(resolveLeaveApplicantAccount("张三", users)).toBe("u1");
    expect(resolveLeaveApplicantAccount("", users)).toBe("");
    expect(resolveLeaveApplicantAccount("不存在", users)).toBe("");
  });
});

describe("leave-page.js 申请弹窗提交防重复", () => {
  test("提交中锁定按钮并忽略重复点击", () => {
    expect(src).toContain("leaveCreateSubmitting");
    expect(src).toMatch(/if\s*\(state\.leaveCreateSubmitting\)\s*return/);
    expect(src).toMatch(/state\.leaveCreateSubmitting\s*=\s*true/);
    expect(src).toMatch(/leaveCreateSubmitting\s*\?\s*"提交中\.\.\."\s*:\s*"提交"/);
  });
});

describe("leave-page.js 审批白名单 UI 结构", () => {
  test("弹窗展示当前审批人列表与搜索添加，不再渲染全量勾选网格", () => {
    expect(src).toContain("leave-app-wl-members");
    expect(src).toContain("leave-wl-user-input");
    expect(src).toContain("leave-wl-add-btn");
    expect(src).toContain("data-leave-wl-remove");
    expect(src).not.toContain("leave-app-wl-grid");
    expect(src).not.toContain("data-leave-wl-acc");
  });
});

describe("leave whitelist helpers", () => {
  test("initLeaveWhitelistDraftFromItems extracts account list", () => {
    expect(
      initLeaveWhitelistDraftFromItems([
        { account: "u1", user_name: "张三" },
        { account: "", user_name: "空" },
        { account: "u2", user_name: "李四" },
      ])
    ).toEqual(["u1", "u2"]);
  });

  test("leaveWhitelistEntryLabel prefers whitelist then admin user name", () => {
    expect(
      leaveWhitelistEntryLabel("u1", {
        whitelist: [{ account: "u1", user_name: "白名单名" }],
        adminUsers: [{ account: "u1", user_name: "用户表名" }],
      })
    ).toBe("白名单名 u1");
    expect(
      leaveWhitelistEntryLabel("u2", {
        whitelist: [],
        adminUsers: [{ account: "u2", user_name: "李四" }],
      })
    ).toBe("李四 u2");
    expect(leaveWhitelistEntryLabel("u3", { whitelist: [], adminUsers: [] })).toBe("u3");
  });

  test("filterLeaveWhitelistUsersForAdd excludes draft and requires keyword", () => {
    const pool = [
      { account: "a1", user_name: "张三", is_active: true },
      { account: "a2", user_name: "李四", is_active: true },
      { account: "a3", user_name: "王五", is_active: true },
    ];
    expect(filterLeaveWhitelistUsersForAdd(pool, ["a1"], "")).toEqual([]);
    expect(filterLeaveWhitelistUsersForAdd(pool, ["a1"], "李").map((u) => u.account)).toEqual(["a2"]);
    expect(filterLeaveWhitelistUsersForAdd(pool, ["a2"], "a3").map((u) => u.account)).toEqual(["a3"]);
  });

  test("leaveApproverPoolFromWhitelist maps whitelist to user pool", () => {
    expect(
      leaveApproverPoolFromWhitelist([
        { account: "u1", user_name: "张三" },
        { account: "", user_name: "空" },
      ])
    ).toEqual([{ account: "u1", user_name: "张三" }]);
  });

  test("resolveLeavePersonAccount and leaveAccountsFromPersonValue", () => {
    const users = [
      { account: "u1", user_name: "张三" },
      { account: "u2", user_name: "李四" },
    ];
    expect(resolveLeavePersonAccount("张三 u1", users)).toBe("u1");
    expect(leaveAccountsFromPersonValue("张三 u1；李四 u2", users)).toEqual(["u1", "u2"]);
    expect(leaveAccountsFromPersonValue("", users)).toEqual([]);
  });
});

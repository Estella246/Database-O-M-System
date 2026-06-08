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
});

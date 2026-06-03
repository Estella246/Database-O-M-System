/**
 * 运维效率团队条「月度闭环 / 工单门槛」按组(ONCALL/R&D)分组明细 - 纯函数单元测试。
 * 对应模块：frontend/modules/pages/oncall-eva-page.js 的 teamGroupBreakdown。
 *
 * 约定：与源文件保持同步（沿用本套件「复制纯函数到测试」的策略）。
 */

const TEAM_GROUP_ORDER = ["ONCALL", "R&D"];

function teamGroupBreakdown(team, field, fmt = (v) => v) {
  const groups = (team && team.groups) || {};
  const keys = [
    ...TEAM_GROUP_ORDER.filter((g) => Object.prototype.hasOwnProperty.call(groups, g)),
    ...Object.keys(groups).filter((g) => !TEAM_GROUP_ORDER.includes(g)),
  ];
  if (!keys.length) return null;
  return keys.map((g) => `${g} ${fmt(groups[g] ? groups[g][field] : undefined)}`).join(" · ");
}

describe("teamGroupBreakdown", () => {
  const team = {
    total_tickets: 5,
    ticket_threshold: 2.0,
    groups: {
      "R&D": { headcount: 2, total_tickets: 2, ticket_threshold: 1.6 },
      ONCALL: { headcount: 3, total_tickets: 3, ticket_threshold: 2.4 },
    },
  };

  test("月度闭环按组拼接，ONCALL 在前 R&D 在后", () => {
    expect(teamGroupBreakdown(team, "total_tickets", (v) => v ?? "--")).toBe(
      "ONCALL 3 · R&D 2",
    );
  });

  test("工单门槛应用格式化函数", () => {
    expect(
      teamGroupBreakdown(team, "ticket_threshold", (v) => Number(v).toFixed(1)),
    ).toBe("ONCALL 2.4 · R&D 1.6");
  });

  test("固定顺序：即使对象里 R&D 在前也先输出 ONCALL", () => {
    const out = teamGroupBreakdown(team, "total_tickets");
    expect(out.indexOf("ONCALL")).toBeLessThan(out.indexOf("R&D"));
  });

  test("未知组排在已知组之后", () => {
    const t = {
      groups: {
        misc: { total_tickets: 9 },
        ONCALL: { total_tickets: 1 },
      },
    };
    expect(teamGroupBreakdown(t, "total_tickets")).toBe("ONCALL 1 · misc 9");
  });

  test("无分组数据返回 null（调用方回退到合计）", () => {
    expect(teamGroupBreakdown({ total_tickets: 5 }, "total_tickets")).toBeNull();
    expect(teamGroupBreakdown({ groups: {} }, "total_tickets")).toBeNull();
    expect(teamGroupBreakdown(null, "total_tickets")).toBeNull();
  });

  test("缺失字段时格式化收到 undefined", () => {
    const t = { groups: { ONCALL: {} } };
    expect(teamGroupBreakdown(t, "total_tickets", (v) => (v === undefined ? "--" : v))).toBe(
      "ONCALL --",
    );
  });
});

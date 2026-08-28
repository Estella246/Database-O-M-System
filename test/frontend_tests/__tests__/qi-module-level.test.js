/**
 * 模块&特性柱状图/饼图「层级粒度」选择（从领域算起）- 哨兵与纯函数测试
 * 覆盖：
 * - frontend/modules/pages/qi-page.js（aggByLevel 粒度聚合 / moduleLevelItems 组合（柱/饼各自
 *   领域筛选×粒度，超深收敛）/ stripDomainPrefix 已选领域去前缀 / 两张卡的粒度下拉渲染与绑定）
 * - frontend/modules/state/state.js（qiAnalyticsModuleLevelBar/Pie 默认 0=最深）
 *
 * 行为级断言用与源文件保持同步的逻辑副本；页面级交互（下拉切换、柱图/饼图/放大浮层跟随粒度）
 * 由 e2e（test_e2e_qi_module_level.py）覆盖。
 */

const fs = require("fs");
const path = require("path");

const readSrc = (rel) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");
const qiPageSrc = readSrc("../../../frontend/modules/pages/qi-page.js");
const stateSrc = readSrc("../../../frontend/modules/state/state.js");

// —— 与源文件保持同步的逻辑副本（qi-page.js 分析 tab 渲染段） ——
const moduleSegCount = (m) => String(m || "").split("/").filter(Boolean).length;
const barMaxDepthOf = (rows) => rows.reduce((mx, r) => Math.max(mx, 1 + moduleSegCount(r.module)), 1);
const aggByLevel = (rows, lvl) => {
  const agg = {};
  rows.forEach(r => {
    const segs = [r.domain, ...String(r.module || "").split("/").filter(Boolean)];
    const key = lvl > 0 ? segs.slice(0, lvl).join("/") : segs.join("/");
    agg[key] = (agg[key] || 0) + r.count;
  });
  return Object.entries(agg).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
};
const stripDomainPrefix = (items, sel) => sel
  ? items.map(it => (it.label.startsWith(sel + "/")
    ? { ...it, label: it.label.slice(sel.length + 1) } : it))
  : items;
const moduleLevelItems = (dmd, selDomain, storedLevel) => {
  const rows = selDomain ? dmd.filter(r => r.domain === selDomain) : dmd;
  const maxDepth = rows.reduce((mx, r) => Math.max(mx, 1 + moduleSegCount(r.module)), 1);
  const raw = Number(storedLevel) || 0;
  const eff = raw > 0 ? Math.min(raw, maxDepth) : 0;
  return {
    items: stripDomainPrefix(aggByLevel(rows, eff), selDomain),
    maxDepth,
    eff,
    selVal: String(eff),
  };
};

const ROWS = [
  { domain: "领域LA", module: "mA/p1", count: 2 },
  { domain: "领域LA", module: "mA/p2", count: 1 },
  { domain: "领域LA", module: "mB", count: 3 },
  { domain: "领域LB", module: "mC", count: 4 },
];

describe("源哨兵：粒度下拉存在并接入 state", () => {
  test("柱图/饼图卡片各渲染「粒度」下拉（含 最深/一级 选项）", () => {
    expect(qiPageSrc).toContain('粒度：<select ${attr}');
    expect(qiPageSrc).toContain('"data-qi-analytics-module-level-bar", barLvl.maxDepth, barLvl.selVal');
    expect(qiPageSrc).toContain('"data-qi-analytics-module-level-pie", pieLvl.maxDepth, pieLvl.selVal');
    expect(qiPageSrc).toContain(">最深</option>");
    expect(qiPageSrc).toContain('["一级", "二级", "三级", "四级", "五级", "六级", "七级", "八级", "九级"]');
  });

  test("change 绑定写入 state.qiAnalyticsModuleLevelBar/Pie 并纯前端重渲染（不重拉接口）", () => {
    expect(qiPageSrc).toContain('document.querySelector("[data-qi-analytics-module-level-bar]")');
    expect(qiPageSrc).toContain("state.qiAnalyticsModuleLevelBar = parseInt(modLvlSel.value, 10) || 0");
    expect(qiPageSrc).toContain('document.querySelector("[data-qi-analytics-module-level-pie]")');
    expect(qiPageSrc).toContain("state.qiAnalyticsModuleLevelPie = parseInt(pieLvlSel.value, 10) || 0");
  });

  test("state 默认 0=最深（默认行为不变）", () => {
    expect(stateSrc).toContain("qiAnalyticsModuleLevelBar: 0");
    expect(stateSrc).toContain("qiAnalyticsModuleLevelPie: 0");
  });

  test("粒度应用后的序列进入 qiAnalyticsFull.moduleBar/modulePie（挂载与放大浮层全量图同源跟随粒度）", () => {
    expect(qiPageSrc).toContain("modulePie: pieLvl.items");
    expect(qiPageSrc).toContain("moduleBar: barLvl.items");
  });

  test("收敛即落账：渲染期把超出最深层的存储层级归一到有效层级（显示值 === state 提交值）", () => {
    expect(qiPageSrc).toContain("state.qiAnalyticsModuleLevelBar = barLvl.eff;");
    expect(qiPageSrc).toContain("state.qiAnalyticsModuleLevelPie = pieLvl.eff;");
  });
});

describe("纯函数：moduleLevelItems 组合（柱/饼各自领域筛选×粒度）", () => {
  test("组合输出：粒度序列 + 最深层级 + 有效层级 + 选中值（二级+已选领域 → 去前缀）", () => {
    const r = moduleLevelItems(ROWS, "领域LA", 2);
    expect(r.items).toEqual([{ label: "mA", value: 3 }, { label: "mB", value: 3 }]);
    expect(r.maxDepth).toBe(3);
    expect(r.eff).toBe(2);
    expect(r.selVal).toBe("2");
  });

  test("0=最深 + 全部领域：带领域前缀全路径，eff=0/selVal=0", () => {
    const r = moduleLevelItems(ROWS, "", 0);
    expect(r.items[0]).toEqual({ label: "领域LB/mC", value: 4 });
    expect(r.eff).toBe(0);
    expect(r.selVal).toBe("0");
  });

  test("存储层级超出数据最深时收敛（9 → 3），收敛值随返回供落账", () => {
    expect(moduleLevelItems(ROWS, "", 9).selVal).toBe("3");
    expect(moduleLevelItems(ROWS, "", 9).eff).toBe(3);
    // 已选浅领域时按该领域数据收敛（领域LB 最深=2 → 9 收敛到 2）
    expect(moduleLevelItems(ROWS, "领域LB", 9).eff).toBe(2);
  });

  test("柱/饼互不耦合：各自传入各自的领域筛选与粒度", () => {
    const bar = moduleLevelItems(ROWS, "领域LA", 1);
    const pie = moduleLevelItems(ROWS, "", 2);
    expect(bar.items).toEqual([{ label: "领域LA", value: 6 }]);
    expect(pie.items).toEqual([
      { label: "领域LB/mC", value: 4 },
      { label: "领域LA/mA", value: 3 },
      { label: "领域LA/mB", value: 3 },
    ]);
  });
});

describe("纯函数：aggByLevel 粒度聚合（从领域算起）", () => {
  test("0=最深：领域+完整模块路径逐条列出", () => {
    expect(aggByLevel(ROWS, 0)).toEqual([
      { label: "领域LB/mC", value: 4 },
      { label: "领域LA/mB", value: 3 },
      { label: "领域LA/mA/p1", value: 2 },
      { label: "领域LA/mA/p2", value: 1 },
    ]);
  });

  test("一级=领域本身：同领域全部合并（LA=2+1+3）", () => {
    expect(aggByLevel(ROWS, 1)).toEqual([
      { label: "领域LA", value: 6 },
      { label: "领域LB", value: 4 },
    ]);
  });

  test("二级=领域/模块：mA 两叶子合并为 领域LA/mA=3", () => {
    expect(aggByLevel(ROWS, 2)).toEqual([
      { label: "领域LB/mC", value: 4 },
      { label: "领域LA/mA", value: 3 },
      { label: "领域LA/mB", value:3 },
    ]);
  });

  test("层级超过路径长度：短路径保持原样不截断（mB 无叶子段）", () => {
    const items = aggByLevel(ROWS, 3);
    expect(items).toContainEqual({ label: "领域LA/mB", value: 3 });
    expect(items.find(i => i.label === "领域LA/mB/p")).toBeUndefined();
  });

  test("「未分类」模块：一级并入领域，二级起单列", () => {
    const rows = [...ROWS, { domain: "领域LA", module: "未分类", count: 5 }];
    expect(aggByLevel(rows, 1)).toEqual([{ label: "领域LA", value: 11 }, { label: "领域LB", value: 4 }]);
    expect(aggByLevel(rows, 2)).toContainEqual({ label: "领域LA/未分类", value: 5 });
  });

  test("空模块段（脏数据）不产生空键：并入领域本身", () => {
    const rows = [{ domain: "领域LA", module: "", count: 7 }];
    expect(aggByLevel(rows, 0)).toEqual([{ label: "领域LA", value: 7 }]);
    expect(aggByLevel(rows, 2)).toEqual([{ label: "领域LA", value: 7 }]);
  });

  test("聚合后按数值降序（Top N 取前 10 的输入序）", () => {
    expect(aggByLevel(ROWS, 2).map(i => i.value)).toEqual([4, 3, 3]);
  });
});

describe("纯函数：最深层级推导与收敛", () => {
  test("barMaxDepth = 1 + 最深模块段数（ROWS 最深 mA/p1 两段 → 3）", () => {
    expect(barMaxDepthOf(ROWS)).toBe(3);
  });

  test("空数据/仅一级模块时最深=1 或 2，不越界", () => {
    expect(barMaxDepthOf([])).toBe(1);
    expect(barMaxDepthOf([{ domain: "D", module: "m" }])).toBe(2);
  });

  test("存储层级超出当前数据最深层级时收敛（Math.min）", () => {
    const barMaxDepth = 2; // 例如切换领域后数据变浅
    const lvlRaw = 3;
    const lvlEff = lvlRaw > 0 ? Math.min(lvlRaw, barMaxDepth) : 0;
    expect(lvlEff).toBe(2);
  });
});

describe("纯函数：已选领域去前缀（展示层）", () => {
  test("选中领域时剥掉恒定前缀，粒度计数不变", () => {
    const items = aggByLevel(ROWS.filter(r => r.domain === "领域LA"), 2);
    expect(stripDomainPrefix(items, "领域LA")).toEqual([
      { label: "mA", value: 3 },
      { label: "mB", value: 3 },
    ]);
  });

  test("一级（无斜杠，等于领域本身）不去前缀；全部领域时不去前缀", () => {
    expect(stripDomainPrefix([{ label: "领域LA", value: 6 }], "领域LA")).toEqual([{ label: "领域LA", value: 6 }]);
    const items = aggByLevel(ROWS, 1);
    expect(stripDomainPrefix(items, "")).toEqual(items);
  });
});

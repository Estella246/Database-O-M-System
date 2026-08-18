/**
 * 在研责任田（田目录 + 节点关联两层模型） - 纯函数单元测试
 * 对应模块：frontend/modules/pages/research-duty-field-params.js
 *
 * 覆盖：researchFieldScopeText（关联合并文本）、researchFieldRowFor 的槽位匹配谓词
 * （树节点角标/弹窗回显都依赖它从 items[].scopes 中找绑定田）。
 * 渲染/交互由 e2e（test_e2e_qi_research_field.py）覆盖。
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(
  __dirname,
  "../../../frontend/modules/pages/research-duty-field-params.js",
);
const src = fs.readFileSync(SRC_PATH, "utf8");

// 简化策略：直接复制需要测试的纯函数到此处（保持与源文件同步）
function researchFieldScopeText(row) {
  const scopes = Array.isArray(row?.scopes) ? row.scopes : [];
  if (!scopes.length) return "未关联（在责任田树节点上配置）";
  return scopes
    .map((sc) => {
      const domain = String(sc.domain || "").trim();
      const module_ = String(sc.module || "").trim();
      return module_ ? `${domain}/${module_}` : `${domain}（整领域）`;
    })
    .join("、");
}

// 源文件 researchFieldRowFor 依赖 state.researchDutyFieldItems；
// 这里抽取同一匹配谓词（槽位 = BTRIM 等价的 trim 语义，module 空 = 整领域槽位）
function rowFor(items, domain, module) {
  const d = String(domain || "").trim();
  const m = String(module || "").trim();
  if (!d) return null;
  return (
    (items || []).find((row) =>
      (row.scopes || []).some(
        (sc) => String(sc.domain || "").trim() === d && String(sc.module || "").trim() === m,
      ),
    ) || null
  );
}

// ---- 与源文件保持同步的哨兵：源实现改动时提示同步本测试 ----
describe("源文件哨兵", () => {
  test("researchFieldScopeText 实现与测试拷贝一致", () => {
    expect(src).toContain("未关联（在责任田树节点上配置）");
    expect(src).toContain("return module_ ? `${domain}/${module_}` : `${domain}（整领域）`;");
    expect(src).toContain('const scopes = Array.isArray(row?.scopes) ? row.scopes : [];');
  });

  test("researchFieldRowFor 槽位匹配语义与测试拷贝一致", () => {
    expect(src).toContain(
      '(row.scopes || []).some(',
    );
    expect(src).toContain(
      "String(sc.domain || \"\").trim() === d && String(sc.module || \"\").trim() === m",
    );
  });
});

describe("researchFieldScopeText 关联合并文本", () => {
  test("无关联 → 引导文案（在树节点上配置）", () => {
    expect(researchFieldScopeText({})).toBe("未关联（在责任田树节点上配置）");
    expect(researchFieldScopeText({ scopes: [] })).toBe("未关联（在责任田树节点上配置）");
    expect(researchFieldScopeText(null)).toBe("未关联（在责任田树节点上配置）");
  });

  test("单条模块关联 → 领域/模块", () => {
    expect(
      researchFieldScopeText({ scopes: [{ domain: "SQL引擎", module: "备份恢复" }] }),
    ).toBe("SQL引擎/备份恢复");
  });

  test("整领域关联（module 空）→ 领域（整领域）", () => {
    expect(researchFieldScopeText({ scopes: [{ domain: "SQL引擎", module: "" }] })).toBe(
      "SQL引擎（整领域）",
    );
  });

  test("多条关联（多模块共田）→ 顿号连接，顺序保持", () => {
    expect(
      researchFieldScopeText({
        scopes: [
          { domain: "D1", module: "M1" },
          { domain: "D2", module: "" },
          { domain: "D1", module: "M2" },
        ],
      }),
    ).toBe("D1/M1、D2（整领域）、D1/M2");
  });

  test("空格按 BTRIM 语义裁剪后展示", () => {
    expect(
      researchFieldScopeText({ scopes: [{ domain: " D ", module: " M " }] }),
    ).toBe("D/M");
    // module 仅空白视作整领域
    expect(researchFieldScopeText({ scopes: [{ domain: "D", module: "   " }] })).toBe(
      "D（整领域）",
    );
  });
});

describe("researchFieldRowFor 槽位匹配（角标/弹窗回显数据源）", () => {
  const items = [
    { id: 1, name: "田一", owner: "张三", scopes: [{ domain: "D1", module: "M1" }] },
    { id: 2, name: "田二", owner: "李四", scopes: [
      { domain: "D2", module: "" },           // 整领域槽位
      { domain: "D2", module: "M2" },         // 多模块共田
    ] },
    { id: 3, name: "田三", owner: "王五", scopes: [] },
  ];

  test("模块槽位命中绑定的田", () => {
    expect(rowFor(items, "D1", "M1")?.name).toBe("田一");
    expect(rowFor(items, "D2", "M2")?.name).toBe("田二");
  });

  test("整领域槽位（module 空）按 (领域, '') 精确匹配，不吞模块槽位", () => {
    expect(rowFor(items, "D2", "")?.name).toBe("田二");
    expect(rowFor(items, "D1", "")).toBe(null); // 田一只有模块关联，无整领域关联
  });

  test("未配置槽位与空领域返回 null", () => {
    expect(rowFor(items, "D9", "M9")).toBe(null);
    expect(rowFor(items, "", "M1")).toBe(null);
  });

  test("空格裁剪后匹配（与后端 BTRIM 槽位语义一致）", () => {
    expect(rowFor(items, " D1 ", " M1 ")?.name).toBe("田一");
    expect(rowFor(items, "D1", "M1 ")?.name).toBe("田一");
  });

  test("无 scopes 的田不参与匹配", () => {
    expect(rowFor(items, "D3", "")).toBe(null);
    expect(rowFor([], "D1", "M1")).toBe(null);
  });
});

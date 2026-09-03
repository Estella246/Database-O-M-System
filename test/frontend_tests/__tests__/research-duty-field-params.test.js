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

// 源文件 researchFieldRowEffectiveFor / collectResearchCascadeSlots 依赖
// state.researchDutyFieldItems 与 duty.js 的 dutyFieldNodeAtPath；
// 这里抽取同一实现（items/tree 显式传参），与源保持同步。
function getParentArray(tree, parts) {
  if (!parts.length) return null;
  if (parts.length === 1) return tree;
  let arr = tree;
  for (let d = 0; d < parts.length - 1; d++) {
    const n = arr[parts[d]];
    if (!n) return null;
    if (!Array.isArray(n.children)) n.children = [];
    arr = n.children;
  }
  return arr;
}

function nodeAt(tree, parts) {
  const parent = getParentArray(tree, parts);
  if (!parent) return null;
  return parent[parts[parts.length - 1]] ?? null;
}

function effectiveFor(items, domain, module) {
  const own = String(module || "").trim();
  let m = own;
  for (;;) {
    const row = rowFor(items, domain, m);
    if (row) return { row, inherited: m !== own };
    if (!m) return null;
    const cut = m.lastIndexOf("/");
    m = cut >= 0 ? m.slice(0, cut) : "";
  }
}

function collectSlots(tree, parts, baseModule) {
  const node = nodeAt(tree, parts);
  if (!node) return [];
  const domain = String(nodeAt(tree, parts.slice(0, 1))?.label || "").trim();
  if (!domain) return [];
  const prefix0 = String(baseModule || "").trim();
  const out = [];
  const walk = (children, prefix) => {
    (Array.isArray(children) ? children : []).forEach((ch) => {
      const label = String(ch?.label || "").trim();
      if (label) {
        const mod = prefix ? `${prefix}/${label}` : label;
        out.push({ domain, module: mod });
        walk(ch?.children || [], mod);
      } else {
        walk(ch?.children || [], prefix);
      }
    });
  };
  walk(node.children || [], prefix0);
  return out;
}

describe("researchFieldRowEffectiveFor 继承回退（角标数据源）", () => {
  const items = [
    { id: 1, name: "田A", owner: "张三", scopes: [
      { domain: "D1", module: "M1/M2" },      // 上级 M1/M2
      { domain: "D1", module: "" },           // 整领域兜底
    ] },
    { id: 2, name: "田B", owner: "李四", scopes: [{ domain: "D1", module: "M1/M2/M3" }] },
  ];

  test("自身槽位命中：非继承", () => {
    const hit = effectiveFor(items, "D1", "M1/M2/M3");
    expect(hit?.row.name).toBe("田B");
    expect(hit?.inherited).toBe(false);
  });

  test("自身未绑：逐级回退到上级模块槽位，标记继承", () => {
    // M1/M2/M3/X 自身无绑定 → 回退 M1/M2/M3（田B）
    const deep = effectiveFor(items, "D1", "M1/M2/M3/X");
    expect(deep?.row.name).toBe("田B");
    expect(deep?.inherited).toBe(true);
    // M1/M2/M3 被 2 田绑过换绑后仅剩田A 的场景：回退 M1/M2（田A）
    const unbound = effectiveFor([{ ...items[0] }, { ...items[1], scopes: [] }], "D1", "M1/M2/M3");
    expect(unbound?.row.name).toBe("田A");
    expect(unbound?.inherited).toBe(true);
  });

  test("模块路径全无绑定：整领域槽位兜底继承", () => {
    const hit = effectiveFor(items, "D1", "M9/Sub");
    expect(hit?.row.name).toBe("田A");
    expect(hit?.inherited).toBe(true);
  });

  test("全无绑定返回 null", () => {
    expect(effectiveFor(items, "D2", "M1/M2")).toBe(null);
    expect(effectiveFor([], "D1", "M1")).toBe(null);
  });
});

describe("collectResearchCascadeSlots 全量级联槽位枚举", () => {
  const tree = [
    { label: "领域甲", children: [
      { label: "模块A1", children: [
        { label: "特性X", children: [{ label: "子项Y", children: [] }] },
        { label: "", children: [{ label: "空档Z", children: [] }] },  // 空标签：不出槽位但下钻
      ] },
      { label: "模块A2", children: [] },
    ] },
    { label: "领域乙", children: [] },
  ];

  test("枚举子树全部下级槽位：模块路径按 / 连接、逐层前缀", () => {
    expect(collectSlots(tree, [0, 0], "模块A1")).toEqual([
      { domain: "领域甲", module: "模块A1/特性X" },
      { domain: "领域甲", module: "模块A1/特性X/子项Y" },
      { domain: "领域甲", module: "模块A1/空档Z" },
    ]);
  });

  test("空标签节点自身不出槽位，子级沿用其前缀继续下钻（防御分支）", () => {
    // e2e 无法造空标签（树 PUT 对空 label 400），该分支在此锁定
    const slots = collectSlots(tree, [0, 0], "模块A1");
    expect(slots.find((s) => s.module.includes("空档Z"))).toEqual({
      domain: "领域甲", module: "模块A1/空档Z",
    });
    expect(slots.some((s) => s.module === "模块A1/")).toBe(false); // 空标签自身不产生槽位
  });

  test("整领域节点：baseModule 为空、从一级标签起拼路径", () => {
    expect(collectSlots(tree, [0], "")).toEqual([
      { domain: "领域甲", module: "模块A1" },
      { domain: "领域甲", module: "模块A1/特性X" },
      { domain: "领域甲", module: "模块A1/特性X/子项Y" },
      { domain: "领域甲", module: "模块A1/空档Z" },
      { domain: "领域甲", module: "模块A2" },
    ]);
  });

  test("叶子节点无下级、路径不存在、根标签为空均返回 []", () => {
    expect(collectSlots(tree, [0, 0, 0, 0], "模块A1/特性X/子项Y")).toEqual([]);
    expect(collectSlots(tree, [9, 9], "x")).toEqual([]);
    expect(collectSlots([{ label: "  ", children: [{ label: "M", children: [] }] }], [0], "")).toEqual([]);
  });
});

describe("源文件哨兵（继承回退/级联枚举）", () => {
  test("researchFieldRowEffectiveFor 实现与测试拷贝一致", () => {
    expect(src).toContain("export function researchFieldRowEffectiveFor(domain, module) {");
    expect(src).toContain("if (row) return { row, inherited: m !== own };");
    expect(src).toContain('m = cut >= 0 ? m.slice(0, cut) : "";');
  });

  test("collectResearchCascadeSlots 实现与测试拷贝一致", () => {
    expect(src).toContain("export function collectResearchCascadeSlots(tree, parts, baseModule) {");
    expect(src).toContain("const mod = prefix ? `${prefix}/${label}` : label;");
    expect(src).toContain("walk(ch?.children || [], prefix);"); // 空标签下钻分支
  });
});

// 多人责任人（「；」分隔，保存预校验在前端、用户存在性校验在后端）：
// 拆分/校验为源文件内部函数，按本文件惯例拷贝实现 + 哨兵保持同步。
function splitOwnerPartsLenient(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const out = [];
  const seen = new Set();
  for (const part of s.split(/[；;，,、]/)) {
    const t = part.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function validateResearchDutyFieldDraft(draft) {
  const seen = new Set();
  for (const row of draft || []) {
    if (!row.name) return { ok: false, message: "在研责任田名称不能为空" };
    if (seen.has(row.name)) return { ok: false, message: `在研责任田名称重复：${row.name}` };
    seen.add(row.name);
    const ownerParts = splitOwnerPartsLenient(row.owner);
    for (const p of ownerParts) {
      if (!/\s/.test(p)) return { ok: false, message: `在研责任田责任人格式须为「姓名 账号」：${p}` };
    }
  }
  return { ok: true };
}

describe("splitOwnerPartsLenient 多人责任人宽容拆分（保存预校验数据源）", () => {
  test("标准「；」分隔：逐段保留、顺序保持", () => {
    expect(splitOwnerPartsLenient("张三 zhangsan；李四 lisi")).toEqual([
      "张三 zhangsan",
      "李四 lisi",
    ]);
  });

  test("历史遗留分隔符（全/半角分号、全/半角逗号、顿号）混用均可拆", () => {
    expect(splitOwnerPartsLenient("张三 zhangsan,李四 lisi、王五 wangwu;赵六 zhaoliu；陈七 chenqi")).toEqual([
      "张三 zhangsan",
      "李四 lisi",
      "王五 wangwu",
      "赵六 zhaoliu",
      "陈七 chenqi",
    ]);
  });

  test("重复段去重保序（首现位置）、段前后空白裁剪、空段丢弃", () => {
    expect(splitOwnerPartsLenient(" 张三 zhangsan ；； 李四 lisi；张三 zhangsan；；")).toEqual([
      "张三 zhangsan",
      "李四 lisi",
    ]);
  });

  test("单人不分隔 → 单元素数组；空串/纯分隔符 → []（owner 留空兼容）", () => {
    expect(splitOwnerPartsLenient("张三 zhangsan")).toEqual(["张三 zhangsan"]);
    expect(splitOwnerPartsLenient("")).toEqual([]);
    expect(splitOwnerPartsLenient("；；，、")).toEqual([]);
    expect(splitOwnerPartsLenient(null)).toEqual([]);
  });
});

describe("validateResearchDutyFieldDraft 保存预校验（多人 owner 格式）", () => {
  test("多人段各含空白（姓名+账号）→ 通过；owner 为空 → 通过", () => {
    expect(validateResearchDutyFieldDraft([{ name: "田一", owner: "张三 zhangsan；李四 lisi" }])).toEqual({ ok: true });
    expect(validateResearchDutyFieldDraft([{ name: "田一", owner: "" }])).toEqual({ ok: true });
  });

  test("任一段无空白（缺账号）→ 拦截并指明问题段", () => {
    const r = validateResearchDutyFieldDraft([{ name: "田一", owner: "张三 zhangsan；只有姓名" }]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("责任人格式须为「姓名 账号」");
    expect(r.message).toContain("只有姓名");
  });

  test("名称空/重复 → 对应拦截（owner 校验不越权覆盖名称分支）", () => {
    expect(validateResearchDutyFieldDraft([{ name: "", owner: "张三 zhangsan" }]).message).toBe(
      "在研责任田名称不能为空",
    );
    expect(
      validateResearchDutyFieldDraft([
        { name: "田一", owner: "" },
        { name: "田一", owner: "" },
      ]).message,
    ).toBe("在研责任田名称重复：田一");
  });

  test("全角空格段通过预校验（\\s 匹配 U+3000；折叠归一由后端 parse_person_parts_lenient 负责）", () => {
    // 前后端契约：FE 只查「段含任意空白」，BE 把段内空白串折叠为半角空格后存储，
    // 两边口径一致才不会出现「FE 放行、BE 400 格式」的全角空格死角
    expect(validateResearchDutyFieldDraft([{ name: "田一", owner: "张三　zhangsan" }])).toEqual({ ok: true });
  });
});

describe("源文件哨兵（多人责任人/错误横幅）", () => {
  test("splitOwnerPartsLenient 实现与测试拷贝一致", () => {
    expect(src).toContain("for (const part of s.split(/[；;，,、]/)) {");
    expect(src).toContain("if (t && !seen.has(t)) {");
  });

  test("owner 格式预校验实现与提示文案", () => {
    expect(src).toContain("const ownerParts = splitOwnerPartsLenient(row.owner);");
    expect(src).toContain("在研责任田责任人格式须为「姓名 账号」：${p}");
  });

  test("编辑行 owner 输入提示多人写法（placeholder/title）", () => {
    expect(src).toContain('placeholder="责任人（多人用；分隔，如 张三 zhangsan；李四 lisi）"');
    expect(src).toContain('title="多个责任人用；分隔，每个须为「姓名 账号」的系统用户"');
  });

  test("只读行 owner 带 title 全量悬浮（配合 CSS 省略号截断）", () => {
    expect(src).toContain('title="${escapeAttr(row.owner || "")}"');
  });

  test("错误横幅按 MsgType 分类（面板与树弹窗），不再嗅探文案正则", () => {
    // 所有置 Msg 的失败路径同步置 Type=err；渲染按类型选样式——
    // 网络异常英文消息、权限 403 等措辞不可枚举，嗅探正则会把它们渲染成绿色成功横幅
    expect(src.split('state.researchDutyFieldMsgType = "err"').length - 1).toBeGreaterThanOrEqual(3);
    expect(src.split('state.researchFieldNodeMsgType = "err"').length - 1).toBeGreaterThanOrEqual(2);
    expect(src).toContain('state.researchDutyFieldMsgType === "err" ? "duty-field-banner--err"');
    expect(src).toContain('state.researchFieldNodeMsgType === "err" ? "duty-field-banner--err"');
    expect(src).not.toContain("未就绪|迁移|不存在|格式"); // 旧文案嗅探正则应已移除
  });

  test("面板说明含多人写法与「模块优先、责任人兜底」口径", () => {
    expect(src).toContain("责任人支持多人（「；」分隔，每个须为「姓名 账号」的系统用户）");
    expect(src).toContain("统计归桶为模块优先、责任人兜底");
  });
});

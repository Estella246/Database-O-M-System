/**
 * 热补丁详情顶栏：段间连接线类型与分叉 HTML，须与 `frontend/modules/constants/hotpatch-workflow.js`
 * 中 `resolveHotpatchFlowJoinKind` / `renderHotpatchFlowJoinHtml` 保持一致（Jest CJS 不便直接 import 该 ESM 文件）。
 */
function resolveHotpatchFlowJoinKind(prevType, nextType) {
  if (prevType === "sequence" && nextType === "parallel2") return "fork-2";
  if (prevType === "parallel2" && nextType === "sequence") return "merge-2";
  if (prevType === "sequence" && nextType === "parallel4") return "fork-4";
  if (prevType === "parallel4" && nextType === "sequence") return "merge-4";
  return "line";
}

const HP_JOIN_SVG_ATTRS =
  ' class="hp-flow-join-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

function renderHotpatchFlowJoinHtml(kind) {
  const k = String(kind || "line");
  if (k === "fork-2") {
    return `<div class="hp-flow-join hp-flow-join--fork-2" aria-hidden="true"><svg${HP_JOIN_SVG_ATTRS} viewBox="0 0 48 120" width="40" height="100%"><path d="M0,60 L12,60 C12,60 26,42 46,27.5 M12,60 C12,60 26,78 46,92.5"/></svg></div>`;
  }
  if (k === "merge-2") {
    return `<div class="hp-flow-join hp-flow-join--merge-2" aria-hidden="true"><svg${HP_JOIN_SVG_ATTRS} viewBox="0 0 48 120" width="40" height="100%"><path d="M0,27.5 C10,27.5 18,48 26,60 L46,60 M0,92.5 C10,92.5 18,72 26,60"/></svg></div>`;
  }
  if (k === "fork-4") {
    return `<div class="hp-flow-join hp-flow-join--fork-4" aria-hidden="true"><svg${HP_JOIN_SVG_ATTRS} viewBox="0 0 48 200" width="40" height="100%"><path d="M0,100 L12,100 C12,100 26,58 46,22 M12,100 C12,100 26,82 46,74 M12,100 C12,100 26,102 46,126 M12,100 C12,100 26,138 46,178"/></svg></div>`;
  }
  if (k === "merge-4") {
    return `<div class="hp-flow-join hp-flow-join--merge-4" aria-hidden="true"><svg${HP_JOIN_SVG_ATTRS} viewBox="0 0 48 200" width="40" height="100%"><path d="M0,22 C10,22 18,56 26,100 M0,74 C10,74 18,84 26,100 M0,126 C10,126 18,98 26,100 M0,178 C10,178 18,116 26,100 M26,100 L46,100"/></svg></div>`;
  }
  return `<div class="hp-flow-join hp-flow-join--line" aria-hidden="true"><span class="hp-flow-join-line"></span></div>`;
}

describe("resolveHotpatchFlowJoinKind / renderHotpatchFlowJoinHtml", () => {
  test("计划制定后并行二泳道：sequence→parallel2 为 fork-2", () => {
    expect(resolveHotpatchFlowJoinKind("sequence", "parallel2")).toBe("fork-2");
  });

  test("并行二泳道汇合到热补丁串讲：parallel2→sequence 为 merge-2", () => {
    expect(resolveHotpatchFlowJoinKind("parallel2", "sequence")).toBe("merge-2");
  });

  test("串讲后四自检并行：sequence→parallel4 为 fork-4", () => {
    expect(resolveHotpatchFlowJoinKind("sequence", "parallel4")).toBe("fork-4");
  });

  test("四自检汇合到转测段：parallel4→sequence 为 merge-4", () => {
    expect(resolveHotpatchFlowJoinKind("parallel4", "sequence")).toBe("merge-4");
  });

  test("其它组合为直线", () => {
    expect(resolveHotpatchFlowJoinKind("sequence", "sequence")).toBe("line");
    expect(resolveHotpatchFlowJoinKind("parallel2", "parallel4")).toBe("line");
  });

  test("fork-2 双泳道支路终点与行中心 27.5 / 92.5 对齐", () => {
    const html = renderHotpatchFlowJoinHtml("fork-2");
    expect(html).toContain("hp-flow-join--fork-2");
    expect(html).toContain("viewBox=\"0 0 48 120\"");
    expect(html).toMatch(/46,27\.5/);
    expect(html).toMatch(/46,92\.5/);
    expect(html).not.toMatch(/L12,22/);
  });

  test("merge-2 双泳道支路起点 y 为 27.5 / 92.5", () => {
    const html = renderHotpatchFlowJoinHtml("merge-2");
    expect(html).toMatch(/M0,27\.5/);
    expect(html).toMatch(/M0,92\.5/);
    expect(html).toMatch(/L46,60/);
  });

  test("fork-4 四条支路终点 y 与四等分行中心 22/74/126/178 对齐", () => {
    const html = renderHotpatchFlowJoinHtml("fork-4");
    expect(html).toContain("viewBox=\"0 0 48 200\"");
    expect(html).toMatch(/46,22/);
    expect(html).toMatch(/46,74/);
    expect(html).toMatch(/46,126/);
    expect(html).toMatch(/46,178/);
  });

  test("merge-4 四条支路起点 y 为 22/74/126/178", () => {
    const html = renderHotpatchFlowJoinHtml("merge-4");
    expect(html).toMatch(/M0,22/);
    expect(html).toMatch(/M0,74/);
    expect(html).toMatch(/M0,126/);
    expect(html).toMatch(/M0,178/);
  });

  test("line HTML 为水平线段", () => {
    const html = renderHotpatchFlowJoinHtml("line");
    expect(html).toContain("hp-flow-join-line");
  });
});

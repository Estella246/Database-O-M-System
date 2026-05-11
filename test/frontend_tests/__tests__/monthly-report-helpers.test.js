/**
 * 月度报告 / 问题报表 纯函数单元测试
 * 对应模块：frontend/modules/pages/report-page.js
 */

function detectDtsColumn(columns) {
  const list = (columns || []).map((c) => String(c || ""));
  const lower = list.map((c) => c.toLowerCase());
  let idx = lower.findIndex((c) => c === "dts" || c === "dts单号" || c === "dts号");
  if (idx >= 0) return list[idx];
  idx = lower.findIndex((c) => c.includes("dts"));
  if (idx >= 0) return list[idx];
  return "";
}

function normalizeDtsValue(raw) {
  return String(raw == null ? "" : raw).trim().toLowerCase();
}

function buildHistoryIndex(historyRows, dtsCol) {
  const idx = new Map();
  if (!dtsCol) return idx;
  (historyRows || []).forEach((row) => {
    const key = normalizeDtsValue(row[dtsCol]);
    if (key && !idx.has(key)) idx.set(key, row);
  });
  return idx;
}

function mergeIssueRows(historyRows, newRows, schemaCols, dtsCol) {
  const cols = (schemaCols || []).slice();
  const historyIndex = buildHistoryIndex(historyRows, dtsCol);
  return (newRows || []).map((row) => {
    const merged = {};
    const dtsKey = dtsCol ? normalizeDtsValue(row[dtsCol]) : "";
    const histRow = dtsKey ? historyIndex.get(dtsKey) : undefined;
    cols.forEach((col) => {
      const newVal = row[col];
      const newStr = newVal == null ? "" : String(newVal);
      if (newStr.trim() !== "") {
        merged[col] = newStr;
        return;
      }
      if (histRow != null) {
        const histVal = histRow[col];
        const histStr = histVal == null ? "" : String(histVal);
        merged[col] = histStr;
        return;
      }
      merged[col] = "";
    });
    return merged;
  });
}

describe("detectDtsColumn", () => {
  test("精确匹配 DTS", () => {
    expect(detectDtsColumn(["问题描述", "DTS", "处理人"])).toBe("DTS");
  });

  test("精确匹配 dts 单号 (大小写不敏感)", () => {
    expect(detectDtsColumn(["DTS单号", "处理人"])).toBe("DTS单号");
    expect(detectDtsColumn(["dts单号", "处理人"])).toBe("dts单号");
  });

  test("子串匹配 DTS_NO", () => {
    expect(detectDtsColumn(["DTS_NO", "owner"])).toBe("DTS_NO");
  });

  test("没有 DTS 列时返回空字符串", () => {
    expect(detectDtsColumn(["title", "owner"])).toBe("");
  });

  test("空输入返回空字符串", () => {
    expect(detectDtsColumn([])).toBe("");
    expect(detectDtsColumn(null)).toBe("");
  });

  test("精确匹配优先于子串匹配", () => {
    expect(detectDtsColumn(["DTS_extra_dts", "DTS"])).toBe("DTS");
  });
});

describe("normalizeDtsValue", () => {
  test("去除前后空白并小写化", () => {
    expect(normalizeDtsValue(" DTS001 ")).toBe("dts001");
  });

  test("空值返回空字符串", () => {
    expect(normalizeDtsValue(null)).toBe("");
    expect(normalizeDtsValue(undefined)).toBe("");
    expect(normalizeDtsValue("")).toBe("");
  });

  test("数字转换为字符串", () => {
    expect(normalizeDtsValue(123)).toBe("123");
  });
});

describe("buildHistoryIndex", () => {
  test("以 DTS 列为键构建索引", () => {
    const rows = [
      { DTS: "D001", title: "x" },
      { DTS: "D002", title: "y" },
    ];
    const idx = buildHistoryIndex(rows, "DTS");
    expect(idx.size).toBe(2);
    expect(idx.get("d001").title).toBe("x");
  });

  test("无 DTS 列时返回空索引", () => {
    const rows = [{ DTS: "D001" }];
    expect(buildHistoryIndex(rows, "").size).toBe(0);
  });

  test("重复键时保留首条", () => {
    const rows = [
      { DTS: "D001", title: "first" },
      { DTS: "D001", title: "second" },
    ];
    const idx = buildHistoryIndex(rows, "DTS");
    expect(idx.size).toBe(1);
    expect(idx.get("d001").title).toBe("first");
  });
});

describe("mergeIssueRows", () => {
  const schemaCols = ["DTS单号", "标题", "责任人", "严重性"];
  const dtsCol = "DTS单号";

  test("通过 DTS 单号补齐空字段", () => {
    const history = [
      { "DTS单号": "DTS001", "标题": "历史标题", "责任人": "张三", "严重性": "致命" },
    ];
    const newRows = [
      { "DTS单号": "DTS001", "标题": "", "责任人": "", "严重性": "" },
    ];
    const merged = mergeIssueRows(history, newRows, schemaCols, dtsCol);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      "DTS单号": "DTS001",
      "标题": "历史标题",
      "责任人": "张三",
      "严重性": "致命",
    });
  });

  test("新增数据优先于历史数据", () => {
    const history = [{ "DTS单号": "DTS001", "标题": "旧标题" }];
    const newRows = [{ "DTS单号": "DTS001", "标题": "新标题" }];
    const merged = mergeIssueRows(history, newRows, ["DTS单号", "标题"], dtsCol);
    expect(merged[0]["标题"]).toBe("新标题");
  });

  test("历史中查不到的字段留空", () => {
    const history = [];
    const newRows = [{ "DTS单号": "DTS999", "标题": "" }];
    const merged = mergeIssueRows(history, newRows, schemaCols, dtsCol);
    expect(merged[0]["标题"]).toBe("");
    expect(merged[0]["责任人"]).toBe("");
  });

  test("DTS 单号大小写/空白不敏感", () => {
    const history = [{ "DTS单号": " dts001 ", "标题": "命中" }];
    const newRows = [{ "DTS单号": "DTS001", "标题": "" }];
    const merged = mergeIssueRows(history, newRows, ["DTS单号", "标题"], dtsCol);
    expect(merged[0]["标题"]).toBe("命中");
  });

  test("schema 仅包含新增列表的字段，历史多余字段被忽略", () => {
    const history = [{ "DTS单号": "DTS001", "标题": "x", "其他": "y" }];
    const newRows = [{ "DTS单号": "DTS001", "标题": "" }];
    const merged = mergeIssueRows(history, newRows, ["DTS单号", "标题"], dtsCol);
    expect(merged[0]).toEqual({ "DTS单号": "DTS001", "标题": "x" });
    expect(merged[0]["其他"]).toBeUndefined();
  });

  test("没有 DTS 列时返回原列表的空字段", () => {
    const history = [{ "DTS单号": "DTS001", "标题": "x" }];
    const newRows = [{ "DTS单号": "DTS001", "标题": "" }];
    const merged = mergeIssueRows(history, newRows, ["DTS单号", "标题"], "");
    expect(merged[0]["标题"]).toBe("");
  });

  test("空输入返回空数组", () => {
    expect(mergeIssueRows([], [], schemaCols, dtsCol)).toEqual([]);
    expect(mergeIssueRows(null, null, schemaCols, dtsCol)).toEqual([]);
  });

  test("空白字符串被视为空字段", () => {
    const history = [{ "DTS单号": "DTS001", "标题": "已补齐" }];
    const newRows = [{ "DTS单号": "DTS001", "标题": "   " }];
    const merged = mergeIssueRows(history, newRows, ["DTS单号", "标题"], dtsCol);
    expect(merged[0]["标题"]).toBe("已补齐");
  });
});

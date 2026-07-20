/**
 * 工作台选择列：各阶段「处理人」表头可筛选（节点级 filter key）。
 * 与 column-fields.js / format.js / table-columns.js 契约一致。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const COLUMN_FIELDS = fs.readFileSync(
  path.join(ROOT, "frontend/modules/constants/column-fields.js"),
  "utf8"
);
const FORMAT_JS = fs.readFileSync(path.join(ROOT, "frontend/modules/utils/format.js"), "utf8");
const TABLE_COLUMNS = fs.readFileSync(
  path.join(ROOT, "frontend/modules/pages/table-columns.js"),
  "utf8"
);

/** 精简复刻：ticketListColumnFilterKey + isTicketListColumnFilterable */
function ticketListColumnFilterKey(col) {
  if (!col?.fieldKey) return "";
  if (col.fieldKey === "stage_handler" && col.nodeKey && col.nodeKey !== "system") {
    return `${col.nodeKey}:stage_handler`;
  }
  return col.fieldKey;
}

function isTicketListColumnFilterable(col) {
  if (!col?.fieldKey) return false;
  const { nodeKey, fieldKey, type } = col;
  const nonFilterable = new Set([
    "processId",
    "slaTime",
    "start_date",
    "startDate",
    "fill_date",
    "issue_desc",
    "description",
  ]);
  if (nonFilterable.has(fieldKey)) return false;
  if (nodeKey === "system") {
    if (fieldKey === "processId" || fieldKey === "slaTime") return false;
    return ["currentStage", "currentHandler", "creatorName"].includes(fieldKey);
  }
  if (fieldKey === "stage_handler") return true;
  if (type === "richtext") return false;
  if (type === "whitelist") return true;
  if (fieldKey === "location") return true;
  return false;
}

function ticketListFilterDisplayValue(ticket, colKey) {
  if (typeof colKey === "string" && colKey.endsWith(":stage_handler")) {
    const nodeKey = colKey.slice(0, -":stage_handler".length);
    const fbn = ticket?._fieldsByNode || ticket?._fields_by_node || {};
    const bucket = fbn[nodeKey] && typeof fbn[nodeKey] === "object" ? fbn[nodeKey] : {};
    const s = String(bucket.stage_handler || "").trim();
    return s || "（空）";
  }
  return "（空）";
}

describe("各阶段处理人列筛选", () => {
  test("源码导出 STAGE_HANDLER / ticketListColumnFilterKey / isTicketListColumnFilterable", () => {
    expect(COLUMN_FIELDS).toMatch(/export const STAGE_HANDLER_FIELD_KEY = "stage_handler"/);
    expect(COLUMN_FIELDS).toMatch(/export function ticketListColumnFilterKey/);
    expect(COLUMN_FIELDS).toMatch(/fieldKey === STAGE_HANDLER_FIELD_KEY/);
    expect(FORMAT_JS).toMatch(/colKey\.endsWith\(":stage_handler"\)/);
    expect(TABLE_COLUMNS).toMatch(/ticketListColumnFilterKey/);
    expect(TABLE_COLUMNS).toMatch(/STAGE_HANDLER_FIELD_KEY/);
  });

  test("stage_handler 可筛选且 filter key 带节点", () => {
    const col = { nodeKey: "ops_analysis", fieldKey: "stage_handler", type: "text" };
    expect(isTicketListColumnFilterable(col)).toBe(true);
    expect(ticketListColumnFilterKey(col)).toBe("ops_analysis:stage_handler");
    expect(ticketListColumnFilterKey({ nodeKey: "dev_analysis", fieldKey: "stage_handler" })).toBe(
      "dev_analysis:stage_handler"
    );
  });

  test("不同阶段处理人 filter key 互不冲突", () => {
    const ops = ticketListColumnFilterKey({ nodeKey: "ops_analysis", fieldKey: "stage_handler" });
    const dev = ticketListColumnFilterKey({ nodeKey: "dev_analysis", fieldKey: "stage_handler" });
    expect(ops).not.toBe(dev);
  });

  test("displayValue 读 _fieldsByNode 对应节点", () => {
    const ticket = {
      _fieldsByNode: {
        ops_analysis: { stage_handler: "张三 z001" },
        dev_analysis: { stage_handler: "李四 l002" },
      },
    };
    expect(ticketListFilterDisplayValue(ticket, "ops_analysis:stage_handler")).toBe("张三 z001");
    expect(ticketListFilterDisplayValue(ticket, "dev_analysis:stage_handler")).toBe("李四 l002");
    expect(ticketListFilterDisplayValue(ticket, "audit_close:stage_handler")).toBe("（空）");
  });

  test("whitelist 与 richtext 行为不变", () => {
    expect(
      isTicketListColumnFilterable({
        nodeKey: "ops_analysis",
        fieldKey: "severity",
        type: "whitelist",
      })
    ).toBe(true);
    expect(
      isTicketListColumnFilterable({
        nodeKey: "ops_analysis",
        fieldKey: "issue_desc",
        type: "richtext",
      })
    ).toBe(false);
  });
});

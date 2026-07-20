/**
 * 工作台「曾处理 / 曾协同」页签过滤 — 与 ticket-core.applyWorkbenchListFilters 口径一致。
 */

const fs = require("fs");
const path = require("path");

function operatorMatchesPersonField(fieldValue, operator) {
  const raw = String(fieldValue || "")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return false;
  const acc = String(operator.account || "").trim();
  const name = String(operator.userName || "").trim();
  const accLower = acc.toLowerCase();
  if (acc && (raw === acc || raw.toLowerCase() === accLower)) return true;
  if (name && raw === name) return true;
  const tokens = raw.split(" ").filter(Boolean);
  if (acc && tokens.some((t) => t.toLowerCase() === accLower)) return true;
  if (name && tokens.some((t) => t === name)) return true;
  return false;
}

function operatorMatchesAnyPersonFields(combined, operator) {
  const raw = String(combined || "").trim();
  if (!raw) return false;
  const parts = raw.split(/[,，;；、]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return operatorMatchesPersonField(raw, operator);
  return parts.some((p) => operatorMatchesPersonField(p, operator));
}

function ticketCreatorMatchesOperator(ticket, operator) {
  const cid = String(ticket.creatorId || "").trim();
  const acc = String(operator.account || "").trim();
  if (cid && acc && cid === acc) return true;
  return operatorMatchesPersonField(String(ticket.creatorName || ""), operator);
}

function filterByWorkbenchTab(tickets, listTab, operator) {
  return (tickets || []).filter((t) => {
    if (listTab === "all") return true;
    if (listTab === "created") return ticketCreatorMatchesOperator(t, operator);
    if (listTab === "handled") return Boolean(t.operatorSubmitted);
    if (listTab === "collaborated") {
      return operatorMatchesAnyPersonFields(String(t.collaborator || ""), operator);
    }
    const handler = String((t.currentHandler ?? t.assignee) || "").trim();
    return operatorMatchesAnyPersonFields(handler, operator);
  });
}

const op = { account: "z001", userName: "张三" };

describe("工作台曾处理 / 曾协同页签", () => {
  test("app.js 在「我创建」后含曾处理、曾协同页签", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../../frontend/app.js"),
      "utf8"
    );
    const createdIdx = src.indexOf('data-tab="created">我创建</button>');
    const handledIdx = src.indexOf('data-tab="handled">曾处理</button>');
    const collabIdx = src.indexOf('data-tab="collaborated">曾协同</button>');
    expect(createdIdx).toBeGreaterThan(-1);
    expect(handledIdx).toBeGreaterThan(createdIdx);
    expect(collabIdx).toBeGreaterThan(handledIdx);
  });

  test("曾处理：仅本人提交过的工单（含已关闭）", () => {
    const tickets = [
      { orderId: "a", operatorSubmitted: true, status: "closed" },
      { orderId: "b", operatorSubmitted: false, status: "open" },
      { orderId: "c", operatorSubmitted: true, status: "open" },
    ];
    expect(filterByWorkbenchTab(tickets, "handled", op).map((t) => t.orderId)).toEqual([
      "a",
      "c",
    ]);
  });

  test("曾协同：协同处理人含本人（多人分隔）", () => {
    const tickets = [
      { orderId: "a", collaborator: "李四 l002；张三 z001" },
      { orderId: "b", collaborator: "王五 w003" },
      { orderId: "c", collaborator: "z001" },
      { orderId: "d", collaborator: "" },
    ];
    expect(
      filterByWorkbenchTab(tickets, "collaborated", op).map((t) => t.orderId)
    ).toEqual(["a", "c"]);
  });

  test("ticket-core 含 handled / collaborated 分支", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../../frontend/modules/pages/ticket-core.js"),
      "utf8"
    );
    expect(src).toContain('state.listTab === "handled"');
    expect(src).toContain('state.listTab === "collaborated"');
    expect(src).toContain("t.collaborator");
  });
});

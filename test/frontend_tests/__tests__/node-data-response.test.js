/**
 * 与 frontend/modules/utils/node-data-response.js 中 parseTicketNodeDataResponse 行为一致。
 */

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function parseTicketNodeDataResponse(dataResp, { allowMissingTicket404 }) {
  if (dataResp.ok) return await dataResp.json();

  const text = await dataResp.text();
  let detail = "";
  try {
    const errBody = JSON.parse(text);
    if (errBody?.detail != null) {
      detail = typeof errBody.detail === "string" ? errBody.detail : JSON.stringify(errBody.detail);
    }
  } catch {
    detail = text.replace(/\s+/g, " ").trim().slice(0, 200);
  }
  const errDetail = detail || `HTTP ${dataResp.status}`;

  if (allowMissingTicket404 && dataResp.status === 404 && /^ticket not found$/i.test(detail.trim())) {
    return { values: {} };
  }

  throw new Error(`data HTTP ${dataResp.status}: ${errDetail}`);
}

describe("parseTicketNodeDataResponse", () => {
  test("200 时返回 JSON", async () => {
    const r = jsonResponse({ values: { a: "1" } });
    await expect(parseTicketNodeDataResponse(r, { allowMissingTicket404: false })).resolves.toEqual({
      values: { a: "1" },
    });
  });

  test("allowMissingTicket404 且 404 ticket not found 时返回空 values", async () => {
    const r = jsonResponse({ detail: "ticket not found" }, 404);
    await expect(parseTicketNodeDataResponse(r, { allowMissingTicket404: true })).resolves.toEqual({ values: {} });
  });

  test("allowMissingTicket404 但 detail 非 ticket not found 时仍抛错", async () => {
    const r = jsonResponse({ detail: "Schema not found." }, 404);
    await expect(parseTicketNodeDataResponse(r, { allowMissingTicket404: true })).rejects.toThrow(
      "data HTTP 404: Schema not found.",
    );
  });

  test("未允许 missing 时 404 抛错", async () => {
    const r = jsonResponse({ detail: "ticket not found" }, 404);
    await expect(parseTicketNodeDataResponse(r, { allowMissingTicket404: false })).rejects.toThrow(
      "data HTTP 404: ticket not found",
    );
  });

  test("非 JSON 500 响应时带上正文片段", async () => {
    const r = new Response("<html>gateway error</html>", { status: 500 });
    await expect(parseTicketNodeDataResponse(r, { allowMissingTicket404: false })).rejects.toThrow(
      "data HTTP 500: <html>gateway error</html>",
    );
  });
});

/**
 * 解析 GET /api/tickets/{id}/nodes/{key}/data 的响应。
 * 创建工单弹窗在首次提交前本地生成 ticket_no，库中尚无该行，后端返回 404 ticket not found；
 * 此时在 allowMissingTicket404 下应视为空 values，与已落库工单的「该节点尚无数据」一致。
 */
export async function parseTicketNodeDataResponse(dataResp, { allowMissingTicket404 }) {
  if (dataResp.ok) return await dataResp.json();

  let detail = "";
  try {
    const errBody = await dataResp.json();
    detail = errBody?.detail != null ? String(errBody.detail) : "";
  } catch {
    /* ignore */
  }
  const errDetail = detail || `HTTP ${dataResp.status}`;

  if (allowMissingTicket404 && dataResp.status === 404 && /^ticket not found$/i.test(detail.trim())) {
    return { values: {} };
  }

  throw new Error(`data HTTP ${dataResp.status}: ${errDetail}`);
}

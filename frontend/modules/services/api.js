export function resolveApiBaseUrl() {
  try {
    if (window.location.origin.includes("gaussdb-ops")){
      return window.location.origin
    }
    const q = new URLSearchParams(window.location.search).get("api");
    if (q) return q.replace(/\/$/, "");
    const ls = window.localStorage.getItem("yunwei_api_base_url");
    if (ls) return ls.replace(/\/$/, "");
  } catch (_) {
    /* ignore */
  }
  const { protocol, hostname, port } = window.location;
  if (protocol === "file:" || !hostname) return "http://127.0.0.1:8000";
  const h = hostname === "::1" ? "127.0.0.1" : hostname;
  // 常见「纯前端 dev server」端口：仍默认连本机 8000，与历史行为一致。
  const uiOnlyDevPorts = new Set(["3000", "4173", "5173", "5174"]);
  if (port && !uiOnlyDevPorts.has(port)) {
    return `${protocol}//${h}:${port}`;
  }
  return `${protocol}//${h}:8000`;
}

export const API_BASE_URL = resolveApiBaseUrl();

export async function parseApiError(resp) {
  const text = await resp.text();
  try {
    const j = JSON.parse(text);
    if (j.detail != null) {
      if (typeof j.detail === "string") return j.detail;
      return JSON.stringify(j.detail);
    }
  } catch {
    /* 非 JSON 响应（如网关 HTML 500 页） */
  }
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
  return snippet || `HTTP ${resp.status}`;
}

export function stripDutyFieldIdsForApi(nodes) {
  return (nodes || []).map((n) => ({
    label: String(n.label || "").trim(),
    children: stripDutyFieldIdsForApi(n.children),
  }));
}

export function dutyFieldTreeHasEmptyLabel(nodes) {
  for (const n of nodes || []) {
    if (!String(n.label || "").trim()) return true;
    if (dutyFieldTreeHasEmptyLabel(n.children)) return true;
  }
  return false;
}

/** 脚本/工具向服务端预取流程号（读写 ticket_global_seq）；工作台创建弹窗在首次 submit 时取号，打开弹窗不调用本接口。 */
export async function fetchAllocatedTicketNo(templateCode = "HCS_INCIDENT") {
  const resp = await fetch(`${API_BASE_URL}/api/tickets/allocate-no`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template_code: templateCode }),
  });
  if (!resp.ok) {
    throw new Error(await parseApiError(resp));
  }
  const json = await resp.json();
  const ticketNo = String(json?.ticket_no || "").trim();
  if (!ticketNo) throw new Error("allocate-no 未返回 ticket_no");
  return ticketNo;
}

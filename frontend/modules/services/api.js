export function resolveApiBaseUrl() {
  try {
    const q = new URLSearchParams(window.location.search).get("api");
    if (q) return q.replace(/\/$/, "");
    const ls = window.localStorage.getItem("yunwei_api_base_url");
    if (ls) return ls.replace(/\/$/, "");
  } catch (_) {
    /* ignore */
  }
  const { protocol, hostname } = window.location;
  if (protocol === "file:" || !hostname) return "http://127.0.0.1:8000";
  const h = hostname === "::1" ? "127.0.0.1" : hostname;
  return `${protocol}//${h}:8000`;
}

export const API_BASE_URL = resolveApiBaseUrl();

export async function parseApiError(resp) {
  const j = await resp.json().catch(() => ({}));
  return j.detail != null ? String(j.detail) : `HTTP ${resp.status}`;
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

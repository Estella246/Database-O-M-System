/** 工单 file 类型字段：落库 JSON { url, file_name?, object_name? } */

export function parseTicketFileFieldValue(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return null;
    const url = String(data.url || "").trim();
    if (!url) return null;
    return {
      url,
      file_name: String(data.file_name || data.fileName || "").trim(),
      object_name: String(data.object_name || data.objectName || "").trim(),
    };
  } catch {
    return null;
  }
}

export function serializeTicketFileFieldValue(meta) {
  if (!meta || !String(meta.url || "").trim()) return "";
  return JSON.stringify({
    url: String(meta.url).trim(),
    file_name: String(meta.file_name || "").trim(),
    object_name: String(meta.object_name || "").trim(),
  });
}

export function ticketFileFieldDisplayName(meta, fallback = "已上传文件") {
  if (!meta) return "";
  return meta.file_name || fallback;
}

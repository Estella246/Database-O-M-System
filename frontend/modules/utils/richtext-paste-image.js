/**
 * 从剪贴板解析可上传的富文本图片文件（与后端 /api/richtext/upload-image 允许的 MIME 对齐）。
 * 仅处理剪贴板中的二进制图片项（截图、从看图软件复制等），不解析 text/html，避免与图文混贴的正文冲突。
 * @param {DataTransfer | null | undefined} clipboardData
 * @returns {File | null}
 */
export function getImageFileFromClipboardData(clipboardData) {
  if (!clipboardData) return null;

  const files = clipboardData.files;
  if (files && files.length) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f && typeof f.type === "string" && f.type.startsWith("image/")) {
        return f;
      }
    }
  }

  const items = clipboardData.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type && String(it.type).startsWith("image/")) {
        try {
          const f = typeof it.getAsFile === "function" ? it.getAsFile() : null;
          if (f) return f;
        } catch (_) {
          /* ignore */
        }
      }
    }
  }

  return null;
}

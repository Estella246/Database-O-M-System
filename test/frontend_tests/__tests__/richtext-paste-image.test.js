/**
 * 剪贴板图片文件解析 — 逻辑须与 frontend/modules/utils/richtext-paste-image.js 保持一致。
 * （Jest 运行于 Node 且未转译 ES 模块，故在此内联副本。）
 */

function getImageFileFromClipboardData(clipboardData) {
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

describe("getImageFileFromClipboardData", () => {
  test("files 中有图片时优先返回", () => {
    const inner = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    const dt = { files: [inner], items: null, getData: () => "" };
    expect(getImageFileFromClipboardData(dt)).toBe(inner);
  });

  test("items 中 file 类型图片", () => {
    const inner = new File([new Uint8Array([9])], "p.jpg", { type: "image/jpeg" });
    const item = {
      kind: "file",
      type: "image/jpeg",
      getAsFile: () => inner,
    };
    const dt = { files: [], items: [item], getData: () => "" };
    expect(getImageFileFromClipboardData(dt)).toBe(inner);
  });

  test("无图片时返回 null", () => {
    expect(getImageFileFromClipboardData(null)).toBeNull();
    expect(getImageFileFromClipboardData({ files: [], items: [], getData: () => "" })).toBeNull();
  });
});

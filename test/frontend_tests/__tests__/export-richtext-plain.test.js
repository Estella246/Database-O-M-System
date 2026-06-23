/**
 * 与 frontend/modules/constants/export-fields.js 中 stripImagesFromHtml 逻辑一致。
 */
function stripImagesFromHtml(html) {
  if (!html) return "";
  let text = String(html);
  text = text.replace(/<img[^>]*>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return text.replace(/\s+/g, " ").trim();
}

describe("stripImagesFromHtml (export richtext)", () => {
  test("去除 HTML 标签与内联样式，仅保留文字", () => {
    const html =
      '<p><span style="font-family: Arial; color: red;">故障现象</span>：<b>连接超时</b></p>';
    expect(stripImagesFromHtml(html)).toBe("故障现象 ： 连接超时");
  });

  test("去除 img 标签及 base64 图片", () => {
    const html = '<p>截图</p><img src="data:image/png;base64,abc123" alt="x">';
    expect(stripImagesFromHtml(html)).toBe("截图");
  });

  test("解码常见 HTML 实体", () => {
    expect(stripImagesFromHtml("A&nbsp;&amp;&nbsp;B")).toBe("A & B");
  });

  test("空值返回空字符串", () => {
    expect(stripImagesFromHtml("")).toBe("");
    expect(stripImagesFromHtml(null)).toBe("");
  });
});

import {
  RICH_COLORS,
  sanitizeRichHtml,
  renderRichEditable,
  renderRichReadonly,
  renderRichToolbar,
  richToPlainText,
} from "../../../frontend/modules/ui/rich-text.js";

// 模块在调用时（而非导入时）读取 window.DOMPurify，故可在用例内注入桩。
const fakePurify = {
  sanitize: (s) =>
    String(s)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/ on\w+="[^"]*"/gi, ""),
};

beforeEach(() => {
  global.window = { DOMPurify: fakePurify };
});
afterEach(() => {
  delete global.window;
});

describe("RICH_COLORS 预设色", () => {
  test("含常用色（红/橙/蓝/绿/黑）", () => {
    const labels = RICH_COLORS.map((c) => c.label);
    ["黑", "红", "橙", "蓝", "绿"].forEach((l) => expect(labels).toContain(l));
  });
});

describe("sanitizeRichHtml", () => {
  test("保留加粗与颜色 span", () => {
    expect(sanitizeRichHtml("<b>x</b>")).toBe("<b>x</b>");
    expect(sanitizeRichHtml('<span style="color:#d94e4e">r</span>')).toBe('<span style="color:#d94e4e">r</span>');
  });
  test("剥离 script 与事件属性", () => {
    expect(sanitizeRichHtml("<b>hi</b><script>bad()</script>")).toBe("<b>hi</b>");
    expect(sanitizeRichHtml('<span onerror="x()">y</span>')).toBe("<span>y</span>");
  });
  test("无 DOMPurify 时退化为转义（安全优先）", () => {
    delete global.window;
    expect(sanitizeRichHtml("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("renderRichEditable", () => {
  test("contenteditable + data-mr-rich + 透传业务属性/占位", () => {
    const html = renderRichEditable("<b>x</b>", 'data-mr-major="k"', { cls: "mr-cell-input", placeholder: "ph" });
    expect(html).toContain('contenteditable="true"');
    expect(html).toContain("data-mr-rich");
    expect(html).toContain('data-mr-major="k"');
    expect(html).toContain('data-placeholder="ph"');
    expect(html).toContain("mr-rich-edit mr-cell-input");
    expect(html).toContain("<b>x</b>");
  });
});

describe("renderRichToolbar", () => {
  test("含加粗按钮与全部预设色块", () => {
    const tb = renderRichToolbar();
    expect(tb).toContain('data-mr-rich-cmd="bold"');
    RICH_COLORS.forEach((c) => expect(tb).toContain(`data-mr-rich-color="${c.value}"`));
  });
});

describe("richToPlainText", () => {
  test("去标签、<br> 转换行", () => {
    expect(richToPlainText("<b>hi</b><br>y")).toBe("hi\ny");
  });
  test("readonly 等于清洗后的 HTML", () => {
    expect(renderRichReadonly("<b>x</b>")).toBe("<b>x</b>");
  });
});

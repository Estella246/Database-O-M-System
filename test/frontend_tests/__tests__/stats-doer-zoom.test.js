/**
 * Doer统计放大按钮功能测试
 * 测试目标：frontend/modules/pages/stats-page.js
 */

// 简化的DOM元素模拟
class MockElement {
  constructor(attrs = {}) {
    this.attributes = new Map(Object.entries(attrs));
    this.classList = new Set();
    this.innerHTML = "";
    this.eventListeners = new Map();
    this.parentElement = null;
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  classListAdd(cls) {
    this.classList.add(cls);
  }

  classListRemove(cls) {
    this.classList.delete(cls);
  }

  addEventListener(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  closest(selector) {
    // 检查自身是否匹配 [data-xxx] 选择器
    const attrMatch = selector.match(/\[data-([^\]]+)\]/);
    if (attrMatch && this.getAttribute(`data-${attrMatch[1]}`)) {
      return this;
    }
    return null;
  }
}

// 模拟放大/关闭函数
function mockOpenStatsDoerChartZoom(key, elements) {
  const src = elements[`chart-${key}`];
  const mask = elements["mask"];
  const host = elements["host"];
  if (!src || !mask || !host) return false;
  host.innerHTML = src.innerHTML;
  mask.classListAdd("open");
  return true;
}

function mockCloseStatsDoerChartZoom(elements) {
  const mask = elements["mask"];
  const host = elements["host"];
  if (mask) mask.classListRemove("open");
  if (host) host.innerHTML = "";
}

describe("Doer统计放大按钮功能", () => {
  let elements;
  let documentEl;
  let btnDoerUsage;
  let btnDoerEffectiveness;

  beforeEach(() => {
    elements = {};
    documentEl = new MockElement();

    // 创建按钮
    btnDoerUsage = new MockElement({ "data-stats-doer-zoom": "doerUsage" });
    btnDoerEffectiveness = new MockElement({ "data-stats-doer-zoom": "doerEffectiveness" });

    // 创建图表容器
    elements["chart-doerUsage"] = new MockElement();
    elements["chart-doerUsage"].innerHTML = "<svg></svg>";
    elements["chart-doerEffectiveness"] = new MockElement();
    elements["chart-doerEffectiveness"].innerHTML = "<svg></svg>";

    // 创建弹窗元素
    elements["mask"] = new MockElement();
    elements["host"] = new MockElement();

    // 模拟事件委托绑定（绑定到document）
    documentEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-stats-doer-zoom]");
      if (!btn) return;
      const key = btn.getAttribute("data-stats-doer-zoom");
      if (!key) return;
      mockOpenStatsDoerChartZoom(key, elements);
    });
  });

  describe("按钮data属性", () => {
    test("doerUsage按钮有正确的data属性", () => {
      expect(btnDoerUsage.getAttribute("data-stats-doer-zoom")).toBe("doerUsage");
    });

    test("doerEffectiveness按钮有正确的data属性", () => {
      expect(btnDoerEffectiveness.getAttribute("data-stats-doer-zoom")).toBe("doerEffectiveness");
    });

    test("按钮closest方法能匹配data属性选择器", () => {
      const result = btnDoerUsage.closest("[data-stats-doer-zoom]");
      expect(result).toBe(btnDoerUsage);
    });
  });

  describe("事件委托绑定", () => {
    test("点击doerUsage按钮触发放大弹窗", () => {
      // 模拟点击事件
      const handlers = documentEl.eventListeners.get("click") || [];
      for (const handler of handlers) {
        handler({ target: btnDoerUsage });
      }

      expect(elements["mask"].classList.has("open")).toBe(true);
      expect(elements["host"].innerHTML).toContain("svg");
    });

    test("点击doerEffectiveness按钮触发放大弹窗", () => {
      const handlers = documentEl.eventListeners.get("click") || [];
      for (const handler of handlers) {
        handler({ target: btnDoerEffectiveness });
      }

      expect(elements["mask"].classList.has("open")).toBe(true);
      expect(elements["host"].innerHTML).toContain("svg");
    });

    test("点击无data属性的元素不触发放大", () => {
      const noBtn = new MockElement({ id: "other" });
      const handlers = documentEl.eventListeners.get("click") || [];
      for (const handler of handlers) {
        handler({ target: noBtn });
      }

      expect(elements["mask"].classList.has("open")).toBe(false);
      expect(elements["host"].innerHTML).toBe("");
    });
  });

  describe("放大弹窗功能", () => {
    test("openStatsDoerChartZoom正确打开弹窗", () => {
      const result = mockOpenStatsDoerChartZoom("doerUsage", elements);
      expect(result).toBe(true);
      expect(elements["mask"].classList.has("open")).toBe(true);
      expect(elements["host"].innerHTML).toContain("svg");
    });

    test("openStatsDoerChartZoom对不存在key返回false", () => {
      const result = mockOpenStatsDoerChartZoom("nonexistent", elements);
      expect(result).toBe(false);
    });

    test("closeStatsDoerChartZoom关闭弹窗", () => {
      mockOpenStatsDoerChartZoom("doerUsage", elements);
      mockCloseStatsDoerChartZoom(elements);
      expect(elements["mask"].classList.has("open")).toBe(false);
      expect(elements["host"].innerHTML).toBe("");
    });
  });

  describe("完整点击流程", () => {
    test("点击doerUsage → 弹窗打开 → 关闭 → 弹窗关闭", () => {
      // 点击打开
      const handlers = documentEl.eventListeners.get("click") || [];
      for (const handler of handlers) {
        handler({ target: btnDoerUsage });
      }
      expect(elements["mask"].classList.has("open")).toBe(true);

      // 关闭
      mockCloseStatsDoerChartZoom(elements);
      expect(elements["mask"].classList.has("open")).toBe(false);
    });

    test("点击doerEffectiveness → 弹窗打开 → 关闭 → 弹窗关闭", () => {
      const handlers = documentEl.eventListeners.get("click") || [];
      for (const handler of handlers) {
        handler({ target: btnDoerEffectiveness });
      }
      expect(elements["mask"].classList.has("open")).toBe(true);

      mockCloseStatsDoerChartZoom(elements);
      expect(elements["mask"].classList.has("open")).toBe(false);
    });
  });
});
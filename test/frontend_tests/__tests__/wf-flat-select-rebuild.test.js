/**
 * @jest-environment jsdom
 */
import { rebuildWfFlatSelectChoiceButtons } from "../../../frontend/modules/pages/ticket.js";

describe("rebuildWfFlatSelectChoiceButtons", () => {
  test("replaces option buttons and keeps placeholder", () => {
    const list = document.createElement("div");
    list.innerHTML = `
      <button type="button" class="wf-flat-select-item wf-flat-select-item--placeholder" data-wf-flat-value-pick="">请选择</button>
      <button type="button" class="wf-flat-select-item" data-wf-flat-value-pick="旧项">旧项</button>
    `;
    rebuildWfFlatSelectChoiceButtons(list, ["配置错误", "代码缺陷"], { currentValue: "配置错误" });
    const picks = Array.from(list.querySelectorAll("[data-wf-flat-value-pick]")).map((b) =>
      b.classList.contains("wf-flat-select-item--placeholder") ? "__ph__" : b.getAttribute("data-wf-flat-value-pick")
    );
    expect(picks).toEqual(["__ph__", "配置错误", "代码缺陷"]);
    expect(list.querySelector('[data-wf-flat-value-pick="配置错误"]').classList.contains("is-active")).toBe(true);
  });
});

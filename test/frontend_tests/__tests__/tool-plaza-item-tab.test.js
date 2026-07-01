import { toolPlazaItemUrl } from "../../../frontend/modules/pages/tool-plaza-page.js";

describe("tool-plaza item tab", () => {
  test("toolPlazaItemUrl encodes item no path", () => {
    expect(toolPlazaItemUrl("SKILL20260701000")).toBe("/tool-plaza/SKILL20260701000");
    expect(toolPlazaItemUrl("TOOL20260701001")).toBe("/tool-plaza/TOOL20260701001");
  });
});

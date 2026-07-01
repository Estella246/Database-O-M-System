import { hotFireHtml, toolPlazaDownloadUrl } from "../../../frontend/modules/pages/tool-plaza-page.js";

describe("tool-plaza hotFireHtml", () => {
  test("cool tier has no fire icon", () => {
    expect(hotFireHtml(0)).toContain("tp-hot-fire--cool");
    expect(hotFireHtml(0)).not.toContain("🔥");
  });

  test("warm tier shows animated fire", () => {
    expect(hotFireHtml(3)).toContain("tp-hot-fire--warm");
    expect(hotFireHtml(3)).toContain("🔥");
  });

  test("blaze tier for high downloads", () => {
    expect(hotFireHtml(100)).toContain("tp-hot-fire--blaze");
    expect(hotFireHtml(100)).toContain("🔥🔥");
  });
});

describe("toolPlazaDownloadUrl", () => {
  beforeEach(() => {
    window.localStorage.setItem("demo_operator_account", "tester");
  });

  test("builds GET download endpoint with operator_id", () => {
    const url = toolPlazaDownloadUrl(42);
    expect(url).toContain("/api/ops-tool-plaza/items/42/download");
    expect(url).toContain("operator_id=tester");
  });
});

import { hotFireHtml } from "../../../frontend/modules/pages/tool-plaza-page.js";

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

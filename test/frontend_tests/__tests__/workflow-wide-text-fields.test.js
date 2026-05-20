import {
  getProblemFillFieldSortTier,
  isWideTextField,
  WIDE_TEXT_FIELD_ORDER,
} from "../../../frontend/modules/constants/workflow.js";

describe("workflow wide text fields", () => {
  test("error_archive_text is wide text like error_text", () => {
    const field = { key: "error_archive_text", type: "text" };
    expect(isWideTextField(field)).toBe(true);
    expect(WIDE_TEXT_FIELD_ORDER.at(-1)).toBe("error_archive_text");
  });

  test("error_archive_text sorts after richtext and other wide text fields", () => {
    const richtextTier = getProblemFillFieldSortTier({ key: "workaround", type: "richtext" });
    const errorTextTier = getProblemFillFieldSortTier({ key: "error_text", type: "text" });
    const coreStackTier = getProblemFillFieldSortTier({ key: "core_stack_text", type: "text" });
    const archiveTier = getProblemFillFieldSortTier({
      key: "error_archive_text",
      type: "text",
    });
    expect(archiveTier).toBeGreaterThan(richtextTier);
    expect(archiveTier).toBeGreaterThan(errorTextTier);
    expect(archiveTier).toBeGreaterThan(coreStackTier);
  });
});

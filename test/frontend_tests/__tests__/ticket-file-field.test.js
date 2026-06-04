import { describe, expect, test } from "vitest";
import {
  parseTicketFileFieldValue,
  serializeTicketFileFieldValue,
  ticketFileFieldDisplayName,
} from "../../../frontend/modules/utils/ticket-file-field.js";

describe("ticket-file-field", () => {
  test("parse and serialize round-trip", () => {
    const raw = serializeTicketFileFieldValue({
      url: "https://cdn.example.com/f.pdf",
      file_name: "report.pdf",
      object_name: "ticket-files/abc.pdf",
    });
    const meta = parseTicketFileFieldValue(raw);
    expect(meta).toEqual({
      url: "https://cdn.example.com/f.pdf",
      file_name: "report.pdf",
      object_name: "ticket-files/abc.pdf",
    });
    expect(ticketFileFieldDisplayName(meta)).toBe("report.pdf");
  });

  test("invalid json returns null", () => {
    expect(parseTicketFileFieldValue("not-json")).toBeNull();
    expect(parseTicketFileFieldValue('{"file_name":"x"}')).toBeNull();
  });
});

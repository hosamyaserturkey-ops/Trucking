import { describe, expect, it } from "vitest";
import { parseDocNumbers } from "./doc-numbers";

const form = (data: Record<string, string>) => (name: string) => data[name] ?? "";

describe("parseDocNumbers", () => {
  it("trims, and leaves empty fields null", () => {
    expect(parseDocNumbers(form({ voucher_no: "  1052 ", notice_no: "" }), ["voucher_no", "notice_no"])).toEqual({
      ok: true,
      values: { voucher_no: "1052", notice_no: null },
    });
  });
  it("refuses numbers longer than the field allows", () => {
    expect(parseDocNumbers(form({ voucher_no: "1".repeat(31) }), ["voucher_no"])).toEqual({ ok: false, error: "رقم سند الصرف طويل جداً" });
    expect(parseDocNumbers(form({ customs_declaration_no: "x".repeat(41) }), ["customs_declaration_no"]).ok).toBe(false);
  });
});

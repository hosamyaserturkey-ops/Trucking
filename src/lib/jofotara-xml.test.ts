import { describe, expect, it } from "vitest";
import {
  base64Utf8,
  buildEinvoiceXml,
  einvoiceProblems,
  governorateCode,
  jodText,
  lineDescription,
  readJoFotaraResponse,
  spreadVat,
  type EinvoiceInput,
} from "./jofotara-xml";

const input: EinvoiceInput = {
  kind: "invoice",
  docNo: "12",
  uuid: "5b0b8e8a-2a43-4c4a-9d3f-6b3f0c2a1e10",
  issueDate: "2026-10-31",
  icv: 7,
  note: "نقلات تشرين الأول",
  seller: { taxNumber: "12345678", name: "شركة النقل & الشحن", incomeSource: "9876543" },
  buyer: { taxNumber: "87654321", name: "مصانع <الإسمنت>", phone: "+962 7 9000 0101", city: "عمّان" },
  vatRatePct: 16,
  exempt: false,
  lines: [
    { description: "خدمة نقل العقبة ← عمان", amountMinor: 350_000, vatMinor: 56_000 },
    { description: "خدمة نقل الزرقاء ← اربد", amountMinor: 100_003, vatMinor: 16_000 },
  ],
};

const tag = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<cbc:${name}[^>]*>([^<]*)</cbc:${name}>`, "g"))].map((m) => m[1]);

describe("jodText", () => {
  it("writes fils as dinars with three decimals", () => {
    expect(jodText(0)).toBe("0.000");
    expect(jodText(5)).toBe("0.005");
    expect(jodText(1_234_567)).toBe("1234.567");
    expect(jodText(-1500)).toBe("-1.500");
  });
});

describe("spreadVat", () => {
  it("spreads an old invoice's tax over its lines exactly", () => {
    expect(spreadVat([100_003, 100_003], 32_001)).toEqual([16_001, 16_000]);
    expect(spreadVat([300, 100], 0)).toEqual([0, 0]);
    const s = spreadVat([123_457, 98_765, 1], 35_556);
    expect(s.reduce((a, b) => a + b, 0)).toBe(35_556);
  });
});

describe("governorateCode", () => {
  it("knows the governorates by their usual names", () => {
    expect(governorateCode("عمّان")).toBe("JO-AM");
    expect(governorateCode("Zarqa")).toBe("JO-AZ");
    expect(governorateCode("العقبة")).toBe("JO-AQ");
    expect(governorateCode("دمشق")).toBeNull();
    expect(governorateCode(null)).toBeNull();
  });
});

describe("buildEinvoiceXml", () => {
  const xml = buildEinvoiceXml(input);
  it("is a reporting invoice on account, numbered, with its UUID and counter", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"')).toBe(true);
    expect(tag(xml, "ProfileID")).toEqual(["reporting:1.0"]);
    expect(xml).toContain('<cbc:InvoiceTypeCode name="022">388</cbc:InvoiceTypeCode>');
    expect(xml).toContain("<cbc:UUID>5b0b8e8a-2a43-4c4a-9d3f-6b3f0c2a1e10</cbc:UUID>");
    expect(xml).toContain("<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>7</cbc:UUID></cac:AdditionalDocumentReference>");
    expect(tag(xml, "DocumentCurrencyCode")).toEqual(["JOD"]);
  });
  it("carries the seller, the buyer and the income source", () => {
    expect(xml).toContain("<cbc:RegistrationName>شركة النقل &amp; الشحن</cbc:RegistrationName>");
    expect(xml).toContain("<cbc:RegistrationName>مصانع &lt;الإسمنت&gt;</cbc:RegistrationName>");
    expect(xml).toContain('<cbc:ID schemeID="TN">87654321</cbc:ID>');
    expect(xml).toContain("<cbc:CountrySubentityCode>JO-AM</cbc:CountrySubentityCode>");
    expect(xml).toContain("<cbc:Telephone>+962790000101</cbc:Telephone>");
    expect(xml).toContain("<cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>9876543</cbc:ID>");
  });
  it("adds up as JoFotara checks it: tax is the lines' tax, totals are the lines' totals", () => {
    expect(xml).toContain('<cac:TaxTotal><cbc:TaxAmount currencyID="JO">72.000</cbc:TaxAmount></cac:TaxTotal>');
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="JO">450.003</cbc:TaxExclusiveAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="JO">522.003</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="JO">522.003</cbc:PayableAmount>');
    expect(tag(xml, "RoundingAmount")).toEqual(["406.000", "116.003"]);
    expect(tag(xml, "LineExtensionAmount")).toEqual(["350.000", "100.003"]);
    expect(xml.match(/<cac:InvoiceLine>/g)).toHaveLength(2);
    expect(xml).toContain('<cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID><cbc:Percent>16</cbc:Percent>');
    expect(xml).not.toContain("currencyID=\"JOD\"");
  });
  it("marks an exempt customer's lines Z at 0%", () => {
    const x = buildEinvoiceXml({ ...input, exempt: true, lines: input.lines.map((l) => ({ ...l, vatMinor: 0 })) });
    expect(x).toContain('schemeID="UN/ECE 5305">Z</cbc:ID><cbc:Percent>0</cbc:Percent>');
    expect(x).toContain('<cac:TaxTotal><cbc:TaxAmount currencyID="JO">0.000</cbc:TaxAmount></cac:TaxTotal>');
  });
  it("a credit note refers to the original and gives the reason", () => {
    const x = buildEinvoiceXml({
      ...input,
      kind: "credit_note",
      docNo: "R-12",
      uuid: "0c1d2e3f-0000-4000-8000-000000000001",
      original: { docNo: "12", uuid: input.uuid, totalMinor: 522_003 },
      reason: "خطأ في الأجرة",
    });
    expect(x).toContain('<cbc:InvoiceTypeCode name="022">381</cbc:InvoiceTypeCode>');
    expect(x).toContain(
      `<cac:BillingReference><cac:InvoiceDocumentReference>\n<cbc:ID>12</cbc:ID>\n<cbc:UUID>${input.uuid}</cbc:UUID>\n<cbc:DocumentDescription>522.003</cbc:DocumentDescription>`,
    );
    expect(x).toContain("<cbc:InstructionNote>خطأ في الأجرة</cbc:InstructionNote>");
  });
});

describe("einvoiceProblems", () => {
  it("lists what is missing before sending", () => {
    expect(einvoiceProblems(input)).toEqual([]);
    expect(
      einvoiceProblems({ ...input, seller: { ...input.seller, taxNumber: "", incomeSource: "" }, buyer: { ...input.buyer, taxNumber: "12 34" } }),
    ).toEqual([
      "أدخل الرقم الضريبي للشركة (أرقام فقط) في بيانات الشركة",
      "أدخل تسلسل مصدر الدخل من بوابة جوفوترة في بيانات الشركة",
      "أدخل الرقم الضريبي للزبون (أرقام فقط) في بيانات الزبون",
    ]);
  });
});

describe("lineDescription and base64Utf8", () => {
  it("describes a load and encodes Arabic text", () => {
    expect(lineDescription({ route: "العقبة ← عمان", cargo_description: "إسمنت", client_ref: "ARB-0007", client_doc_no: "BL-1", load_date: "2026-10-03" })).toBe(
      "خدمة نقل العقبة ← عمان — إسمنت — إشارة ARB-0007 — مستند BL-1 — 2026-10-03",
    );
    expect(base64Utf8("نقل")).toBe("2YbZgtmE");
    expect(new TextDecoder().decode(Uint8Array.from(atob(base64Utf8(buildEinvoiceXml(input))), (c) => c.charCodeAt(0)))).toBe(buildEinvoiceXml(input));
  });
});

describe("readJoFotaraResponse", () => {
  it("accepts a submitted invoice with its QR code", () => {
    expect(readJoFotaraResponse(200, { EINV_STATUS: "SUBMITTED", EINV_QR: "AQx...", EINV_INV_UUID: "u-1", EINV_NUM: "EIN00012", EINV_RESULTS: { status: "PASS" } })).toEqual({
      accepted: true,
      uuid: "u-1",
      num: "EIN00012",
      qr: "AQx...",
      message: null,
    });
  });
  it("treats an invoice sent before as accepted", () => {
    expect(readJoFotaraResponse(200, { EINV_STATUS: "ALREADY_SUBMITTED" })).toMatchObject({ accepted: true, qr: null });
  });
  it("gives the reasons of a rejection", () => {
    expect(
      readJoFotaraResponse(400, {
        EINV_STATUS: "NOT_SUBMITTED",
        EINV_RESULTS: { status: "ERROR", ERRORS: [{ EINV_CODE: "totalGeneralTaxesAmount", EINV_MESSAGE: "Total general amount is not correct" }] },
      }),
    ).toEqual({ accepted: false, message: "totalGeneralTaxesAmount: Total general amount is not correct" });
    expect(readJoFotaraResponse(401, {})).toEqual({ accepted: false, message: "رفض النظام بيانات الربط (Client ID / Secret Key)؛ راجعها في إعدادات الخادم" });
    expect(readJoFotaraResponse(502, "Bad gateway")).toEqual({ accepted: false, message: "Bad gateway" });
    expect(readJoFotaraResponse(200, { EINV_STATUS: "SUBMITTED" })).toMatchObject({ accepted: false });
  });
});

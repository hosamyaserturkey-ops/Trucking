// JoFotara (نظام الفوترة الوطني الإلكتروني): the UBL 2.1 invoice file sent to
// the Income and Sales Tax Department, and reading its answer. Pure; the
// server sends it (src/lib/jofotara.ts).
//
// The layout follows ISTD's technical guide for a general sales tax invoice on
// account (InvoiceTypeCode name="022": 0, receivable "2", general sales "2"):
//   388  invoice       381  return / credit note (فاتورة إرجاع), with the
//                           original invoice in BillingReference and the
//                           reason in PaymentMeans/InstructionNote
// Amounts are JOD with 3 decimals and currencyID="JO", as in the guide.
// The invoice's tax is the sum of the lines' tax, and the tax-inclusive and
// payable totals are the sum of the lines' totals with tax, to the fils.

export type EinvoiceLine = { description: string; amountMinor: number; vatMinor: number };

export type EinvoiceInput = {
  kind: "invoice" | "credit_note";
  docNo: string;
  uuid: string;
  issueDate: string;
  icv: number;
  note: string | null;
  seller: { taxNumber: string; name: string; incomeSource: string };
  buyer: { taxNumber: string; name: string; phone: string | null; city: string | null };
  vatRatePct: number;
  exempt: boolean;
  lines: EinvoiceLine[];
  original?: { docNo: string; uuid: string; totalMinor: number };
  reason?: string | null;
};

/** 123456 fils → "123.456" (exact, no floating point). */
export function jodText(minor: number): string {
  const neg = minor < 0;
  const v = Math.abs(minor);
  const s = `${Math.floor(v / 1000)}.${String(v % 1000).padStart(3, "0")}`;
  return neg ? `-${s}` : s;
}

function pctText(pct: number): string {
  return String(Number(pct.toFixed(2)));
}

/**
 * Spread an invoice's tax over its lines in proportion to their amounts,
 * exactly (largest remainder): for invoices issued before tax was kept per line.
 */
export function spreadVat(amounts: number[], vatTotal: number): number[] {
  const sub = amounts.reduce((s, a) => s + a, 0);
  if (!sub || !vatTotal) return amounts.map(() => 0);
  const exact = amounts.map((a) => (a * vatTotal) / sub);
  const base = exact.map((e) => Math.floor(e));
  let left = vatTotal - base.reduce((s, b) => s + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  return base;
}

// ISO 3166-2:JO governorates, by the Arabic or English city name customers are entered with.
const GOVERNORATES: [RegExp, string][] = [
  [/عمان|amman/i, "JO-AM"],
  [/الزرقاء|زرقاء|رصيفة|zarq|rusaifa/i, "JO-AZ"],
  [/إربد|اربد|الرمثا|irbid|ramtha/i, "JO-IR"],
  [/العقبة|عقبة|aqaba/i, "JO-AQ"],
  [/البلقاء|السلط|balqa|salt/i, "JO-BA"],
  [/المفرق|mafraq/i, "JO-MA"],
  [/الكرك|karak/i, "JO-KA"],
  [/مادبا|madaba/i, "JO-MD"],
  [/جرش|jerash|jarash/i, "JO-JA"],
  [/عجلون|ajloun|ajlun/i, "JO-AJ"],
  [/الطفيلة|tafil/i, "JO-AT"],
  [/معان|ma'?an/i, "JO-MN"],
];

export function governorateCode(city: string | null | undefined): string | null {
  // Without harakat and shadda, so "عمّان" reads as "عمان".
  const c = (city ?? "").replace(/[\u064b-\u0652]/g, "").trim();
  if (!c) return null;
  for (const [re, code] of GOVERNORATES) if (re.test(c)) return code;
  return null;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Characters XML 1.0 does not allow.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const amt = (tag: string, minor: number) => `<cbc:${tag} currencyID="JO">${jodText(minor)}</cbc:${tag}>`;

/** What is missing before an invoice can be sent; empty when it is ready. */
export function einvoiceProblems(input: Pick<EinvoiceInput, "seller" | "buyer" | "lines">): string[] {
  const out: string[] = [];
  if (!/^\d{5,20}$/.test(input.seller.taxNumber)) out.push("أدخل الرقم الضريبي للشركة (أرقام فقط) في بيانات الشركة");
  if (!input.seller.name.trim()) out.push("أدخل اسم الشركة في بيانات الشركة");
  if (!/^\d{1,20}$/.test(input.seller.incomeSource)) out.push("أدخل تسلسل مصدر الدخل من بوابة جوفوترة في بيانات الشركة");
  if (!/^\d{5,20}$/.test(input.buyer.taxNumber)) out.push("أدخل الرقم الضريبي للزبون (أرقام فقط) في بيانات الزبون");
  if (!input.buyer.name.trim()) out.push("اسم الزبون فارغ");
  if (input.lines.length === 0) out.push("الفاتورة بلا سطور");
  if (input.lines.some((l) => l.amountMinor <= 0 || l.vatMinor < 0)) out.push("سطر بمبلغ غير صحيح");
  return out;
}

/** The UBL 2.1 invoice (or credit note) file for JoFotara. */
export function buildEinvoiceXml(input: EinvoiceInput): string {
  const sub = input.lines.reduce((s, l) => s + l.amountMinor, 0);
  const vat = input.lines.reduce((s, l) => s + l.vatMinor, 0);
  const total = sub + vat;
  const category = input.exempt ? "Z" : "S";
  const pct = input.exempt ? 0 : input.vatRatePct;
  const city = governorateCode(input.buyer.city);
  const x: string[] = [];
  x.push('<?xml version="1.0" encoding="UTF-8"?>');
  x.push(
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">',
  );
  x.push("<cbc:ProfileID>reporting:1.0</cbc:ProfileID>");
  x.push(`<cbc:ID>${esc(input.docNo)}</cbc:ID>`);
  x.push(`<cbc:UUID>${esc(input.uuid)}</cbc:UUID>`);
  x.push(`<cbc:IssueDate>${esc(input.issueDate)}</cbc:IssueDate>`);
  x.push(`<cbc:InvoiceTypeCode name="022">${input.kind === "credit_note" ? "381" : "388"}</cbc:InvoiceTypeCode>`);
  if (input.note) x.push(`<cbc:Note>${esc(input.note.slice(0, 500))}</cbc:Note>`);
  x.push("<cbc:DocumentCurrencyCode>JOD</cbc:DocumentCurrencyCode>");
  x.push("<cbc:TaxCurrencyCode>JOD</cbc:TaxCurrencyCode>");
  if (input.kind === "credit_note" && input.original) {
    x.push("<cac:BillingReference><cac:InvoiceDocumentReference>");
    x.push(`<cbc:ID>${esc(input.original.docNo)}</cbc:ID>`);
    x.push(`<cbc:UUID>${esc(input.original.uuid)}</cbc:UUID>`);
    x.push(`<cbc:DocumentDescription>${jodText(input.original.totalMinor)}</cbc:DocumentDescription>`);
    x.push("</cac:InvoiceDocumentReference></cac:BillingReference>");
  }
  x.push(`<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${input.icv}</cbc:UUID></cac:AdditionalDocumentReference>`);

  x.push("<cac:AccountingSupplierParty><cac:Party>");
  x.push("<cac:PostalAddress><cac:Country><cbc:IdentificationCode>JO</cbc:IdentificationCode></cac:Country></cac:PostalAddress>");
  x.push(`<cac:PartyTaxScheme><cbc:CompanyID>${esc(input.seller.taxNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  x.push(`<cac:PartyLegalEntity><cbc:RegistrationName>${esc(input.seller.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`);
  x.push("</cac:Party></cac:AccountingSupplierParty>");

  x.push("<cac:AccountingCustomerParty><cac:Party>");
  x.push(`<cac:PartyIdentification><cbc:ID schemeID="TN">${esc(input.buyer.taxNumber)}</cbc:ID></cac:PartyIdentification>`);
  x.push("<cac:PostalAddress>");
  if (city) x.push(`<cbc:CountrySubentityCode>${city}</cbc:CountrySubentityCode>`);
  x.push("<cac:Country><cbc:IdentificationCode>JO</cbc:IdentificationCode></cac:Country></cac:PostalAddress>");
  x.push(`<cac:PartyTaxScheme><cbc:CompanyID>${esc(input.buyer.taxNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  x.push(`<cac:PartyLegalEntity><cbc:RegistrationName>${esc(input.buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`);
  x.push("</cac:Party>");
  const phone = (input.buyer.phone ?? "").replace(/[^\d+]/g, "");
  if (phone) x.push(`<cac:AccountingContact><cbc:Telephone>${esc(phone)}</cbc:Telephone></cac:AccountingContact>`);
  x.push("</cac:AccountingCustomerParty>");

  x.push(`<cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>${esc(input.seller.incomeSource)}</cbc:ID></cac:PartyIdentification></cac:Party></cac:SellerSupplierParty>`);
  if (input.kind === "credit_note") {
    x.push(
      `<cac:PaymentMeans><cbc:PaymentMeansCode listID="UN/ECE 4461">10</cbc:PaymentMeansCode><cbc:InstructionNote>${esc(
        (input.reason ?? "").slice(0, 300),
      )}</cbc:InstructionNote></cac:PaymentMeans>`,
    );
  }
  x.push(`<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>${amt("Amount", 0)}</cac:AllowanceCharge>`);
  x.push(`<cac:TaxTotal>${amt("TaxAmount", vat)}</cac:TaxTotal>`);
  x.push("<cac:LegalMonetaryTotal>");
  x.push(amt("TaxExclusiveAmount", sub));
  x.push(amt("TaxInclusiveAmount", total));
  x.push(amt("AllowanceTotalAmount", 0));
  x.push(amt("PayableAmount", total));
  x.push("</cac:LegalMonetaryTotal>");

  input.lines.forEach((l, i) => {
    x.push("<cac:InvoiceLine>");
    x.push(`<cbc:ID>${i + 1}</cbc:ID>`);
    x.push('<cbc:InvoicedQuantity unitCode="PCE">1.000</cbc:InvoicedQuantity>');
    x.push(amt("LineExtensionAmount", l.amountMinor));
    x.push("<cac:TaxTotal>");
    x.push(amt("TaxAmount", l.vatMinor));
    x.push(amt("RoundingAmount", l.amountMinor + l.vatMinor));
    x.push("<cac:TaxSubtotal>");
    x.push(amt("TaxAmount", l.vatMinor));
    x.push(
      `<cac:TaxCategory><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${category}</cbc:ID><cbc:Percent>${pctText(pct)}</cbc:Percent><cac:TaxScheme><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>`,
    );
    x.push("</cac:TaxSubtotal></cac:TaxTotal>");
    x.push(`<cac:Item><cbc:Name>${esc(l.description.slice(0, 250))}</cbc:Name></cac:Item>`);
    x.push(
      `<cac:Price>${amt("PriceAmount", l.amountMinor)}<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>DISCOUNT</cbc:AllowanceChargeReason>${amt("Amount", 0)}</cac:AllowanceCharge></cac:Price>`,
    );
    x.push("</cac:InvoiceLine>");
  });
  x.push("</Invoice>");
  return x.join("\n");
}

/** One invoice line's description in the e-invoice: the route, cargo and references. */
export function lineDescription(l: {
  route: string | null;
  cargo_description: string | null;
  client_ref: string | null;
  client_doc_no: string | null;
  load_date: string;
}): string {
  const parts = [
    `خدمة نقل${l.route ? ` ${l.route}` : ""}`,
    l.cargo_description,
    l.client_ref ? `إشارة ${l.client_ref}` : null,
    l.client_doc_no ? `مستند ${l.client_doc_no}` : null,
    l.load_date,
  ];
  return parts.filter(Boolean).join(" — ").replace(/\s+/g, " ").trim();
}

/** Base64 of the UTF-8 bytes, without Node's Buffer (also runs on Workers). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export type JoFotaraOutcome =
  | { accepted: true; uuid: string | null; num: string | null; qr: string | null; message: string | null }
  | { accepted: false; message: string };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Read JoFotara's answer. Accepted when EINV_STATUS is SUBMITTED (with its QR
 * code), or ALREADY_SUBMITTED (sent before with the same number and UUID);
 * anything else is a rejection with its reasons.
 */
export function readJoFotaraResponse(httpStatus: number, body: unknown): JoFotaraOutcome {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const status = (str(b.EINV_STATUS) ?? "").toUpperCase();
  const qr = str(b.EINV_QR);
  const uuid = str(b.EINV_INV_UUID);
  const num = str(b.EINV_NUM);
  if (status === "SUBMITTED" && qr) return { accepted: true, uuid, num, qr, message: null };
  if (status === "ALREADY_SUBMITTED") {
    return { accepted: true, uuid, num, qr, message: qr ? null : "أُرسلت هذه الفاتورة سابقاً إلى النظام؛ لم يرجع رمز QR، راجعه في بوابة جوفوترة" };
  }
  const results = (b.EINV_RESULTS && typeof b.EINV_RESULTS === "object" ? b.EINV_RESULTS : {}) as Record<string, unknown>;
  const errors = Array.isArray(results.ERRORS) ? results.ERRORS : [];
  const lines = errors
    .map((e) => {
      const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
      const msg = str(o.EINV_MESSAGE) ?? str(o.message) ?? (typeof e === "string" ? e : null);
      const code = str(o.EINV_CODE);
      return msg ? (code ? `${code}: ${msg}` : msg) : null;
    })
    .filter((s): s is string => !!s);
  if (lines.length) return { accepted: false, message: lines.join("\n") };
  if (status === "SUBMITTED") return { accepted: false, message: "قبل النظام الفاتورة دون رمز QR؛ أعد المحاولة أو راجع بوابة جوفوترة" };
  if (httpStatus === 401 || httpStatus === 403) return { accepted: false, message: "رفض النظام بيانات الربط (Client ID / Secret Key)؛ راجعها في إعدادات الخادم" };
  const raw = str(b.EINV_MESSAGE) ?? str(b.message) ?? str(b.error) ?? (typeof body === "string" ? body.slice(0, 300) : null);
  return { accepted: false, message: raw ?? `ردّ النظام بالرمز ${httpStatus}${status ? ` (${status})` : ""}` };
}

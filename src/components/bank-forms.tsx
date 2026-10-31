"use client";

import { useActionState, useMemo, useState } from "react";
import { Download, FileUp } from "lucide-react";
import type { BankFormState } from "@/app/(app)/bank/actions";
import { parseCsv, parseStatementRows, STATEMENT_TEMPLATE, type ParsedStatement } from "@/lib/bank";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { readSheet, writeSheet, XlsxError } from "@/lib/xlsx";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";

type Action = (prev: BankFormState, formData: FormData) => Promise<BankFormState>;
type Option = { id: string; label: string };

const jod = (minor: number) => formatMoney(minor, "JOD", { withCurrency: false });
const toInput = (minor: number) => (minor / 1000).toFixed(3);

/** Arabic bank CSV files are often Windows-1256, not UTF-8. */
function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("windows-1256").decode(buf);
  } catch {
    return utf8;
  }
}

function downloadTemplate() {
  const bytes = writeSheet(STATEMENT_TEMPLATE, { sheetName: "كشف البنك", rtl: true, widths: [14, 40, 16, 16, 16, 16], headerRow: 1 });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "bank-statement-template.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type PreviousStatement = { period_to: string; closing_minor: number };

/**
 * A new statement: pick the bank's Excel or CSV file (read here in the browser),
 * check the period, opening balance and totals against the paper, then save.
 * Without a file, an empty statement is saved and its lines typed one by one.
 */
export function BankStatementImport({
  action,
  accounts,
  today,
  previous,
}: {
  action: Action;
  accounts: Option[];
  today: string;
  previous: Record<string, PreviousStatement | undefined>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const prev = previous[account];
  const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [from, setFrom] = useState(prev ? nextDay(prev.period_to) : "");
  const [to, setTo] = useState("");
  const [opening, setOpening] = useState(prev ? toInput(prev.closing_minor) : "");
  const [bankClosing, setBankClosing] = useState("");

  async function onFile(file: File | undefined) {
    setFileError(null);
    setParsed(null);
    setFileName(file?.name ?? "");
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const isCsv = /\.(csv|txt)$/i.test(file.name) || file.type.startsWith("text/");
      const rows = isCsv ? parseCsv(decodeText(buf)) : readSheet(new Uint8Array(buf));
      const r = parseStatementRows(rows);
      if (!r.ok) {
        setFileError(r.error);
        return;
      }
      const p = r.value;
      setParsed(p);
      setFrom((f) => (f && f <= p.lines[0].txn_date ? f : p.lines[0].txn_date));
      setTo(p.lines[p.lines.length - 1].txn_date);
      if (p.openingHint !== null) setOpening(toInput(p.openingHint));
      if (p.closingHint !== null) setBankClosing(toInput(p.closingHint));
    } catch (err) {
      setFileError(err instanceof XlsxError ? err.message : "تعذر قراءة الملف؛ احفظه من Excel بصيغة .xlsx أو .csv وأعد المحاولة");
    }
  }

  const lines = parsed?.lines ?? [];
  const deposits = lines.filter((l) => l.amount_minor > 0).reduce((s, l) => s + l.amount_minor, 0);
  const withdrawals = -lines.filter((l) => l.amount_minor < 0).reduce((s, l) => s + l.amount_minor, 0);
  const openingMinor = /^-?\d+(\.\d{1,3})?$/.test(opening.replace(/,/g, "")) ? Math.round(Number(opening.replace(/,/g, "")) * 1000) : null;
  const closingMinor = openingMinor === null ? null : openingMinor + deposits - withdrawals;
  const bankClosingMinor = /^-?\d+(\.\d{1,3})?$/.test(bankClosing.replace(/,/g, "")) ? Math.round(Number(bankClosing.replace(/,/g, "")) * 1000) : null;
  const closingOff = closingMinor !== null && bankClosingMinor !== null ? bankClosingMinor - closingMinor : null;
  const outside = lines.filter((l) => (from && l.txn_date < from) || (to && l.txn_date > to)).length;
  const preview = lines.length > 12 ? [...lines.slice(0, 8), null, ...lines.slice(-3)] : lines;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="حساب البنك" htmlFor="bs_account">
          <Select
            id="bs_account"
            name="account_id"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              const p = previous[e.target.value];
              if (p) {
                setFrom(nextDay(p.period_to));
                setOpening(toInput(p.closing_minor));
              }
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="من" htmlFor="bs_from" hint={prev ? `الكشف السابق ينتهي ${formatDate(prev.period_to)}` : undefined}>
          <Input id="bs_from" name="period_from" type="date" dir="ltr" max={today} required value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="إلى" htmlFor="bs_to">
          <Input id="bs_to" name="period_to" type="date" dir="ltr" max={today} required value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field
          label="رصيد أول المدة حسب البنك"
          htmlFor="bs_opening"
          hint={prev && openingMinor !== null && openingMinor !== prev.closing_minor ? `لا يساوي رصيد آخر الكشف السابق (${jod(prev.closing_minor)})` : "سالب إذا كان الحساب مكشوفاً"}
        >
          <Input id="bs_opening" name="opening" inputMode="decimal" dir="ltr" required value={opening} onChange={(e) => setOpening(e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className={buttonClass("secondary", "cursor-pointer")}>
          <FileUp className="size-4" aria-hidden />
          {fileName ? "تغيير الملف" : "اختيار ملف كشف البنك (Excel أو CSV)"}
          <input
            type="file"
            accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {fileName ? (
          <span className="text-sm text-muted" dir="ltr">
            {fileName}
          </span>
        ) : null}
        <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <Download className="size-4" aria-hidden />
          تنزيل نموذج فارغ
        </button>
      </div>
      <FormError message={fileError} />

      {parsed ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-sm">
            <span className="num font-semibold">{formatInt(lines.length)}</span> حركة · إيداعات <span className="num">{jod(deposits)}</span> · سحوبات{" "}
            <span className="num">{jod(withdrawals)}</span>
            {parsed.skipped ? <span className="text-muted"> · تُرك {formatInt(parsed.skipped)} صف بلا تاريخ أو مبلغ</span> : null}
            {parsed.reversed ? <span className="text-muted"> · الملف من الأحدث للأقدم فرُتّب</span> : null}
          </p>
          <p className="text-xs text-muted">
            الأعمدة: {Object.entries(parsed.columns).map(([k, v]) => `${COLUMN_LABEL[k] ?? k} ← «${v}»`).join(" · ")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="border-b border-border px-2 py-1 text-start">التاريخ</th>
                  <th className="border-b border-border px-2 py-1 text-start">البيان</th>
                  <th className="border-b border-border px-2 py-1 text-start">المرجع</th>
                  <th className="border-b border-border px-2 py-1 text-end">المبلغ</th>
                  <th className="border-b border-border px-2 py-1 text-end">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((l, i) =>
                  l ? (
                    <tr key={i}>
                      <td className="num border-b border-border px-2 py-1 whitespace-nowrap">{formatDate(l.txn_date)}</td>
                      <td className="border-b border-border px-2 py-1">{l.description}</td>
                      <td className="num border-b border-border px-2 py-1" dir="ltr">
                        {l.reference}
                      </td>
                      <td className={`num border-b border-border px-2 py-1 text-end ${l.amount_minor < 0 ? "text-danger" : "text-success"}`}>{jod(l.amount_minor)}</td>
                      <td className="num border-b border-border px-2 py-1 text-end">{l.balance_minor !== null ? jod(l.balance_minor) : ""}</td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td colSpan={5} className="px-2 py-1 text-center text-muted">
                        …
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="رصيد آخر المدة حسب الكشف الورقي (للتحقق)" htmlFor="bs_bank_closing">
          <Input id="bs_bank_closing" inputMode="decimal" dir="ltr" value={bankClosing} onChange={(e) => setBankClosing(e.target.value)} />
        </Field>
        <div className="flex flex-col justify-end gap-1 text-sm sm:col-span-2">
          {closingMinor !== null ? (
            <p>
              رصيد آخر المدة المحسوب: <span className="num font-semibold">{jod(closingMinor)}</span>{" "}
              {closingOff === null ? null : closingOff === 0 ? (
                <Badge tone="success">يطابق الكشف</Badge>
              ) : (
                <Badge tone="danger">يختلف بـ {jod(closingOff)}؛ تأكد من الملف ورصيد أول المدة</Badge>
              )}
            </p>
          ) : null}
          {outside ? <p className="text-danger">{formatInt(outside)} حركة خارج الفترة؛ عدّل الفترة.</p> : null}
        </div>
      </div>

      <Field label="ملاحظات" htmlFor="bs_notes">
        <Input id="bs_notes" name="notes" maxLength={500} />
      </Field>
      <input type="hidden" name="lines_json" value={JSON.stringify(lines)} />
      <input type="hidden" name="source_name" value={fileName} />
      <FormError message={state.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !!outside || (closingOff !== null && closingOff !== 0)}>
          {pending ? "جارٍ الحفظ…" : lines.length ? `حفظ الكشف (${formatInt(lines.length)} حركة)` : "حفظ كشف فارغ وإدخال الحركات يدوياً"}
        </Button>
        {closingOff !== null && closingOff !== 0 ? <span className="text-xs text-danger">لا يُحفظ والرصيد لا يطابق الكشف.</span> : null}
      </div>
    </form>
  );
}

const COLUMN_LABEL: Record<string, string> = {
  date: "التاريخ",
  value_date: "تاريخ القيمة",
  description: "البيان",
  reference: "المرجع",
  debit: "سحب",
  credit: "إيداع",
  amount: "المبلغ",
  balance: "الرصيد",
};

export type MatchBankLine = { id: string; line_no: number; date: string; description: string; reference: string | null; amount: number };
export type MatchBookLine = {
  id: string;
  entry_no: number;
  date: string;
  description: string;
  reference: string | null;
  party: string | null;
  amount: number;
  note: string | null;
};

/**
 * Tick lines on both sides with the same total and match them. Ticking a bank
 * line narrows the ledger list to the same amount, until the filter is cleared.
 */
export function BankMatcher({
  action,
  bankLines,
  bookLines,
  postForms,
}: {
  action: Action;
  bankLines: MatchBankLine[];
  bookLines: MatchBookLine[];
  postForms: Record<string, React.ReactNode>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [bank, setBank] = useState<Set<string>>(new Set());
  const [book, setBook] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sameAmount, setSameAmount] = useState(true);
  const [lastDone, setLastDone] = useState<BankFormState | null>(null);
  if (state.done && state !== lastDone) {
    setLastDone(state);
    setBank(new Set());
    setBook(new Set());
  }
  const bankSum = bankLines.filter((l) => bank.has(l.id)).reduce((s, l) => s + l.amount, 0);
  const bookSum = bookLines.filter((l) => book.has(l.id)).reduce((s, l) => s + l.amount, 0);
  const target = bank.size ? bankSum - bookSum : null;
  const visibleBook = useMemo(() => {
    const q = query.trim();
    return bookLines.filter((l) => {
      if (book.has(l.id)) return true;
      if (q) return `${l.description} ${l.reference ?? ""} ${l.party ?? ""} ${l.entry_no} ${jod(Math.abs(l.amount))}`.includes(q);
      if (sameAmount && bank.size === 1 && book.size === 0) return l.amount === bankSum;
      return true;
    });
  }, [bookLines, book, query, sameAmount, bank, bankSum]);
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  const canMatch = bank.size + book.size >= 2 && bankSum === bookSum;

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="sticky top-14 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm lg:top-2">
        {[...bank].map((id) => (
          <input key={id} type="hidden" name="bank_id" value={id} />
        ))}
        {[...book].map((id) => (
          <input key={id} type="hidden" name="book_id" value={id} />
        ))}
        <span className="text-sm">
          الكشف: <span className="num font-semibold">{jod(bankSum)}</span> ({formatInt(bank.size)})
        </span>
        <span className="text-sm">
          الدفاتر: <span className="num font-semibold">{jod(bookSum)}</span> ({formatInt(book.size)})
        </span>
        {bank.size + book.size > 0 && !canMatch ? (
          <span className="text-sm text-danger">
            الفرق <span className="num">{jod(bankSum - bookSum)}</span>
          </span>
        ) : null}
        <Button type="submit" disabled={!canMatch || pending}>
          {pending ? "…" : "مطابقة المحدد"}
        </Button>
        {bank.size + book.size > 0 ? (
          <button
            type="button"
            className="text-sm text-muted hover:underline"
            onClick={() => {
              setBank(new Set());
              setBook(new Set());
            }}
          >
            إلغاء التحديد
          </button>
        ) : null}
        <FormError message={state.error} />
        {state.done && state.message ? <span className="text-sm text-success">{state.message}</span> : null}
      </form>

      <div className="grid gap-4 2xl:grid-cols-2">
        <section aria-label="حركات الكشف غير المطابقة" className="min-w-0 rounded-lg border border-border">
          <h3 className="border-b border-border px-3 py-2 text-sm font-semibold">
            حركات الكشف غير المطابقة <span className="num text-muted">({formatInt(bankLines.length)})</span>
          </h3>
          {bankLines.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">كل حركات الكشف مطابقة.</p>
          ) : (
            <ul className="divide-y divide-border">
              {bankLines.map((l) => (
                <li key={l.id} className={bank.has(l.id) ? "bg-primary-soft" : ""}>
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm">
                    <input type="checkbox" className="mt-1 size-4" checked={bank.has(l.id)} onChange={() => toggle(bank, l.id, setBank)} />
                    <span className="min-w-0 flex-1">
                      <span className="num text-xs text-muted">
                        {l.line_no} · {formatDate(l.date)}
                      </span>{" "}
                      {l.description || "—"}
                      {l.reference ? (
                        <span className="num ms-1 text-xs text-muted" dir="ltr">
                          {l.reference}
                        </span>
                      ) : null}
                    </span>
                    <span className={`num whitespace-nowrap font-semibold ${l.amount < 0 ? "text-danger" : "text-success"}`}>{jod(l.amount)}</span>
                  </label>
                  {postForms[l.id] ? <div className="px-3 pb-2">{postForms[l.id]}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="حركات الدفاتر غير المطابقة" className="min-w-0 rounded-lg border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h3 className="text-sm font-semibold">
              حركات البنك في الدفاتر غير المطابقة <span className="num text-muted">({formatInt(bookLines.length)})</span>
            </h3>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="checkbox" className="size-3.5" checked={sameAmount} onChange={(e) => setSameAmount(e.target.checked)} />
                نفس المبلغ فقط
              </label>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="بحث"
                aria-label="بحث في حركات الدفاتر"
                className="w-32 rounded-md border border-border bg-surface px-2 py-1 text-xs"
              />
            </div>
          </div>
          {target !== null && target !== 0 && book.size ? (
            <p className="px-3 pt-2 text-xs text-muted">
              المتبقي للمطابقة: <span className="num">{jod(target)}</span>
            </p>
          ) : null}
          {visibleBook.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              {bookLines.length === 0 ? "لا توجد حركات غير مطابقة في الدفاتر." : "لا توجد حركة بنفس المبلغ؛ ألغِ «نفس المبلغ فقط» أو ابحث."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {visibleBook.map((l) => (
                <li key={l.id} className={book.has(l.id) ? "bg-primary-soft" : ""}>
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm">
                    <input type="checkbox" className="mt-1 size-4" checked={book.has(l.id)} onChange={() => toggle(book, l.id, setBook)} />
                    <span className="min-w-0 flex-1">
                      <span className="num text-xs text-muted">
                        قيد {l.entry_no} · {formatDate(l.date)}
                      </span>{" "}
                      {l.description}
                      {l.reference ? (
                        <span className="num ms-1 text-xs text-muted" dir="ltr">
                          {l.reference}
                        </span>
                      ) : null}
                      {l.note ? (
                        <span className="ms-1">
                          <Badge tone="info">{l.note}</Badge>
                        </span>
                      ) : null}
                    </span>
                    <span className={`num whitespace-nowrap font-semibold ${l.amount < 0 ? "text-danger" : "text-success"}`}>{jod(l.amount)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Post one bank line the books do not have (charges, interest...) against an account, and match it. */
export function PostBankLineForm({
  action,
  accounts,
  trucks,
  defaultAccountId,
  description,
}: {
  action: Action;
  accounts: Option[];
  trucks: Option[];
  defaultAccountId: string;
  description: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-primary">تسجيل في الدفاتر (عمولات، فوائد…)</summary>
      <form action={formAction} className="mt-2 grid gap-2 sm:grid-cols-4">
        <select name="account_id" defaultValue={defaultAccountId} aria-label="الحساب المقابل" className="rounded-md border border-border bg-surface px-2 py-1 sm:col-span-2">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <select name="truck_id" defaultValue="" aria-label="الشاحنة" className="rounded-md border border-border bg-surface px-2 py-1">
          <option value="">بدون شاحنة</option>
          {trucks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <input name="description" defaultValue={description} maxLength={200} aria-label="البيان" className="rounded-md border border-border bg-surface px-2 py-1" />
        <div className="flex items-center gap-2 sm:col-span-4">
          <button type="submit" disabled={pending} className="rounded-md border border-border px-2 py-1 font-medium text-primary hover:bg-surface-2">
            {pending ? "…" : "ترحيل ومطابقة"}
          </button>
          {state.error ? <span className="text-danger">{state.error}</span> : null}
        </div>
      </form>
    </details>
  );
}

/** A movement typed by hand into an open statement. */
export function ManualBankLineForm({ action, from, to }: { action: Action; from: string; to: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [round, setRound] = useState(0);
  const [last, setLast] = useState<BankFormState | null>(null);
  if (state.done && state !== last) {
    setLast(state);
    setRound((r) => r + 1);
  }
  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="التاريخ" htmlFor="ml_date">
          <Input id="ml_date" name="txn_date" type="date" dir="ltr" min={from} max={to} defaultValue={to} required />
        </Field>
        <Field label="النوع" htmlFor="ml_dir">
          <Select id="ml_dir" name="direction" defaultValue="out">
            <option value="in">إيداع (دائن)</option>
            <option value="out">سحب (مدين)</option>
          </Select>
        </Field>
        <Field label="المبلغ" htmlFor="ml_amount">
          <Input id="ml_amount" name="amount" inputMode="decimal" dir="ltr" required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="البيان" htmlFor="ml_desc">
            <Input id="ml_desc" name="description" maxLength={300} />
          </Field>
        </div>
        <Field label="المرجع" htmlFor="ml_ref">
          <Input id="ml_ref" name="reference" dir="ltr" maxLength={80} />
        </Field>
      </div>
      <FormError message={state.error} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "…" : "إضافة الحركة"}
        </Button>
      </div>
    </form>
  );
}

/** A button with a confirmation that shows the action's message or error. */
export function BankButton({
  action,
  label,
  confirmText,
  variant = "secondary",
  small = false,
}: {
  action: (prev: BankFormState) => Promise<BankFormState>;
  label: string;
  confirmText?: string;
  variant?: "primary" | "secondary" | "danger";
  small?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !confirm(confirmText)) e.preventDefault();
      }}
      className="inline-flex flex-wrap items-center gap-2"
    >
      {small ? (
        <button type="submit" disabled={pending} className={`text-xs hover:underline ${variant === "danger" ? "text-danger" : "text-primary"}`}>
          {pending ? "…" : label}
        </button>
      ) : (
        <Button type="submit" variant={variant === "danger" ? "secondary" : variant} disabled={pending} className={variant === "danger" ? "text-danger" : ""}>
          {pending ? "…" : label}
        </Button>
      )}
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
      {state.done && state.message ? <span className="text-xs text-success">{state.message}</span> : null}
    </form>
  );
}

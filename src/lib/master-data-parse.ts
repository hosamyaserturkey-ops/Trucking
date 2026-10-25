import { parseMoney } from "@/lib/money";
import type { FieldDef } from "@/lib/master-data";

export type ParseResult = { ok: true; values: Record<string, unknown> } | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Turn submitted form values into a database row, or explain what is wrong (in Arabic). */
export function parseEntityForm(fields: FieldDef[], get: (name: string) => string | null): ParseResult {
  const values: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = get(field.name);
    const text = typeof raw === "string" ? raw.trim() : "";

    if (field.type === "bool") {
      values[field.name] = raw === "on" || raw === "true";
      continue;
    }

    if (text === "") {
      if (field.required) return { ok: false, error: `الحقل «${field.label}» مطلوب` };
      values[field.name] = null;
      continue;
    }

    switch (field.type) {
      case "text":
        values[field.name] = text;
        break;
      case "int": {
        if (!/^-?\d+$/.test(text)) return { ok: false, error: `«${field.label}» يجب أن يكون رقماً صحيحاً` };
        values[field.name] = Number(text);
        break;
      }
      case "decimal": {
        if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: `«${field.label}» يجب أن يكون رقماً` };
        values[field.name] = text; // numeric column: pass the exact text
        break;
      }
      case "money": {
        const minor = parseMoney(text, "JOD");
        if (minor === null || minor < 0n) {
          return { ok: false, error: `«${field.label}» مبلغ غير صحيح (حتى 3 منازل عشرية)` };
        }
        values[field.name] = Number(minor);
        break;
      }
      case "date": {
        if (!ISO_DATE.test(text)) return { ok: false, error: `«${field.label}» تاريخ غير صحيح` };
        values[field.name] = text;
        break;
      }
      case "select": {
        if (!field.options?.some((o) => o.value === text)) {
          return { ok: false, error: `قيمة غير مسموحة في «${field.label}»` };
        }
        values[field.name] = text;
        break;
      }
      case "ref": {
        if (!/^[0-9a-f-]{36}$/i.test(text)) return { ok: false, error: `قيمة غير صحيحة في «${field.label}»` };
        values[field.name] = text;
        break;
      }
    }
  }

  return { ok: true, values };
}

/** Map a Postgres/PostgREST error to a message for the user. */
export function describeDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "23505":
      return "هذه القيمة مستخدمة مسبقاً (يجب أن تكون فريدة)";
    case "42501":
      return "لا تملك صلاحية تعديل هذه البيانات";
    case "23503":
      return "السجل مرتبط بسجل غير موجود";
    case "23514":
      return `القيمة لا تحقق شروط الحفظ: ${error.message}`;
    default:
      return `تعذر الحفظ: ${error.message}`;
  }
}

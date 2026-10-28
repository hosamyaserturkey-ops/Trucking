// Arabic labels for database codes, kept in one place.

export const TRUCK_STATUS: Record<string, { label: string; tone: Tone }> = {
  on_trip: { label: "في رحلة", tone: "info" },
  idle: { label: "متوقفة", tone: "neutral" },
  workshop: { label: "في الورشة", tone: "warning" },
  inactive: { label: "غير فعالة", tone: "neutral" },
};

export const TRIP_STATUS: Record<string, { label: string; tone: Tone }> = {
  planned: { label: "مخططة", tone: "neutral" },
  in_progress: { label: "جارية", tone: "info" },
  completed: { label: "مكتملة", tone: "success" },
  cancelled: { label: "ملغاة", tone: "danger" },
};

export const PNL_KIND: Record<string, string> = {
  revenue: "الإيرادات",
  fuel: "الديزل",
  maintenance: "الصيانة",
  expense: "مصاريف مباشرة",
  depreciation: "الاستهلاك",
  interest: "فوائد التمويل",
  overhead: "مصاريف عامة موزعة",
};

export const COST_KINDS = ["fuel", "maintenance", "expense", "depreciation", "interest", "overhead"] as const;

export const DOC_TYPE: Record<string, string> = {
  registration: "رخصة المركبة",
  insurance: "التأمين",
  inspection: "الفحص الفني",
  permit: "تصريح",
  other: "أخرى",
};

export const EXPIRY_BAND: Record<string, { label: string; tone: Tone }> = {
  expired: { label: "منتهية", tone: "danger" },
  d7: { label: "خلال 7 أيام", tone: "danger" },
  d30: { label: "خلال 30 يوماً", tone: "warning" },
  d60: { label: "خلال 60 يوماً", tone: "info" },
  ok: { label: "سارية", tone: "success" },
  none: { label: "بدون تاريخ", tone: "neutral" },
};

export const SERVICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  overdue: { label: "متأخرة", tone: "danger" },
  due_soon: { label: "قريبة", tone: "warning" },
  ok: { label: "جيدة", tone: "success" },
};

export const WORK_ORDER_KIND: Record<string, string> = {
  service: "صيانة دورية",
  repair: "إصلاح",
  tires: "إطارات",
  inspection: "فحص",
  other: "أخرى",
};

export const WORK_ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "مفتوح", tone: "warning" },
  closed: { label: "مغلق", tone: "success" },
  cancelled: { label: "ملغى", tone: "neutral" },
};

export const PAYMENT_METHOD: Record<string, string> = {
  cash: "نقداً",
  card: "بطاقة",
  credit: "آجل",
  own_tank: "خزان الشركة",
  bank: "تحويل بنكي",
  check: "شيك",
  driver_advance: "دفعها السائق",
};

export const SUPPLIER_KIND: Record<string, string> = {
  fuel_station: "محطة وقود",
  workshop: "ورشة",
  parts: "قطع غيار",
  tires: "إطارات",
  other: "أخرى",
};

export const ACCOUNT_TYPE: Record<string, string> = {
  asset: "أصول",
  liability: "خصوم",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصاريف",
};

export const JOURNAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "مسودة", tone: "neutral" },
  posted: { label: "مرحّل", tone: "success" },
  reversed: { label: "معكوس", tone: "warning" },
};

// Steer axle, then two drive axles (outer/inner, left/right).
export const TIRE_POSITIONS: { code: string; label: string }[] = [
  { code: "F-L", label: "أمامي يسار" },
  { code: "F-R", label: "أمامي يمين" },
  { code: "D1-LO", label: "محور 1 يسار خارجي" },
  { code: "D1-LI", label: "محور 1 يسار داخلي" },
  { code: "D1-RI", label: "محور 1 يمين داخلي" },
  { code: "D1-RO", label: "محور 1 يمين خارجي" },
  { code: "D2-LO", label: "محور 2 يسار خارجي" },
  { code: "D2-LI", label: "محور 2 يسار داخلي" },
  { code: "D2-RI", label: "محور 2 يمين داخلي" },
  { code: "D2-RO", label: "محور 2 يمين خارجي" },
];

export const AUDIT_TABLE: Record<string, string> = {
  trucks: "الشاحنات",
  truck_assets: "قيم الشاحنات",
  drivers: "السائقون",
  clients: "العملاء",
  suppliers: "الموردون",
  locations: "المواقع",
  accounts: "دليل الحسابات",
  expense_categories: "فئات المصاريف",
  trips: "الرحلات",
  fuel_fillups: "تعبئة الديزل",
  expenses: "المصاريف",
  work_orders: "أوامر الصيانة",
  work_order_lines: "بنود الصيانة",
  service_schedules: "جداول الصيانة",
  tires: "الإطارات",
  tire_installations: "تركيب الإطارات",
  truck_documents: "الوثائق",
  journal_entries: "القيود",
  journal_lines: "سطور القيود",
  truck_financing: "التمويل",
  financing_installments: "الأقساط",
  profiles: "المستخدمون",
  company_settings: "الإعدادات",
  currencies: "العملات",
};

export const AUDIT_ACTION: Record<string, { label: string; tone: Tone }> = {
  INSERT: { label: "إضافة", tone: "success" },
  UPDATE: { label: "تعديل", tone: "info" },
  DELETE: { label: "حذف", tone: "danger" },
};

export const EXPENSE_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "بانتظار الموافقة", tone: "warning" },
  approved: { label: "معتمد", tone: "success" },
  rejected: { label: "مرفوض", tone: "danger" },
};

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  issued: { label: "صادرة", tone: "success" },
  cancelled: { label: "ملغاة", tone: "neutral" },
};

export const RECEIPT_METHOD: Record<string, string> = {
  cash: "نقداً",
  bank: "تحويل بنكي",
  cheque: "شيك",
  discount: "خصم / تسوية",
};

export const CHEQUE_STATUS: Record<string, { label: string; tone: Tone }> = {
  in_hand: { label: "بالصندوق", tone: "info" },
  deposited: { label: "مودع بالبنك", tone: "warning" },
  cleared: { label: "محصّل", tone: "success" },
  bounced: { label: "مرتجع", tone: "danger" },
};

export const SUPPLIER_PAYMENT_METHOD: Record<string, string> = {
  cash: "نقداً",
  bank: "تحويل بنكي",
  cheque: "شيك",
  discount: "خصم مكتسب",
};

export const ISSUED_CHEQUE_STATUS: Record<string, { label: string; tone: Tone }> = {
  issued: { label: "بانتظار الصرف", tone: "warning" },
  cleared: { label: "صُرف من البنك", tone: "success" },
  bounced: { label: "مرتجع", tone: "danger" },
};

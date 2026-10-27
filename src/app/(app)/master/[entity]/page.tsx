import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getEntity, type FieldDef } from "@/lib/master-data";
import { loadRefOptions, untypedClient } from "@/lib/master-data-server";
import { formatDate, formatInt } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export async function generateMetadata({ params }: { params: Promise<{ entity: string }> }) {
  const entity = getEntity((await params).entity);
  return { title: entity?.title ?? "البيانات الأساسية" };
}

export default async function EntityListPage({ params }: { params: Promise<{ entity: string }> }) {
  const entity = getEntity((await params).entity);
  if (!entity) notFound();
  const profile = await requireRole(...entity.readRoles);
  const canWrite = entity.writeRoles.includes(profile.role);

  const supabase = await untypedClient();
  const columns = entity.list.map((name) => entity.fields.find((f) => f.name === name)!);
  const [{ data, error }, refs] = await Promise.all([
    supabase.from(entity.table).select(["id", ...entity.list].join(", ")).order(entity.orderBy),
    loadRefOptions(columns),
  ]);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  const cell = (field: FieldDef, value: unknown) => {
    if (value === null || value === undefined || value === "") return <span className="text-muted">—</span>;
    switch (field.type) {
      case "bool":
        return value ? <Badge tone="success">نعم</Badge> : <Badge>لا</Badge>;
      case "date":
        return <span className="num">{formatDate(String(value))}</span>;
      case "int":
        return <span className="num">{formatInt(Number(value))}</span>;
      case "money":
        return <span className="num">{formatMoney(Number(value))}</span>;
      case "select":
        return field.options?.find((o) => o.value === value)?.label ?? String(value);
      case "ref":
        return refs[field.name]?.find((o) => o.value === value)?.label ?? "—";
      default:
        return field.ltr ? <span className="num">{String(value)}</span> : String(value);
    }
  };

  return (
    <>
      <PageHeader
        title={entity.title}
        subtitle={`${formatInt(rows.length)} سجل`}
        action={
          canWrite ? (
            <LinkButton href={`/master/${entity.key}/new`} variant="primary">
              <Plus className="size-4" aria-hidden />
              إضافة {entity.singular}
            </LinkButton>
          ) : null
        }
      />
      <Card>
        {error ? (
          <EmptyState>تعذر تحميل البيانات: {error.message}</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>لا توجد سجلات بعد.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <Th key={c.name}>{c.label}</Th>
                ))}
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={String(row.id)}>
                  {columns.map((c) => (
                    <Td key={c.name} className="whitespace-nowrap">
                      {entity.key === "accounts" && c.name === "name_ar" ? (
                        <span style={{ paddingInlineStart: `${(String(row.code).length - 1) * 0.5}rem` }}>
                          {String(row.name_ar)}
                        </span>
                      ) : (
                        cell(c, row[c.name])
                      )}
                    </Td>
                  ))}
                  <Td className="whitespace-nowrap text-end">
                    {entity.key === "trucks" ? (
                      <Link href={`/trucks/${row.id}`} className="me-3 text-sm text-primary hover:underline">
                        ملف الشاحنة
                      </Link>
                    ) : null}
                    <Link href={`/master/${entity.key}/${row.id}`} className="text-sm text-primary hover:underline">
                      {canWrite ? "تعديل" : "عرض"}
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

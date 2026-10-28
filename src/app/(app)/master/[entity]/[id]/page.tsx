import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials } from "@/lib/roles";
import { getEntity, TRUCK_ASSETS } from "@/lib/master-data";
import { loadRefOptions, untypedClient } from "@/lib/master-data-server";
import { decideUpload } from "@/lib/file-access";
import { saveEntity } from "../../actions";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EntityForm } from "@/components/entity-form";
import { DriverLicenceSection, TruckLicenceSection } from "@/components/licence-fields";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditEntityPage({ params }: { params: Promise<{ entity: string; id: string }> }) {
  const { entity: key, id } = await params;
  const entity = getEntity(key);
  if (!entity || !UUID.test(id)) notFound();
  const profile = await requireRole(...entity.readRoles);
  const canWrite = entity.writeRoles.includes(profile.role);

  const supabase = await untypedClient();
  const [{ data: row }, refOptions] = await Promise.all([
    supabase.from(entity.table).select("*").eq("id", id).maybeSingle(),
    loadRefOptions(entity.fields),
  ]);
  if (!row) notFound();

  // Trucks: finance roles also see and edit purchase value and depreciation inputs.
  const showAssets = entity.key === "trucks" && canSeeFinancials(profile.role);
  const assets = showAssets
    ? (await supabase.from("truck_assets").select("*").eq("truck_id", id).maybeSingle()).data
    : null;

  const title = (row as Record<string, unknown>)[entity.list[0]];

  // Licences: the driver's scan is on his row; the truck's is its latest registration document.
  const licence =
    entity.key === "trucks"
      ? (
          await supabase
            .from("truck_documents")
            .select("id, doc_number, expiry_date, file_path")
            .eq("truck_id", id)
            .eq("doc_type", "registration")
            .order("expiry_date", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle()
        ).data
      : null;
  const extra =
    entity.key === "drivers" ? (
      <DriverLicenceSection fileHref={(row as { license_file_path?: string | null }).license_file_path ? `/files/driver-license/${id}` : null} />
    ) : entity.key === "trucks" ? (
      <TruckLicenceSection
        number={licence?.doc_number ?? null}
        expiry={licence?.expiry_date ?? null}
        fileHref={licence?.file_path ? `/files/truck-document/${licence.id}` : null}
        canAttach={canWrite && decideUpload(profile.role, "truck_document")}
      />
    ) : undefined;

  return (
    <>
      <Link href={`/master/${entity.key}`} className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        {entity.title}
      </Link>
      <PageHeader
        title={
          <>
            {canWrite ? "تعديل" : "عرض"} {entity.singular}: <span className="num">{String(title ?? "")}</span>
          </>
        }
        action={
          entity.key === "trucks" ? (
            <Link href={`/trucks/${id}`} className="text-sm text-primary hover:underline">
              ملف الشاحنة
            </Link>
          ) : null
        }
      />
      <div className="flex flex-col gap-5">
        <Card>
          <CardBody>
            <EntityForm
              fields={entity.fields}
              values={row as Record<string, unknown>}
              refOptions={refOptions}
              action={saveEntity.bind(null, entity.key, id)}
              submitLabel="حفظ التعديلات"
              readOnly={!canWrite}
              extra={extra}
              uploadPurpose={entity.key === "drivers" ? "driver_license" : "truck_document"}
            />
          </CardBody>
        </Card>

        {showAssets ? (
          <Card>
            <CardHeader title="قيمة الشاحنة والاستهلاك" subtitle="تظهر للمدير والمحاسب فقط" />
            <CardBody>
              <EntityForm
                fields={TRUCK_ASSETS.fields}
                values={(assets as Record<string, unknown> | null) ?? {}}
                refOptions={{}}
                action={saveEntity.bind(null, "truck_assets", id)}
                submitLabel="حفظ القيمة"
              />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}

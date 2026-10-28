import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getEntity } from "@/lib/master-data";
import { loadRefOptions } from "@/lib/master-data-server";
import { decideUpload } from "@/lib/file-access";
import { saveEntity } from "../../actions";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EntityForm } from "@/components/entity-form";
import { DriverLicenceSection, TruckLicenceSection } from "@/components/licence-fields";

export default async function NewEntityPage({ params }: { params: Promise<{ entity: string }> }) {
  const entity = getEntity((await params).entity);
  if (!entity) notFound();
  const profile = await requireRole(...entity.writeRoles);
  const refOptions = await loadRefOptions(entity.fields);
  const defaults: Record<string, unknown> = entity.key === "locations" ? { country: "الأردن" } : {};

  return (
    <>
      <Link href={`/master/${entity.key}`} className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        {entity.title}
      </Link>
      <PageHeader title={`إضافة ${entity.singular}`} />
      <Card>
        <CardBody>
          <EntityForm
            fields={entity.fields}
            values={defaults}
            refOptions={refOptions}
            action={saveEntity.bind(null, entity.key, null)}
            submitLabel="حفظ"
            extra={
              entity.key === "drivers" ? (
                <DriverLicenceSection fileHref={null} />
              ) : entity.key === "trucks" ? (
                <TruckLicenceSection number={null} expiry={null} fileHref={null} canAttach={decideUpload(profile.role, "truck_document")} />
              ) : undefined
            }
            uploadPurpose={entity.key === "drivers" ? "driver_license" : "truck_document"}
          />
        </CardBody>
      </Card>
    </>
  );
}

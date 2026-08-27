import { requireGlobal } from "@/lib/permissions/guard";
import { listVentures } from "@/modules/ventures/venture.service";
import { PersonForm } from "@/components/forms/PersonForm";
import { createPersonAction } from "../actions";
import { Card, PageHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add person · Portfolio Ops" };

export default async function NewPersonPage() {
  const actor = await requireGlobal("person:create");
  const ventures = await listVentures(actor);

  return (
    <>
      <PageHeader
        title="Add person"
        description="They receive an invitation link and set their own password. Pay rates are set separately."
      />
      <Card className="max-w-3xl">
        <div className="p-6">
          <PersonForm
            action={createPersonAction}
            ventures={ventures.map((v) => ({ id: v.id, name: v.name, tagColor: v.tagColor }))}
          />
        </div>
      </Card>
    </>
  );
}

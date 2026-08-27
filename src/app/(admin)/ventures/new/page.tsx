import Link from "next/link";
import { requireGlobal } from "@/lib/permissions/guard";
import { VentureForm } from "@/components/forms/VentureForm";
import { createVentureAction } from "../actions";
import { Card, PageHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create venture · Portfolio Ops" };

export default async function NewVenturePage() {
  await requireGlobal("venture:create");

  return (
    <>
      <PageHeader
        title="Create venture"
        description="Ventures are not hardcoded — add as many as you need."
        action={
          <Link
            href="/ventures"
            className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
          >
            Cancel
          </Link>
        }
      />
      <Card className="max-w-2xl">
        <div className="p-6">
          <VentureForm action={createVentureAction} submitLabel="Create venture" />
        </div>
      </Card>
    </>
  );
}

import { checkGlobal } from "@/lib/permissions/guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { listAssets, listDocuments } from "@/modules/hr/hr.service";
import { listPeople } from "@/modules/people/person.service";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AssetForm, DocumentForm } from "./HrForms";
import { issueAssetAction, returnAssetAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "HR records · Portfolio Ops" };

const ASSET_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  AVAILABLE: "green",
  ISSUED: "blue",
  IN_REPAIR: "amber",
  RETIRED: "neutral",
  LOST: "red",
};

const DOC_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  VERIFIED: "green",
  SUBMITTED: "blue",
  PENDING: "amber",
  REJECTED: "red",
  EXPIRED: "red",
};

export default async function HrPage() {
  const access = await checkGlobal("person:update:profile");
  if (!access.allowed) return <AccessDenied area="HR records" />;
  const actor = access.actor;

  const [assets, documents, people] = await Promise.all([
    listAssets(actor),
    listDocuments(actor),
    listPeople(actor),
  ]);

  const peopleOptions = people.map((p) => ({ personId: p.personId, name: p.name }));
  const attention = documents.filter((d) => d.expired || d.expiringSoon);

  return (
    <>
      <PageHeader
        title="HR records"
        description="Hardware and document tracking. Documents themselves stay in your secure storage — only references are held here."
      />

      {attention.length > 0 && (
        <Card className="mb-6 border-amber-300 dark:border-amber-900">
          <div className="p-4">
            <h2 className="font-medium text-amber-900 dark:text-amber-200">
              {attention.length} document{attention.length === 1 ? "" : "s"} need attention
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {attention.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-zinc-900 dark:text-zinc-100">{d.personName}</span>
                  <span className="text-zinc-600 dark:text-zinc-400">{d.docType}</span>
                  <Badge tone={d.expired ? "red" : "amber"}>
                    {d.expired ? `expired ${d.expiryDate}` : `expires ${d.expiryDate}`}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Hardware */}
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Hardware ({assets.length})
          </h2>

          {assets.length === 0 ? (
            <EmptyState
              title="No hardware assigned"
              description="Register a laptop, phone or other asset to start tracking who holds it."
            />
          ) : (
            <div className="mb-4 space-y-2">
              {assets.map((a) => (
                <Card key={a.id}>
                  <div className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {a.itemName}
                      </span>
                      {a.assetTag && (
                        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                          {a.assetTag}
                        </span>
                      )}
                      <div className="flex-1" />
                      <Badge tone={ASSET_TONE[a.status] ?? "neutral"}>
                        {a.status.replace("_", " ").toLowerCase()}
                      </Badge>
                    </div>

                    {a.holder ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-zinc-600 dark:text-zinc-400">
                          Held by {a.holder.name} since{" "}
                          {a.holder.issuedAt.toISOString().slice(0, 10)}
                        </span>
                        <form action={returnAssetAction} className="ml-auto flex gap-1">
                          <input type="hidden" name="assetId" value={a.id} />
                          <input
                            name="condition"
                            placeholder="Condition"
                            className="w-28 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                          />
                          <Button variant="secondary" type="submit" className="px-2 py-1 text-xs">
                            Record return
                          </Button>
                        </form>
                      </div>
                    ) : (
                      <form action={issueAssetAction} className="mt-2 flex flex-wrap gap-1">
                        <input type="hidden" name="assetId" value={a.id} />
                        <select
                          name="personId"
                          required
                          className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          {peopleOptions.map((p) => (
                            <option key={p.personId} value={p.personId}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" className="px-2 py-1 text-xs">
                          Issue
                        </Button>
                      </form>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Card>
            <div className="p-4">
              <h3 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Register an asset
              </h3>
              <AssetForm />
            </div>
          </Card>
        </section>

        {/* Documents */}
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Documents ({documents.length})
          </h2>

          {documents.length === 0 ? (
            <EmptyState
              title="No document records"
              description="Track passports, contracts or visas by reference — the files themselves stay elsewhere."
            />
          ) : (
            <div className="mb-4 space-y-2">
              {documents.map((d) => (
                <Card key={d.id}>
                  <div className="flex flex-wrap items-center gap-2 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {d.docType}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {d.personName}
                        {d.expiryDate && ` · expires ${d.expiryDate}`}
                      </div>
                    </div>
                    {d.externalLink && (
                      <a
                        href={d.externalLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Open
                      </a>
                    )}
                    <Badge tone={DOC_TONE[d.status] ?? "neutral"}>
                      {d.status.toLowerCase()}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Card>
            <div className="p-4">
              <h3 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Add a document record
              </h3>
              <DocumentForm people={peopleOptions} />
            </div>
          </Card>
        </section>
      </div>
    </>
  );
}

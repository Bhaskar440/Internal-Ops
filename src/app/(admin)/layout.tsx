import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { resolveActor } from "@/lib/auth/actor";
import { AppShell } from "@/components/layout/AppShell";
import { PendingApproval } from "@/components/layout/PendingApproval";

export const dynamic = "force-dynamic";

/**
 * Every page in this group requires an authenticated, active account.
 * Individual pages still check their own permissions — this is the floor,
 * not the ceiling.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await resolveActor();
  if (!actor) redirect("/login");

  // PENDING may sign in but sees only the awaiting-approval screen (§7).
  if (actor.accountStatus === "PENDING") {
    return <PendingApproval name={actor.name} />;
  }

  if (actor.accountStatus !== "ACTIVE") {
    redirect("/login");
  }

  return <AppShell actor={actor}>{children}</AppShell>;
}

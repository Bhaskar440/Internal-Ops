import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth/config";
import type { Actor } from "@/lib/permissions/types";
import { isSuperAdmin } from "@/lib/permissions/types";
import { Button } from "@/components/ui/Button";

/**
 * Application shell with role-aware navigation (§8).
 *
 * Navigation is filtered by role for usability only — every route re-checks
 * permission server-side. Hiding a link is not security (§6).
 */

type NavItem = { href: string; label: string; adminOnly?: boolean; managerOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/my-day", label: "My day" },
  { href: "/tasks", label: "Tasks" },
  { href: "/approvals", label: "Approvals", managerOnly: true },
  { href: "/people", label: "People" },
  { href: "/reports", label: "Reports", managerOnly: true },
  { href: "/payroll", label: "Payroll", adminOnly: true },
  { href: "/hr", label: "HR", adminOnly: true },
  { href: "/ventures", label: "Ventures", adminOnly: true },
  { href: "/audit", label: "Audit", adminOnly: true },
];

export function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  const admin = isSuperAdmin(actor);
  const isManager = admin || [...actor.memberships.values()].includes("MANAGER");
  const items = NAV.filter(
    (i) => (!i.adminOnly || admin) && (!i.managerOnly || isManager),
  );
  const initials = actor.name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Portfolio&nbsp;Ops
          </Link>

          <nav className="flex flex-1 items-center gap-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {actor.name}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {admin ? "Super Admin" : "Member"}
              </div>
            </div>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
              aria-hidden
            >
              {initials}
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button variant="ghost" type="submit" className="px-2 py-1 text-xs">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}

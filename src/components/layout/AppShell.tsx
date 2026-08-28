import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth/config";
import type { Actor } from "@/lib/permissions/types";
import { isSuperAdmin } from "@/lib/permissions/types";
import { isMyPayEnabled } from "@/modules/compensation/compensation.service";
import { NavLink } from "./NavLink";
import { Button } from "@/components/ui/Button";

/**
 * Application shell with role-aware navigation (§8).
 *
 * Navigation is filtered by role for usability only — every route re-checks
 * permission server-side. Hiding a link is not security (§6).
 *
 * The bar carries the daily work; personal and account items sit to the right,
 * so an eleven-item admin nav stays readable instead of becoming a wall.
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
  { href: "/settings", label: "Settings", adminOnly: true },
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

  const roleLabel = admin ? "Super Admin" : isManager ? "Manager" : "Member";

  return (
    <div className="flex min-h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-14 items-center gap-4">
            <Link
              href="/"
              className="shrink-0 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
            >
              Portfolio&nbsp;Ops
            </Link>

            {/* The nav scrolls sideways on narrow screens rather than wrapping
                the header into two rows. */}
            <nav
              aria-label="Main"
              className="-mx-2 flex flex-1 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {items.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} />
              ))}
            </nav>

            <div className="flex shrink-0 items-center gap-2">
              {isMyPayEnabled() && (
                <NavLink href="/my-pay" label="My pay" />
              )}

              <div className="hidden items-center gap-2 border-l border-zinc-200 pl-3 dark:border-zinc-800 md:flex">
                <div className="text-right">
                  <div className="text-sm font-medium leading-tight text-zinc-900 dark:text-zinc-100">
                    {actor.name}
                  </div>
                  <div className="text-xs leading-tight text-zinc-500 dark:text-zinc-400">
                    {roleLabel}
                  </div>
                </div>
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
                  aria-hidden
                >
                  {initials}
                </div>
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
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>

      <footer className="border-t border-zinc-200 py-4 dark:border-zinc-800">
        <div className="mx-auto max-w-7xl px-4 text-xs text-zinc-400 dark:text-zinc-600 sm:px-6">
          Portfolio Ops · internal system of record
        </div>
      </footer>
    </div>
  );
}

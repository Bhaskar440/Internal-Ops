import { cache } from "react";
import { auth } from "./config";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/permissions/types";
import { accountStatusError, unauthenticated } from "@/lib/errors/appError";

/**
 * Resolve the current caller into an Actor (§51 steps 1-4).
 *
 * Roles, account status and memberships are read FROM THE DATABASE on every
 * request, never from the session token. A suspended account or a revoked
 * membership therefore takes effect immediately, not at next sign-in.
 *
 * Wrapped in React's `cache` so multiple calls within one request hit the
 * database once.
 */
export const resolveActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      globalRole: true,
      accountStatus: true,
      person: {
        select: {
          id: true,
          memberships: {
            where: { leftAt: null },
            select: { ventureId: true, accessRole: true },
          },
        },
      },
    },
  });

  if (!user) return null;

  return {
    userId: user.id,
    personId: user.person?.id ?? null,
    name: user.name,
    email: user.email,
    globalRole: user.globalRole,
    accountStatus: user.accountStatus,
    memberships: new Map(
      (user.person?.memberships ?? []).map((m) => [m.ventureId, m.accessRole]),
    ),
  };
});

/** Actor or throw UNAUTHENTICATED. Does not check account status. */
export async function requireActor(): Promise<Actor> {
  const actor = await resolveActor();
  if (!actor) throw unauthenticated();
  return actor;
}

/**
 * Actor that is signed in AND active (§51 step 2).
 * PENDING, SUSPENDED and INACTIVE are refused with a specific reason.
 */
export async function requireActiveActor(): Promise<Actor> {
  const actor = await requireActor();
  const statusError = accountStatusError(actor.accountStatus);
  if (statusError) throw statusError;
  return actor;
}

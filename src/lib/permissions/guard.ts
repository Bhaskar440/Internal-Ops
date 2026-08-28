import { prisma } from "@/lib/db/client";
import { requireActiveActor } from "@/lib/auth/actor";
import type { Actor, ActorWithVenture } from "./types";
import { canGlobal, canVenture, type GlobalPermission, type VenturePermission } from "./matrix";
import { forbidden, notFound, isAppError } from "@/lib/errors/appError";

/**
 * Authorization guards implementing the §51 request pipeline:
 *
 *   Authenticate -> Check Account Status -> Resolve Global Role
 *     -> Resolve Venture Membership -> Check Permission -> ...
 *
 * Callers get an Actor only after every preceding step has passed, so a handler
 * cannot accidentally run before authorization. Hiding UI buttons is not
 * security (§6) — these run server-side on every request.
 */

/** Require an active session plus a global permission. */
export async function requireGlobal(permission: GlobalPermission): Promise<Actor> {
  const actor = await requireActiveActor();
  if (!canGlobal(actor, permission)) {
    throw forbidden(`You do not have permission to perform this action.`);
  }
  return actor;
}

/**
 * Require an active session, membership of the given venture, and a
 * venture-scoped permission.
 *
 * Resolving the venture here — rather than in the handler — is what guarantees
 * the membership check happens. A handler that needs venture scope gets it from
 * this function or not at all.
 */
export async function requireVenture(
  ventureId: string,
  permission: VenturePermission,
): Promise<ActorWithVenture> {
  const actor = await requireActiveActor();

  const venture = await prisma.venture.findUnique({
    where: { id: ventureId },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      workingDays: true,
      dailyLogEditWindowHours: true,
      defaultCurrency: true,
      archivedAt: true,
    },
  });

  if (!venture || venture.archivedAt) throw notFound("Venture");

  const ventureRole = actor.memberships.get(venture.id) ?? null;

  // A non-admin with no membership must not learn whether the venture exists.
  if (actor.globalRole !== "SUPER_ADMIN" && ventureRole === null) {
    throw notFound("Venture");
  }

  const withVenture: ActorWithVenture = {
    ...actor,
    venture: {
      id: venture.id,
      name: venture.name,
      slug: venture.slug,
      timezone: venture.timezone,
      workingDays: venture.workingDays,
      dailyLogEditWindowHours: venture.dailyLogEditWindowHours,
      defaultCurrency: venture.defaultCurrency,
    },
    ventureRole,
  };

  if (!canVenture(withVenture, permission)) {
    throw forbidden("You do not have permission to perform this action in this venture.");
  }

  return withVenture;
}

/** Same as requireVenture but resolved by slug, for URL-addressed pages. */
export async function requireVentureBySlug(
  slug: string,
  permission: VenturePermission,
): Promise<ActorWithVenture> {
  const venture = await prisma.venture.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!venture) throw notFound("Venture");
  return requireVenture(venture.id, permission);
}

/**
 * Page-level authorization that RENDERS a denial rather than throwing.
 *
 * Throwing from a server component produces a 500 and, in production, Next
 * strips the message so the boundary cannot tell "forbidden" from "crashed".
 * The spec asks for a clear refusal (§69, §70), so pages ask this instead and
 * render an access-denied view when it says no.
 *
 * API routes keep using requireGlobal / requireVenture, which throw and are
 * translated into a proper status code.
 */
export async function checkGlobal(
  permission: GlobalPermission,
): Promise<{ allowed: true; actor: Actor } | { allowed: false; reason: string }> {
  try {
    const actor = await requireGlobal(permission);
    return { allowed: true, actor };
  } catch (e) {
    if (isAppError(e)) return { allowed: false, reason: e.message };
    throw e;
  }
}

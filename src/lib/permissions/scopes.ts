import type { Actor, ActorWithVenture } from "./types";
import { isSuperAdmin } from "./types";

/**
 * Reusable authorization scopes.
 *
 * The point of this file is that NO route hand-writes a `where` clause for
 * authorization. Forgetting such a filter is the single most likely way a
 * manager sees another venture's data, so the filter lives here, is unit
 * tested, and is reused everywhere.
 */

/** Venture ids the actor may see. Undefined means "no restriction" (Super Admin). */
export function visibleVentureIds(actor: Actor): string[] | undefined {
  if (isSuperAdmin(actor)) return undefined;
  return [...actor.memberships.keys()];
}

/** Prisma filter restricting a Venture query to what the actor may see. */
export function ventureScope(actor: Actor): { id?: { in: string[] } } {
  const ids = visibleVentureIds(actor);
  return ids === undefined ? {} : { id: { in: ids } };
}

/** Prisma filter for any model carrying a `ventureId` column. */
export function ventureIdScope(actor: Actor): { ventureId?: { in: string[] } } {
  const ids = visibleVentureIds(actor);
  return ids === undefined ? {} : { ventureId: { in: ids } };
}

/**
 * Within a single venture, a MEMBER sees only their own rows while a MANAGER or
 * Super Admin sees everyone's. Used for time entries and daily logs (§6).
 */
export function ownRowsUnlessManager(actor: ActorWithVenture): { personId?: string } {
  if (isSuperAdmin(actor) || actor.ventureRole === "MANAGER") return {};
  if (!actor.personId) {
    // A user with no Person row can own no rows; match nothing rather than all.
    return { personId: "__no_person__" };
  }
  return { personId: actor.personId };
}

/** Whether the actor holds any membership in the given venture. */
export function hasVentureAccess(actor: Actor, ventureId: string): boolean {
  return isSuperAdmin(actor) || actor.memberships.has(ventureId);
}

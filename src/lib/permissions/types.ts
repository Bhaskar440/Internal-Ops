import type { AccountStatus, GlobalRole, VentureAccessRole } from "@/generated/prisma/enums";

/**
 * The authenticated caller, resolved server-side on every request (§51).
 *
 * `memberships` is the complete set of ventures this person belongs to. It is
 * read from the database per request — never from the session token, and never
 * from client input (§53).
 */
export type Actor = {
  userId: string;
  /** Null only for a User with no Person row yet (should not occur post-Phase 2). */
  personId: string | null;
  name: string;
  email: string;
  globalRole: GlobalRole;
  accountStatus: AccountStatus;
  /** ventureId -> access role. Excludes memberships that have been ended. */
  memberships: ReadonlyMap<string, VentureAccessRole>;
};

/** Actor plus the resolved venture for a venture-scoped operation. */
export type ActorWithVenture = Actor & {
  venture: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    workingDays: number[];
    dailyLogEditWindowHours: number;
    defaultCurrency: string;
  };
  /**
   * The caller's role in THIS venture. Null when a SUPER_ADMIN operates on a
   * venture they are not a member of — they still have full access via
   * globalRole, but they hold no venture role.
   */
  ventureRole: VentureAccessRole | null;
};

export function isSuperAdmin(actor: Actor): boolean {
  return actor.globalRole === "SUPER_ADMIN";
}

export function isVentureManager(actor: ActorWithVenture): boolean {
  return isSuperAdmin(actor) || actor.ventureRole === "MANAGER";
}

export function isVentureMember(actor: ActorWithVenture): boolean {
  return isSuperAdmin(actor) || actor.ventureRole !== null;
}

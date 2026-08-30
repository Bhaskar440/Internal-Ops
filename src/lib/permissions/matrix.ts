import type { Actor, ActorWithVenture } from "./types";
import { isSuperAdmin } from "./types";

/**
 * The complete permission matrix (§6), expressed as DATA rather than scattered
 * conditionals, so it can be exhaustively tested and reviewed in one place.
 *
 * Two kinds of permission:
 *   - GlobalPermission   — evaluated against the Actor alone.
 *   - VenturePermission  — evaluated against a resolved venture + venture role.
 *
 * Defaults are CLOSED. Where §6 says "No by default" or is silent, the answer
 * here is no; loosening is a deliberate future edit, not an oversight.
 */

// --- global -----------------------------------------------------------------

export const GLOBAL_PERMISSIONS = {
  /** See every venture in the portfolio (§6 "All ventures"). */
  "venture:list:all": (a: Actor) => isSuperAdmin(a),
  "venture:create": (a: Actor) => isSuperAdmin(a),
  "venture:archive": (a: Actor) => isSuperAdmin(a),

  /** Create/deactivate identity records. Admin-only per the §7 lifecycle. */
  "person:create": (a: Actor) => isSuperAdmin(a),
  "person:list:all": (a: Actor) => isSuperAdmin(a),
  "person:update:profile": (a: Actor) => isSuperAdmin(a),
  "person:activate": (a: Actor) => isSuperAdmin(a),
  "person:deactivate": (a: Actor) => isSuperAdmin(a),
  "person:approve-registration": (a: Actor) => isSuperAdmin(a),
  // Super Admins are equal: any of them may grant or revoke the role.
  "person:set-global-role": (a: Actor) => isSuperAdmin(a),

  /** Compensation is Super Admin only — managers get no salary access (§6, §52). */
  "compensation:read": (a: Actor) => isSuperAdmin(a),
  "compensation:write": (a: Actor) => isSuperAdmin(a),

  /** Payroll (§6): generate and mark paid are Super Admin only. */
  "payroll:read": (a: Actor) => isSuperAdmin(a),
  "payroll:generate": (a: Actor) => isSuperAdmin(a),
  "payroll:lock": (a: Actor) => isSuperAdmin(a),
  "payroll:mark-paid": (a: Actor) => isSuperAdmin(a),

  "audit:read": (a: Actor) => isSuperAdmin(a),
  "settings:write": (a: Actor) => isSuperAdmin(a),
} as const satisfies Record<string, (actor: Actor) => boolean>;

export type GlobalPermission = keyof typeof GLOBAL_PERMISSIONS;

// --- venture-scoped ---------------------------------------------------------

const managerOrAdmin = (a: ActorWithVenture) => isSuperAdmin(a) || a.ventureRole === "MANAGER";
const anyMember = (a: ActorWithVenture) => isSuperAdmin(a) || a.ventureRole !== null;

export const VENTURE_PERMISSIONS = {
  /** Open the venture at all. */
  "venture:read": anyMember,
  "venture:update": (a: ActorWithVenture) => isSuperAdmin(a),

  /**
   * Membership management. Managers may assign people to ventures they manage
   * (§6 "Assign people: Yes") but may NOT create new person records — that is
   * a global permission above.
   */
  "membership:read": anyMember,
  "membership:write": managerOrAdmin,

  /** Team directory, venture-limited for managers (§6 "HR directory"). */
  "person:list:venture": anyMember,

  "task:read": anyMember,
  "task:create": managerOrAdmin,
  "task:update": managerOrAdmin,
  "task:assign": managerOrAdmin,
  "task:archive": managerOrAdmin,
  /** Moving a task backwards is restricted to manager/admin (§18). */
  "task:transition:backward": managerOrAdmin,

  "time:read:all": managerOrAdmin,
  "time:adjust": managerOrAdmin,

  "dailylog:read:all": managerOrAdmin,
  /** Managers approve their own venture (§6, and the user's chosen default). */
  "dailylog:approve": managerOrAdmin,
  /** Correcting a log after the employee edit window has closed (§29). */
  "dailylog:correct": managerOrAdmin,

  "report:read": managerOrAdmin,
} as const satisfies Record<string, (actor: ActorWithVenture) => boolean>;

export type VenturePermission = keyof typeof VENTURE_PERMISSIONS;

// --- evaluation -------------------------------------------------------------

export function canGlobal(actor: Actor, permission: GlobalPermission): boolean {
  return GLOBAL_PERMISSIONS[permission](actor);
}

export function canVenture(actor: ActorWithVenture, permission: VenturePermission): boolean {
  return VENTURE_PERMISSIONS[permission](actor);
}

/** Every permission name, for exhaustiveness tests and admin tooling. */
export const ALL_GLOBAL_PERMISSIONS = Object.keys(GLOBAL_PERMISSIONS) as GlobalPermission[];
export const ALL_VENTURE_PERMISSIONS = Object.keys(VENTURE_PERMISSIONS) as VenturePermission[];

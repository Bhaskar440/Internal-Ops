import { describe, it, expect } from "vitest";
import {
  canGlobal,
  canVenture,
  ALL_GLOBAL_PERMISSIONS,
  ALL_VENTURE_PERMISSIONS,
} from "@/lib/permissions/matrix";
import {
  ventureScope,
  ventureIdScope,
  ownRowsUnlessManager,
  hasVentureAccess,
  visibleVentureIds,
} from "@/lib/permissions/scopes";
import type { Actor, ActorWithVenture } from "@/lib/permissions/types";

const VENTURE_A = "venture-a";
const VENTURE_B = "venture-b";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "u1",
    personId: "p1",
    name: "Test",
    email: "t@test.local",
    globalRole: "USER",
    accountStatus: "ACTIVE",
    memberships: new Map(),
    ...overrides,
  };
}

function withVenture(base: Actor, ventureRole: "MANAGER" | "MEMBER" | null): ActorWithVenture {
  return {
    ...base,
    venture: {
      id: VENTURE_A,
      name: "A",
      slug: "a",
      timezone: "Asia/Kolkata",
      workingDays: [1, 2, 3, 4, 5],
      dailyLogEditWindowHours: 48,
      defaultCurrency: "INR",
    },
    ventureRole,
  };
}

const superAdmin = actor({ globalRole: "SUPER_ADMIN" });
const manager = actor({ memberships: new Map([[VENTURE_A, "MANAGER"]]) });
const member = actor({ memberships: new Map([[VENTURE_A, "MEMBER"]]) });

describe("global permissions (§6)", () => {
  it("grants every global permission to Super Admin", () => {
    for (const p of ALL_GLOBAL_PERMISSIONS) {
      expect(canGlobal(superAdmin, p), `expected SUPER_ADMIN to have ${p}`).toBe(true);
    }
  });

  it("denies every global permission to a plain user, manager included", () => {
    for (const p of ALL_GLOBAL_PERMISSIONS) {
      expect(canGlobal(member, p), `expected MEMBER to lack ${p}`).toBe(false);
      expect(canGlobal(manager, p), `expected MANAGER to lack ${p}`).toBe(false);
    }
  });

  it("keeps compensation and payroll away from managers (§52)", () => {
    expect(canGlobal(manager, "compensation:read")).toBe(false);
    expect(canGlobal(manager, "compensation:write")).toBe(false);
    expect(canGlobal(manager, "payroll:read")).toBe(false);
    expect(canGlobal(manager, "payroll:generate")).toBe(false);
    expect(canGlobal(manager, "payroll:mark-paid")).toBe(false);
  });

  it("reserves person creation for Super Admin (chosen default)", () => {
    expect(canGlobal(superAdmin, "person:create")).toBe(true);
    expect(canGlobal(manager, "person:create")).toBe(false);
  });
});

describe("venture permissions (§6)", () => {
  it("grants everything to Super Admin even without a membership", () => {
    const a = withVenture(superAdmin, null);
    for (const p of ALL_VENTURE_PERMISSIONS) {
      expect(canVenture(a, p), `expected SUPER_ADMIN to have ${p}`).toBe(true);
    }
  });

  it("lets a manager manage membership and approve logs in their venture", () => {
    const a = withVenture(manager, "MANAGER");
    expect(canVenture(a, "membership:write")).toBe(true);
    expect(canVenture(a, "dailylog:approve")).toBe(true);
    expect(canVenture(a, "task:create")).toBe(true);
    expect(canVenture(a, "time:read:all")).toBe(true);
  });

  it("denies a member every management action", () => {
    const a = withVenture(member, "MEMBER");
    expect(canVenture(a, "membership:write")).toBe(false);
    expect(canVenture(a, "dailylog:approve")).toBe(false);
    expect(canVenture(a, "task:create")).toBe(false);
    expect(canVenture(a, "task:transition:backward")).toBe(false);
    expect(canVenture(a, "time:read:all")).toBe(false);
    expect(canVenture(a, "report:read")).toBe(false);
  });

  it("still lets a member read their venture and its tasks", () => {
    const a = withVenture(member, "MEMBER");
    expect(canVenture(a, "venture:read")).toBe(true);
    expect(canVenture(a, "task:read")).toBe(true);
  });

  it("denies a non-member everything, even read", () => {
    const outsider = withVenture(actor(), null);
    for (const p of ALL_VENTURE_PERMISSIONS) {
      expect(canVenture(outsider, p), `expected outsider to lack ${p}`).toBe(false);
    }
  });

  it("reserves venture settings for Super Admin", () => {
    expect(canVenture(withVenture(manager, "MANAGER"), "venture:update")).toBe(false);
    expect(canVenture(withVenture(superAdmin, null), "venture:update")).toBe(true);
  });
});

describe("scoping (prevents cross-venture leaks)", () => {
  it("does not restrict Super Admin", () => {
    expect(visibleVentureIds(superAdmin)).toBeUndefined();
    expect(ventureScope(superAdmin)).toEqual({});
    expect(ventureIdScope(superAdmin)).toEqual({});
  });

  it("restricts a manager to their own ventures", () => {
    const multi = actor({
      memberships: new Map([
        [VENTURE_A, "MANAGER"],
        [VENTURE_B, "MEMBER"],
      ]),
    });
    expect(ventureScope(multi)).toEqual({ id: { in: [VENTURE_A, VENTURE_B] } });
    expect(ventureIdScope(multi)).toEqual({ ventureId: { in: [VENTURE_A, VENTURE_B] } });
  });

  it("produces an empty-set filter for a user with no memberships", () => {
    // Critical: must match NOTHING, not everything.
    expect(ventureScope(actor())).toEqual({ id: { in: [] } });
  });

  it("narrows a member to their own rows but not a manager", () => {
    expect(ownRowsUnlessManager(withVenture(member, "MEMBER"))).toEqual({ personId: "p1" });
    expect(ownRowsUnlessManager(withVenture(manager, "MANAGER"))).toEqual({});
    expect(ownRowsUnlessManager(withVenture(superAdmin, null))).toEqual({});
  });

  it("matches nothing when a member has no person record", () => {
    const noPerson = withVenture(actor({ personId: null }), "MEMBER");
    expect(ownRowsUnlessManager(noPerson)).toEqual({ personId: "__no_person__" });
  });

  it("checks venture access correctly", () => {
    expect(hasVentureAccess(manager, VENTURE_A)).toBe(true);
    expect(hasVentureAccess(manager, VENTURE_B)).toBe(false);
    expect(hasVentureAccess(superAdmin, VENTURE_B)).toBe(true);
  });
});

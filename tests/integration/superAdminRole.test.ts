import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { setGlobalRole, createPerson } from "@/modules/people/person.service";
import type { Actor } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";

/**
 * Super Admin promotion rules (§7).
 *
 * These guard the account that controls everything else, so they run against a
 * real database: the "last active Super Admin" checks are count queries, and a
 * mocked Prisma would return whatever the test wanted them to.
 */

const SUFFIX = `sa${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

async function makeUser(
  label: string,
  globalRole: "SUPER_ADMIN" | "USER" = "USER",
  accountStatus: "ACTIVE" | "PENDING" | "SUSPENDED" = "ACTIVE",
) {
  const user = await prisma.user.create({
    data: {
      name: label,
      email: `${label}-${SUFFIX}@test.local`,
      globalRole,
      accountStatus,
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  return { userId: user.id, personId: user.person!.id };
}

function actorFor(
  userId: string,
  personId: string,
  globalRole: "SUPER_ADMIN" | "USER" = "USER",
): Actor {
  return {
    userId,
    personId,
    name: "Test",
    email: "t@test.local",
    globalRole,
    accountStatus: "ACTIVE",
    memberships: new Map(),
  };
}

beforeAll(async () => {
  const owner = await makeUser("owner", "SUPER_ADMIN");
  const second = await makeUser("second", "SUPER_ADMIN");
  const regular = await makeUser("regular");
  const pending = await makeUser("pendinguser", "USER", "PENDING");

  ids.ownerUser = owner.userId;
  ids.ownerPerson = owner.personId;
  ids.secondUser = second.userId;
  ids.secondPerson = second.personId;
  ids.regularUser = regular.userId;
  ids.regularPerson = regular.personId;
  ids.pendingUser = pending.userId;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: Object.values(ids) } },
  });
  await prisma.person.deleteMany({ where: { user: { email: { contains: SUFFIX } } } });
  await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
});

describe("Super Admin promotion", () => {
  it("lets a Super Admin promote an active user", async () => {
    const actor = actorFor(ids.ownerUser, ids.ownerPerson, "SUPER_ADMIN");
    const after = await setGlobalRole(actor, {
      userId: ids.regularUser,
      globalRole: "SUPER_ADMIN",
    });
    expect(after.globalRole).toBe("SUPER_ADMIN");

    // Put it back so later assertions start from a known state.
    await setGlobalRole(actor, { userId: ids.regularUser, globalRole: "USER" });
  });

  it("refuses to promote a non-active account", async () => {
    const actor = actorFor(ids.ownerUser, ids.ownerPerson, "SUPER_ADMIN");
    await expect(
      setGlobalRole(actor, { userId: ids.pendingUser, globalRole: "SUPER_ADMIN" }),
    ).rejects.toSatisfy((e) => isAppError(e) && e.code === "CONFLICT");
  });

  it("refuses promotion by a regular user", async () => {
    const actor = actorFor(ids.regularUser, ids.regularPerson, "USER");
    await expect(
      setGlobalRole(actor, { userId: ids.regularUser, globalRole: "SUPER_ADMIN" }),
    ).rejects.toSatisfy((e) => isAppError(e) && e.code === "FORBIDDEN");
  });

  it("writes an audit row naming who made the change", async () => {
    const actor = actorFor(ids.ownerUser, ids.ownerPerson, "SUPER_ADMIN");
    await setGlobalRole(actor, {
      userId: ids.regularUser,
      globalRole: "SUPER_ADMIN",
      reason: "Test promotion",
    });

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: ids.regularUser, action: "ROLE_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.actorUserId).toBe(ids.ownerUser);
    expect(entry?.reason).toBe("Test promotion");

    await setGlobalRole(actor, { userId: ids.regularUser, globalRole: "USER" });
  });
});

describe("the system always keeps a Super Admin", () => {
  it("refuses to demote the last active one", async () => {
    const actor = actorFor(ids.ownerUser, ids.ownerPerson, "SUPER_ADMIN");

    // Reduce to a single Super Admin, then try to remove that one too.
    await setGlobalRole(actor, { userId: ids.secondUser, globalRole: "USER" });

    await expect(
      setGlobalRole(actor, { userId: ids.ownerUser, globalRole: "USER" }),
    ).rejects.toSatisfy((e) => isAppError(e) && e.code === "CONFLICT");

    const still = await prisma.user.findUnique({ where: { id: ids.ownerUser } });
    expect(still?.globalRole).toBe("SUPER_ADMIN");

    await setGlobalRole(actor, { userId: ids.secondUser, globalRole: "SUPER_ADMIN" });
  });

  it("allows demotion while another active Super Admin remains", async () => {
    const actor = actorFor(ids.ownerUser, ids.ownerPerson, "SUPER_ADMIN");
    const after = await setGlobalRole(actor, {
      userId: ids.secondUser,
      globalRole: "USER",
    });
    expect(after.globalRole).toBe("USER");

    await setGlobalRole(actor, { userId: ids.secondUser, globalRole: "SUPER_ADMIN" });
  });

  it("does not count a suspended Super Admin as cover for demoting the last active one", async () => {
    const actor = actorFor(ids.ownerUser, ids.ownerPerson, "SUPER_ADMIN");
    await prisma.user.update({
      where: { id: ids.secondUser },
      data: { accountStatus: "SUSPENDED" },
    });

    await expect(
      setGlobalRole(actor, { userId: ids.ownerUser, globalRole: "USER" }),
    ).rejects.toSatisfy((e) => isAppError(e) && e.code === "CONFLICT");

    await prisma.user.update({
      where: { id: ids.secondUser },
      data: { accountStatus: "ACTIVE" },
    });
  });
});

describe("inviting straight to Super Admin", () => {
  it("is refused for a non Super Admin", async () => {
    const actor = actorFor(ids.regularUser, ids.regularPerson, "USER");
    await expect(
      createPerson(actor, {
        name: "Sneaky",
        email: `sneaky-${SUFFIX}@test.local`,
        employmentType: "EMPLOYEE",
        ventureIds: [],
        accessRole: "MEMBER",
        makeSuperAdmin: true,
      }),
    ).rejects.toSatisfy((e) => isAppError(e) && e.code === "FORBIDDEN");
  });

  it("creates a PENDING Super Admin who cannot act until they accept", async () => {
    const actor = actorFor(ids.ownerUser, ids.ownerPerson, "SUPER_ADMIN");
    const created = await createPerson(actor, {
      name: "Invited Admin",
      email: `invited-${SUFFIX}@test.local`,
      employmentType: "EMPLOYEE",
      ventureIds: [],
      accessRole: "MEMBER",
      makeSuperAdmin: true,
    });

    const user = await prisma.user.findUnique({ where: { id: created.userId } });
    expect(user?.globalRole).toBe("SUPER_ADMIN");
    // No password is set by the inviter, so the account cannot be used yet.
    expect(user?.accountStatus).toBe("PENDING");
    expect(user?.passwordHash).toBeNull();
  });

  it("defaults to a regular user when the flag is absent", async () => {
    const actor = actorFor(ids.ownerUser, ids.ownerPerson, "SUPER_ADMIN");
    const created = await createPerson(actor, {
      name: "Normal Hire",
      email: `normal-${SUFFIX}@test.local`,
      employmentType: "EMPLOYEE",
      ventureIds: [],
      accessRole: "MEMBER",
    });

    const user = await prisma.user.findUnique({ where: { id: created.userId } });
    expect(user?.globalRole).toBe("USER");
  });
});

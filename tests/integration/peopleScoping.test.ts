import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import { listPeople, getPerson, setMembership } from "@/modules/people/person.service";
import { listVentures } from "@/modules/ventures/venture.service";
import type { Actor } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";

/**
 * Cross-venture isolation tests.
 *
 * These verify the claim that matters most in Phase 2: a manager of one venture
 * cannot see people or ventures belonging to another. They run against a real
 * database because a mocked Prisma would happily accept a query with no venture
 * filter — precisely the bug being guarded against.
 */

const SUFFIX = `scope${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

async function makePerson(label: string, name: string) {
  const user = await prisma.user.create({
    data: {
      name,
      email: `${label}-${SUFFIX}@test.local`,
      accountStatus: "ACTIVE",
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  return { userId: user.id, personId: user.person!.id };
}

function actorFor(
  userId: string,
  personId: string,
  memberships: [string, "MANAGER" | "MEMBER"][],
  globalRole: "SUPER_ADMIN" | "USER" = "USER",
): Actor {
  return {
    userId,
    personId,
    name: "Test",
    email: "t@test.local",
    globalRole,
    accountStatus: "ACTIVE",
    memberships: new Map(memberships),
  };
}

beforeAll(async () => {
  const alpha = await prisma.venture.create({
    data: { name: `Alpha ${SUFFIX}`, slug: `alpha-${SUFFIX}` },
  });
  const beta = await prisma.venture.create({
    data: { name: `Beta ${SUFFIX}`, slug: `beta-${SUFFIX}` },
  });
  ids.alpha = alpha.id;
  ids.beta = beta.id;

  const mgr = await makePerson("mgr", `Alpha Manager ${SUFFIX}`);
  const alphaStaff = await makePerson("astaff", `Alpha Staff ${SUFFIX}`);
  const betaStaff = await makePerson("bstaff", `Beta Staff ${SUFFIX}`);
  const admin = await makePerson("admin", `Admin ${SUFFIX}`);

  Object.assign(ids, {
    mgrUser: mgr.userId,
    mgrPerson: mgr.personId,
    alphaStaffPerson: alphaStaff.personId,
    betaStaffPerson: betaStaff.personId,
    adminUser: admin.userId,
    adminPerson: admin.personId,
  });

  await prisma.ventureMembership.createMany({
    data: [
      { ventureId: alpha.id, personId: mgr.personId, accessRole: "MANAGER" },
      { ventureId: alpha.id, personId: alphaStaff.personId, accessRole: "MEMBER" },
      { ventureId: beta.id, personId: betaStaff.personId, accessRole: "MEMBER" },
    ],
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: Object.values(ids) } },
  });
  await prisma.ventureMembership.deleteMany({
    where: { ventureId: { in: [ids.alpha, ids.beta] } },
  });
  const personIds = [ids.mgrPerson, ids.alphaStaffPerson, ids.betaStaffPerson, ids.adminPerson];
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.user.deleteMany({
    where: { id: { in: [ids.mgrUser, ids.adminUser] } },
  });
  await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
  await prisma.venture.deleteMany({ where: { id: { in: [ids.alpha, ids.beta] } } });
  await prisma.$disconnect();
});

describe("venture isolation (§6)", () => {
  it("shows a manager only their own venture", async () => {
    const manager = actorFor(ids.mgrUser, ids.mgrPerson, [[ids.alpha, "MANAGER"]]);
    const ventures = await listVentures(manager);
    const names = ventures.map((v) => v.id);

    expect(names).toContain(ids.alpha);
    expect(names).not.toContain(ids.beta);
  });

  it("shows a Super Admin every venture", async () => {
    const admin = actorFor(ids.adminUser, ids.adminPerson, [], "SUPER_ADMIN");
    const ventures = await listVentures(admin);
    const vids = ventures.map((v) => v.id);

    expect(vids).toContain(ids.alpha);
    expect(vids).toContain(ids.beta);
  });

  it("hides people from other ventures in the directory", async () => {
    const manager = actorFor(ids.mgrUser, ids.mgrPerson, [[ids.alpha, "MANAGER"]]);
    const people = await listPeople(manager);
    const personIds = people.map((p) => p.personId);

    expect(personIds).toContain(ids.alphaStaffPerson);
    expect(personIds).not.toContain(ids.betaStaffPerson);
  });

  it("refuses to open a person from another venture", async () => {
    const manager = actorFor(ids.mgrUser, ids.mgrPerson, [[ids.alpha, "MANAGER"]]);

    // Returns NOT_FOUND rather than FORBIDDEN, so the caller cannot confirm
    // that the person exists at all.
    await expect(getPerson(manager, ids.betaStaffPerson)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "NOT_FOUND",
    );
  });

  it("cannot widen scope by passing another venture id as a filter", async () => {
    const manager = actorFor(ids.mgrUser, ids.mgrPerson, [[ids.alpha, "MANAGER"]]);

    // Explicitly asking for Beta must intersect with the manager scope and
    // yield nothing, not silently switch ventures.
    const people = await listPeople(manager, { ventureId: ids.beta });
    expect(people.map((p) => p.personId)).not.toContain(ids.betaStaffPerson);
    expect(people).toHaveLength(0);
  });

  it("lets a user with no memberships see nothing", async () => {
    const nobody = actorFor("no-user", "no-person", []);
    expect(await listVentures(nobody)).toHaveLength(0);
    expect(await listPeople(nobody)).toHaveLength(0);
  });

  it("lets a Super Admin see people across all ventures", async () => {
    const admin = actorFor(ids.adminUser, ids.adminPerson, [], "SUPER_ADMIN");
    const people = await listPeople(admin);
    const personIds = people.map((p) => p.personId);

    expect(personIds).toContain(ids.alphaStaffPerson);
    expect(personIds).toContain(ids.betaStaffPerson);
  });
});

describe("membership changes are audited (§46)", () => {
  it("writes an audit row when a membership is added", async () => {
    const admin = actorFor(ids.adminUser, ids.adminPerson, [], "SUPER_ADMIN");

    const result = await setMembership(admin, {
      personId: ids.betaStaffPerson,
      ventureId: ids.alpha,
      accessRole: "MEMBER",
    });

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "VentureMembership", entityId: result.id },
    });

    expect(audit).not.toBeNull();
    expect(audit!.action).toBe("MEMBERSHIP_ADDED");
    expect(audit!.actorUserId).toBe(ids.adminUser);
  });
});

describe("salary safety (§52)", () => {
  it("never returns compensation fields from the people directory", async () => {
    const admin = actorFor(ids.adminUser, ids.adminPerson, [], "SUPER_ADMIN");
    const people = await listPeople(admin);
    const serialized = JSON.stringify(people);

    // Even for a Super Admin, the directory endpoint must not carry pay data —
    // compensation lives behind its own module (§52).
    expect(serialized).not.toMatch(/"rate"/);
    expect(serialized).not.toMatch(/"computedPay"/);
    expect(serialized).not.toMatch(/compensationAgreements/);
    expect(serialized).not.toMatch(/passwordHash/);
  });
});

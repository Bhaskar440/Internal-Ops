import crypto from "node:crypto";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";
import { conflict, forbidden, notFound } from "@/lib/errors/appError";
import { visibleVentureIds } from "@/lib/permissions/scopes";
import { isSuperAdmin, type Actor } from "@/lib/permissions/types";
import type {
  CreatePersonInput,
  SetAccountStatusInput,
  SetMembershipInput,
  UpdatePersonInput,
} from "./person.schema";

/**
 * People / HR directory (§11, §12).
 *
 * SALARY SAFETY (§52): the selects in this file deliberately contain NO
 * compensation fields. Pay data is reachable only through the dedicated
 * compensation module, which is Super Admin only. Nothing here can leak a rate
 * because nothing here ever selects one.
 */

const personSelect = {
  id: true,
  employmentType: true,
  startDate: true,
  endDate: true,
  archivedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      globalRole: true,
      accountStatus: true,
    },
  },
  memberships: {
    where: { leftAt: null },
    select: {
      accessRole: true,
      venture: { select: { id: true, name: true, slug: true, tagColor: true } },
    },
  },
} as const;

export type PersonSummary = {
  personId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  employmentType: string;
  accountStatus: string;
  globalRole: string;
  startDate: Date | null;
  endDate: Date | null;
  archived: boolean;
  ventures: { id: string; name: string; slug: string; tagColor: string; accessRole: string }[];
};

type PersonRow = {
  id: string;
  employmentType: string;
  startDate: Date | null;
  endDate: Date | null;
  archivedAt: Date | null;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    globalRole: string;
    accountStatus: string;
  };
  memberships: {
    accessRole: string;
    venture: { id: string; name: string; slug: string; tagColor: string };
  }[];
};

function toSummary(p: PersonRow): PersonSummary {
  return {
    personId: p.id,
    userId: p.user.id,
    name: p.user.name,
    email: p.user.email,
    phone: p.user.phone,
    employmentType: p.employmentType,
    accountStatus: p.user.accountStatus,
    globalRole: p.user.globalRole,
    startDate: p.startDate,
    endDate: p.endDate,
    archived: p.archivedAt !== null,
    ventures: p.memberships.map((m) => ({
      id: m.venture.id,
      name: m.venture.name,
      slug: m.venture.slug,
      tagColor: m.venture.tagColor,
      accessRole: m.accessRole,
    })),
  };
}

/**
 * Directory listing.
 *
 * A Super Admin sees everyone. Anyone else sees only people who share one of
 * their ventures — the venture-limited HR directory of §6.
 */
export async function listPeople(
  actor: Actor,
  opts: { search?: string; ventureId?: string; includeArchived?: boolean } = {},
): Promise<PersonSummary[]> {
  const scopeIds = visibleVentureIds(actor);

  // Non-admins are restricted to their own ventures; an explicit ventureId
  // filter must intersect with that, never widen it.
  let membershipVentureFilter: string[] | undefined;
  if (scopeIds === undefined) {
    membershipVentureFilter = opts.ventureId ? [opts.ventureId] : undefined;
  } else if (opts.ventureId) {
    membershipVentureFilter = scopeIds.includes(opts.ventureId) ? [opts.ventureId] : [];
  } else {
    membershipVentureFilter = scopeIds;
  }

  const people = await prisma.person.findMany({
    where: {
      ...(opts.includeArchived ? {} : { archivedAt: null }),
      ...(membershipVentureFilter === undefined
        ? {}
        : {
            memberships: {
              some: { leftAt: null, ventureId: { in: membershipVentureFilter } },
            },
          }),
      ...(opts.search
        ? {
            user: {
              OR: [
                { name: { contains: opts.search, mode: "insensitive" as const } },
                { email: { contains: opts.search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    select: personSelect,
    orderBy: { user: { name: "asc" } },
    take: 200,
  });

  return people.map((p) => toSummary(p as PersonRow));
}

/** People awaiting approval (§7 freelancer self-registration). */
export async function listPendingRegistrations(actor: Actor): Promise<PersonSummary[]> {
  if (!isSuperAdmin(actor)) throw forbidden();
  const people = await prisma.person.findMany({
    where: { archivedAt: null, user: { accountStatus: "PENDING" } },
    select: personSelect,
    orderBy: { createdAt: "asc" },
  });
  return people.map((p) => toSummary(p as PersonRow));
}

export async function getPerson(actor: Actor, personId: string): Promise<PersonSummary> {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: personSelect });
  if (!person) throw notFound("Person");

  // A non-admin may only view someone who shares one of their ventures, or
  // their own profile (§6 "HR directory: own profile").
  if (!isSuperAdmin(actor)) {
    const mine = visibleVentureIds(actor) ?? [];
    const shares = person.memberships.some((m) => mine.includes(m.venture.id));
    const isSelf = person.id === actor.personId;
    if (!shares && !isSelf) throw notFound("Person");
  }

  return toSummary(person as PersonRow);
}

/**
 * Create a person (§7 admin-created employee).
 *
 * Creates the User + Person + memberships in one transaction, in PENDING state
 * with an invitation token. The person sets their own password via the invite
 * link; the admin never chooses it, and a self-registered person can never set
 * their own pay rate.
 */
export async function createPerson(actor: Actor, input: CreatePersonInput) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw conflict(`Someone with the email ${input.email} already exists.`);

  // Only ventures the actor can actually assign into.
  const allowed = visibleVentureIds(actor);
  const ventureIds =
    allowed === undefined ? input.ventureIds : input.ventureIds.filter((v) => allowed.includes(v));

  const inviteToken = crypto.randomBytes(32).toString("base64url");
  const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        globalRole: "USER",
        accountStatus: "PENDING",
        person: {
          create: {
            employmentType: input.employmentType,
            startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : undefined,
          },
        },
      },
      select: { id: true, name: true, email: true, person: { select: { id: true } } },
    });

    const personId = user.person!.id;

    for (const ventureId of ventureIds) {
      await tx.ventureMembership.create({
        data: { ventureId, personId, accessRole: input.accessRole },
      });
    }

    // Invitation token, stored in the Auth.js verification table.
    await tx.verificationToken.create({
      data: { identifier: user.email, token: inviteToken, expires: inviteExpires },
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PERSON_CREATED",
      entityType: "Person",
      entityId: personId,
      after: {
        name: user.name,
        email: user.email,
        employmentType: input.employmentType,
        ventureIds,
        accessRole: input.accessRole,
      },
    });

    return { personId, userId: user.id, email: user.email, inviteToken };
  });
}

/** Add or change a venture membership (§11). */
export async function setMembership(actor: Actor, input: SetMembershipInput) {
  const person = await prisma.person.findUnique({
    where: { id: input.personId },
    select: { id: true },
  });
  if (!person) throw notFound("Person");

  const existing = await prisma.ventureMembership.findUnique({
    where: { ventureId_personId: { ventureId: input.ventureId, personId: input.personId } },
    select: { id: true, accessRole: true, leftAt: true },
  });

  return prisma.$transaction(async (tx) => {
    if (existing) {
      const after = await tx.ventureMembership.update({
        where: { id: existing.id },
        data: { accessRole: input.accessRole, leftAt: null },
        select: { id: true, accessRole: true, ventureId: true, personId: true },
      });
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action:
          existing.accessRole === input.accessRole
            ? "MEMBERSHIP_ADDED"
            : "MEMBERSHIP_ROLE_CHANGED",
        entityType: "VentureMembership",
        entityId: after.id,
        before: { accessRole: existing.accessRole, ended: existing.leftAt !== null },
        after: { accessRole: after.accessRole },
      });
      return after;
    }

    const created = await tx.ventureMembership.create({
      data: {
        ventureId: input.ventureId,
        personId: input.personId,
        accessRole: input.accessRole,
      },
      select: { id: true, accessRole: true, ventureId: true, personId: true },
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "MEMBERSHIP_ADDED",
      entityType: "VentureMembership",
      entityId: created.id,
      after: { ventureId: input.ventureId, accessRole: input.accessRole },
    });

    return created;
  });
}

/** End a membership. Soft — `leftAt` is set so history survives (§47). */
export async function removeMembership(actor: Actor, personId: string, ventureId: string) {
  const existing = await prisma.ventureMembership.findUnique({
    where: { ventureId_personId: { ventureId, personId } },
    select: { id: true, accessRole: true, leftAt: true },
  });
  if (!existing || existing.leftAt) throw notFound("Membership");

  return prisma.$transaction(async (tx) => {
    const after = await tx.ventureMembership.update({
      where: { id: existing.id },
      data: { leftAt: new Date() },
      select: { id: true },
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "MEMBERSHIP_REMOVED",
      entityType: "VentureMembership",
      entityId: existing.id,
      before: { accessRole: existing.accessRole },
    });
    return after;
  });
}

/**
 * Change an account status (§7 lifecycle).
 *
 * Guards against an admin locking themselves out, and records who did it.
 */
export async function setAccountStatus(actor: Actor, input: SetAccountStatusInput) {
  if (input.userId === actor.userId && input.status !== "ACTIVE") {
    throw conflict("You cannot deactivate your own account.");
  }

  const before = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true, accountStatus: true, globalRole: true },
  });
  if (!before) throw notFound("User");
  if (before.accountStatus === input.status) return before;

  // Never leave the system with no active Super Admin.
  if (before.globalRole === "SUPER_ADMIN" && input.status !== "ACTIVE") {
    const others = await prisma.user.count({
      where: { globalRole: "SUPER_ADMIN", accountStatus: "ACTIVE", id: { not: input.userId } },
    });
    if (others === 0) {
      throw conflict("This is the last active Super Admin; promote another before deactivating.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const after = await tx.user.update({
      where: { id: input.userId },
      data: { accountStatus: input.status },
      select: { id: true, name: true, email: true, accountStatus: true, globalRole: true },
    });

    const action =
      input.status === "ACTIVE"
        ? before.accountStatus === "PENDING"
          ? ("REGISTRATION_APPROVED" as const)
          : ("PERSON_ACTIVATED" as const)
        : ("PERSON_DEACTIVATED" as const);

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action,
      entityType: "User",
      entityId: after.id,
      before: { accountStatus: before.accountStatus },
      after: { accountStatus: after.accountStatus },
      reason: input.reason,
    });

    return after;
  });
}

/** Update profile details. Never touches pay (§52). */
export async function updatePerson(actor: Actor, input: UpdatePersonInput) {
  const before = await prisma.person.findUnique({
    where: { id: input.personId },
    select: personSelect,
  });
  if (!before) throw notFound("Person");

  return prisma.$transaction(async (tx) => {
    if (input.name !== undefined || input.phone !== undefined) {
      await tx.user.update({
        where: { id: before.user.id },
        data: { name: input.name, phone: input.phone },
      });
    }

    const after = await tx.person.update({
      where: { id: input.personId },
      data: {
        employmentType: input.employmentType,
        startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : undefined,
        endDate: input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : undefined,
      },
      select: personSelect,
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PERSON_UPDATED",
      entityType: "Person",
      entityId: input.personId,
      before: toSummary(before as PersonRow),
      after: toSummary(after as PersonRow),
    });

    return toSummary(after as PersonRow);
  });
}

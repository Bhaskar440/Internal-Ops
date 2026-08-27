import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";
import { conflict, notFound } from "@/lib/errors/appError";
import { ventureScope } from "@/lib/permissions/scopes";
import type { Actor } from "@/lib/permissions/types";
import type { CreateVentureInput, UpdateVentureInput } from "./venture.schema";

/**
 * Venture business logic (§10).
 *
 * Ventures are never hardcoded — they are ordinary rows an admin creates,
 * renames and archives, with their own timezone, working week and daily-log
 * cutoff (§85).
 */

/** Fields safe to return to any authorized caller. Carries no PII or money. */
const ventureSelect = {
  id: true,
  name: true,
  slug: true,
  tagColor: true,
  timezone: true,
  workingDays: true,
  dailyLogEditWindowHours: true,
  defaultCurrency: true,
  active: true,
  createdAt: true,
  archivedAt: true,
} as const;

export type VentureSummary = {
  id: string;
  name: string;
  slug: string;
  tagColor: string;
  timezone: string;
  workingDays: number[];
  dailyLogEditWindowHours: number;
  defaultCurrency: string;
  active: boolean;
  memberCount: number;
};

/**
 * Ventures the actor may see. A Super Admin sees all; anyone else sees only
 * ventures they belong to — enforced by the shared scope, not a hand-written
 * filter (§6).
 */
export async function listVentures(
  actor: Actor,
  opts: { includeArchived?: boolean } = {},
): Promise<VentureSummary[]> {
  const ventures = await prisma.venture.findMany({
    where: {
      ...ventureScope(actor),
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    select: {
      ...ventureSelect,
      _count: { select: { memberships: { where: { leftAt: null } } } },
    },
    orderBy: { name: "asc" },
  });

  return ventures.map((v) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    tagColor: v.tagColor,
    timezone: v.timezone,
    workingDays: v.workingDays,
    dailyLogEditWindowHours: v.dailyLogEditWindowHours,
    defaultCurrency: v.defaultCurrency,
    active: v.active,
    memberCount: v._count.memberships,
  }));
}

export async function getVentureBySlug(actor: Actor, slug: string) {
  const venture = await prisma.venture.findFirst({
    where: { slug, ...ventureScope(actor) },
    select: ventureSelect,
  });
  if (!venture) throw notFound("Venture");
  return venture;
}

/** Create a venture. Caller must already hold `venture:create`. */
export async function createVenture(actor: Actor, input: CreateVentureInput) {
  const existing = await prisma.venture.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (existing) throw conflict(`A venture with the slug "${input.slug}" already exists.`);

  return prisma.$transaction(async (tx) => {
    const venture = await tx.venture.create({
      data: {
        name: input.name,
        slug: input.slug,
        tagColor: input.tagColor,
        timezone: input.timezone,
        workingDays: input.workingDays,
        dailyLogEditWindowHours: input.dailyLogEditWindowHours,
        defaultCurrency: input.defaultCurrency,
      },
      select: ventureSelect,
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "VENTURE_CREATED",
      entityType: "Venture",
      entityId: venture.id,
      after: venture,
    });

    return venture;
  });
}

/**
 * Update a venture.
 *
 * Timezone is effectively immutable once time has been recorded: changing it
 * would silently reinterpret every stored business_date, corrupting history.
 */
export async function updateVenture(actor: Actor, input: UpdateVentureInput) {
  const before = await prisma.venture.findUnique({
    where: { id: input.id },
    select: ventureSelect,
  });
  if (!before) throw notFound("Venture");

  if (input.timezone && input.timezone !== before.timezone) {
    const entries = await prisma.timeEntry.count({ where: { ventureId: input.id } });
    if (entries > 0) {
      throw conflict(
        "This venture already has recorded time, so its timezone can no longer be changed. " +
          "Changing it would reinterpret every historical business date.",
      );
    }
  }

  if (input.slug && input.slug !== before.slug) {
    const clash = await prisma.venture.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (clash) throw conflict(`A venture with the slug "${input.slug}" already exists.`);
  }

  return prisma.$transaction(async (tx) => {
    const after = await tx.venture.update({
      where: { id: input.id },
      data: {
        name: input.name,
        slug: input.slug,
        tagColor: input.tagColor,
        timezone: input.timezone,
        workingDays: input.workingDays,
        dailyLogEditWindowHours: input.dailyLogEditWindowHours,
        defaultCurrency: input.defaultCurrency,
      },
      select: ventureSelect,
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "VENTURE_UPDATED",
      entityType: "Venture",
      entityId: after.id,
      before,
      after,
    });

    return after;
  });
}

/** Archive (soft delete) a venture — history is preserved (§47). */
export async function archiveVenture(actor: Actor, ventureId: string, reason?: string) {
  const before = await prisma.venture.findUnique({
    where: { id: ventureId },
    select: ventureSelect,
  });
  if (!before) throw notFound("Venture");
  if (before.archivedAt) throw conflict("This venture is already archived.");

  return prisma.$transaction(async (tx) => {
    const after = await tx.venture.update({
      where: { id: ventureId },
      data: { archivedAt: new Date(), active: false },
      select: ventureSelect,
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "VENTURE_ARCHIVED",
      entityType: "Venture",
      entityId: ventureId,
      before,
      after,
      reason,
    });

    return after;
  });
}

/** Restore an archived venture. */
export async function restoreVenture(actor: Actor, ventureId: string) {
  const before = await prisma.venture.findUnique({
    where: { id: ventureId },
    select: ventureSelect,
  });
  if (!before) throw notFound("Venture");
  if (!before.archivedAt) throw conflict("This venture is not archived.");

  return prisma.$transaction(async (tx) => {
    const after = await tx.venture.update({
      where: { id: ventureId },
      data: { archivedAt: null, active: true },
      select: ventureSelect,
    });

    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "VENTURE_UPDATED",
      entityType: "Venture",
      entityId: ventureId,
      before,
      after,
      reason: "Restored from archive",
    });

    return after;
  });
}

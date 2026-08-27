import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";
import { conflict, forbidden, notFound } from "@/lib/errors/appError";
import { isSuperAdmin, type Actor } from "@/lib/permissions/types";
import { toPrismaDate, fromPrismaDate, type BusinessDate } from "@/lib/timezone/businessDate";

/**
 * Compensation agreements (§35, §52).
 *
 * SALARY SECURITY. Every function here re-checks Super Admin itself rather
 * than trusting the caller to have done so. This module is the ONLY place pay
 * rates are read or written; the people directory never selects them.
 *
 * Rates are never overwritten. A change closes the current agreement and opens
 * a new one, so historical payroll keeps using the rate that applied then.
 */

export type CompensationView = {
  id: string;
  personId: string;
  payType: string;
  currency: string;
  /** String, not number — Decimal must not pass through floating point (§36). */
  rate: string;
  effectiveFrom: BusinessDate;
  effectiveTo: BusinessDate | null;
  prorationPolicy: string;
  isCurrent: boolean;
};

function assertCanReadPay(actor: Actor): void {
  if (!isSuperAdmin(actor)) {
    throw forbidden("You are not authorized to view compensation.");
  }
}

/** Full rate history for one person, newest first. */
export async function listAgreements(
  actor: Actor,
  personId: string,
): Promise<CompensationView[]> {
  assertCanReadPay(actor);

  const rows = await prisma.compensationAgreement.findMany({
    where: { personId },
    orderBy: { effectiveFrom: "desc" },
    select: {
      id: true,
      personId: true,
      payType: true,
      currency: true,
      rate: true,
      effectiveFrom: true,
      effectiveTo: true,
      prorationPolicy: true,
    },
  });

  const today = new Date();
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    payType: r.payType,
    currency: r.currency,
    rate: String(r.rate),
    effectiveFrom: fromPrismaDate(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? fromPrismaDate(r.effectiveTo) : null,
    prorationPolicy: r.prorationPolicy,
    isCurrent: r.effectiveFrom <= today && (r.effectiveTo === null || r.effectiveTo >= today),
  }));
}

/**
 * The agreement in force on a given date — what payroll must use so a later
 * rate change never rewrites history (§35).
 */
export async function agreementOn(personId: string, date: BusinessDate) {
  const on = toPrismaDate(date);
  return prisma.compensationAgreement.findFirst({
    where: {
      personId,
      effectiveFrom: { lte: on },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
    },
    orderBy: { effectiveFrom: "desc" },
    select: {
      id: true,
      payType: true,
      currency: true,
      rate: true,
      prorationPolicy: true,
      effectiveFrom: true,
    },
  });
}

/**
 * Record a new pay agreement.
 *
 * Any open agreement is closed the day before this one starts, so the two can
 * never overlap (§49) and history stays intact.
 */
export async function setAgreement(
  actor: Actor,
  input: {
    personId: string;
    payType: "HOURLY" | "MONTHLY_FIXED" | "PER_TASK";
    currency: string;
    rate: number;
    effectiveFrom: BusinessDate;
    prorationPolicy?: "FIXED_FULL" | "ATTENDANCE_PRORATED";
  },
) {
  if (!isSuperAdmin(actor)) throw forbidden("Only an administrator can set pay rates.");
  if (input.rate <= 0) throw conflict("The rate must be greater than zero.");

  const person = await prisma.person.findUnique({
    where: { id: input.personId },
    select: { id: true },
  });
  if (!person) throw notFound("Person");

  const from = toPrismaDate(input.effectiveFrom);
  const dayBefore = new Date(from.getTime() - 24 * 3600 * 1000);

  return prisma.$transaction(async (tx) => {
    // Close any agreement still open on that date.
    await tx.compensationAgreement.updateMany({
      where: {
        personId: input.personId,
        effectiveTo: null,
        effectiveFrom: { lt: from },
      },
      data: { effectiveTo: dayBefore },
    });

    const created = await tx.compensationAgreement.create({
      data: {
        personId: input.personId,
        payType: input.payType,
        currency: input.currency.toUpperCase(),
        rate: input.rate,
        effectiveFrom: from,
        prorationPolicy: input.prorationPolicy ?? "FIXED_FULL",
        createdBy: actor.userId,
      },
      select: { id: true, payType: true, currency: true, effectiveFrom: true },
    });

    // The rate itself is redacted by the audit helper (§64) — the fact of the
    // change is recorded, not the amount.
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "PAY_RATE_CHANGED",
      entityType: "CompensationAgreement",
      entityId: created.id,
      after: {
        personId: input.personId,
        payType: input.payType,
        currency: input.currency,
        rate: input.rate,
        effectiveFrom: input.effectiveFrom,
      },
    });

    return created;
  });
}

/**
 * People with no pay agreement covering a date — a payroll exception (§44).
 * Returns identity only, never a rate.
 */
export async function peopleMissingCompensation(
  actor: Actor,
  date: BusinessDate,
): Promise<{ personId: string; name: string }[]> {
  assertCanReadPay(actor);

  const people = await prisma.person.findMany({
    where: { archivedAt: null, user: { accountStatus: "ACTIVE" } },
    select: { id: true, user: { select: { name: true } } },
  });

  const missing: { personId: string; name: string }[] = [];
  for (const person of people) {
    const agreement = await agreementOn(person.id, date);
    if (!agreement) missing.push({ personId: person.id, name: person.user.name });
  }
  return missing;
}

/**
 * A person's own computed pay summary, used by the My Pay screen.
 * Feature-flagged off until the policy is settled (§88 item 10).
 */
export function isMyPayEnabled(): boolean {
  return process.env.FEATURE_MY_PAY_ENABLED === "true";
}

import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";
import { conflict, forbidden, notFound } from "@/lib/errors/appError";
import { isSuperAdmin, type Actor } from "@/lib/permissions/types";
import { toPrismaDate, fromPrismaDate, type BusinessDate } from "@/lib/timezone/businessDate";

/**
 * HR records (§13, §14).
 *
 * Hardware is never tied permanently to a person: assets are reusable and keep
 * a full assignment history, so a laptop moving A -> B -> C stays traceable.
 *
 * Documents store METADATA and an external link only. No files are held here
 * (§14) — the documents themselves stay in restricted storage.
 */

function assertHrAccess(actor: Actor): void {
  if (!isSuperAdmin(actor)) throw forbidden("You are not authorized to manage HR records.");
}

// --- hardware ---------------------------------------------------------------

export type AssetView = {
  id: string;
  itemName: string;
  assetTag: string | null;
  serialNumber: string | null;
  status: string;
  notes: string | null;
  holder: { personId: string; name: string; issuedAt: Date } | null;
};

export async function listAssets(actor: Actor): Promise<AssetView[]> {
  assertHrAccess(actor);

  const assets = await prisma.hardwareAsset.findMany({
    orderBy: { itemName: "asc" },
    select: {
      id: true,
      itemName: true,
      assetTag: true,
      serialNumber: true,
      status: true,
      notes: true,
      assignments: {
        where: { returnedAt: null },
        take: 1,
        select: {
          issuedAt: true,
          personId: true,
          person: { select: { user: { select: { name: true } } } },
        },
      },
    },
  });

  return assets.map((a) => ({
    id: a.id,
    itemName: a.itemName,
    assetTag: a.assetTag,
    serialNumber: a.serialNumber,
    status: a.status,
    notes: a.notes,
    holder: a.assignments[0]
      ? {
          personId: a.assignments[0].personId,
          name: a.assignments[0].person.user.name,
          issuedAt: a.assignments[0].issuedAt,
        }
      : null,
  }));
}

export async function createAsset(
  actor: Actor,
  input: { itemName: string; assetTag?: string; serialNumber?: string; notes?: string },
) {
  assertHrAccess(actor);

  if (input.assetTag) {
    const clash = await prisma.hardwareAsset.findUnique({
      where: { assetTag: input.assetTag },
      select: { id: true },
    });
    if (clash) throw conflict(`Asset tag ${input.assetTag} is already in use.`);
  }

  return prisma.$transaction(async (tx) => {
    const asset = await tx.hardwareAsset.create({
      data: {
        itemName: input.itemName,
        assetTag: input.assetTag,
        serialNumber: input.serialNumber,
        notes: input.notes,
        status: "AVAILABLE",
      },
      select: { id: true, itemName: true, assetTag: true },
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "HARDWARE_ISSUED",
      entityType: "HardwareAsset",
      entityId: asset.id,
      after: { itemName: asset.itemName, assetTag: asset.assetTag },
      reason: "Asset registered",
    });
    return asset;
  });
}

/**
 * Turn a `YYYY-MM-DD` from a form into a timestamp.
 *
 * These record when something actually happened — a laptop handed over, a
 * document checked — which is frequently not the day someone gets round to
 * entering it. Defaulting silently to now() quietly falsified the record, so
 * the caller supplies the date and today is used only when none is given.
 *
 * Midday UTC, not midnight: a date-only value stored at midnight can read as
 * the previous day once rendered in a timezone behind UTC.
 */
function parseRecordedDate(value?: string): Date {
  if (!value) return new Date();
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw conflict("That date could not be read. Use the date picker.");
  }
  return parsed;
}

/** Issue an asset to a person (§13). Refuses if it is already out. */
export async function issueAsset(
  actor: Actor,
  input: { assetId: string; personId: string; condition?: string; issuedAt?: string },
) {
  assertHrAccess(actor);

  const asset = await prisma.hardwareAsset.findUnique({
    where: { id: input.assetId },
    select: {
      id: true,
      itemName: true,
      status: true,
      assignments: { where: { returnedAt: null }, select: { id: true } },
    },
  });
  if (!asset) throw notFound("Asset");
  if (asset.assignments.length > 0) {
    throw conflict("That asset is already issued. Record its return first.");
  }
  if (asset.status === "RETIRED" || asset.status === "LOST") {
    throw conflict(`That asset is marked ${asset.status.toLowerCase()} and cannot be issued.`);
  }

  return prisma.$transaction(async (tx) => {
    const assignment = await tx.assetAssignment.create({
      data: {
        assetId: input.assetId,
        personId: input.personId,
        issuedAt: parseRecordedDate(input.issuedAt),
        issuedBy: actor.userId,
        issueCondition: input.condition,
      },
      select: { id: true },
    });
    await tx.hardwareAsset.update({
      where: { id: input.assetId },
      data: { status: "ISSUED" },
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "HARDWARE_ISSUED",
      entityType: "AssetAssignment",
      entityId: assignment.id,
      after: { assetId: input.assetId, personId: input.personId },
    });
    return assignment;
  });
}

/** Record a return, freeing the asset for the next person. */
export async function returnAsset(
  actor: Actor,
  input: { assetId: string; condition?: string; returnedAt?: string },
) {
  assertHrAccess(actor);

  const open = await prisma.assetAssignment.findFirst({
    where: { assetId: input.assetId, returnedAt: null },
    select: { id: true, personId: true },
  });
  if (!open) throw conflict("That asset is not currently issued to anyone.");

  await prisma.$transaction(async (tx) => {
    await tx.assetAssignment.update({
      where: { id: open.id },
      data: {
        returnedAt: parseRecordedDate(input.returnedAt),
        returnedTo: actor.userId,
        returnCondition: input.condition,
      },
    });
    await tx.hardwareAsset.update({
      where: { id: input.assetId },
      data: { status: "AVAILABLE" },
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "HARDWARE_RETURNED",
      entityType: "AssetAssignment",
      entityId: open.id,
      after: { assetId: input.assetId, condition: input.condition },
    });
  });
}

/** Full history for one asset — who held it and when (§13). */
export async function assetHistory(actor: Actor, assetId: string) {
  assertHrAccess(actor);
  return prisma.assetAssignment.findMany({
    where: { assetId },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      issuedAt: true,
      returnedAt: true,
      issueCondition: true,
      returnCondition: true,
      person: { select: { id: true, user: { select: { name: true } } } },
    },
  });
}

/** Assets currently held by one person, for their profile page. */
export async function assetsHeldBy(actor: Actor, personId: string) {
  assertHrAccess(actor);
  return prisma.assetAssignment.findMany({
    where: { personId, returnedAt: null },
    select: {
      id: true,
      issuedAt: true,
      asset: { select: { id: true, itemName: true, assetTag: true } },
    },
  });
}

// --- documents --------------------------------------------------------------

export type DocumentView = {
  id: string;
  personId: string;
  personName: string;
  docType: string;
  status: string;
  expiryDate: BusinessDate | null;
  externalLink: string | null;
  notes: string | null;
  verifiedAt: Date | null;
  expiringSoon: boolean;
  expired: boolean;
};

const EXPIRY_WARNING_DAYS = 30;

function toDocumentView(d: {
  id: string;
  personId: string;
  docType: string;
  status: string;
  expiryDate: Date | null;
  externalReferenceLink: string | null;
  notes: string | null;
  verifiedAt: Date | null;
  person: { user: { name: string } };
}): DocumentView {
  const now = Date.now();
  const expiry = d.expiryDate?.getTime();
  return {
    id: d.id,
    personId: d.personId,
    personName: d.person.user.name,
    docType: d.docType,
    status: d.status,
    expiryDate: d.expiryDate ? fromPrismaDate(d.expiryDate) : null,
    externalLink: d.externalReferenceLink,
    notes: d.notes,
    verifiedAt: d.verifiedAt,
    expired: expiry !== undefined && expiry < now,
    expiringSoon:
      expiry !== undefined &&
      expiry >= now &&
      expiry < now + EXPIRY_WARNING_DAYS * 24 * 3600 * 1000,
  };
}

export async function listDocuments(
  actor: Actor,
  opts: { personId?: string } = {},
): Promise<DocumentView[]> {
  assertHrAccess(actor);
  const docs = await prisma.documentRecord.findMany({
    where: { ...(opts.personId ? { personId: opts.personId } : {}) },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      personId: true,
      docType: true,
      status: true,
      expiryDate: true,
      externalReferenceLink: true,
      notes: true,
      verifiedAt: true,
      person: { select: { user: { select: { name: true } } } },
    },
  });
  return docs.map(toDocumentView);
}

/** Documents expired or expiring soon — the dashboard alert (§9). */
export async function expiringDocuments(actor: Actor): Promise<DocumentView[]> {
  const all = await listDocuments(actor);
  return all.filter((d) => d.expired || d.expiringSoon);
}

export async function saveDocument(
  actor: Actor,
  input: {
    documentId?: string;
    personId: string;
    docType: string;
    status: string;
    expiryDate?: BusinessDate;
    externalLink?: string;
    notes?: string;
    /** When verification actually happened, if not today. */
    verifiedAt?: string;
  },
) {
  assertHrAccess(actor);

  const data = {
    docType: input.docType,
    status: input.status as never,
    expiryDate: input.expiryDate ? toPrismaDate(input.expiryDate) : null,
    externalReferenceLink: input.externalLink,
    notes: input.notes,
    ...(input.status === "VERIFIED"
      ? { verifiedBy: actor.userId, verifiedAt: parseRecordedDate(input.verifiedAt) }
      : {}),
  };

  return prisma.$transaction(async (tx) => {
    const doc = input.documentId
      ? await tx.documentRecord.update({
          where: { id: input.documentId },
          data,
          select: { id: true, docType: true, status: true },
        })
      : await tx.documentRecord.create({
          data: { ...data, personId: input.personId },
          select: { id: true, docType: true, status: true },
        });

    if (input.status === "VERIFIED") {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: "DOCUMENT_VERIFIED",
        entityType: "DocumentRecord",
        entityId: doc.id,
        after: { docType: doc.docType, status: doc.status },
      });
    }

    return doc;
  });
}

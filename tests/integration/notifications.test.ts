import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";
import {
  notify,
  listMyNotifications,
  unreadCount,
  markRead,
  markAllRead,
  generateScheduledNotifications,
  pruneNotifications,
} from "@/modules/notifications/notification.service";
import { createTask } from "@/modules/tasks/task.service";
import type { Actor, ActorWithVenture } from "@/lib/permissions/types";
import { isAppError } from "@/lib/errors/appError";
import { toPrismaDate } from "@/lib/timezone/businessDate";

/**
 * In-app notifications (§59).
 *
 * The properties that matter: a person only ever sees their OWN alerts, and a
 * recurring condition updates one row rather than piling up.
 */

const S = `ntf${Date.now().toString(36)}`;
const ids: Record<string, string> = {};

function actorFor(userKey: string, personKey: string): Actor {
  return {
    userId: ids[userKey],
    personId: ids[personKey],
    name: "Test",
    email: `${personKey}-${S}@test.local`,
    globalRole: "USER",
    accountStatus: "ACTIVE",
    memberships: new Map([[ids.venture, "MEMBER"]]),
  };
}

async function makePerson(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: `${label} ${S}`,
      email: `${label}-${S}@test.local`,
      accountStatus: "ACTIVE",
      person: { create: { employmentType: "EMPLOYEE" } },
    },
    include: { person: true },
  });
  ids[`${label}User`] = user.id;
  return user.person!.id;
}

beforeAll(async () => {
  const venture = await prisma.venture.create({
    data: { name: `Ntf ${S}`, slug: `ntf-${S}`, timezone: "Asia/Kolkata" },
  });
  ids.venture = venture.id;

  ids.alicePerson = await makePerson("alice");
  ids.bobPerson = await makePerson("bob");

  await prisma.ventureMembership.createMany({
    data: [
      { ventureId: venture.id, personId: ids.alicePerson, accessRole: "MANAGER" },
      { ventureId: venture.id, personId: ids.bobPerson, accessRole: "MEMBER" },
    ],
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { personId: { in: [ids.alicePerson, ids.bobPerson] } },
  });
  await prisma.taskStatusHistory.deleteMany({ where: { task: { ventureId: ids.venture } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { ventureId: ids.venture } } });
  await prisma.task.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.documentRecord.deleteMany({
    where: { personId: { in: [ids.alicePerson, ids.bobPerson] } },
  });
  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: [ids.aliceUser, ids.bobUser] } },
  });
  await prisma.ventureMembership.deleteMany({ where: { ventureId: ids.venture } });
  await prisma.person.deleteMany({
    where: { id: { in: [ids.alicePerson, ids.bobPerson] } },
  });
  await prisma.user.deleteMany({ where: { email: { contains: S } } });
  await prisma.venture.delete({ where: { id: ids.venture } });
  await prisma.$disconnect();
});

describe("notification privacy", () => {
  it("shows a person only their own notifications", async () => {
    await notify({
      personId: ids.alicePerson,
      kind: "TASK_ASSIGNED",
      title: "For Alice only",
      dedupeKey: `privacy:${S}:alice`,
    });
    await notify({
      personId: ids.bobPerson,
      kind: "TASK_ASSIGNED",
      title: "For Bob only",
      dedupeKey: `privacy:${S}:bob`,
    });

    const aliceSees = await listMyNotifications(actorFor("aliceUser", "alicePerson"));
    const titles = aliceSees.map((n) => n.title);

    expect(titles).toContain("For Alice only");
    expect(titles).not.toContain("For Bob only");
  });

  it("refuses to mark someone else's notification read", async () => {
    const bobs = await listMyNotifications(actorFor("bobUser", "bobPerson"));
    const bobNotification = bobs[0];

    // Reports not-found rather than forbidden, so existence cannot be probed.
    await expect(
      markRead(actorFor("aliceUser", "alicePerson"), bobNotification.id),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "NOT_FOUND");
  });
});

describe("deduplication", () => {
  it("updates one row rather than stacking repeats of the same condition", async () => {
    const key = `dedupe:${S}`;

    await notify({
      personId: ids.alicePerson,
      kind: "TASK_OVERDUE",
      title: "Overdue: first wording",
      dedupeKey: key,
    });
    await notify({
      personId: ids.alicePerson,
      kind: "TASK_OVERDUE",
      title: "Overdue: second wording",
      dedupeKey: key,
    });
    await notify({
      personId: ids.alicePerson,
      kind: "TASK_OVERDUE",
      title: "Overdue: third wording",
      dedupeKey: key,
    });

    const matching = await prisma.notification.findMany({
      where: { personId: ids.alicePerson, dedupeKey: key },
    });

    expect(matching).toHaveLength(1);
    expect(matching[0].title).toBe("Overdue: third wording");
  });

  it("marks a repeat unread again so an unresolved problem does not vanish", async () => {
    const key = `reopen:${S}`;

    await notify({
      personId: ids.alicePerson,
      kind: "DAILY_LOG_MISSING",
      title: "Missing log",
      dedupeKey: key,
    });

    const before = await prisma.notification.findFirstOrThrow({
      where: { personId: ids.alicePerson, dedupeKey: key },
    });
    await markRead(actorFor("aliceUser", "alicePerson"), before.id);

    // The condition persists, so the alert must come back.
    await notify({
      personId: ids.alicePerson,
      kind: "DAILY_LOG_MISSING",
      title: "Missing log",
      dedupeKey: key,
    });

    const after = await prisma.notification.findFirstOrThrow({
      where: { personId: ids.alicePerson, dedupeKey: key },
    });
    expect(after.readAt).toBeNull();
  });
});

describe("read state", () => {
  it("counts unread and clears them all", async () => {
    const before = await unreadCount(actorFor("aliceUser", "alicePerson"));
    expect(before).toBeGreaterThan(0);

    const cleared = await markAllRead(actorFor("aliceUser", "alicePerson"));
    expect(cleared).toBe(before);

    expect(await unreadCount(actorFor("aliceUser", "alicePerson"))).toBe(0);
  });
});

describe("assignment notifications (§59)", () => {
  it("tells assignees when a task is created for them", async () => {
    const manager: ActorWithVenture = {
      ...actorFor("aliceUser", "alicePerson"),
      memberships: new Map([[ids.venture, "MANAGER"]]),
      venture: {
        id: ids.venture,
        name: `Ntf ${S}`,
        slug: `ntf-${S}`,
        timezone: "Asia/Kolkata",
        workingDays: [1, 2, 3, 4, 5],
        dailyLogEditWindowHours: 48,
        defaultCurrency: "INR",
      },
      ventureRole: "MANAGER",
    };

    const task = await createTask(manager, {
      ventureId: ids.venture,
      title: `Notify me ${S}`,
      estimatedHours: 4,
      priority: "HIGH",
      assigneeIds: [ids.bobPerson],
    });

    const bobSees = await listMyNotifications(actorFor("bobUser", "bobPerson"));
    const alert = bobSees.find((n) => n.kind === "TASK_ASSIGNED" && n.title.includes(task.title));

    expect(alert).toBeDefined();
    expect(alert!.link).toBe(`/tasks/${task.id}`);
    expect(alert!.read).toBe(false);
  });
});

describe("scheduled sweep", () => {
  it("raises an alert for a document that is expiring", async () => {
    await prisma.documentRecord.create({
      data: {
        personId: ids.bobPerson,
        docType: `Passport ${S}`,
        status: "VERIFIED",
        expiryDate: toPrismaDate(
          new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        ),
      },
    });

    await generateScheduledNotifications();

    const bobSees = await listMyNotifications(actorFor("bobUser", "bobPerson"));
    const alert = bobSees.find((n) => n.kind === "DOCUMENT_EXPIRING");

    expect(alert).toBeDefined();
    expect(alert!.title).toContain(`Passport ${S}`);
  });

  it("is safe to run twice without duplicating", async () => {
    await generateScheduledNotifications();
    const first = await prisma.notification.count({ where: { personId: ids.bobPerson } });

    await generateScheduledNotifications();
    const second = await prisma.notification.count({ where: { personId: ids.bobPerson } });

    expect(second).toBe(first);
  });

  it("prunes notifications read over a month ago", async () => {
    const old = await prisma.notification.create({
      data: {
        personId: ids.alicePerson,
        kind: "TASK_ASSIGNED",
        title: "Ancient history",
        dedupeKey: `ancient:${S}`,
        readAt: new Date(Date.now() - 45 * 24 * 3600 * 1000),
        createdAt: new Date(Date.now() - 45 * 24 * 3600 * 1000),
      },
      select: { id: true },
    });

    const pruned = await pruneNotifications();
    expect(pruned).toBeGreaterThan(0);

    const gone = await prisma.notification.findUnique({ where: { id: old.id } });
    expect(gone).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";

/**
 * Schema integrity guards.
 *
 * The one-active-timer rule is enforced by a PARTIAL UNIQUE INDEX, which rides
 * Prisma's `partialIndexes` preview feature. Its failure mode is silent: if the
 * index ever stops being emitted, no application test necessarily fails, but a
 * person can hold two running timers and their hours double. These tests exist
 * so that regression is loud.
 */

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("one-active-timer constraint (§20, §49)", () => {
  it("exists in the database as a partial unique index on ended_at IS NULL", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'time_entries'
        AND indexname = 'one_active_timer_per_person'
    `;

    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef;
    expect(def).toMatch(/UNIQUE/i);
    expect(def).toMatch(/person_id/);
    // The predicate is what makes it "one ACTIVE timer" rather than "one entry".
    expect(def.replace(/\s+/g, " ")).toMatch(/WHERE \(ended_at IS NULL\)/i);
  });

  it("rejects a second running timer for the same person", async () => {
    const suffix = Date.now().toString(36);
    const user = await prisma.user.create({
      data: {
        name: "Constraint Probe",
        email: `probe-${suffix}@test.local`,
        accountStatus: "ACTIVE",
        person: { create: { employmentType: "EMPLOYEE" } },
      },
      include: { person: true },
    });
    const venture = await prisma.venture.create({
      data: { name: `Probe ${suffix}`, slug: `probe-${suffix}` },
    });
    const personId = user.person!.id;

    try {
      await prisma.timeEntry.create({
        data: {
          personId,
          ventureId: venture.id,
          source: "TIMER",
          startedAt: new Date(),
          endedAt: null,
          businessDate: new Date("2026-08-25T00:00:00Z"),
        },
      });

      // Second running timer for the same person must be refused by Postgres.
      await expect(
        prisma.timeEntry.create({
          data: {
            personId,
            ventureId: venture.id,
            source: "TIMER",
            startedAt: new Date(),
            endedAt: null,
            businessDate: new Date("2026-08-25T00:00:00Z"),
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    } finally {
      await prisma.timeEntry.deleteMany({ where: { personId } });
      await prisma.person.delete({ where: { id: personId } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.venture.delete({ where: { id: venture.id } });
    }
  });

  it("allows many COMPLETED entries for the same person", async () => {
    const suffix = `${Date.now().toString(36)}b`;
    const user = await prisma.user.create({
      data: {
        name: "Completed Probe",
        email: `probe2-${suffix}@test.local`,
        accountStatus: "ACTIVE",
        person: { create: { employmentType: "EMPLOYEE" } },
      },
      include: { person: true },
    });
    const venture = await prisma.venture.create({
      data: { name: `Probe2 ${suffix}`, slug: `probe2-${suffix}` },
    });
    const personId = user.person!.id;

    try {
      const base = new Date("2026-08-25T04:00:00Z");
      for (let i = 0; i < 3; i++) {
        await prisma.timeEntry.create({
          data: {
            personId,
            ventureId: venture.id,
            source: "MANUAL",
            startedAt: new Date(base.getTime() + i * 3_600_000),
            endedAt: new Date(base.getTime() + (i + 1) * 3_600_000),
            durationSeconds: 3600,
            businessDate: new Date("2026-08-25T00:00:00Z"),
          },
        });
      }

      const count = await prisma.timeEntry.count({ where: { personId } });
      expect(count).toBe(3);

      // ...and one running timer may still be started alongside them.
      await prisma.timeEntry.create({
        data: {
          personId,
          ventureId: venture.id,
          source: "TIMER",
          startedAt: new Date(),
          endedAt: null,
          businessDate: new Date("2026-08-25T00:00:00Z"),
        },
      });
      expect(await prisma.timeEntry.count({ where: { personId, endedAt: null } })).toBe(1);
    } finally {
      await prisma.timeEntry.deleteMany({ where: { personId } });
      await prisma.person.delete({ where: { id: personId } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.venture.delete({ where: { id: venture.id } });
    }
  });
});

describe("other spec-mandated constraints (§49)", () => {
  it("enforces one daily log per person + venture + business date", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'daily_logs' AND indexdef ILIKE '%UNIQUE%'
    `;
    const combined = rows.map((r) => r.indexdef.replace(/\s+/g, " ")).join(" | ");
    expect(combined).toMatch(/person_id/);
    expect(combined).toMatch(/venture_id/);
    expect(combined).toMatch(/business_date/);
  });

  it("enforces unique user email", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'users' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%email%'
    `;
    expect(rows.length).toBeGreaterThan(0);
  });

  it("enforces unique task assignee per task", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'task_assignees' AND indexdef ILIKE '%UNIQUE%'
    `;
    const combined = rows.map((r) => r.indexdef.replace(/\s+/g, " ")).join(" | ");
    expect(combined).toMatch(/task_id/);
    expect(combined).toMatch(/person_id/);
  });

  it("has no actual_hours column on tasks (§23)", async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks'
    `;
    const names = rows.map((r) => r.column_name);
    expect(names).not.toContain("actual_hours");
    expect(names).not.toContain("actual_minutes");
    // ...but the estimate must be present and integer-typed.
    expect(names).toContain("estimated_minutes");
  });

  it("has no total_hours column on daily_logs (§27)", async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'daily_logs'
    `;
    const names = rows.map((r) => r.column_name);
    expect(names).not.toContain("total_hours");
    expect(names).not.toContain("total_minutes");
  });

  it("stores money as DECIMAL, never floating point (§36)", async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string }>>`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE column_name IN ('rate', 'rate_snapshot', 'computed_pay', 'amount', 'fixed_fee')
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.data_type).toBe("numeric");
    }
  });

  it("stores estimated_minutes as an integer (§15)", async () => {
    const rows = await prisma.$queryRaw<Array<{ data_type: string }>>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'estimated_minutes'
    `;
    expect(rows[0].data_type).toBe("integer");
  });
});

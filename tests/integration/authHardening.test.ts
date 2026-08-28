import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { testPrisma as prisma } from "../helpers/testPrisma";
import {
  checkLoginAllowed,
  recordFailedLogin,
  clearFailedLogins,
  pruneLoginAttempts,
  checkSensitiveActionAllowed,
  recordSensitiveAction,
} from "@/lib/auth/rateLimit";

/**
 * Login rate limiting and password reset (§63).
 *
 * The reset logic is exercised at the data layer here rather than through the
 * server action, because the action lives behind a Next.js request context.
 * The properties under test are the same ones the action relies on.
 */

const S = `auth${Date.now().toString(36)}`;
const EMAIL = `rl-${S}@test.local`;
const IP = `10.0.0.${Math.floor(Math.random() * 200) + 1}`;
let userId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: "Rate Limit Probe",
      email: EMAIL,
      accountStatus: "ACTIVE",
      passwordHash: await bcrypt.hash("OriginalPassword123", 12),
    },
    select: { id: true },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.loginAttempt.deleteMany({ where: { OR: [{ email: EMAIL }, { ipAddress: IP }] } });
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("login rate limiting (§63)", () => {
  it("allows sign-in attempts until the threshold, then refuses", async () => {
    expect((await checkLoginAllowed(EMAIL, IP)).allowed).toBe(true);

    // Seven failures is still under the per-email limit of eight.
    for (let i = 0; i < 7; i++) {
      await recordFailedLogin(EMAIL, IP);
    }
    expect((await checkLoginAllowed(EMAIL, IP)).allowed).toBe(true);

    await recordFailedLogin(EMAIL, IP);
    const blocked = await checkLoginAllowed(EMAIL, IP);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMinutes).toBeGreaterThan(0);
  });

  it("clears the counter after a successful sign-in", async () => {
    await clearFailedLogins(EMAIL);
    expect((await checkLoginAllowed(EMAIL, IP)).allowed).toBe(true);
  });

  it("limits a different email on the same IP independently, up to the IP cap", async () => {
    const other = `other-${S}@test.local`;

    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(other, IP);
    }
    // Under both caps, so still allowed.
    expect((await checkLoginAllowed(other, IP)).allowed).toBe(true);

    // Push the IP total past its own limit of twenty.
    for (let i = 0; i < 16; i++) {
      await recordFailedLogin(`spray${i}-${S}@test.local`, IP);
    }
    const blocked = await checkLoginAllowed(`fresh-${S}@test.local`, IP);
    expect(blocked.allowed).toBe(false);

    await prisma.loginAttempt.deleteMany({ where: { ipAddress: IP } });
  });

  it("prunes attempts older than a day", async () => {
    await prisma.loginAttempt.create({
      data: {
        email: EMAIL,
        ipAddress: IP,
        successful: false,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      },
    });
    const pruned = await pruneLoginAttempts();
    expect(pruned).toBeGreaterThan(0);
  });
});

describe("anonymous sensitive actions are rate limited", () => {
  it("stops repeated password-reset requests for one address", async () => {
    const target = `flood-${S}@test.local`;
    const floodIp = `10.9.9.${Math.floor(Math.random() * 200) + 1}`;

    expect((await checkSensitiveActionAllowed(target, floodIp)).allowed).toBe(true);

    // Five requests is the cap; the sixth must be refused, so the endpoint
    // cannot be used to flood an inbox or probe for accounts.
    for (let i = 0; i < 5; i++) {
      await recordSensitiveAction(target, floodIp);
    }

    const blocked = await checkSensitiveActionAllowed(target, floodIp);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMinutes).toBeGreaterThan(0);

    await prisma.loginAttempt.deleteMany({ where: { ipAddress: floodIp } });
  });

  it("keeps reset counters separate from login counters", async () => {
    const shared = `shared-${S}@test.local`;
    const sharedIp = `10.8.8.${Math.floor(Math.random() * 200) + 1}`;

    // Exhaust the reset limit.
    for (let i = 0; i < 5; i++) {
      await recordSensitiveAction(shared, sharedIp);
    }
    expect((await checkSensitiveActionAllowed(shared, sharedIp)).allowed).toBe(false);

    // Signing in with the same address must still be possible — a reset flood
    // should not lock someone out of the login form.
    expect((await checkLoginAllowed(shared, sharedIp)).allowed).toBe(true);

    await prisma.loginAttempt.deleteMany({ where: { ipAddress: sharedIp } });
  });
});

describe("password reset (§63)", () => {
  it("stores only a hash of the token, never the token itself", async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + 3600_000) },
    });

    const stored = await prisma.passwordResetToken.findFirst({ where: { userId } });
    expect(stored!.tokenHash).toBe(tokenHash);
    // The raw token must appear nowhere in the row.
    expect(JSON.stringify(stored)).not.toContain(token);

    await prisma.passwordResetToken.deleteMany({ where: { userId } });
  });

  it("treats an expired token as unusable", async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() - 1000) },
    });

    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    expect(record!.expiresAt.getTime()).toBeLessThan(Date.now());

    await prisma.passwordResetToken.deleteMany({ where: { userId } });
  });

  it("marks a token used so it cannot be replayed", async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const created = await prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + 3600_000) },
      select: { id: true },
    });

    await prisma.passwordResetToken.update({
      where: { id: created.id },
      data: { usedAt: new Date() },
    });

    const after = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    expect(after!.usedAt).not.toBeNull();

    await prisma.passwordResetToken.deleteMany({ where: { userId } });
  });
});

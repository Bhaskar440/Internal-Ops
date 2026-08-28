import { prisma } from "@/lib/db/client";

/**
 * Login rate limiting (§63).
 *
 * Counts failed attempts per email and per IP in a rolling window and refuses
 * further attempts once the threshold is passed. Backed by the database rather
 * than in-process memory, so the limit still holds across server restarts and
 * multiple instances — an in-memory counter resets on every deploy, which is
 * exactly when an attacker benefits.
 */

const MAX_ATTEMPTS_PER_EMAIL = 8;
const MAX_ATTEMPTS_PER_IP = 20;
const WINDOW_MINUTES = 15;

export type RateLimitResult = { allowed: boolean; retryAfterMinutes?: number };

/** Record one failed sign-in attempt. */
export async function recordFailedLogin(email: string, ipAddress?: string): Promise<void> {
  await prisma.loginAttempt.create({
    data: { email: email.toLowerCase().trim(), ipAddress: ipAddress ?? null, successful: false },
  });
}

/** Clear the counters for an email once it signs in successfully. */
export async function clearFailedLogins(email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({
    where: { email: email.toLowerCase().trim(), successful: false },
  });
}

/** Whether this email and IP may attempt a sign-in right now. */
export async function checkLoginAllowed(
  email: string,
  ipAddress?: string,
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const normalized = email.toLowerCase().trim();

  const [byEmail, byIp] = await Promise.all([
    prisma.loginAttempt.count({
      where: { email: normalized, successful: false, createdAt: { gte: since } },
    }),
    ipAddress
      ? prisma.loginAttempt.count({
          where: { ipAddress, successful: false, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  if (byEmail >= MAX_ATTEMPTS_PER_EMAIL || byIp >= MAX_ATTEMPTS_PER_IP) {
    return { allowed: false, retryAfterMinutes: WINDOW_MINUTES };
  }
  return { allowed: true };
}

/**
 * Rate limit for unauthenticated flows that send email or consume tokens —
 * password reset requests and invitation acceptance.
 *
 * Reuses the login-attempt table with a namespaced key, so there is one place
 * that decides whether a caller is being abusive.
 */
const MAX_SENSITIVE_PER_KEY = 5;
const MAX_SENSITIVE_PER_IP = 15;

export async function checkSensitiveActionAllowed(
  key: string,
  ipAddress?: string,
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const namespaced = `reset:${key.toLowerCase().trim()}`;

  const [byKey, byIp] = await Promise.all([
    prisma.loginAttempt.count({
      where: { email: namespaced, createdAt: { gte: since } },
    }),
    ipAddress
      ? prisma.loginAttempt.count({
          where: {
            ipAddress,
            email: { startsWith: "reset:" },
            createdAt: { gte: since },
          },
        })
      : Promise.resolve(0),
  ]);

  if (byKey >= MAX_SENSITIVE_PER_KEY || byIp >= MAX_SENSITIVE_PER_IP) {
    return { allowed: false, retryAfterMinutes: WINDOW_MINUTES };
  }
  return { allowed: true };
}

/** Record one attempt at a sensitive unauthenticated action. */
export async function recordSensitiveAction(
  key: string,
  ipAddress?: string,
): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      email: `reset:${key.toLowerCase().trim()}`,
      ipAddress: ipAddress ?? null,
      successful: false,
    },
  });
}

/** Housekeeping for old rows; safe to call from a scheduled job. */
export async function pruneLoginAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

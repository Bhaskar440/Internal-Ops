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

/** Housekeeping for old rows; safe to call from a scheduled job. */
export async function pruneLoginAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

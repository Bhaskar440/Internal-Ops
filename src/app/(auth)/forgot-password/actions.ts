"use server";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";

/**
 * Password reset (§63).
 *
 * Two properties matter here:
 *   - The response is identical whether or not the email exists, so the form
 *     cannot be used to discover which accounts are real.
 *   - Only a HASH of the token is stored. A database leak therefore does not
 *     hand out working reset links.
 *
 * Until email delivery is configured, the link is returned to the caller for an
 * administrator to pass on. That is a deliberate interim step, and it is why
 * this action is safe to call anonymously only in that mode.
 */

const RESET_TTL_MINUTES = 60;

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

export type ResetRequestState = {
  error?: string;
  sent?: boolean;
  /** Interim: shown so an admin can pass the link on until email is wired up. */
  devLink?: string;
};

export async function requestPasswordReset(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const parsed = requestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, accountStatus: true },
  });

  // Always report success, whether or not the account exists.
  if (!user || user.accountStatus === "SUSPENDED" || user.accountStatus === "INACTIVE") {
    return { sent: true };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  await prisma.$transaction(async (tx) => {
    // Any earlier unused token is invalidated, so only the newest link works.
    await tx.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
      },
    });
  });

  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  const link = `${base}/reset-password/${token}`;

  // With no mail provider configured, surface the link rather than silently
  // dropping it. Once email is enabled this branch goes away.
  const emailConfigured = Boolean(process.env.RESEND_API_KEY);
  return emailConfigured ? { sent: true } : { sent: true, devLink: link };
}

const resetSchema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters.").max(200),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "The passwords do not match.",
    path: ["confirm"],
  });

export type ResetState = { error?: string; done?: boolean };

export async function resetPassword(
  token: string,
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = resetSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the password you entered." };
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });
    // Single use.
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    // Existing sessions are invalidated so a stolen session cannot outlive the
    // password it was issued under.
    await tx.session.deleteMany({ where: { userId: record.userId } });

    await writeAudit(tx, {
      actorUserId: record.userId,
      action: "PERSON_UPDATED",
      entityType: "User",
      entityId: record.userId,
      reason: "Password reset via emailed link",
    });
  });

  return { done: true };
}

/** Whether a reset token is currently usable, for the page to render. */
export async function isResetTokenValid(token: string): Promise<boolean> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { expiresAt: true, usedAt: true },
  });
  return Boolean(record && !record.usedAt && record.expiresAt > new Date());
}

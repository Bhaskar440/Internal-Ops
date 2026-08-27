"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";

/**
 * Invitation acceptance (§7 admin-created employee).
 *
 * The invited person sets their OWN password — an admin never chooses it. On
 * success the account moves PENDING -> ACTIVE and the token is consumed, so an
 * invite link cannot be replayed.
 */

const schema = z
  .object({
    password: z
      .string()
      .min(10, "Use at least 10 characters.")
      .max(200, "That password is too long."),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "The passwords do not match.",
    path: ["confirm"],
  });

export type InviteState = { error?: string; done?: boolean };

export async function acceptInvite(
  token: string,
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const parsed = schema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the password you entered." };
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record || record.expires < new Date()) {
    return { error: "This invitation link is invalid or has expired. Ask for a new one." };
  }

  const user = await prisma.user.findUnique({
    where: { email: record.identifier },
    select: { id: true, accountStatus: true },
  });
  if (!user) return { error: "This invitation is no longer valid." };

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        accountStatus: "ACTIVE",
        emailVerified: new Date(),
      },
    });

    // Consume the token so the link cannot be reused.
    await tx.verificationToken.delete({ where: { token } });

    await writeAudit(tx, {
      actorUserId: user.id,
      action: "PERSON_ACTIVATED",
      entityType: "User",
      entityId: user.id,
      before: { accountStatus: user.accountStatus },
      after: { accountStatus: "ACTIVE" },
      reason: "Invitation accepted; password set by the user",
    });
  });

  return { done: true };
}

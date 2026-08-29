"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/lib/audit/audit";
import {
  checkSensitiveActionAllowed,
  recordSensitiveAction,
} from "@/lib/auth/rateLimit";
import {
  isEmailConfigured,
  sendRegistrationReceivedEmail,
  sendRegistrationPendingEmail,
} from "@/lib/email/mailer";

/**
 * Freelancer self-registration (§7, §58).
 *
 * The registration flow is deliberately narrow:
 *   - The account is created PENDING with NO venture access. Until an admin
 *     approves and assigns ventures, it can see nothing.
 *   - A self-registered person can NEVER set their own pay rate (§7). The form
 *     has no rate field, and the service never writes a compensation
 *     agreement — only an admin can, through the compensation module.
 *   - Global role is always USER. Nothing here can create an administrator.
 *
 * Anonymous and account-creating, so it is rate limited like the other public
 * endpoints.
 */

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name.").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    phone: z
      .string()
      .trim()
      .max(30)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    employmentType: z.enum(["FREELANCER", "CONTRACTOR"], {
      message: "Choose how you will be engaged.",
    }),
    password: z.string().min(10, "Use at least 10 characters.").max(200),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "The passwords do not match.",
    path: ["confirm"],
  });

export type RegisterState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  done?: boolean;
};

export async function register(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? undefined,
    employmentType: formData.get("employmentType"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const ip = await clientIp();
  const limit = await checkSensitiveActionAllowed(parsed.data.email, ip);
  if (!limit.allowed) {
    return {
      error: `Too many registration attempts. Try again in ${limit.retryAfterMinutes} minutes.`,
    };
  }
  await recordSensitiveAction(parsed.data.email, ip);

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });

  // Report success either way, so the form cannot be used to discover which
  // addresses already have accounts. A duplicate simply creates nothing.
  if (existing) return { done: true };

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        passwordHash,
        // Always USER, always PENDING, never any venture membership.
        globalRole: "USER",
        accountStatus: "PENDING",
        person: {
          create: { employmentType: parsed.data.employmentType },
        },
      },
      select: { id: true, name: true, email: true, person: { select: { id: true } } },
    });

    await writeAudit(tx, {
      actorUserId: user.id,
      action: "PERSON_CREATED",
      entityType: "Person",
      entityId: user.person!.id,
      after: {
        name: user.name,
        email: user.email,
        employmentType: parsed.data.employmentType,
        accountStatus: "PENDING",
      },
      reason: "Self-registration; awaiting administrator approval",
      ipAddress: ip ?? null,
    });
  });

  // Sent AFTER the transaction commits. A mail provider having a bad day must
  // never roll back a registration that already succeeded.
  if (isEmailConfigured()) {
    const base = process.env.AUTH_URL ?? "http://localhost:3000";

    await sendRegistrationReceivedEmail({
      to: parsed.data.email,
      name: parsed.data.name,
    });

    // Tell the administrators, so a request does not sit unseen until someone
    // happens to open the People page.
    const admins = await prisma.user.findMany({
      where: { globalRole: "SUPER_ADMIN", accountStatus: "ACTIVE" },
      select: { name: true, email: true },
    });

    for (const admin of admins) {
      await sendRegistrationPendingEmail({
        to: admin.email,
        adminName: admin.name,
        registrantName: parsed.data.name,
        registrantEmail: parsed.data.email,
        employmentType: parsed.data.employmentType,
        reviewUrl: `${base}/people?status=PENDING`,
      });
    }
  }

  return { done: true };
}

/** Best-effort client IP from proxy headers, for rate limiting. */
async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return h.get("x-real-ip") ?? undefined;
}

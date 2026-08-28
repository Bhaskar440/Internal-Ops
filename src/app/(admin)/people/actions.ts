"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireGlobal, requireVenture } from "@/lib/permissions/guard";
import {
  createPersonSchema,
  setAccountStatusSchema,
  setMembershipSchema,
} from "@/modules/people/person.schema";
import {
  createPerson,
  removeMembership,
  setAccountStatus,
  setMembership,
} from "@/modules/people/person.service";
import { isAppError } from "@/lib/errors/appError";
import { sendInvitationEmail, isEmailConfigured } from "@/lib/email/mailer";

export type PersonFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  inviteUrl?: string;
  /** True when the invitation was emailed, so the UI need not show the link. */
  emailSent?: boolean;
};

/**
 * Create a person (§7). Returns the invitation link for the admin to share.
 * Automatic email delivery is Phase 3; until then the admin copies the link.
 */
export async function createPersonAction(
  _prev: PersonFormState,
  formData: FormData,
): Promise<PersonFormState> {
  try {
    const actor = await requireGlobal("person:create");

    const parsed = createPersonSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone") ?? undefined,
      employmentType: formData.get("employmentType"),
      startDate: formData.get("startDate") ?? undefined,
      ventureIds: formData.getAll("ventureIds").map(String).filter(Boolean),
      accessRole: formData.get("accessRole") ?? "MEMBER",
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
      return { error: "Check the highlighted fields.", fieldErrors };
    }

    const result = await createPerson(actor, parsed.data);

    revalidatePath("/people");
    revalidatePath("/");

    const base = process.env.AUTH_URL ?? "http://localhost:3000";
    const inviteUrl = `${base}/invite/${result.inviteToken}`;

    // Email if a provider is configured. A send failure must not undo the
    // person we just created — the link is valid either way, so fall back to
    // showing it for the admin to pass on.
    let emailSent = false;
    if (isEmailConfigured()) {
      const outcome = await sendInvitationEmail({
        to: result.email,
        name: parsed.data.name,
        inviteUrl,
        invitedBy: actor.name,
      });
      emailSent = outcome.sent;
    }

    return { inviteUrl, emailSent };
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Could not create the person." };
  }
}

/** Assign or change a venture membership. Managers may do this in their own venture. */
export async function setMembershipAction(formData: FormData): Promise<void> {
  const parsed = setMembershipSchema.safeParse({
    personId: formData.get("personId"),
    ventureId: formData.get("ventureId"),
    accessRole: formData.get("accessRole"),
  });
  if (!parsed.success) return;

  // Venture-scoped permission: resolves membership before allowing the write.
  const actor = await requireVenture(parsed.data.ventureId, "membership:write");
  await setMembership(actor, parsed.data);

  revalidatePath("/people");
  revalidatePath(`/people/${parsed.data.personId}`);
  revalidatePath("/ventures");
}

export async function removeMembershipAction(formData: FormData): Promise<void> {
  const personId = String(formData.get("personId"));
  const ventureId = String(formData.get("ventureId"));

  const actor = await requireVenture(ventureId, "membership:write");
  await removeMembership(actor, personId, ventureId);

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  revalidatePath("/ventures");
}

/** Approve, suspend or reactivate an account (§7). */
export async function setAccountStatusAction(formData: FormData): Promise<void> {
  const parsed = setAccountStatusSchema.safeParse({
    userId: formData.get("userId"),
    status: formData.get("status"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return;

  const permission =
    parsed.data.status === "ACTIVE" ? "person:activate" : "person:deactivate";
  const actor = await requireGlobal(permission);
  await setAccountStatus(actor, parsed.data);

  revalidatePath("/people");
  revalidatePath("/");
}

export async function goToPerson(formData: FormData): Promise<void> {
  redirect(`/people/${String(formData.get("personId"))}`);
}

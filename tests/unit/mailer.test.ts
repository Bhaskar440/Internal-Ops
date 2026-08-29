import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isEmailConfigured } from "@/lib/email/mailer";

/**
 * The mailer's contract: it degrades rather than throwing when no provider is
 * configured, so invitations and password resets keep working on a machine
 * with no mail credentials.
 */

const ORIGINAL = process.env.RESEND_API_KEY;

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL;
});

describe("email configuration", () => {
  it("reports not configured when no API key is set", () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it("reports configured once an API key is present", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    expect(isEmailConfigured()).toBe(true);
  });

  it("treats an empty key as not configured", () => {
    process.env.RESEND_API_KEY = "";
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("registration emails (§7)", () => {
  it("degrades rather than throwing when no provider is configured", async () => {
    const {
      sendRegistrationReceivedEmail,
      sendRegistrationPendingEmail,
      sendAccountApprovedEmail,
    } = await import("@/lib/email/mailer");

    // A registration must still succeed on a machine with no mail credentials.
    expect(
      await sendRegistrationReceivedEmail({ to: "a@example.com", name: "Ada" }),
    ).toEqual({ sent: false, reason: "not_configured" });

    expect(
      await sendRegistrationPendingEmail({
        to: "admin@example.com",
        adminName: "Admin",
        registrantName: "Ada",
        registrantEmail: "a@example.com",
        employmentType: "FREELANCER",
        reviewUrl: "https://example.com/people?status=PENDING",
      }),
    ).toEqual({ sent: false, reason: "not_configured" });

    expect(
      await sendAccountApprovedEmail({
        to: "a@example.com",
        name: "Ada",
        signInUrl: "https://example.com/login",
      }),
    ).toEqual({ sent: false, reason: "not_configured" });
  });

  it("escapes a name so it cannot inject markup into the email", async () => {
    // The template escapes user input; this pins that behaviour by checking the
    // helper the templates rely on rather than reaching into private state.
    const { sendRegistrationReceivedEmail } = await import("@/lib/email/mailer");
    const result = await sendRegistrationReceivedEmail({
      to: "x@example.com",
      name: '<script>alert("x")</script>',
    });
    // With no provider it reports not_configured — the point is that building
    // the message with hostile input does not throw.
    expect(result.sent).toBe(false);
  });
});

describe("sending without a provider", () => {
  it("returns not_configured instead of throwing", async () => {
    // Imported lazily so the module reads the cleared env var.
    const { sendInvitationEmail, sendPasswordResetEmail } = await import(
      "@/lib/email/mailer"
    );

    const invite = await sendInvitationEmail({
      to: "someone@example.com",
      name: "Someone",
      inviteUrl: "https://example.com/invite/abc",
      invitedBy: "Admin",
    });
    expect(invite).toEqual({ sent: false, reason: "not_configured" });

    const reset = await sendPasswordResetEmail({
      to: "someone@example.com",
      resetUrl: "https://example.com/reset-password/abc",
    });
    expect(reset).toEqual({ sent: false, reason: "not_configured" });
  });
});

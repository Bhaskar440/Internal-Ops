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

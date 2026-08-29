import { Resend } from "resend";

/**
 * Outbound email (§59 Phase 3).
 *
 * The mailer is deliberately tolerant: if RESEND_API_KEY is not set, sending is
 * skipped and the caller is told so, rather than throwing. That keeps
 * invitations and password resets working on a machine with no mail provider —
 * the link is surfaced in the UI for an administrator to pass on instead.
 *
 * Failures never block the action that triggered them. Nobody should be unable
 * to reset a password because a mail provider is having a bad day; the link is
 * already valid by the time we try to send it.
 */

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not_configured" | "failed"; detail?: string };

function config() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Portfolio Ops <onboarding@resend.dev>";
  return { apiKey, from };
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

async function send(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const { apiKey, from } = config();
  if (!apiKey) return { sent: false, reason: "not_configured" };

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });

    if (error) {
      // Log the failure without the recipient's address (§64 PII rules).
      console.error("[email] send failed:", error.message);
      return { sent: false, reason: "failed", detail: error.message };
    }
    return { sent: true, id: data?.id ?? "" };
  } catch (e) {
    console.error("[email] send threw:", e instanceof Error ? e.message : String(e));
    return {
      sent: false,
      reason: "failed",
      detail: e instanceof Error ? e.message : undefined,
    };
  }
}

// --- templates --------------------------------------------------------------

/** Shared shell so both emails look like they come from the same system. */
function layout(args: { heading: string; body: string; cta?: { label: string; url: string }; footer: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
      <tr>
        <td style="padding:28px 32px 8px;">
          <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#2563eb;font-weight:600;">Portfolio Ops</div>
          <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;">${args.heading}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 32px 0;font-size:14px;line-height:1.6;color:#3f3f46;">
          ${args.body}
        </td>
      </tr>
      ${
        args.cta
          ? `<tr>
        <td style="padding:24px 32px 8px;">
          <a href="${args.cta.url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px;font-weight:500;">${args.cta.label}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 32px 0;font-size:12px;color:#71717a;word-break:break-all;">
          Or paste this into your browser:<br />${args.cta.url}
        </td>
      </tr>`
          : ""
      }
      <tr>
        <td style="padding:24px 32px 28px;font-size:12px;color:#a1a1aa;border-top:1px solid #f4f4f5;margin-top:16px;">
          ${args.footer}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Invitation for a newly created person to set their password (§7). */
export async function sendInvitationEmail(args: {
  to: string;
  name: string;
  inviteUrl: string;
  invitedBy: string;
}): Promise<SendResult> {
  const heading = "You have been invited to Portfolio Ops";
  const body = `
    <p style="margin:0 0 12px;">Hello ${escapeHtml(args.name)},</p>
    <p style="margin:0 0 12px;">${escapeHtml(args.invitedBy)} has created an account for you on Portfolio Ops, the internal system for tracking work, time and payroll across our ventures.</p>
    <p style="margin:0;">Choose a password to activate your account.</p>
  `;

  return send({
    to: args.to,
    subject: "Your Portfolio Ops account",
    html: layout({
      heading,
      body,
      cta: { label: "Set your password", url: args.inviteUrl },
      footer: "This invitation expires in 7 days. If you were not expecting it, you can ignore this email.",
    }),
    text: [
      `Hello ${args.name},`,
      "",
      `${args.invitedBy} has created an account for you on Portfolio Ops.`,
      "",
      "Set your password here:",
      args.inviteUrl,
      "",
      "This invitation expires in 7 days.",
    ].join("\n"),
  });
}

/** Password reset link (§63). */
export async function sendPasswordResetEmail(args: {
  to: string;
  resetUrl: string;
}): Promise<SendResult> {
  const body = `
    <p style="margin:0 0 12px;">We received a request to reset the password for this account.</p>
    <p style="margin:0;">The link below is valid for one hour and can be used once.</p>
  `;

  return send({
    to: args.to,
    subject: "Reset your Portfolio Ops password",
    html: layout({
      heading: "Reset your password",
      body,
      cta: { label: "Set a new password", url: args.resetUrl },
      footer:
        "If you did not request this, no action is needed — your password has not changed.",
    }),
    text: [
      "We received a request to reset your Portfolio Ops password.",
      "",
      "Set a new password here:",
      args.resetUrl,
      "",
      "This link is valid for one hour and can be used once.",
      "If you did not request this, no action is needed.",
    ].join("\n"),
  });
}

/**
 * Acknowledge a self-registration (§7, §58).
 *
 * Deliberately says nothing about when approval will happen, and carries no
 * link — there is nothing for them to do until an administrator acts.
 */
export async function sendRegistrationReceivedEmail(args: {
  to: string;
  name: string;
}): Promise<SendResult> {
  const body = `
    <p style="margin:0 0 12px;">Hello ${escapeHtml(args.name)},</p>
    <p style="margin:0 0 12px;">We have received your request for access to Portfolio Ops.</p>
    <p style="margin:0;">An administrator will review it and assign the ventures you will be working on. You will get another email once your account is active.</p>
  `;

  return send({
    to: args.to,
    subject: "We have received your Portfolio Ops request",
    html: layout({
      heading: "Request received",
      body,
      footer: "No action is needed from you right now.",
    }),
    text: [
      `Hello ${args.name},`,
      "",
      "We have received your request for access to Portfolio Ops.",
      "",
      "An administrator will review it and assign your ventures. You will get",
      "another email once your account is active. No action is needed for now.",
    ].join("\n"),
  });
}

/**
 * Tell an administrator that somebody is waiting.
 *
 * Without this a self-registration sits unseen until an admin happens to open
 * the People page.
 */
export async function sendRegistrationPendingEmail(args: {
  to: string;
  adminName: string;
  registrantName: string;
  registrantEmail: string;
  employmentType: string;
  reviewUrl: string;
}): Promise<SendResult> {
  const body = `
    <p style="margin:0 0 12px;">Hello ${escapeHtml(args.adminName)},</p>
    <p style="margin:0 0 12px;"><strong>${escapeHtml(args.registrantName)}</strong> (${escapeHtml(args.registrantEmail)}) has requested access as a ${escapeHtml(args.employmentType.toLowerCase())}.</p>
    <p style="margin:0;">They have no access to any venture until you approve them and assign their ventures.</p>
  `;

  return send({
    to: args.to,
    subject: `Access request from ${args.registrantName}`,
    html: layout({
      heading: "Someone is awaiting approval",
      body,
      cta: { label: "Review the request", url: args.reviewUrl },
      footer: "Pay rates are never set by the person registering.",
    }),
    text: [
      `Hello ${args.adminName},`,
      "",
      `${args.registrantName} (${args.registrantEmail}) has requested access as a ${args.employmentType.toLowerCase()}.`,
      "",
      "They have no access to any venture until you approve them.",
      "",
      "Review the request:",
      args.reviewUrl,
    ].join("\n"),
  });
}

/** Tell someone their account is now active and they can sign in (§7). */
export async function sendAccountApprovedEmail(args: {
  to: string;
  name: string;
  signInUrl: string;
}): Promise<SendResult> {
  const body = `
    <p style="margin:0 0 12px;">Hello ${escapeHtml(args.name)},</p>
    <p style="margin:0;">Your Portfolio Ops account has been approved. You can now sign in with the password you chose when you registered.</p>
  `;

  return send({
    to: args.to,
    subject: "Your Portfolio Ops account is ready",
    html: layout({
      heading: "Your account is ready",
      body,
      cta: { label: "Sign in", url: args.signInUrl },
      footer: "If you have forgotten your password, use the reset link on the sign-in page.",
    }),
    text: [
      `Hello ${args.name},`,
      "",
      "Your Portfolio Ops account has been approved. You can now sign in with",
      "the password you chose when you registered.",
      "",
      args.signInUrl,
    ].join("\n"),
  });
}

/** Escape user-supplied text before it goes into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

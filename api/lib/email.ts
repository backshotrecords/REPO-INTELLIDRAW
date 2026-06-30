import { getResetTokenTtlMinutes } from "./passwordReset.js";
import { getSignupTokenTtlMinutes } from "./signupVerification.js";

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
  displayName?: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const from =
    process.env.PASSWORD_RESET_EMAIL_FROM ||
    "IntelliDraw <no-reply@intellidraw.dev>";
  const name = opts.displayName || "there";
  const expiresMinutes = getResetTokenTtlMinutes();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: "Reset your IntelliDraw password",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#172026">
          <p>Hi ${escapeHtml(name)},</p>
          <p>Use the button below to reset your IntelliDraw password. This link expires in ${expiresMinutes} minutes and can only be used once.</p>
          <p>
            <a href="${escapeAttribute(opts.resetUrl)}" style="display:inline-block;background:#0f6bff;color:white;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">
              Reset password
            </a>
          </p>
          <p>If you did not request this, you can ignore this email.</p>
          <p style="font-size:12px;color:#667085">If the button does not work, paste this URL into your browser:<br>${escapeHtml(opts.resetUrl)}</p>
        </div>
      `,
      text: `Hi ${name},\n\nReset your IntelliDraw password using this link:\n${opts.resetUrl}\n\nThis link expires in ${expiresMinutes} minutes and can only be used once.\n\nIf you did not request this, you can ignore this email.`,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message =
      data && typeof data === "object" && "message" in data
        ? String(data.message)
        : "Failed to send password reset email";
    throw new Error(message);
  }
}

export async function sendSignupVerificationEmail(opts: {
  to: string;
  verificationUrl: string;
  displayName?: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const from =
    process.env.SIGNUP_VERIFICATION_EMAIL_FROM ||
    process.env.PASSWORD_RESET_EMAIL_FROM ||
    "IntelliDraw <no-reply@intellidraw.dev>";
  const name = opts.displayName || "there";
  const expiresMinutes = getSignupTokenTtlMinutes();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: "Verify your IntelliDraw signup",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#172026">
          <p>Hi ${escapeHtml(name)},</p>
          <p>Use the button below to verify this signup request. This link expires in ${expiresMinutes} minutes.</p>
          <p>You will be asked to re-enter the password you chose before the account is created.</p>
          <p>
            <a href="${escapeAttribute(opts.verificationUrl)}" style="display:inline-block;background:#0f6bff;color:white;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">
              Verify signup
            </a>
          </p>
          <p>If you did not request this, you can ignore this email.</p>
          <p style="font-size:12px;color:#667085">If the button does not work, paste this URL into your browser:<br>${escapeHtml(opts.verificationUrl)}</p>
        </div>
      `,
      text: `Hi ${name},\n\nVerify your IntelliDraw signup using this link:\n${opts.verificationUrl}\n\nThis link expires in ${expiresMinutes} minutes. You will be asked to re-enter the password you chose before the account is created.\n\nIf you did not request this, you can ignore this email.`,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message =
      data && typeof data === "object" && "message" in data
        ? String(data.message)
        : "Failed to send signup verification email";
    throw new Error(message);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

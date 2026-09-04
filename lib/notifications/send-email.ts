// =============================================================================
// Shared email sender — Nodemailer + Gmail Workspace SMTP
//
// Usage:
//   import { sendEmail } from "@/lib/notifications/send-email";
//   await sendEmail({
//     eventType: "pulveriser_production",
//     subject:   "[JSCI A-20/1] Job Card #JB-0451 — Production stage complete",
//     html:      "<p>...</p>",
//     factoryId: "...",        // optional, for the log
//     referenceId: "...",      // optional, for the log
//   });
//
// Contract:
//   - Never throws. All errors are caught, logged to console, and recorded in
//     the notification_log table. The caller's DB write is never blocked.
//   - Uses SUPABASE_SERVICE_ROLE_KEY to write the log (bypasses RLS).
//   - SMTP credentials come from GMAIL_SMTP_USER + GMAIL_SMTP_PASS env vars.
//
// Gmail Workspace SMTP setup:
//   Host:  smtp.gmail.com   Port: 465 (SSL)
//   User:  <your Google Workspace sending address>
//   Pass:  <16-char App Password — NOT your account password>
//   Enable 2-Step Verification on the account first, then generate an App
//   Password at https://myaccount.google.com/apppasswords
// =============================================================================

import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

// Fixed recipient for all A-20/1 workflow notifications.
export const AUTOMATION_EMAIL = "automation@jaishilshulphur.com";

// ---------------------------------------------------------------------------
// Nodemailer transporter — created once (module-level singleton).
// The transporter is created lazily so that a missing env var at startup does
// not crash the Next.js process — it will only fail on the first send attempt.
// ---------------------------------------------------------------------------
let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;

  const user = process.env.GMAIL_SMTP_USER;
  const pass = process.env.GMAIL_SMTP_PASS;

  if (!user || !pass) {
    throw new Error(
      "Email not configured: set GMAIL_SMTP_USER and GMAIL_SMTP_PASS in .env.local. " +
      "Use a Gmail App Password (16 chars), not your account password."
    );
  }

  _transporter = nodemailer.createTransport({
    host:   "smtp.gmail.com",
    port:   465,
    secure: true,   // SSL
    auth: { user, pass },
  });

  return _transporter;
}

// ---------------------------------------------------------------------------
// Supabase admin client for writing to notification_log (bypasses RLS).
// ---------------------------------------------------------------------------
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------
export interface SendEmailArgs {
  /** Identifies the workflow that fired this email (stored in notification_log). */
  eventType:    string;
  subject:      string;
  /** Full HTML body. Plain-text auto-generated from the HTML by Nodemailer. */
  html:         string;
  /** Recipients. Defaults to [AUTOMATION_EMAIL] if omitted. */
  recipients?:  string[];
  /** Optional foreign key stored in the log for traceability. */
  factoryId?:   string;
  referenceId?: string;
}

/**
 * Send an email and log the attempt (success or failure) to notification_log.
 * Safe to `void` / fire-and-forget — never throws.
 */
export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const recipients = args.recipients ?? [AUTOMATION_EMAIL];
  let success = false;
  let errorMsg: string | null = null;

  try {
    const transporter = getTransporter();
    const from = `"JSCI Automation" <${process.env.GMAIL_SMTP_USER}>`;

    await transporter.sendMail({
      from,
      to:      recipients.join(", "),
      subject: args.subject,
      html:    args.html,
      // Strip tags for text/plain fallback
      text:    args.html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim(),
    });

    success = true;
    console.info(`[send-email] sent "${args.subject}" to ${recipients.join(", ")}`);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[send-email] failed to send "${args.subject}":`, errorMsg);
  }

  // Always log the attempt, even when email succeeded.
  try {
    const admin = getAdminClient();
    await admin.from("notification_log").insert({
      event_type:   args.eventType,
      subject:      args.subject,
      recipients,
      success,
      error_msg:    errorMsg,
      factory_id:   args.factoryId   ?? null,
      reference_id: args.referenceId ?? null,
    });
  } catch (logErr) {
    // Log failures must never crash the caller.
    console.error("[send-email] notification_log insert failed:", logErr);
  }
}

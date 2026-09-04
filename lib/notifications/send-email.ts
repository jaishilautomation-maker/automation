// =============================================================================
// Shared email sender — Gmail API via service account + domain-wide delegation
//
// Usage (unchanged from the Nodemailer version):
//   import { sendEmail } from "@/lib/notifications/send-email";
//   await sendEmail({
//     eventType:   "pulveriser_production",
//     subject:     "[JSCI A-20/1] Job Card #JB-0451 — Production stage complete",
//     html:        "<p>...</p>",
//     factoryId:   "...",   // optional, stored in notification_log
//     referenceId: "...",   // optional, stored in notification_log
//   });
//
// Contract (unchanged):
//   - Never throws. All failures are caught, logged to console, and recorded
//     in notification_log. The caller's DB write is never blocked.
//   - Uses SUPABASE_SERVICE_ROLE_KEY to write the log (bypasses RLS).
//
// Transport:
//   - Gmail API (users.messages.send), authenticated via a Google service
//     account with domain-wide delegation.
//   - The service account impersonates automation@jaishil.com so every email
//     is sent FROM that address — no App Password, no SMTP port.
//
// Required env var (server-side only, never exposed to the browser):
//   GMAIL_SERVICE_ACCOUNT_KEY_BASE64
//     The service account JSON key file, base64-encoded.
//     On Vercel: Settings → Environment Variables → paste the base64 string.
//     Locally:   echo (Get-Content key.json -Raw) | base64 > key.b64
//                then paste the contents into .env.local.
//
// One-time Google setup (already done per task brief):
//   1. Gmail API enabled in the GCP project.
//   2. Service account created; JSON key downloaded.
//   3. Workspace Admin Console → Security → API controls →
//      Domain-wide delegation → Add the service account's Client ID with
//      scope https://www.googleapis.com/auth/gmail.send
// =============================================================================

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

// Fixed recipient for all A-20/1 workflow notifications.
export const AUTOMATION_EMAIL = "automation@jaishil.com";

// The Workspace mailbox the service account impersonates as the sender.
const SENDER_EMAIL = "automation@jaishil.com";

// ---------------------------------------------------------------------------
// Build an authenticated Gmail API client, lazily on first use.
// The JWT client is cached at module level — the token is auto-refreshed by
// google-auth-library when it expires.
// ---------------------------------------------------------------------------
let _gmailClient: ReturnType<typeof google.gmail> | null = null;

function getGmailClient(): ReturnType<typeof google.gmail> {
  if (_gmailClient) return _gmailClient;

  const keyBase64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
  if (!keyBase64) {
    throw new Error(
      "Email not configured: set GMAIL_SERVICE_ACCOUNT_KEY_BASE64 in your " +
      "environment variables. Value is the service account JSON key file " +
      "base64-encoded."
    );
  }

  // Decode and parse the service account key.
  let serviceAccountKey: {
    client_email: string;
    private_key:  string;
    [k: string]:  unknown;
  };
  try {
    serviceAccountKey = JSON.parse(
      Buffer.from(keyBase64, "base64").toString("utf-8")
    );
  } catch (err) {
    throw new Error(
      "GMAIL_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON: " +
      String(err)
    );
  }

  // Create a JWT auth client that impersonates SENDER_EMAIL via
  // domain-wide delegation.
  const auth = new google.auth.JWT({
    email:   serviceAccountKey.client_email,
    key:     serviceAccountKey.private_key,
    scopes:  ["https://www.googleapis.com/auth/gmail.send"],
    subject: SENDER_EMAIL,   // <-- this is the impersonation target
  });

  _gmailClient = google.gmail({ version: "v1", auth });
  return _gmailClient;
}

// ---------------------------------------------------------------------------
// Build a raw RFC 2822 message and base64url-encode it.
// Gmail API requires base64url (not standard base64):
//   + → -    / → _    trailing = stripped
// ---------------------------------------------------------------------------
function buildRawMessage(args: {
  from:     string;
  to:       string;
  subject:  string;
  html:     string;
  textFallback: string;
}): string {
  // Encode subject as RFC 2047 UTF-8 quoted-printable so non-ASCII survives.
  const encodedSubject = `=?UTF-8?B?${Buffer.from(args.subject).toString("base64")}?=`;

  const boundary = `boundary_${Date.now().toString(36)}`;

  const raw = [
    `From: JSCI Automation <${args.from}>`,
    `To: ${args.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    args.textFallback,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    args.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
// Public interface — identical to the previous Nodemailer version.
// ---------------------------------------------------------------------------
export interface SendEmailArgs {
  /** Identifies the workflow that fired this email (stored in notification_log). */
  eventType:    string;
  subject:      string;
  /** Full HTML body. A plain-text fallback is auto-derived by stripping tags. */
  html:         string;
  /** Recipients. Defaults to [AUTOMATION_EMAIL] if omitted. */
  recipients?:  string[];
  /** Optional foreign key stored in the log for traceability. */
  factoryId?:   string;
  referenceId?: string;
}

/**
 * Send an email via the Gmail API and log the attempt to notification_log.
 * Safe to `void` / fire-and-forget — never throws.
 */
export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const recipients = args.recipients ?? [AUTOMATION_EMAIL];
  let success   = false;
  let errorMsg: string | null = null;

  try {
    const gmail = getGmailClient();

    const textFallback = args.html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    // Gmail API sends one message at a time; loop if multiple recipients.
    for (const to of recipients) {
      const raw = buildRawMessage({
        from:         SENDER_EMAIL,
        to,
        subject:      args.subject,
        html:         args.html,
        textFallback,
      });

      await gmail.users.messages.send({
        userId:      "me",
        requestBody: { raw },
      });
    }

    success = true;
    console.info(
      `[send-email] sent "${args.subject}" to ${recipients.join(", ")}`
    );
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[send-email] failed to send "${args.subject}":`,
      errorMsg
    );
  }

  // Always log the attempt — success or failure.
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

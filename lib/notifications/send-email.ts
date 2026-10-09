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
//   - The service account impersonates chinmaythakker@jaishilsulphur.com
//     (domain-wide delegation) so emails appear from that Workspace address.
//   - Recipient is automation@jaishilsulphur.com
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
export const AUTOMATION_EMAIL = "automation@jaishilsulphur.com";

// Lab / QC mailbox. Every lab/chemist submission (eventType prefixed
// "lab_qc_") is also delivered here, in the same format, in addition to the
// AUTOMATION_EMAIL recipient.
export const LAB_QC_EMAIL = "qcdombivli@jaishilsulphur.com";
const LAB_QC_EVENT_PREFIX = "lab_qc_";

// Factory mailbox. Production and Operator job-card submissions are also
// delivered here, in the same format, in addition to AUTOMATION_EMAIL.
export const FACTORY_EMAIL = "factory@jaishilsulphur.com";
const FACTORY_EVENT_TYPES = new Set(["pulveriser_production", "pulveriser_operator"]);

// ---------------------------------------------------------------------------
// TEMPORARY global CC — every notification (all roles, all event types) is
// additionally delivered to these addresses. Remove this block (and its use
// in sendEmail below) when the temporary monitoring period ends.
// ---------------------------------------------------------------------------
const TEMP_CC_EMAILS = [
  "chinmaythakker@jaishilsulphur.com",
  "samirthakkar@jaishilsulphur.com",
  "kamalthakkar@jaishilsulphur.com",
];

// The Workspace mailbox the service account impersonates as the sender.
// Must match the account authorised in Workspace Admin → Domain-wide Delegation.
// Client ID 111764033913967609618 is delegated for this address.
const SENDER_EMAIL = "automation@jaishilsulphur.com";

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
  attachments?: EmailAttachment[];
}): string {
  // Encode subject as RFC 2047 UTF-8 quoted-printable so non-ASCII survives.
  const encodedSubject = `=?UTF-8?B?${Buffer.from(args.subject).toString("base64")}?=`;

  const altBoundary = `alt_${Date.now().toString(36)}`;

  // The body itself is always a multipart/alternative (plain + html).
  const altParts = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    args.textFallback,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    args.html,
    "",
    `--${altBoundary}--`,
  ];

  const attachments = args.attachments ?? [];

  // No attachments → the classic multipart/alternative message (unchanged
  // wire format, so existing emails look exactly as before).
  if (attachments.length === 0) {
    const raw = [
      `From: JSCI Automation <${args.from}>`,
      `To: ${args.to}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      ...altParts,
    ].join("\r\n");

    return toBase64Url(raw);
  }

  // Split into INLINE images (referenced via cid: in the HTML) and regular
  // file attachments.
  const inlineAtts = attachments.filter(a => a.cid);
  const fileAtts   = attachments.filter(a => !a.cid);

  const b64 = (buf: Buffer) => buf.toString("base64").replace(/(.{76})/g, "$1\r\n");

  // Inline images go inside a multipart/related alongside the HTML body, so
  // `<img src="cid:...">` resolves. Build that related block first.
  const relBoundary = `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const relatedParts: string[] = [
    `--${relBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    ...altParts,
    "",
  ];
  for (const att of inlineAtts) {
    relatedParts.push(
      `--${relBoundary}`,
      `Content-Type: ${att.contentType}; name="${att.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${att.cid}>`,
      `Content-Disposition: inline; filename="${att.filename}"`,
      "",
      b64(att.content),
      "",
    );
  }
  relatedParts.push(`--${relBoundary}--`);

  // Wrap the related body + any file attachments in a multipart/mixed.
  const mixedBoundary = `mixed_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const fileAttParts: string[] = [];
  for (const att of fileAtts) {
    fileAttParts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${att.contentType}; name="${att.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${att.filename}"`,
      "",
      b64(att.content),
      "",
    );
  }

  const raw = [
    `From: JSCI Automation <${args.from}>`,
    `To: ${args.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/related; boundary="${relBoundary}"`,
    "",
    ...relatedParts,
    "",
    ...fileAttParts,
    `--${mixedBoundary}--`,
  ].join("\r\n");

  return toBase64Url(raw);
}

// Gmail API requires base64url (not standard base64):
//   + → -    / → _    trailing = stripped
function toBase64Url(raw: string): string {
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
/**
 * A binary attachment carried in-memory. `content` is the raw file bytes
 * (e.g. the Buffer returned by exceljs `workbook.xlsx.writeBuffer()`); nothing
 * is ever read from or written to disk.
 */
export interface EmailAttachment {
  filename:    string;
  /** MIME type, e.g. the .xlsx type for a populated report workbook. */
  contentType: string;
  content:     Buffer;
  /**
   * Optional Content-ID. When set, the part is embedded INLINE (referenced by
   * `<img src="cid:THIS_VALUE">` in the HTML) instead of being a downloadable
   * attachment. Used for lab QC photos shown in the email body.
   */
  cid?:        string;
}

/** Standard MIME type for a modern .xlsx workbook. */
export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
  /** Optional in-memory file attachments (e.g. a populated .xlsx report). */
  attachments?: EmailAttachment[];
}

/**
 * Send an email via the Gmail API and log the attempt to notification_log.
 * Safe to `void` / fire-and-forget — never throws.
 */
export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const baseRecipients = args.recipients ?? [AUTOMATION_EMAIL];
  // Lab/chemist submissions are additionally CC'd to the Lab QC mailbox, in the
  // same format. Applied here (server-side, by eventType) so it covers every
  // lab-qc page without each caller having to opt in. Deduplicated in case the
  // caller already listed it.
  let recipients = args.eventType?.startsWith(LAB_QC_EVENT_PREFIX)
    ? Array.from(new Set([...baseRecipients, LAB_QC_EMAIL]))
    : baseRecipients;

  // Production / Operator job-card submissions are additionally delivered to
  // the factory mailbox, in the same format. Applied here (server-side, by
  // eventType) so every caller is covered. Deduplicated.
  if (args.eventType && FACTORY_EVENT_TYPES.has(args.eventType)) {
    recipients = Array.from(new Set([...recipients, FACTORY_EMAIL]));
  }

  // TEMPORARY: CC every notification to the monitoring addresses. Remove this
  // line (and the TEMP_CC_EMAILS constant above) when no longer needed.
  recipients = Array.from(new Set([...recipients, ...TEMP_CC_EMAILS]));
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
        attachments:  args.attachments,
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

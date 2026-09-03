// =============================================================================
// POST /api/auth/sms-hook
//
// Supabase Send SMS Hook endpoint.
// Supabase calls this every time a phone OTP needs to be delivered.
//
// Flow:
//   1. Verify Standard Webhooks signature (SUPABASE_SMS_HOOK_SECRET).
//      Reject with 401 if invalid — Supabase surfaces this as "couldn't send".
//   2. Extract phone (E.164) from payload.user.phone and OTP from payload.sms.otp.
//   3. Split phone into countryCode + local number for Interakt's API.
//   4. POST to Interakt's send-message API with the approved template.
//   5. Write a row to otp_notification_log (phone masked to last 4 digits,
//      phone SHA-256 hash, success/failure, provider response).
//   6. Return:
//      - 200 {}                      → success, Supabase marks "code sent"
//      - 200 { error: {...} }        → failure, Supabase surfaces to the user
//        (per Supabase docs, use { error: { http_code, message } } shape)
//
// Env vars required (server-side only — never NEXT_PUBLIC_):
//   SUPABASE_SMS_HOOK_SECRET          from Supabase Dashboard → Auth → Hooks
//   INTERAKT_API_KEY                  from Interakt Dashboard → Developer Settings
//   INTERAKT_WHATSAPP_TEMPLATE_NAME   e.g. "jsci_login_otp"
//   SUPABASE_SERVICE_ROLE_KEY         for writing otp_notification_log
//   NEXT_PUBLIC_SUPABASE_URL          for the service-role client
//   NEXT_PUBLIC_FACTORY_CODE          optional, stored in log for multi-app triage
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "standardwebhooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supabase Send SMS Hook payload (from official JSON schema) */
interface SmsSendPayload {
  user: {
    id: string;
    phone: string; // E.164, e.g. "+919876543210"
    [key: string]: unknown;
  };
  sms: {
    otp: string; // 6-digit string
  };
}

/** Supabase hook error response shape */
interface HookErrorBody {
  error: {
    http_code: number;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Service-role client (bypasses RLS for log writes)
// ---------------------------------------------------------------------------
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase service role env vars missing");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split an E.164 number into { countryCode, localNumber } for Interakt's API.
 * Interakt wants:
 *   countryCode: "+91"       (with the leading +)
 *   phoneNumber: "9876543210" (no country code, no leading zero)
 *
 * We support any country code by matching the leading + and digits before the
 * 10-digit subscriber number.  For all Indian numbers (+91XXXXXXXXXX) this is
 * deterministic; for other countries we fall back to assuming 10-digit local.
 */
function splitPhone(e164: string): { countryCode: string; localNumber: string } {
  // Strip the leading + and work with digits only
  const digits = e164.startsWith("+") ? e164.slice(1) : e164;

  // India (+91) — 12 digits total: 2 CC + 10 local
  if (digits.startsWith("91") && digits.length === 12) {
    return { countryCode: "+91", localNumber: digits.slice(2) };
  }

  // Generic fallback: assume last 10 digits are local, rest is country code
  if (digits.length > 10) {
    const ccDigits = digits.slice(0, digits.length - 10);
    return { countryCode: `+${ccDigits}`, localNumber: digits.slice(-10) };
  }

  // No country code detectable — return as-is (will likely fail at Interakt)
  return { countryCode: "+91", localNumber: digits };
}

/** Last-4 mask for log storage: "+91XXXXXX5678" */
function maskPhone(e164: string): string {
  if (e164.length <= 4) return "****";
  return "*".repeat(e164.length - 4) + e164.slice(-4);
}

/** SHA-256 hex digest of the phone number for deduplicate queries */
async function hashPhone(e164: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(e164),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Write one row to otp_notification_log.  Fire-and-forget — never throws. */
async function writeLog(row: {
  phone_masked: string;
  phone_hash: string;
  success: boolean;
  provider_status: number | null;
  provider_msg: string | null;
}): Promise<void> {
  try {
    const admin = getServiceClient();
    await admin.from("otp_notification_log").insert({
      phone_masked:    row.phone_masked,
      phone_hash:      row.phone_hash,
      success:         row.success,
      provider_status: row.provider_status,
      provider_msg:    row.provider_msg ? row.provider_msg.slice(0, 512) : null,
      provider:        "whatsapp_interakt",
      factory_code:    process.env.NEXT_PUBLIC_FACTORY_CODE ?? null,
    });
  } catch (logErr) {
    // Log write failure must never block or change the hook response
    console.error("[sms-hook] Failed to write otp_notification_log:", logErr);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 0. Guard: required env vars ──────────────────────────────────────────
  const rawSecret      = process.env.SUPABASE_SMS_HOOK_SECRET;
  const interaktApiKey = process.env.INTERAKT_API_KEY;
  const templateName   = process.env.INTERAKT_WHATSAPP_TEMPLATE_NAME;

  if (!rawSecret || !interaktApiKey || !templateName) {
    console.error(
      "[sms-hook] Missing required env vars:",
      !rawSecret      ? "SUPABASE_SMS_HOOK_SECRET " : "",
      !interaktApiKey ? "INTERAKT_API_KEY " : "",
      !templateName   ? "INTERAKT_WHATSAPP_TEMPLATE_NAME" : "",
    );
    // Return a proper hook error so Supabase surfaces it rather than timing out
    const body: HookErrorBody = {
      error: { http_code: 500, message: "SMS hook is not configured on this server." },
    };
    return NextResponse.json(body, { status: 200 });
  }

  // ── 1. Read raw body (needed for signature verification) ─────────────────
  const rawBody = await request.text();

  // ── 2. Verify Standard Webhooks signature ────────────────────────────────
  // Supabase stores the secret as "v1,whsec_<base64>".
  // The standardwebhooks library expects just the base64 portion.
  const base64Secret = rawSecret.replace(/^v1,whsec_/, "");

  let payload: SmsSendPayload;
  try {
    const wh = new Webhook(base64Secret);
    // wh.verify throws if signature is invalid or timestamp is too old
    payload = wh.verify(rawBody, Object.fromEntries(request.headers)) as SmsSendPayload;
  } catch (verifyErr) {
    console.warn("[sms-hook] Signature verification failed:", verifyErr);
    // 401 → Supabase will NOT retry and will surface error to user
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phone = payload?.user?.phone;
  const otp   = payload?.sms?.otp;

  if (!phone || !otp) {
    console.error("[sms-hook] Payload missing phone or otp:", { phone, otp });
    const body: HookErrorBody = {
      error: { http_code: 400, message: "Invalid hook payload: missing phone or otp." },
    };
    return NextResponse.json(body, { status: 200 });
  }

  // Pre-compute log fields — done before the Interakt call so we always log
  const phoneMasked = maskPhone(phone);
  const phoneHash   = await hashPhone(phone);

  // ── 3. Send WhatsApp message via Interakt ─────────────────────────────────
  const { countryCode, localNumber } = splitPhone(phone);

  const interaktBody = {
    countryCode,
    phoneNumber: localNumber,
    type: "Template",
    template: {
      name:         templateName,
      languageCode: "en",
      bodyValues:   [otp], // {{1}} in the jsci_login_otp template
    },
  };

  let providerStatus: number | null = null;
  let providerMsg: string | null    = null;
  let success = false;

  try {
    const resp = await fetch("https://api.interakt.ai/v1/public/message/", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Basic ${interaktApiKey}`,
      },
      body: JSON.stringify(interaktBody),
    });

    providerStatus = resp.status;
    const respText = await resp.text().catch(() => "");
    providerMsg    = respText.slice(0, 512);

    if (resp.ok) {
      success = true;
      console.log(
        `[sms-hook] OTP sent via Interakt to ${phoneMasked} (${providerStatus})`,
      );
    } else {
      console.error(
        `[sms-hook] Interakt returned ${providerStatus} for ${phoneMasked}:`,
        providerMsg,
      );
    }
  } catch (fetchErr) {
    providerMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    console.error("[sms-hook] Network error calling Interakt:", providerMsg);
  }

  // ── 4. Write audit log (fire-and-forget) ─────────────────────────────────
  await writeLog({ phone_masked: phoneMasked, phone_hash: phoneHash, success, provider_status: providerStatus, provider_msg: providerMsg });

  // ── 5. Return hook response ───────────────────────────────────────────────
  if (success) {
    // Empty 200 = success; Supabase tells the client "code sent"
    return NextResponse.json({}, { status: 200 });
  }

  // Non-empty error body = failure; Supabase surfaces this to the client
  // so the user knows to retry rather than waiting for a code that won't arrive.
  const errorBody: HookErrorBody = {
    error: {
      http_code: providerStatus ?? 503,
      message: `Failed to deliver OTP via WhatsApp. Provider response: ${providerMsg ?? "no response"}`,
    },
  };
  return NextResponse.json(errorBody, { status: 200 });
}

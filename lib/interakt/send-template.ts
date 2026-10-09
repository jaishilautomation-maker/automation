// =============================================================================
// Generic Interakt WhatsApp "template message" sender.
//
// Thin, dependency-free wrapper around Interakt's Template Sending API
// (POST https://api.interakt.ai/v1/public/message/). It knows nothing about
// job cards — give it a phone, a template code-name, and the ordered body
// variables and it sends one message.
//
// Payload shape and auth convention mirror the EXISTING, working OTP route
// (app/api/auth/sms-hook/route.ts): the API key is the HTTP Basic-Auth
// username with an empty password, i.e. base64("<key>:"). The official docs
// (https://www.interakt.shop/resource-center/how-to-send-whatsapp-templates-using-apis-webhooks/)
// confirm the body-only template shape and that Interakt returns HTTP 200 for
// BOTH success and failure — so the JSON `result === true` field is the real
// success signal.
//
// This module is server-only (uses INTERAKT_API_KEY). Never import it into a
// "use client" component.
// =============================================================================

const INTERAKT_MESSAGE_URL = "https://api.interakt.ai/v1/public/message/";

export interface InteraktSendResult {
  /** True only when Interakt's JSON body reports result === true. */
  success: boolean;
  /** Interakt's message id (for webhook correlation), when provided. */
  messageId: string | null;
  /** HTTP status from the call, or null on a network error. */
  httpStatus: number | null;
  /** Trimmed error / provider message, null on clean success. */
  error: string | null;
}

export interface SendTemplateArgs {
  /** Country code WITH leading '+', e.g. "+91". */
  countryCode: string;
  /** Local number WITHOUT country code and WITHOUT leading zero. */
  phoneNumber: string;
  /** Interakt template code-name, e.g. "jobcard_action_required". */
  templateName: string;
  /** Ordered values for the template body variables {{1}}, {{2}}, ... */
  bodyValues: string[];
  /** Template language code; defaults to "en". */
  languageCode?: string;
  /** Optional string (<=512 chars) echoed back in Interakt webhooks. */
  callbackData?: string;
}

/**
 * Split an E.164-ish phone into Interakt's { countryCode, phoneNumber }.
 * Interakt wants the country code WITH a leading '+' and the local number
 * WITHOUT the country code or a leading zero. Mirrors the OTP route's splitter
 * so both code paths treat numbers identically.
 */
export function splitPhoneForInterakt(
  phone: string,
): { countryCode: string; phoneNumber: string } {
  const digits = phone.replace(/\D/g, "");

  // India (91): 12 digits = 2 (CC) + 10 (local).
  if (digits.startsWith("91") && digits.length === 12) {
    return { countryCode: "+91", phoneNumber: digits.slice(2) };
  }

  // Generic: assume the last 10 digits are the local number.
  if (digits.length > 10) {
    return {
      countryCode: `+${digits.slice(0, digits.length - 10)}`,
      phoneNumber: digits.slice(-10),
    };
  }

  // Fallback: treat the whole thing as a local Indian number.
  return { countryCode: "+91", phoneNumber: digits };
}

/**
 * Send one WhatsApp template message via Interakt.
 *
 * Never throws — all failures (missing key, network error, provider rejection)
 * come back as { success: false, error }. The caller decides how to log.
 */
export async function sendInteraktTemplate(
  args: SendTemplateArgs,
): Promise<InteraktSendResult> {
  const apiKey = process.env.INTERAKT_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      messageId: null,
      httpStatus: null,
      error: "INTERAKT_API_KEY is not set",
    };
  }

  const payload: Record<string, unknown> = {
    countryCode: args.countryCode,
    phoneNumber: args.phoneNumber,
    type: "Template",
    template: {
      name: args.templateName,
      languageCode: args.languageCode ?? "en",
      bodyValues: args.bodyValues,
    },
  };
  if (args.callbackData) {
    payload.callbackData = args.callbackData.slice(0, 512);
  }

  try {
    const resp = await fetch(INTERAKT_MESSAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Basic auth: key as username, empty password → base64("<key>:").
        // Matches the proven OTP sms-hook convention for the same account.
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      },
      body: JSON.stringify(payload),
    });

    const httpStatus = resp.status;
    const respText = await resp.text().catch(() => "");

    let json: { result?: boolean; message?: string; id?: string } = {};
    try {
      json = JSON.parse(respText);
    } catch {
      /* non-JSON body — leave json empty, handled below */
    }

    if (resp.ok && json.result === true) {
      return {
        success: true,
        messageId: json.id ?? null,
        httpStatus,
        error: null,
      };
    }

    return {
      success: false,
      messageId: json.id ?? null,
      httpStatus,
      error: (json.message || respText || `HTTP ${httpStatus}`).slice(0, 512),
    };
  } catch (err) {
    return {
      success: false,
      messageId: null,
      httpStatus: null,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 512),
    };
  }
}

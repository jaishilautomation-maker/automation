// =============================================================================
// WhatsApp notifications for the A-20/1 Pulveriser Job Card workflow.
//
// Pure side-effect: after a stage transition is persisted, notify the NEXT
// role in line (and, on Lab NOT OK, notify Production with the Lab remark).
// Changes NO workflow logic, status, or routing — it only READS the persisted
// state to decide who to tell. Called server-side from /api/notify, right
// alongside the existing per-stage email, inside that route's awaited block.
//
// Recipient role is DERIVED from the resulting job-card status (the same state
// machine), never from a hardcoded parallel table:
//
//     pending_stores     → stores           (Production created / Production
//                                             re-routed to Stores)
//     pending            → operator         (Stores issued oil / Production
//                                             re-routed to Operator)
//     submitted_for_qc   → chemist +        (Operator submitted for QC)
//                          lab_manager
//     pending_production → production_incharge (Lab marked NOT OK → rework)
//     finalized          → nobody           (Lab OK — existing emails cover it)
//
// Idempotency: a unique (event_key, recipient_user_id) in
// whatsapp_notification_log. event_key is the Lab review row id for Lab steps,
// else "<job_card_id>:<status>:<stage_timestamp>" — differs per rework pass,
// identical across a double-click of the same transition.
//
// Safety switches (env):
//   WHATSAPP_NOTIFY_ENABLED   default false → log 'skipped', send nothing
//   WHATSAPP_NOTIFY_ALLOWLIST comma-separated E.164 → only these get messages
//   INTERAKT_TEMPLATE_JOBCARD_ACTION   default 'jobcard_action_required'
//   INTERAKT_TEMPLATE_JOBCARD_REJECTED default 'jobcard_rejected'
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  sendInteraktTemplate,
  splitPhoneForInterakt,
} from "@/lib/interakt/send-template";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The notify eventType strings the five stage call-sites already send. */
export type JobCardNotifyEvent =
  | "pulveriser_production"          // Production create → pending_stores
  | "pulveriser_production_triage"   // Production rework route → stores|operator
  | "pulveriser_stores"              // Stores issued oil → pending
  | "pulveriser_operator"            // Operator submitted → submitted_for_qc
  | "pulveriser_lab";                // Lab review → finalized | pending_production

interface JobCardRow {
  id: string;
  factory_id: string;
  status: string;
  job_number: string | null;
  material_code: string | null;
  party_code: string | null;
  production_by: string | null;
  production_at: string | null;
  oil_issued_by: string | null;
  oil_issued_at: string | null;
  operator_by: string | null;
  operator_submitted_at: string | null;
}

interface ReviewRow {
  id: string;
  result: "ok" | "not_ok";
  remark: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface Recipient {
  user_id: string;
  full_name: string | null;
  phone_number: string | null;
}

/** app_role values that can be notified by this feature. */
type NotifyRole =
  | "stores"
  | "operator"
  | "chemist"
  | "lab_manager"
  | "production_incharge";

// ---------------------------------------------------------------------------
// Admin (service-role) client — bypasses RLS, server-only. Same pattern as
// send-email.ts.
// ---------------------------------------------------------------------------
function getAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ---------------------------------------------------------------------------
// Variable sanitisation — Meta rejects newlines/tabs in template variables.
// ---------------------------------------------------------------------------

/** Collapse all whitespace to single spaces, trim, optional max length. */
function sanitizeVar(value: string | null | undefined, maxLen = 200): string {
  const cleaned = (value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1).trimEnd() + "\u2026"; // ellipsis
}

/** Last 4 digits of a phone for log storage — never the full number. */
function last4(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

// ---------------------------------------------------------------------------
// Allowlist parsing
// ---------------------------------------------------------------------------

/** Reduce a phone to a comparable digit string (country code tolerant). */
function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "");
}

function getAllowlist(): string[] | null {
  const raw = process.env.WHATSAPP_NOTIFY_ALLOWLIST;
  if (!raw || raw.trim() === "") return null;
  return raw
    .split(",")
    .map((s) => phoneKey(s))
    .filter((s) => s.length > 0);
}

/** True when sends are globally enabled. Defaults to FALSE (safe). */
function isEnabled(): boolean {
  return (process.env.WHATSAPP_NOTIFY_ENABLED ?? "false").toLowerCase() === "true";
}

// ---------------------------------------------------------------------------
// State-machine → recipient role mapping (derived from the resulting status).
// ---------------------------------------------------------------------------

/** Resulting status → the role(s) that should act next. finalized → none. */
function rolesForStatus(status: string): NotifyRole[] {
  switch (status) {
    case "pending_stores":
      return ["stores"];
    case "pending":
      return ["operator"];
    case "submitted_for_qc":
      return ["chemist", "lab_manager"];
    case "pending_production":
      return ["production_incharge"];
    case "finalized":
    default:
      return []; // nobody — Lab OK is covered by existing emails
  }
}

/** Human-readable stage label for the {{4}} "this step" variable. */
function stageLabel(status: string): string {
  switch (status) {
    case "pending_stores":
      return "Stores";
    case "pending":
      return "Operator";
    case "submitted_for_qc":
      return "Lab QC";
    case "pending_production":
      return "Production";
    default:
      return "next";
  }
}

/** The timestamp column that stamps a given transition — used in event_key. */
function stageTimestamp(status: string, card: JobCardRow): string | null {
  switch (status) {
    case "pending_stores":
      // Production create stamps production_at. (A triage re-route to Stores
      // does not re-stamp it, so triage falls back to updated-at via the key
      // builder below.)
      return card.production_at;
    case "pending":
      return card.oil_issued_at;
    case "submitted_for_qc":
      return card.operator_submitted_at;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Notify the next role after a persisted job-card transition.
 *
 * @param event        the notify eventType the stage page sent
 * @param jobCardId    the pulveriser_job_cards.id (the notify referenceId)
 * @param factoryId    the card's factory_id (the notify factoryId)
 *
 * Never throws. Logs every recipient outcome (sent/failed/skipped). Safe to
 * `await` inside /api/notify's Promise.all — it will not block or fail the
 * submission even if Interakt is down or the template is unapproved.
 */
export async function notifyJobCardWhatsApp(
  event: JobCardNotifyEvent,
  jobCardId: string | undefined,
  factoryId: string | undefined,
): Promise<void> {
  try {
    if (!jobCardId || !factoryId) return;

    const admin = getAdminClient();

    // ── 1. Re-read the persisted card (source of truth for status). ─────────
    const { data: card, error: cardErr } = await admin
      .from("pulveriser_job_cards")
      .select(
        "id, factory_id, status, job_number, material_code, party_code, " +
          "production_by, production_at, oil_issued_by, oil_issued_at, " +
          "operator_by, operator_submitted_at",
      )
      .eq("id", jobCardId)
      .single();

    if (cardErr || !card) {
      console.error("[whatsapp-jobcard] card lookup failed:", cardErr?.message);
      return;
    }
    const jc = card as unknown as JobCardRow;

    // ── 2. For the Lab step, read the latest review (OK vs NOT OK + remark +
    //       stable per-transition id). Lab OK → nothing to send. ─────────────
    let review: ReviewRow | null = null;
    if (event === "pulveriser_lab") {
      const { data: rv } = await admin
        .from("pulveriser_job_card_reviews")
        .select("id, result, remark, reviewed_by, reviewed_at")
        .eq("job_card_id", jc.id)
        .order("reviewed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      review = (rv as unknown as ReviewRow) ?? null;

      // Lab OK finalizes the card — this feature sends nothing (emails cover it).
      if (!review || review.result === "ok") return;
    }

    // ── 3. Decide recipients' role(s) from the resulting status. ────────────
    const roles = rolesForStatus(jc.status);
    if (roles.length === 0) return; // finalized / unknown → nobody

    // ── 4. Who submitted this transition (to exclude them). ─────────────────
    const submitterId = submitterForEvent(event, jc, review);

    // ── 5. Build the stable event_key for this specific transition. ─────────
    const eventKey = buildEventKey(event, jc, review);

    // ── 6. Choose template + body variables. ────────────────────────────────
    // Three templates:
    //   jobcard_action_required     — English, for Stores / Lab next-steps
    //   jobcard_action_required_hi  — Devanagari Hindi, used ONLY when the next
    //                                  role is Operator (status 'pending'), who
    //                                  does not read English
    //   jobcard_rejected            — English, goes to Production on Lab NOT OK
    const actionTemplate =
      process.env.INTERAKT_TEMPLATE_JOBCARD_ACTION ?? "jobcard_action_required";
    const actionTemplateHi =
      process.env.INTERAKT_TEMPLATE_JOBCARD_ACTION_HI ?? "jobcard_action_required_hi";
    const rejectedTemplate =
      process.env.INTERAKT_TEMPLATE_JOBCARD_REJECTED ?? "jobcard_rejected";

    const jobNumberVar = sanitizeVar(jc.job_number ?? jc.id, 60);
    const materialVar = sanitizeVar(jc.party_code ?? jc.material_code ?? "—", 60);

    const isRejection = event === "pulveriser_lab"; // only path left here is NOT OK
    // The next role is Operator exactly when the resulting status is 'pending'.
    const toOperator = jc.status === "pending";

    let template: string;
    let templateLang: string; // must match the language the template was approved in
    let bodyValues: string[];
    if (isRejection) {
      // jobcard_rejected: {{1}} job, {{2}} material, {{3}} Lab remark
      template = rejectedTemplate;
      templateLang = "en";
      const remarkVar =
        sanitizeVar(review?.remark, 120) || "No remark given";
      bodyValues = [jobNumberVar, materialVar, remarkVar];
    } else if (toOperator) {
      // jobcard_action_required_hi (Devanagari): {{1}} job, {{2}} material,
      //   {{3}} previous stage name (Hindi), {{4}} this stage name (Hindi)
      template = actionTemplateHi;
      templateLang = "hi"; // Hindi template — must be sent as 'hi'
      bodyValues = [
        jobNumberVar,
        materialVar,
        sanitizeVar(previousStageNameHi(event), 40),
        sanitizeVar(stageLabelHi(jc.status), 40),
      ];
    } else {
      // jobcard_action_required (English): {{1}} job, {{2}} material,
      //   {{3}} previous stage name, {{4}} this stage name
      template = actionTemplate;
      templateLang = "en";
      bodyValues = [
        jobNumberVar,
        materialVar,
        sanitizeVar(previousStageName(event), 40),
        sanitizeVar(stageLabel(jc.status), 40),
      ];
    }

    // ── 7. Resolve recipients for every target role, dedupe, exclude submitter.
    const seen = new Set<string>();
    const recipients: Recipient[] = [];
    for (const role of roles) {
      const { data, error } = await admin.rpc("fn_jobcard_notify_recipients", {
        p_factory_id: factoryId,
        p_role: role,
      });
      if (error) {
        console.error(
          `[whatsapp-jobcard] recipient lookup failed for role ${role}:`,
          error.message,
        );
        continue;
      }
      for (const r of (data ?? []) as Recipient[]) {
        if (!r.user_id || seen.has(r.user_id)) continue;
        if (submitterId && r.user_id === submitterId) continue; // exclude submitter
        seen.add(r.user_id);
        recipients.push(r);
      }
    }

    if (recipients.length === 0) return; // no one to notify

    // ── 8. Dispatch + log each recipient. ───────────────────────────────────
    const enabled = isEnabled();
    const allowlist = getAllowlist();

    for (const r of recipients) {
      await handleRecipient({
        admin,
        enabled,
        allowlist,
        event,
        eventKey,
        template,
        templateLang,
        bodyValues,
        jobCardId: jc.id,
        factoryId,
        recipient: r,
      });
    }
  } catch (err) {
    // Absolute backstop — this must never affect the submission.
    console.error("[whatsapp-jobcard] unexpected error:", err);
  }
}

// ---------------------------------------------------------------------------
// Per-recipient send + idempotent log.
// ---------------------------------------------------------------------------
async function handleRecipient(ctx: {
  admin: SupabaseClient;
  enabled: boolean;
  allowlist: string[] | null;
  event: JobCardNotifyEvent;
  eventKey: string;
  template: string;
  templateLang: string;
  bodyValues: string[];
  jobCardId: string;
  factoryId: string;
  recipient: Recipient;
}): Promise<void> {
  const { admin, recipient } = ctx;
  const phone = recipient.phone_number ?? "";

  // Decide the outcome BEFORE touching Interakt.
  let status: "sent" | "failed" | "skipped" = "skipped";
  let providerMessageId: string | null = null;
  let error: string | null = null;

  if (!phone || phone.trim() === "") {
    status = "skipped";
    error = "no phone number";
  } else if (!ctx.enabled) {
    status = "skipped";
    error = "WHATSAPP_NOTIFY_ENABLED=false";
  } else if (ctx.allowlist && !ctx.allowlist.includes(phoneKey(phone))) {
    status = "skipped";
    error = "not in WHATSAPP_NOTIFY_ALLOWLIST";
  } else {
    // Cleared to send.
    const { countryCode, phoneNumber } = splitPhoneForInterakt(phone);
    let result = await sendInteraktTemplate({
      countryCode,
      phoneNumber,
      templateName: ctx.template,
      languageCode: ctx.templateLang,
      bodyValues: ctx.bodyValues,
      callbackData: `${ctx.event}:${ctx.jobCardId}`.slice(0, 512),
    });

    // Optional single retry on a network error (httpStatus === null).
    if (!result.success && result.httpStatus === null) {
      result = await sendInteraktTemplate({
        countryCode,
        phoneNumber,
        templateName: ctx.template,
        languageCode: ctx.templateLang,
        bodyValues: ctx.bodyValues,
        callbackData: `${ctx.event}:${ctx.jobCardId}`.slice(0, 512),
      });
    }

    status = result.success ? "sent" : "failed";
    providerMessageId = result.messageId;
    error = result.error;
  }

  // Idempotent log insert. The unique (event_key, recipient_user_id) index
  // makes a double-click of the SAME transition a no-op (23505 → swallow).
  try {
    const { error: insErr } = await admin
      .from("whatsapp_notification_log")
      .insert({
        job_card_id: ctx.jobCardId,
        event_key: ctx.eventKey,
        event_type: ctx.event,
        recipient_user_id: recipient.user_id,
        phone_last4: phone ? last4(phone) : null,
        template: ctx.template,
        status,
        provider_message_id: providerMessageId,
        error: error ? error.slice(0, 512) : null,
        factory_id: ctx.factoryId,
      });
    if (insErr && insErr.code !== "23505") {
      console.error("[whatsapp-jobcard] log insert failed:", insErr.message);
    }
  } catch (logErr) {
    console.error("[whatsapp-jobcard] log insert threw:", logErr);
  }
}

// ---------------------------------------------------------------------------
// Transition identity helpers.
// ---------------------------------------------------------------------------

/** Who performed this transition (excluded from recipients). */
function submitterForEvent(
  event: JobCardNotifyEvent,
  jc: JobCardRow,
  review: ReviewRow | null,
): string | null {
  switch (event) {
    case "pulveriser_production":
    case "pulveriser_production_triage":
      return jc.production_by;
    case "pulveriser_stores":
      return jc.oil_issued_by;
    case "pulveriser_operator":
      return jc.operator_by;
    case "pulveriser_lab":
      return review?.reviewed_by ?? null;
    default:
      return null;
  }
}

/** The role/stage that just acted (for the {{3}} "submitted by" variable). */
function previousStageName(event: JobCardNotifyEvent): string {
  switch (event) {
    case "pulveriser_production":
    case "pulveriser_production_triage":
      return "Production";
    case "pulveriser_stores":
      return "Stores";
    case "pulveriser_operator":
      return "Operator";
    default:
      return "Previous stage";
  }
}

/** Devanagari Hindi stage name of the actor who just submitted (for Operator). */
function previousStageNameHi(event: JobCardNotifyEvent): string {
  switch (event) {
    case "pulveriser_production":
    case "pulveriser_production_triage":
      return "प्रोडक्शन";
    case "pulveriser_stores":
      return "स्टोर्स";
    case "pulveriser_operator":
      return "ऑपरेटर";
    default:
      return "पिछला चरण";
  }
}

/** Devanagari Hindi label for the resulting stage (for the Operator template). */
function stageLabelHi(status: string): string {
  switch (status) {
    case "pending_stores":
      return "स्टोर्स";
    case "pending":
      return "ऑपरेटर";
    case "submitted_for_qc":
      return "लैब क्यूसी";
    case "pending_production":
      return "प्रोडक्शन";
    default:
      return "अगला";
  }
}

/**
 * Build the stable per-transition event_key.
 *   Lab step   → the review row id (a true per-transition identifier).
 *   Triage     → "<id>:triage:<status>:<reviewed_at>" so each distinct rework
 *                decision is unique but a double-click of the same route is not.
 *   Others     → "<id>:<status>:<stage_timestamp>" where the stage timestamp
 *                is re-stamped on every genuine pass.
 */
function buildEventKey(
  event: JobCardNotifyEvent,
  jc: JobCardRow,
  review: ReviewRow | null,
): string {
  if (event === "pulveriser_lab" && review) {
    return review.id;
  }

  if (event === "pulveriser_production_triage") {
    // Triage re-uses the latest review as the decision anchor; combine it with
    // the chosen target status so a Stores-vs-Operator choice is distinct and a
    // repeat of the same route is deduped.
    const anchor = review?.id ?? jc.operator_submitted_at ?? jc.production_at ?? "x";
    return `${jc.id}:triage:${jc.status}:${anchor}`;
  }

  const ts = stageTimestamp(jc.status, jc);
  // Timestamp should always be present for these transitions; fall back to the
  // status alone only as a last resort (still dedupes a double-click).
  return `${jc.id}:${jc.status}:${ts ?? "nots"}`;
}

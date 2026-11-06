// =============================================================================
// "Limit exceeded" management email (A-20 Phase A -> chemist -> Phase B flow).
//
// Server-only. Recipients come from public.notification_recipients
// (entry_type = 'limit_exceeded'), never from code. Sent through the existing
// Gmail sender (sendEmail), which also logs to notification_log.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./send-email";
import { fmtKg, fmtPct } from "@/lib/job-card/phase-b-calc";
import type { PhaseBSnapshot } from "@/lib/job-card/phase-b-review";

export const LIMIT_EXCEEDED_ENTRY_TYPE = "limit_exceeded";

export interface LimitEmailCard {
  id: string;
  factory_id: string;
  lot_no: string;
  limit_exceeded_case: number | null;
  limit_remark: string | null;
  phase_b_calc: PhaseBSnapshot | null;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Active management recipients for this factory (factory-specific + global rows). */
export async function limitExceededRecipients(factoryId: string): Promise<string[]> {
  const { data, error } = await admin()
    .from("notification_recipients")
    .select("email, factory_id")
    .eq("entry_type", LIMIT_EXCEEDED_ENTRY_TYPE)
    .eq("is_active", true)
    .or(`factory_id.is.null,factory_id.eq.${factoryId}`);
  if (error) {
    console.error("[limit-exceeded-email] recipients lookup failed:", error.message);
    return [];
  }
  return Array.from(new Set((data ?? []).map(r => String(r.email).trim()).filter(Boolean)));
}

export function buildLimitExceededHtml(productName: string, card: LimitEmailCard): string {
  const s = card.phase_b_calc;
  const o = s?.outputs;
  const caseNo = card.limit_exceeded_case;
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;
  const remark = card.limit_remark?.trim();

  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
  <h2 style="color:#b71c1c;margin:0 0 8px">LIMIT EXCEEDED - lot rejected</h2>
  <p style="margin:0 0 12px">${
    caseNo === 1
      ? "Phase A concentration is at or below the target active content. No Phase B quantities can be issued."
      : "The Phase B ingredients at their formulation % need more than the room available. Water is 0 and the target cannot be reached."
  }</p>
  <table style="border-collapse:collapse">
    ${row("Product", productName)}
    ${row("Lot", card.lot_no)}
    ${row("Case", caseNo === 1 ? "1 - concentration at/below target" : "2 - ingredients exceed available room")}
    ${row("Phase A weight", `${fmtKg(s?.inputs.phaseAKg)} kg`)}
    ${row("Phase A concentration", `${fmtPct(s?.inputs.concPct)} %`)}
    ${row("Target active content", `${fmtPct(s?.inputs.appliedTargetPct)} %`)}
    ${caseNo === 2 ? row("Needed (non-water Phase B)", `${fmtKg(o?.neededKg)} kg`) : ""}
    ${caseNo === 2 ? row("Available (Phase B room)", `${fmtKg(o?.availableKg)} kg`) : ""}
    ${caseNo === 1 ? row("Target weight vs Phase A", `${fmtKg(o?.targetWeight)} kg vs ${fmtKg(s?.inputs.phaseAKg)} kg`) : ""}
    ${caseNo === 2 ? row("Achieved active content", `${fmtPct(o?.achievedActivePct)} %`) : ""}
    ${row("Operator remark", remark ? remark : "(pending - operator has not entered a remark yet)")}
  </table>
</div>`;
}

/**
 * Send (or re-send, once the remark is entered) the limit-exceeded email.
 * Never throws. Returns whether any management recipient was configured.
 */
export async function sendLimitExceededEmail(
  productName: string, card: LimitEmailCard, stage: "flagged" | "remark",
): Promise<{ configured: boolean; recipients: number }> {
  try {
    const to = await limitExceededRecipients(card.factory_id);
    if (to.length === 0) {
      console.warn("[limit-exceeded-email] no active 'limit_exceeded' recipients in notification_recipients; using the default mailbox.");
    }
    await sendEmail({
      eventType: "job_card_limit_exceeded",
      subject: `[A-20] LIMIT EXCEEDED - ${productName} lot ${card.lot_no}${stage === "remark" ? " (operator remark added)" : ""}`,
      html: buildLimitExceededHtml(productName, card),
      recipients: to.length ? to : undefined,
      factoryId: card.factory_id,
      referenceId: card.id,
    });
    return { configured: to.length > 0, recipients: to.length };
  } catch (e) {
    console.error("[limit-exceeded-email] failed:", e);
    return { configured: false, recipients: 0 };
  }
}

// =============================================================================
// GET /api/field-audit-digest  (called daily by Vercel Cron at 06:30 UTC)
//
// Queries field_entry_log for the previous calendar day, builds a short
// human-readable summary + a CSV attachment, and sends exactly ONE email
// via the existing Gmail sender.  No Sheets or Interakt calls are made.
//
// Summary format (email body):
//   Date: YYYY-MM-DD
//   Total field entries: 340
//   Distinct users: 16
//   Modules touched: batch_analysis, rm_qc, job_card, breakdown
//   Average entered_at → recorded_at gap: 8s  (flag: max gap 12m 3s for user X)
//
// Attachment: field_audit_YYYY-MM-DD.csv
//   Columns: recorded_at, entered_at, gap_seconds, module, field_name,
//            field_value, user_name, record_id
//
// Cron schedule: 0 30 6 * * *  (06:30 UTC daily, after the 06:00 qc-exchange retry)
// =============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/notifications/send-email";

const AUTOMATION_EMAIL = "automation@jaishilsulphur.com";

// ---------------------------------------------------------------------------
// Auth: service-role client to bypass RLS on field_entry_log + profiles.
// ---------------------------------------------------------------------------
function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Previous calendar day in UTC, as ISO date strings [start, end). */
function previousDayRange(): { start: string; end: string; label: string } {
  const now   = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    start: start.toISOString(),
    end:   end.toISOString(),
    label: start.toISOString().slice(0, 10),
  };
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function escapeCSV(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function GET() {
  const { start, end, label } = previousDayRange();
  const admin = getAdmin();

  // 1. Fetch all field_entry_log rows for the previous day.
  const { data: rows, error } = await admin
    .from("field_entry_log")
    .select("id, user_id, module, record_id, field_name, field_value, entered_at, recorded_at")
    .gte("recorded_at", start)
    .lt("recorded_at", end)
    .order("recorded_at", { ascending: true });

  if (error) {
    console.error("[field-audit-digest] query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const entries = rows ?? [];

  // 2. Fetch user display names for the distinct user_ids.
  const userIds = [...new Set(entries.map(r => r.user_id as string))];
  const nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of (profiles ?? []) as { id: string; full_name: string }[]) {
      nameMap[p.id] = p.full_name;
    }
  }

  // 3. Compute summary statistics.
  const totalEntries   = entries.length;
  const distinctUsers  = userIds.length;
  const modulesSet     = new Set(entries.map(r => r.module as string));
  const modulesTouched = [...modulesSet].sort().join(", ");

  // Gap analysis: entered_at vs recorded_at in seconds.
  type GapRow = { gapSeconds: number; userId: string; module: string; fieldName: string };
  const gapRows: GapRow[] = entries.map(r => ({
    gapSeconds: (new Date(r.recorded_at as string).getTime() - new Date(r.entered_at as string).getTime()) / 1000,
    userId:     r.user_id as string,
    module:     r.module as string,
    fieldName:  r.field_name as string,
  }));
  const avgGap = gapRows.length > 0
    ? gapRows.reduce((s, r) => s + r.gapSeconds, 0) / gapRows.length
    : 0;
  const maxGapRow = gapRows.reduce((best, r) => r.gapSeconds > best.gapSeconds ? r : best, { gapSeconds: 0, userId: "", module: "", fieldName: "" });
  // Flag rows where entered_at is more than 5 minutes before recorded_at
  // (suggests pre-typing on paper then bulk-entering).
  const flagThresholdSec = 5 * 60;
  const flaggedCount = gapRows.filter(r => r.gapSeconds > flagThresholdSec).length;

  // 4. Build CSV attachment.
  const csvHeader = ["recorded_at", "entered_at", "gap_seconds", "module", "field_name", "field_value", "user_name", "record_id"].join(",");
  const csvRows   = entries.map(r => [
    r.recorded_at,
    r.entered_at,
    Math.round((new Date(r.recorded_at as string).getTime() - new Date(r.entered_at as string).getTime()) / 1000),
    r.module,
    r.field_name,
    r.field_value,
    nameMap[r.user_id as string] ?? r.user_id,
    r.record_id,
  ].map(escapeCSV).join(","));
  const csvContent = [csvHeader, ...csvRows].join("\n");
  const csvFilename = `field_audit_${label}.csv`;

  // 5. Build email.
  const subject = `[JSCI] Field Audit Digest — ${label}`;

  const flagLine = flaggedCount > 0
    ? `<p style="color:#c0392b;font-weight:bold">⚠ ${flaggedCount} entries had an entered→recorded gap &gt; 5 minutes (possible backdating — see attachment for detail).</p>`
    : `<p style="color:#27ae60">✓ No entries flagged for large timing gaps.</p>`;

  const maxGapLine = maxGapRow.gapSeconds > 0
    ? `Max gap: <b>${fmtDuration(maxGapRow.gapSeconds)}</b> (user: ${nameMap[maxGapRow.userId] ?? maxGapRow.userId}, module: ${maxGapRow.module}, field: ${maxGapRow.fieldName})`
    : "Max gap: —";

  const activityUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://jsci-a20-1.vercel.app"}/activity`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px">
      <h2 style="margin:0 0 8px">Field Audit Digest — ${label}</h2>
      <p style="color:#555;margin:0 0 16px">Daily summary of field-level entries across all production modules.</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:16px">
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Date</td><td style="padding:6px 12px">${label}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Total field entries</td><td style="padding:6px 12px">${totalEntries}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Distinct users</td><td style="padding:6px 12px">${distinctUsers}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Modules touched</td><td style="padding:6px 12px">${modulesTouched || "—"}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Avg timing gap</td><td style="padding:6px 12px">${fmtDuration(avgGap)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Flagged entries (&gt;5 min)</td><td style="padding:6px 12px">${flaggedCount}</td></tr>
      </table>
      ${flagLine}
      <p style="font-size:12px;color:#888">${maxGapLine}</p>
      <p>Full field-level detail is in the attached CSV file.<br>
         <a href="${activityUrl}">Open Activity drill-down →</a></p>
      <p style="font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:8px;margin-top:16px">
        Sent by JSCI Automation · ${new Date().toUTCString()}
      </p>
    </div>`;

  // 6. Send exactly one email with the CSV attached (one Gmail API call).
  await sendEmail({
    eventType:   "field_audit_digest",
    subject,
    html,
    recipients:  [AUTOMATION_EMAIL],
    attachments: [{
      filename:    csvFilename,
      contentType: "text/csv",
      content:     Buffer.from(csvContent, "utf-8"),
    }],
  });

  console.info(`[field-audit-digest] sent digest for ${label}: ${totalEntries} entries, ${distinctUsers} users`);
  return NextResponse.json({ ok: true, date: label, totalEntries, distinctUsers });
}

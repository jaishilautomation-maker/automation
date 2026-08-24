// =============================================================================
// GET /api/qc-exchange/retry-pending
//
// Called by Vercel Cron every 5 minutes (see vercel.json).
// Picks up SYNC_PENDING and SYNC_FAILED rows and retries them.
//
// Security:
//   Protected by CRON_SECRET env var which Vercel sets in the Authorization
//   header automatically for Cron calls.
//   Reject any request not from the Vercel scheduler.
//
// Backoff strategy:
//   attempt 1: immediate (done by /send)
//   attempt 2: >= 5 min  (cron interval)
//   attempt 3: >= 15 min (3 × cron interval)
//   attempt 4: >= 45 min (9 × cron interval)
//   attempt 5: >= 135 min → after this → SYNC_FAILED permanently
//
// The backoff is enforced via last_attempted_at: the cron only picks up rows
// where last_attempted_at IS NULL (never tried) or where enough time has
// passed based on attempt_count.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { attemptSend } from "../send/route";

const MAX_ATTEMPTS = 5;

// Minimum wait (ms) before retrying based on attempt number
const BACKOFF_MS = [
  0,          // attempt 1 — done by /send
  5 * 60_000, // attempt 2 — 5 min
  15 * 60_000, // attempt 3 — 15 min
  45 * 60_000, // attempt 4 — 45 min
  135 * 60_000, // attempt 5 — 135 min
];

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase service role env vars missing");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  // -------------------------------------------------------------------------
  // Verify this is a Vercel Cron call
  // -------------------------------------------------------------------------
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const receiveUrl = process.env.A20_RECEIVE_URL;
  const secret     = process.env.QC_EXCHANGE_SECRET;

  if (!receiveUrl || !secret) {
    return NextResponse.json({ skipped: true, reason: "A20 not configured" });
  }

  const admin = getServiceClient();
  const now   = new Date();

  // Fetch eligible rows: SYNC_PENDING or SYNC_FAILED, under max attempts
  const { data: rows, error } = await admin
    .from("qc_exchange_log")
    .select("id, source_table, source_record_id, factory_id, payload, attempt_count, last_attempted_at")
    .in("status", ["SYNC_PENDING", "SYNC_FAILED"])
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(20); // process at most 20 per cron run

  if (error) {
    console.error("[qc-exchange/retry-pending] Query error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { id: string; action: string }[] = [];

  for (const row of rows ?? []) {
    const attempt = row.attempt_count as number;

    // Check backoff: skip if not enough time has passed since last attempt
    if (row.last_attempted_at && attempt > 0) {
      const waitMs = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      const msSinceLast = now.getTime() - new Date(row.last_attempted_at as string).getTime();
      if (msSinceLast < waitMs) {
        results.push({ id: row.id as string, action: "skipped_backoff" });
        continue;
      }
    }

    const result = await attemptSend({
      admin,
      logId:           row.id as string,
      receiveUrl,
      secret,
      source_table:    row.source_table as string,
      source_record_id: row.source_record_id as string,
      factory_id:      row.factory_id as string,
      payload:         row.payload as Record<string, unknown>,
      attemptCount:    attempt,
    });

    results.push({ id: row.id as string, action: result.success ? "sent" : "failed" });
  }

  return NextResponse.json({ processed: results.length, results });
}

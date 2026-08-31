// =============================================================================
// POST /api/qc-exchange/send
//
// Called after a QC record in A-20/1 is finalized (overall_result set).
// This is a FIRE-AND-FORGET endpoint: it writes the exchange log row and
// immediately attempts the first send to A-20. If the send fails, the row
// stays as SYNC_PENDING and the retry cron will pick it up — the UI is
// never blocked waiting for this.
//
// Request body (JSON):
//   {
//     source_table:     "product_qc" | "rm_qc" | "batch_analysis",
//     source_record_id: string (uuid),
//     factory_id:       string (uuid),
//     payload:          object  -- full QC record snapshot
//   }
//
// Security:
//   - Caller must be authenticated (Supabase session cookie checked).
//   - QC_EXCHANGE_SECRET env var is used to HMAC-sign the outbound payload.
//     NEVER has NEXT_PUBLIC_ prefix — server-side only.
//   - A-20 endpoint URL in A20_RECEIVE_URL env var — server-side only.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHmacSignature } from "@/lib/qc-exchange/hmac";

// ---------------------------------------------------------------------------
// Supabase admin client (service role) — bypasses RLS for log writes
// ---------------------------------------------------------------------------
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase service role env vars missing");

  // We import createClient directly since this is server-only
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. Verify the caller is authenticated (has a valid Supabase session)
  // -------------------------------------------------------------------------
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => {},
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // -------------------------------------------------------------------------
  // 2. Parse and validate request body
  // -------------------------------------------------------------------------
  let body: {
    source_table: string;
    source_record_id: string;
    factory_id: string;
    payload: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { source_table, source_record_id, factory_id, payload } = body;
  if (!source_table || !source_record_id || !factory_id || !payload) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const receiveUrl = process.env.A20_RECEIVE_URL;
  const secret     = process.env.QC_EXCHANGE_SECRET;

  // -------------------------------------------------------------------------
  // 3. Write exchange log row FIRST (upsert — idempotent if called twice).
  //    We always persist the queue entry, even if the A-20 target is not yet
  //    configured. This makes qc_exchange_log a reliable signal that this
  //    endpoint was reached, and lets the retry-pending cron flush the backlog
  //    the moment A20_RECEIVE_URL / QC_EXCHANGE_SECRET are added.
  // -------------------------------------------------------------------------
  let admin: ReturnType<typeof getServiceClient>;
  try {
    admin = getServiceClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[qc-exchange/send] Service client init failed:", msg);
    return NextResponse.json({ error: "Server misconfigured: " + msg }, { status: 500 });
  }

  const logEntry = {
    source_table,
    source_record_id,
    factory_id,
    payload,
    status: "SYNC_PENDING",
    attempt_count: 0,
  };

  const { data: logRow, error: logErr } = await admin
    .from("qc_exchange_log")
    .upsert(logEntry, { onConflict: "source_table,source_record_id" })
    .select("id")
    .single();

  if (logErr || !logRow) {
    console.error("[qc-exchange/send] Failed to write log:", logErr?.message);
    return NextResponse.json({ error: "Failed to write exchange log: " + (logErr?.message ?? "unknown") }, { status: 500 });
  }

  // -------------------------------------------------------------------------
  // 4. If the A-20 target is not configured, leave the row as SYNC_PENDING.
  //    The retry cron will send it once the env vars are present.
  // -------------------------------------------------------------------------
  if (!receiveUrl || !secret) {
    return NextResponse.json({
      log_id:  logRow.id,
      status:  "queued_no_target",
      message: "Logged as SYNC_PENDING. Set A20_RECEIVE_URL / QC_EXCHANGE_SECRET to enable sending.",
    });
  }

  // -------------------------------------------------------------------------
  // 5. Attempt first send (non-blocking — failure updates log, doesn't throw)
  // -------------------------------------------------------------------------
  const sendResult = await attemptSend({
    admin,
    logId:   logRow.id,
    receiveUrl,
    secret,
    source_table,
    source_record_id,
    factory_id,
    payload,
    attemptCount: 0,
  });

  return NextResponse.json({
    log_id:  logRow.id,
    sent:    sendResult.success,
    message: sendResult.message,
  });
}

// ---------------------------------------------------------------------------
// Shared send logic — used by both /send and /retry-pending
// ---------------------------------------------------------------------------
export async function attemptSend(params: {
  admin:            ReturnType<typeof getServiceClient>;
  logId:            string;
  receiveUrl:       string;
  secret:           string;
  source_table:     string;
  source_record_id: string;
  factory_id:       string;
  payload:          Record<string, unknown>;
  attemptCount:     number;
}): Promise<{ success: boolean; message: string }> {
  const { admin, logId, receiveUrl, secret, source_table, source_record_id, factory_id, payload, attemptCount } = params;
  const MAX_ATTEMPTS = 5;

  if (attemptCount >= MAX_ATTEMPTS) {
    await admin.from("qc_exchange_log").update({
      status: "SYNC_FAILED",
      last_error: `Max attempts (${MAX_ATTEMPTS}) reached`,
      last_attempted_at: new Date().toISOString(),
    }).eq("id", logId);
    return { success: false, message: "Max retry attempts reached" };
  }

  // Build outbound payload
  const outbound = {
    exchange_id:      logId,
    source_factory:   factory_id,
    source_table,
    source_record_id,
    payload,
    sent_at:          new Date().toISOString(),
    version:          1,
  };

  const bodyString = JSON.stringify(outbound);
  const signature  = await createHmacSignature(bodyString, secret);

  try {
    const response = await fetch(receiveUrl, {
      method:  "POST",
      headers: {
        "Content-Type":          "application/json",
        "X-QC-Exchange-Sig":     signature,
        "X-QC-Exchange-Factory": factory_id,
      },
      body: bodyString,
      signal: AbortSignal.timeout(10_000), // 10 second timeout
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    // Success
    await admin.from("qc_exchange_log").update({
      status:           "SYNC_SENT",
      sent_at:          new Date().toISOString(),
      attempt_count:    attemptCount + 1,
      last_attempted_at: new Date().toISOString(),
      last_error:       null,
    }).eq("id", logId);

    return { success: true, message: "Sent successfully" };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[qc-exchange/send] Attempt ${attemptCount + 1} failed:`, errMsg);

    // Log the failure but do NOT flip to SYNC_FAILED yet — retry cron will do that
    await admin.from("qc_exchange_log").update({
      attempt_count:    attemptCount + 1,
      last_attempted_at: new Date().toISOString(),
      last_error:       errMsg,
    }).eq("id", logId);

    return { success: false, message: errMsg };
  }
}

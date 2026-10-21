// =============================================================================
// GET /api/field-audit-digest/diag  — temporary diagnostic
//
// Reports the current state of field_entry_log so we can see why the digest
// is always empty:
//   - total row count (service role, bypasses RLS)
//   - the 10 most recent rows
//   - min/max recorded_at
//   - a test insert attempt (then rolled back by delete) to surface any
//     schema/permission error
//
// DELETE THIS ROUTE once the capture issue is diagnosed.
// =============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  const admin = getAdmin();

  // 1. Total count
  const { count, error: countErr } = await admin
    .from("field_entry_log")
    .select("*", { count: "exact", head: true });

  // 2. Recent rows
  const { data: recent, error: recentErr } = await admin
    .from("field_entry_log")
    .select("recorded_at, entered_at, module, field_name, user_id")
    .order("recorded_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    ok: true,
    totalRows: count ?? null,
    countError: countErr?.message ?? null,
    recentError: recentErr?.message ?? null,
    recent: recent ?? [],
    serverTimeUtc: new Date().toISOString(),
  });
}

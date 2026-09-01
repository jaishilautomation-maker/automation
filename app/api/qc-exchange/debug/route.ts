// =============================================================================
// GET /api/qc-exchange/debug
//
// Diagnostic endpoint to confirm which Supabase project THIS deployment is
// actually wired to at runtime, and how many qc_imports rows it can see with
// the service-role key. Use it to resolve "sent successfully but not found"
// (a read/write project mismatch).
//
// Returns only NON-SECRET info: the project ref (subdomain) of the configured
// URL, the factory code, whether keys are present (booleans, never the values),
// and the qc_imports row count + latest batch numbers as seen by the service
// role (bypasses RLS). No secret material is ever returned.
// =============================================================================

import { NextResponse } from "next/server";

function projectRef(url: string): string {
  // https://<ref>.supabase.co  ->  <ref>
  const m = url.match(/^https?:\/\/([^.]+)\.supabase\.co/i);
  return m?.[1] ?? "(unrecognized)";
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase service role env vars missing");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  const info: Record<string, unknown> = {
    factory_code:            process.env.NEXT_PUBLIC_FACTORY_CODE ?? "(unset)",
    supabase_url_ref:        projectRef(url),
    lab_qc_url_set:          !!process.env.NEXT_PUBLIC_LAB_QC_SUPABASE_URL,
    lab_qc_url_ref:          process.env.NEXT_PUBLIC_LAB_QC_SUPABASE_URL
                               ? projectRef(process.env.NEXT_PUBLIC_LAB_QC_SUPABASE_URL)
                               : null,
    has_service_role_key:    !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    has_qc_exchange_secret:  !!process.env.QC_EXCHANGE_SECRET,
    has_a20_receive_url:     !!process.env.A20_RECEIVE_URL,
    // Non-secret: the HOST of the receive URL, so we can confirm A-20/1 is
    // pointing at the CURRENT A-20 deployment (not an old/preview URL).
    a20_receive_host:        (() => {
      try { return process.env.A20_RECEIVE_URL ? new URL(process.env.A20_RECEIVE_URL).host : null; }
      catch { return "(invalid URL)"; }
    })(),
  };

  // Count qc_imports rows visible to the service role (bypasses RLS).
  try {
    const admin = getServiceClient();
    const { data, error, count } = await admin
      .from("qc_imports")
      .select("source_batch_number, transferred_at", { count: "exact" })
      .order("transferred_at", { ascending: false })
      .limit(5);
    if (error) {
      info.qc_imports_error = error.message;
    } else {
      info.qc_imports_count = count ?? (data?.length ?? 0);
      info.qc_imports_latest = (data ?? []).map(
        (r: { source_batch_number: string | null }) => r.source_batch_number
      );
    }
  } catch (e) {
    info.qc_imports_error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(info);
}

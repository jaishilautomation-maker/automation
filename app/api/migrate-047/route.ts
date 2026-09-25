// =============================================================================
// GET /api/migrate-047
//
// Applies migration 047 — adds UPDATE RLS policy on stores_stock_ledger
// for manually-entered rows. Call once after deploy, then remove this file.
//
// Safe to call multiple times (DROP POLICY IF EXISTS makes it idempotent).
// =============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Run each DDL statement via a Postgres function call.
  // Supabase JS doesn't support raw DDL directly, so we use the
  // Management API approach via fetch with the service role.
  const statements = [
    `DROP POLICY IF EXISTS "ssl_update" ON public.stores_stock_ledger`,
    `CREATE POLICY "ssl_update" ON public.stores_stock_ledger
       FOR UPDATE TO authenticated
       USING (
         factory_id IN (SELECT fn_user_factory_ids())
         AND transaction_source = 'manual'
         AND entered_by = auth.uid()
       )
       WITH CHECK (
         factory_id IN (SELECT fn_user_factory_ids())
         AND transaction_source = 'manual'
         AND entered_by = auth.uid()
       )`,
    `GRANT UPDATE ON public.stores_stock_ledger TO authenticated`,
    `DROP POLICY IF EXISTS "ssl_delete" ON public.stores_stock_ledger`,
    `CREATE POLICY "ssl_delete" ON public.stores_stock_ledger
       FOR DELETE TO authenticated
       USING (
         factory_id IN (SELECT fn_user_factory_ids())
         AND transaction_source = 'manual'
         AND entered_by = auth.uid()
       )`,
    `GRANT DELETE ON public.stores_stock_ledger TO authenticated`,
  ];

  // Use Supabase Management API to run SQL
  const projectRef = url.split("//")[1].split(".")[0];
  const mgmtUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  const results: { stmt: string; status: string }[] = [];
  for (const stmt of statements) {
    try {
      const res = await fetch(mgmtUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({ query: stmt }),
      });
      const data = await res.json() as { error?: string };
      results.push({ stmt: stmt.slice(0, 60), status: data.error ? "ERROR: " + data.error : "OK" });
    } catch (e) {
      results.push({ stmt: stmt.slice(0, 60), status: "EXCEPTION: " + String(e) });
    }
  }

  const allOk = results.every(r => r.status === "OK");
  return NextResponse.json({
    success: allOk,
    results,
    fallback_sql: allOk ? undefined : statements.join(";\n\n") + ";",
    note: allOk
      ? "Migration 047 applied. You can now edit Daily Production records."
      : "Some statements failed. Copy fallback_sql and run it in your Supabase Dashboard → SQL Editor.",
  });
}

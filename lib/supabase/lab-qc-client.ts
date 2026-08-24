// =============================================================================
// Lab QC Supabase client
//
// This client connects to the Lab QC database for the current factory
// deployment. The Lab QC database is shared between A-20/1 and A-20.
//
//   A-20/1 → NEXT_PUBLIC_LAB_QC_SUPABASE_URL / NEXT_PUBLIC_LAB_QC_SUPABASE_ANON_KEY
//            (may be the same project as Job Card during transition phase)
//   A-20   → same env var names, pointing to SUPABASE_A20
//
// Falls back to the legacy single-DB env vars so existing deployments
// continue working unchanged during the transition period.
//
// Usage (browser): import { createLabQcClient } from "@/lib/supabase/lab-qc-client"
// =============================================================================

import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a browser-side Supabase client connected to the Lab QC database.
 * Throws a descriptive error if the required env vars are absent.
 */
export function createLabQcClient() {
  const url =
    process.env.NEXT_PUBLIC_LAB_QC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key =
    process.env.NEXT_PUBLIC_LAB_QC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Lab QC database env vars missing. " +
      "Set NEXT_PUBLIC_LAB_QC_SUPABASE_URL and " +
      "NEXT_PUBLIC_LAB_QC_SUPABASE_ANON_KEY in Vercel settings."
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createBrowserClient<any>(url, key);
}

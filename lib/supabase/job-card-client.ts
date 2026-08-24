// =============================================================================
// Job Card Supabase client
//
// This client connects to the Job Card database for the current factory
// deployment. Each Vercel project sets its own env vars:
//
//   A-20/1 → NEXT_PUBLIC_JOB_CARD_SUPABASE_URL / NEXT_PUBLIC_JOB_CARD_SUPABASE_ANON_KEY
//   A-20   → same env var names, different values pointing to SUPABASE_A20
//
// Falls back to the legacy single-DB env vars so existing deployments without
// the new vars continue working unchanged.
//
// Usage (browser): import { createJobCardClient } from "@/lib/supabase/job-card-client"
// =============================================================================

import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a browser-side Supabase client connected to the Job Card database.
 * Throws a descriptive error if the required env vars are absent.
 */
export function createJobCardClient() {
  const url =
    process.env.NEXT_PUBLIC_JOB_CARD_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key =
    process.env.NEXT_PUBLIC_JOB_CARD_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Job Card database env vars missing. " +
      "Set NEXT_PUBLIC_JOB_CARD_SUPABASE_URL and " +
      "NEXT_PUBLIC_JOB_CARD_SUPABASE_ANON_KEY in Vercel settings."
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createBrowserClient<any>(url, key);
}

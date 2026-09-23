// =============================================================================
// GET /api/stores-sheets-bootstrap
//
// One-time setup endpoint. Call this ONCE after:
//   1. Creating the Stores Google Sheet
//   2. Sharing it with the service account (Editor access)
//   3. Setting STORES_SHEET_ID in .env.local / Vercel env vars
//
// What it does:
//   - Creates all 14 tab sheets inside the spreadsheet if they don't exist
//   - Writes the header row (Row 1) to each tab
//   - Skips tabs that already have a header
//
// Safe to call multiple times — idempotent.
//
// Usage:
//   Open in browser or curl:
//   https://your-app.vercel.app/api/stores-sheets-bootstrap
//   (or http://localhost:3000/api/stores-sheets-bootstrap locally)
// =============================================================================

import { NextResponse } from "next/server";
import { createAllTabsAndHeaders } from "@/lib/notifications/stores-sheets";

export async function GET() {
  const result = await createAllTabsAndHeaders();

  const allOk = result.errors.length === 0;

  return NextResponse.json(
    {
      success: allOk,
      message: allOk
        ? "All Stores sheet tabs and headers are ready."
        : "Completed with some errors — check the errors array.",
      tabs_created: result.created,
      tabs_skipped: result.skipped,
      errors:       result.errors,
      next_steps: allOk
        ? [
            "Your Stores Google Sheet is ready.",
            "All 14 tabs have been created with header rows.",
            "Every save action in the Stores module will now append a row.",
          ]
        : [
            "Fix the errors above (usually: wrong STORES_SHEET_ID, or sheet not shared with service account).",
            "Then call this endpoint again.",
          ],
    },
    { status: allOk ? 200 : 500 },
  );
}

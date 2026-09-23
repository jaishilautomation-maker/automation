// =============================================================================
// GET/POST /api/bootstrap-sheets
//
// One-time setup: writes header rows to any tab whose Row 1 is empty, across
// all 4 department spreadsheets (jobcard, production, stores, lab).
// Safe to run repeatedly — tabs that already have a header are skipped.
//
// Usage:
//   Visit /api/bootstrap-sheets in a browser (GET), or POST to it.
//   Optional query param ?only=stores restricts it to one department
//   (valid values: jobcard, production, stores, lab).
//
// Delete this route once setup is confirmed — it's not needed at runtime.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { bootstrapHeaders, type SheetTarget } from "@/lib/notifications/sheets-sync";

const VALID_TARGETS: SheetTarget[] = ["jobcard", "production", "stores", "lab"];

async function runBootstrap(req: NextRequest) {
  const onlyParam = req.nextUrl.searchParams.get("only");
  const only = onlyParam && VALID_TARGETS.includes(onlyParam as SheetTarget)
    ? (onlyParam as SheetTarget)
    : undefined;

  try {
    const outcome = await bootstrapHeaders(only);
    return NextResponse.json({ success: true, outcome });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return runBootstrap(req);
}

export async function POST(req: NextRequest) {
  return runBootstrap(req);
}

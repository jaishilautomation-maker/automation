// =============================================================================
// POST /api/lab-qc/generate-report
//
// Server-side report generator entry point. Client finalization handlers call
// this fire-and-forget (keepalive fetch) after a successful DB write. It:
//   1. resolves the .xlsx template + field map for the record,
//   2. populates it in-memory (exceljs),
//   3. emails it as an attachment to the role-routed recipients,
//   4. logs the attempt to notification_log (via sendEmail).
//
// The populated workbook is NEVER persisted. Always returns 200 to the client
// (failures are logged server-side; the UI never needs to retry).
//
// Request body (JSON):
//   { source: "rm_qc" | "batch_analysis" | "product_qc" | "coa",
//     recordId: string }
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { generateAndEmailReport } from "@/lib/reports/generate-filled-report";
import type { ReportSource } from "@/lib/reports/template-map";

const VALID_SOURCES: ReportSource[] = [
  "rm_qc",
  "batch_analysis",
  "product_qc",
  "coa",
];

async function getAuthUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(req: NextRequest) {
  // Only authenticated users can trigger report generation. This does not
  // expose any UI — it is called programmatically from finalization handlers.
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { source?: string; recordId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { source, recordId } = body;
  if (!source || !VALID_SOURCES.includes(source as ReportSource)) {
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  }
  if (!recordId) {
    return NextResponse.json({ error: "recordId required" }, { status: 400 });
  }

  // Await internally so the serverless function doesn't tear down mid-send,
  // but always return 200 — the client fires this and forgets.
  try {
    const result = await generateAndEmailReport({
      source: source as ReportSource,
      recordId,
    });
    if (!result.ok) {
      console.error("[generate-report] skipped:", result.reason);
    } else {
      console.info(
        `[generate-report] emailed ${result.filename} (${result.sizeBytes} bytes)`
      );
    }
    return NextResponse.json({ queued: true, ...result });
  } catch (err) {
    console.error("[generate-report] unexpected error:", err);
    return NextResponse.json({ queued: true, ok: false });
  }
}

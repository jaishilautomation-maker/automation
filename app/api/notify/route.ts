// =============================================================================
// POST /api/notify
//
// Generic server-side notification endpoint. Client pages call this after
// a successful DB write — fire-and-forget via keepalive fetch.
//
// Request body (JSON):
//   {
//     eventType:    string,
//     subject:      string,
//     html:         string,
//     factoryId?:   string,
//     referenceId?: string,
//     recipients?:  string[],   // defaults to [AUTOMATION_EMAIL]
//     sheetData?:   SheetSyncPayload,   // optional — push row to master Sheet
//   }
//
// sheetData shapes:
//   { type: "job_card",  row: JobCardSheetRow }
//   { type: "append",    tab: string,  values: (string|number|boolean|null)[] }
//
// Always returns 200 — failures are logged server-side; the client never
// needs to retry. Email and sheet sync run independently — one failing does
// not affect the other.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/notifications/send-email";
import {
  syncJobCardRow,
  appendRow,
  type JobCardSheetRow,
  type SheetTarget,
} from "@/lib/notifications/sheets-sync";

type SheetSyncPayload =
  | { type: "job_card"; row: JobCardSheetRow }
  | { type: "append"; target: SheetTarget; tab: string; values: (string | number | boolean | null)[] };

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { eventType, subject, html, factoryId, referenceId, recipients, sheetData } = body as {
    eventType?:   string;
    subject?:     string;
    html?:        string;
    factoryId?:   string;
    referenceId?: string;
    recipients?:  string[];
    sheetData?:   SheetSyncPayload;
  };

  // A sheet-only call (e.g. one row of a repeatable set) may omit subject/html.
  // In that case we just do the sheet sync and skip the email. A normal call
  // must supply eventType + subject + html.
  const wantsEmail = Boolean(subject && html);
  if (!eventType) {
    return NextResponse.json({ error: "eventType required" }, { status: 400 });
  }
  if (!wantsEmail && !sheetData) {
    return NextResponse.json({ error: "subject+html or sheetData required" }, { status: 400 });
  }

  // Run email and sheet sync concurrently — each is independently safe (never
  // throws). Await both so the Vercel lambda doesn't tear down mid-flight.
  await Promise.all([
    wantsEmail
      ? sendEmail({ eventType, subject: subject!, html: html!, factoryId, referenceId, recipients })
      : Promise.resolve(),
    (async () => {
      if (!sheetData) return;
      if (sheetData.type === "job_card") {
        await syncJobCardRow(sheetData.row);
      } else if (sheetData.type === "append") {
        await appendRow(sheetData.target, sheetData.tab, sheetData.values);
      }
    })(),
  ]);

  return NextResponse.json({ queued: true });
}

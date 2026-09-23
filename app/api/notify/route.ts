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
//   { type: "job_card",      row: JobCardSheetRow }
//   { type: "append",        tab: string,  values: (string|number|boolean|null)[] }
//   { type: "stores_append", tab: string,  values: (string|number|boolean|null)[] }
//
// "stores_append" writes to the SEPARATE Stores spreadsheet (STORES_SHEET_ID).
// "append" writes to the main pulveriser spreadsheet (GOOGLE_SHEET_ID).
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
} from "@/lib/notifications/sheets-sync";
import { appendToStoresSheet, type StoresSheetTab } from "@/lib/notifications/stores-sheets";

type SheetSyncPayload =
  | { type: "job_card";      row: JobCardSheetRow }
  | { type: "append";        tab: string; values: (string | number | boolean | null)[] }
  | { type: "stores_append"; tab: string; values: (string | number | boolean | null)[] };

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

  if (!eventType || !subject || !html) {
    return NextResponse.json({ error: "eventType, subject, html required" }, { status: 400 });
  }

  console.log(`[notify] eventType=${eventType} sheetData=${sheetData ? sheetData.type : "none"}`);

  // Run email and sheet sync concurrently — each is independently safe (never
  // throws). Await both so the Vercel lambda doesn't tear down mid-flight.
  await Promise.all([
    sendEmail({ eventType, subject, html, factoryId, referenceId, recipients }),
    (async () => {
      if (!sheetData) return;
      if (sheetData.type === "job_card") {
        await syncJobCardRow(sheetData.row);
      } else if (sheetData.type === "append") {
        await appendRow(sheetData.tab, sheetData.values);
      } else if (sheetData.type === "stores_append") {
        await appendToStoresSheet(sheetData.tab as StoresSheetTab, sheetData.values);
      }
    })(),
  ]);

  return NextResponse.json({ queued: true });
}

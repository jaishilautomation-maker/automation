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
import { loadQcPhotoAttachments, buildPhotoHtml } from "@/lib/notifications/qc-photo-attachments";
import {
  notifyJobCardWhatsApp,
  type JobCardNotifyEvent,
} from "@/lib/notifications/whatsapp-jobcard";
import {
  syncJobCardRow,
  appendRow,
  type JobCardSheetRow,
  type SheetTarget,
} from "@/lib/notifications/sheets-sync";

// The pulveriser job-card stage events that also fire a WhatsApp message to the
// next role. Keep in sync with JobCardNotifyEvent. Any other eventType (lab-qc,
// breakdown, hourly readings, etc.) is email/sheet-only — no WhatsApp.
const WHATSAPP_JOBCARD_EVENTS = new Set<string>([
  "pulveriser_production",
  "pulveriser_production_triage",
  "pulveriser_stores",
  "pulveriser_operator",
  "pulveriser_lab",
]);

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

  // Run email, sheet sync, and the WhatsApp job-card notification concurrently.
  // Each is independently safe (never throws). Await all so the Vercel lambda
  // doesn't tear down mid-flight. The WhatsApp send is a PURE side-effect of a
  // pulveriser job-card transition — it reads the persisted card to find the
  // next role and never alters workflow state. referenceId is the job card id.
  await Promise.all([
    wantsEmail
      ? (async () => {
          // Lab QC submissions embed any uploaded photos INLINE in the email so
          // the recipient sees them in the body (the bucket is private, so we
          // send the image bytes and reference them via cid:).
          const attachments = eventType.startsWith("lab_qc_")
            ? await loadQcPhotoAttachments(referenceId)
            : [];
          const finalHtml = attachments.length
            ? html! + buildPhotoHtml(attachments)
            : html!;
          await sendEmail({
            eventType, subject: subject!, html: finalHtml, factoryId, referenceId, recipients,
            attachments: attachments.length ? attachments : undefined,
          });
        })()
      : Promise.resolve(),
    (async () => {
      if (!sheetData) return;
      if (sheetData.type === "job_card") {
        await syncJobCardRow(sheetData.row);
      } else if (sheetData.type === "append") {
        await appendRow(sheetData.target, sheetData.tab, sheetData.values);
      }
    })(),
    WHATSAPP_JOBCARD_EVENTS.has(eventType)
      ? notifyJobCardWhatsApp(eventType as JobCardNotifyEvent, referenceId, factoryId)
      : Promise.resolve(),
  ]);

  return NextResponse.json({ queued: true });
}

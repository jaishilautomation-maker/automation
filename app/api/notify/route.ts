// =============================================================================
// POST /api/notify
//
// Generic server-side email dispatch endpoint. Client pages call this after
// a successful DB write — fire-and-forget via keepalive fetch, same pattern
// as /api/qc-exchange/send.
//
// Request body (JSON):
//   {
//     eventType:    string,
//     subject:      string,
//     html:         string,
//     factoryId?:   string,
//     referenceId?: string,
//     recipients?:  string[],   // defaults to [AUTOMATION_EMAIL]
//   }
//
// Always returns 200 — the client never needs to retry; failures are logged
// server-side and visible in the notification_log table.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/notifications/send-email";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { eventType, subject, html, factoryId, referenceId, recipients } = body as {
    eventType?:   string;
    subject?:     string;
    html?:        string;
    factoryId?:   string;
    referenceId?: string;
    recipients?:  string[];
  };

  if (!eventType || !subject || !html) {
    return NextResponse.json({ error: "eventType, subject, html required" }, { status: 400 });
  }

  // Fire-and-forget — don't await; the response goes back immediately and
  // the email + log happen asynchronously (Next.js keeps the lambda alive
  // via the awaited sendEmail inside the void call).
  void sendEmail({ eventType, subject, html, factoryId, referenceId, recipients });

  return NextResponse.json({ queued: true });
}

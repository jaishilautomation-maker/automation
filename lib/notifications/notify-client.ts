// =============================================================================
// Client-side notification helper
//
// Call this from any "use client" page after a successful DB write.
// Fire-and-forget — never throws, never blocks the UI.
//
// Usage:
//   void notifyEvent({
//     eventType:   "pulveriser_production",
//     subject:     "[JSCI A-20/1] Job Card #JB-0451 — Production stage complete",
//     html:        buildProductionEmail({ ... }),
//     factoryId:   activeFactory.id,
//     referenceId: cardId,
//   });
// =============================================================================

export interface NotifyEventArgs {
  eventType:    string;
  subject:      string;
  html:         string;
  factoryId?:   string;
  referenceId?: string;
  recipients?:  string[];
}

/**
 * POST to /api/notify (fire-and-forget).
 * Safe to `void`. Never throws.
 */
export async function notifyEvent(args: NotifyEventArgs): Promise<void> {
  try {
    await fetch("/api/notify", {
      method:    "POST",
      headers:   { "Content-Type": "application/json" },
      body:      JSON.stringify(args),
      keepalive: true,   // survives page navigation
    });
  } catch (err) {
    // Network failure — swallow. The notification_log won't have an entry for
    // this but the UI and DB write are unaffected.
    console.error("[notify-client] fetch failed:", err);
  }
}

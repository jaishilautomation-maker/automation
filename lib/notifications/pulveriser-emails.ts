// =============================================================================
// Email formatters — Pulveriser Job Card (4 stages), Breakdown Register,
// Preventive Maintenance
//
// Each function returns { subject, html } ready to pass to notifyEvent().
// All formatters are pure — no DB calls, no side effects.
// =============================================================================

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function fmtNum(v: number | null | undefined, unit = ""): string {
  if (v == null) return "—";
  return `${v}${unit ? " " + unit : ""}`;
}

/** Wraps rows of key/value pairs in a simple HTML table. */
function table(rows: [string, string][]): string {
  const inner = rows
    .map(([k, v]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top">${k}</td>
        <td style="padding:6px 0;font-weight:600;vertical-align:top">${v}</td>
      </tr>`)
    .join("");
  return `<table style="border-collapse:collapse;font-size:14px;line-height:1.5">${inner}</table>`;
}

function emailWrap(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;
              border:1px solid #e0e0e0;overflow:hidden">
    <div style="background:#1a1a2e;padding:20px 28px">
      <p style="margin:0;font-size:11px;color:#aaa;letter-spacing:1px;text-transform:uppercase">
        JSCI A-20/1 · Automated Notification
      </p>
      <h2 style="margin:6px 0 0;font-size:20px;color:#fff">${title}</h2>
    </div>
    <div style="padding:24px 28px">
      ${body}
    </div>
    <div style="padding:16px 28px;background:#f9f9f9;border-top:1px solid #eee;
                font-size:12px;color:#999">
      This is an automated message from the JSCI A-20/1 plant management system.
      Sent at ${fmtTs(new Date().toISOString())}.
    </div>
  </div>
</body>
</html>`.trim();
}

// ---------------------------------------------------------------------------
// 1. Production submit  (status → pending_stores)
// ---------------------------------------------------------------------------

export interface ProductionEmailArgs {
  jobNumber:           string | null | undefined;
  machineNumber:       string | null | undefined;
  materialCode:        string | null | undefined;  // batch number
  partyCode:           string | null | undefined;
  plannedProductionMt: number | null | undefined;
  oilRequiredKg:       number | null | undefined;
  sulphurSupplier:     string | null | undefined;
  sulphurLotNumber:    string | null | undefined;
  sulphurEmptyDate:    string | null | undefined;
  oilSupplier:         string | null | undefined;
  oilBatchNumber:      string | null | undefined;
  oilQuantity:         number | null | undefined;
  submittedByName:     string;
  submittedAt:         string;  // ISO
  jobDate:             string | null | undefined;
  shift:               string | null | undefined;
}

export function buildProductionEmail(d: ProductionEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Job Card #${d.jobNumber ?? "—"} — Production stage complete`;

  const html = emailWrap(
    `Job Card #${d.jobNumber ?? "—"} — Production`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      Production stage is complete. Stores should now issue oil before the Operator can run the batch.
    </p>
    ${table([
      ["Job Number",             d.jobNumber         ?? "—"],
      ["Machine",                d.machineNumber      ?? "—"],
      ["Job Date",               fmtDate(d.jobDate)],
      ["Shift",                  d.shift              ?? "—"],
      ["Batch Number",           d.materialCode       ?? "—"],
      ["Party / Code",           d.partyCode          ?? "—"],
      ["Planned Production",     fmtNum(d.plannedProductionMt, "MT")],
      ["Oil Required (auto)",    fmtNum(d.oilRequiredKg, "kg")],
      ["Sulphur Supplier",       d.sulphurSupplier    ?? "—"],
      ["Sulphur Lot",            d.sulphurLotNumber   ?? "—"],
      ["Sulphur Empty Date",     fmtDate(d.sulphurEmptyDate)],
      ["Oil Supplier",           d.oilSupplier        ?? "—"],
      ["Oil Batch",              d.oilBatchNumber     ?? "—"],
      ["Oil Quantity",           fmtNum(d.oilQuantity, "kg")],
      ["Submitted By",           d.submittedByName],
      ["Submitted At",           fmtTs(d.submittedAt)],
    ])}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 2. Stores submit  (status → pending)
// ---------------------------------------------------------------------------

export interface StoresEmailArgs {
  jobNumber:      string | null | undefined;
  materialCode:   string | null | undefined;
  oilRequiredKg:  number | null | undefined;
  oilIssuedKg:    number | null | undefined;
  submittedByName: string;
  submittedAt:    string;
}

export function buildStoresEmail(d: StoresEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Job Card #${d.jobNumber ?? "—"} — Oil issued`;

  const html = emailWrap(
    `Job Card #${d.jobNumber ?? "—"} — Oil Issued`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      Stores has issued oil. The card is now open for the Operator to fill and run the batch.
    </p>
    ${table([
      ["Job Number",          d.jobNumber      ?? "—"],
      ["Batch Number",        d.materialCode   ?? "—"],
      ["Oil Required (auto)", fmtNum(d.oilRequiredKg, "kg")],
      ["Oil Issued",          fmtNum(d.oilIssuedKg,   "kg")],
      ["Issued By",           d.submittedByName],
      ["Issued At",           fmtTs(d.submittedAt)],
    ])}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 3. Operator submit  (status → submitted_for_qc)
// ---------------------------------------------------------------------------

export interface HourlyReadingRow {
  machine:        string | null | undefined;
  start_time:     string | null | undefined;
  stop_time:      string | null | undefined;
  total_hours:    number | null | undefined;
  batch_no:       string | null | undefined;
  bags:           number | null | undefined;
}

export interface OperatorEmailArgs {
  jobNumber:                  string | null | undefined;
  materialCode:               string | null | undefined;
  actualProductionMt:         number | null | undefined;
  expectedOilKg:              number | null | undefined;
  actualOilConsumptionKg:     number | null | undefined;
  oilVarianceKg:              number | null | undefined;
  oilExtraLeftoverBalanceKg:  number | null | undefined;
  checkpointMachineCleaning:  boolean;
  checkpointRollerCheck:      boolean;
  checkpointMeshClothCheck:   boolean;
  hourlyReadings:             HourlyReadingRow[];
  submittedByName:            string;
  submittedAt:                string;
}

export function buildOperatorEmail(d: OperatorEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Job Card #${d.jobNumber ?? "—"} — Ready for QC`;

  const readingSummary =
    d.hourlyReadings.length === 0
      ? "<p style='color:#999;font-size:13px'>No hourly readings recorded.</p>"
      : `<table style="border-collapse:collapse;font-size:13px;width:100%;margin-top:8px">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:5px 8px;text-align:left;font-weight:600">#</th>
              <th style="padding:5px 8px;text-align:left;font-weight:600">Machine</th>
              <th style="padding:5px 8px;text-align:left;font-weight:600">Start→Stop</th>
              <th style="padding:5px 8px;text-align:left;font-weight:600">Hours</th>
              <th style="padding:5px 8px;text-align:left;font-weight:600">Batch</th>
              <th style="padding:5px 8px;text-align:left;font-weight:600">Bags</th>
            </tr>
          </thead>
          <tbody>
            ${d.hourlyReadings.map((r, i) => `
              <tr style="border-top:1px solid #eee">
                <td style="padding:5px 8px">${i + 1}</td>
                <td style="padding:5px 8px">${r.machine ?? "—"}</td>
                <td style="padding:5px 8px">${r.start_time ?? "—"}→${r.stop_time ?? "—"}</td>
                <td style="padding:5px 8px">${fmtNum(r.total_hours, "h")}</td>
                <td style="padding:5px 8px">${r.batch_no ?? "—"}</td>
                <td style="padding:5px 8px">${fmtNum(r.bags)}</td>
              </tr>`).join("")}
          </tbody>
        </table>`;

  const html = emailWrap(
    `Job Card #${d.jobNumber ?? "—"} — Ready for QC`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      Operator has submitted the card for QC review.
    </p>
    ${table([
      ["Job Number",              d.jobNumber                 ?? "—"],
      ["Batch Number",            d.materialCode              ?? "—"],
      ["Actual Production",       fmtNum(d.actualProductionMt, "MT")],
      ["Expected Oil",            fmtNum(d.expectedOilKg,       "kg")],
      ["Actual Oil Consumed",     fmtNum(d.actualOilConsumptionKg, "kg")],
      ["Oil Variance",            fmtNum(d.oilVarianceKg,      "kg")],
      ["Oil Extra/Leftover",      fmtNum(d.oilExtraLeftoverBalanceKg, "kg")],
      ["Machine Cleaning ✓",      d.checkpointMachineCleaning ? "Yes" : "No"],
      ["Roller Check ✓",          d.checkpointRollerCheck     ? "Yes" : "No"],
      ["Mesh Cloth Check ✓",      d.checkpointMeshClothCheck  ? "Yes" : "No"],
      ["Submitted By",            d.submittedByName],
      ["Submitted At",            fmtTs(d.submittedAt)],
    ])}
    <h4 style="margin:20px 0 8px;font-size:14px">Hourly Readings (${d.hourlyReadings.length})</h4>
    ${readingSummary}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 4. Lab submit  (status → finalized | pending_stores)
// ---------------------------------------------------------------------------

export interface LabEmailArgs {
  jobNumber:      string | null | undefined;
  materialCode:   string | null | undefined;
  result:         "ok" | "not_ok";
  remark:         string | null | undefined;
  reviewedByName: string;
  reviewedAt:     string;
}

export function buildLabEmail(d: LabEmailArgs): { subject: string; html: string } {
  const resultLabel = d.result === "ok" ? "Finalized" : "Sent back for rework";
  const subject = `[JSCI A-20/1] Job Card #${d.jobNumber ?? "—"} — ${resultLabel}`;

  const statusLine =
    d.result === "ok"
      ? `<p style="margin:0 0 12px;padding:10px 14px;background:#e8f5e9;
                   border:1px solid #4caf50;border-radius:6px;color:#2e7d32;font-weight:600">
           ✅ Result: OK — Job card finalized.
         </p>`
      : `<p style="margin:0 0 12px;padding:10px 14px;background:#fff3e0;
                   border:1px solid #ff9800;border-radius:6px;color:#e65100;font-weight:600">
           ⚠️ Result: NOT OK — Sent back to Stores for a full rework cycle.
           Stores → Operator → Lab stages are now reopened.
         </p>`;

  const html = emailWrap(
    `Job Card #${d.jobNumber ?? "—"} — Lab Review`,
    `${statusLine}
    ${table([
      ["Job Number",    d.jobNumber   ?? "—"],
      ["Batch Number",  d.materialCode ?? "—"],
      ["Result",        d.result === "ok" ? "OK ✅" : "NOT OK ⚠️"],
      ["Remark",        d.remark      || "—"],
      ["Reviewed By",   d.reviewedByName],
      ["Reviewed At",   fmtTs(d.reviewedAt)],
    ])}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 5. Breakdown Register
// ---------------------------------------------------------------------------

export interface BreakdownEmailArgs {
  machineName:         string;
  srNo?:               number | null;
  startAt:             string;
  finishAt:            string | null | undefined;
  natureOfBreakdown:   string;
  repairCarriedOut:    string | null | undefined;
  partsReplaced:       string | null | undefined;
  correctiveAction:    string | null | undefined;
  remarks:             string | null | undefined;
  submittedByName:     string;
  submittedAt:         string;
}

export function buildBreakdownEmail(d: BreakdownEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Breakdown Register — ${d.machineName} logged`;

  const html = emailWrap(
    `Breakdown: ${d.machineName}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      A new breakdown entry has been logged.
    </p>
    ${table([
      ["Machine",           d.machineName],
      ["SR No",             d.srNo != null ? String(d.srNo) : "—"],
      ["Start",             fmtTs(d.startAt)],
      ["Finish",            d.finishAt ? fmtTs(d.finishAt) : "Ongoing"],
      ["Nature",            d.natureOfBreakdown || "—"],
      ["Repair Done",       d.repairCarriedOut  || "—"],
      ["Parts Replaced",    d.partsReplaced     || "—"],
      ["Corrective Action", d.correctiveAction  || "—"],
      ["Remarks",           d.remarks           || "—"],
      ["Logged By",         d.submittedByName],
      ["Logged At",         fmtTs(d.submittedAt)],
    ])}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 6. Preventive Maintenance — "Mark done today"
// ---------------------------------------------------------------------------

export interface PmEmailArgs {
  machine:         string;
  component:       string;
  task:            string;
  frequencyWeeks:  number;
  completedAt:     string;
  completedByName: string;
  notes:           string | null | undefined;
}

export function buildPmEmail(d: PmEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Preventive Maintenance — ${d.machine}/${d.component} marked done`;

  function freqLabel(w: number) {
    if (w === 1)  return "Weekly";
    if (w === 2)  return "Fortnightly";
    if (w === 4)  return "Monthly";
    if (w === 12) return "Quarterly";
    if (w === 24) return "Half-yearly";
    return `${w} weeks`;
  }

  const html = emailWrap(
    `PM Done: ${d.machine} / ${d.component}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      A preventive maintenance task has been marked complete.
    </p>
    ${table([
      ["Machine",    d.machine],
      ["Component",  d.component],
      ["Task",       d.task],
      ["Frequency",  freqLabel(d.frequencyWeeks)],
      ["Completed",  fmtTs(d.completedAt)],
      ["Done By",    d.completedByName],
      ["Notes",      d.notes || "—"],
    ])}`,
  );

  return { subject, html };
}

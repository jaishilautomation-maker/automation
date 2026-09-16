// =============================================================================
// Email formatters — Lab QC (all 7 entry types)
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

/** Render a JSONB test_results object as a readable table. */
function testResultsTable(tr: Record<string, unknown> | null | undefined): string {
  if (!tr || Object.keys(tr).length === 0) {
    return `<p style="color:#999;font-size:13px">No test results.</p>`;
  }
  const rows = Object.entries(tr)
    .map(([k, v]) => `
      <tr style="border-top:1px solid #eee">
        <td style="padding:5px 8px;color:#666">${k.replace(/_/g, " ")}</td>
        <td style="padding:5px 8px;font-weight:600">${v != null ? String(v) : "—"}</td>
      </tr>`)
    .join("");
  return `<table style="border-collapse:collapse;font-size:13px;width:100%;margin-top:8px">
    <thead>
      <tr style="background:#f5f5f5">
        <th style="padding:5px 8px;text-align:left">Parameter</th>
        <th style="padding:5px 8px;text-align:left">Value</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function emailWrap(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;
              border:1px solid #e0e0e0;overflow:hidden">
    <div style="background:#1b5e20;padding:20px 28px">
      <p style="margin:0;font-size:11px;color:#a5d6a7;letter-spacing:1px;text-transform:uppercase">
        JSCI A-20/1 · Lab QC
      </p>
      <h2 style="margin:6px 0 0;font-size:20px;color:#fff">${title}</h2>
    </div>
    <div style="padding:24px 28px">
      ${body}
    </div>
    <div style="padding:16px 28px;background:#f9f9f9;border-top:1px solid #eee;
                font-size:12px;color:#999">
      This is an automated message from the JSCI A-20/1 Lab QC system.
      Sent at ${fmtTs(new Date().toISOString())}.
    </div>
  </div>
</body>
</html>`.trim();
}

// ---------------------------------------------------------------------------
// 1. RM Receipt
// ---------------------------------------------------------------------------

export interface RmReceiptEmailArgs {
  materialType:   string;         // "Crude Sulphur" | "Oil" | material name
  batchNumber:    string;
  supplierName:   string | null | undefined;
  quantity:       number | null | undefined;
  unit:           string | null | undefined;
  receivedDate:   string | null | undefined;
  truckNumber?:   string | null;
  appearance?:    string | null;
  submittedByName: string;
  submittedAt:    string;
  factoryName:    string;
}

export function buildRmReceiptEmail(d: RmReceiptEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] RM Receipt — ${d.materialType} · ${d.batchNumber}`;

  const html = emailWrap(
    `RM Receipt: ${d.materialType}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      A new raw material receipt has been recorded at ${d.factoryName}.
    </p>
    ${table([
      ["Material",    d.materialType],
      ["Batch / Invoice", d.batchNumber],
      ["Supplier",    d.supplierName  || "—"],
      ["Quantity",    d.quantity != null ? `${d.quantity} ${d.unit ?? ""}`.trim() : "—"],
      ["Date Received", fmtDate(d.receivedDate)],
      ["Truck No.",   d.truckNumber   || "—"],
      ["Appearance",  d.appearance    || "—"],
      ["Received By", d.submittedByName],
      ["Recorded At", fmtTs(d.submittedAt)],
    ])}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 2. RM QC
// ---------------------------------------------------------------------------

export interface RmQcEmailArgs {
  materialName:   string;
  batchNumber?:   string | null;
  testDate:       string | null | undefined;
  chemistName?:   string | null;
  testResults:    Record<string, unknown> | null | undefined;
  remarks:        string | null | undefined;
  submittedByName: string;
  submittedAt:    string;
}

export function buildRmQcEmail(d: RmQcEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] RM QC — ${d.materialName}${d.batchNumber ? " · " + d.batchNumber : ""}`;

  const html = emailWrap(
    `RM QC: ${d.materialName}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      Raw material QC results have been recorded.
    </p>
    ${table([
      ["Material",     d.materialName],
      ["Batch",        d.batchNumber  || "—"],
      ["Test Date",    fmtDate(d.testDate)],
      ["Chemist",      d.chemistName  || "—"],
      ["Remarks",      d.remarks      || "—"],
      ["Saved By",     d.submittedByName],
      ["Saved At",     fmtTs(d.submittedAt)],
    ])}
    <h4 style="margin:20px 0 8px;font-size:14px">Test Results</h4>
    ${testResultsTable(d.testResults)}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 3. Hourly Reading
// ---------------------------------------------------------------------------

export interface HourlyReadingEmailArgs {
  batchNumber:    string;
  readingTime:    string;
  testResults:    Record<string, unknown> | null | undefined;
  remarks:        string | null | undefined;
  submittedByName: string;
  submittedAt:    string;
}

export function buildHourlyReadingEmail(d: HourlyReadingEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Hourly Reading — Batch ${d.batchNumber}`;

  const html = emailWrap(
    `Hourly Reading: ${d.batchNumber}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      A new hourly reading has been recorded.
    </p>
    ${table([
      ["Batch Number",   d.batchNumber],
      ["Reading Time",   fmtTs(d.readingTime)],
      ["Remarks",        d.remarks        || "—"],
      ["Recorded By",    d.submittedByName],
      ["Recorded At",    fmtTs(d.submittedAt)],
    ])}
    <h4 style="margin:20px 0 8px;font-size:14px">Test Results</h4>
    ${testResultsTable(d.testResults)}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 4. Batch Analysis
// ---------------------------------------------------------------------------

export interface BatchAnalysisEmailArgs {
  batchNumber:    string;
  analysisDate:   string | null | undefined;
  appearance?:    string | null;
  testResults:    Record<string, unknown> | null | undefined;
  remarks:        string | null | undefined;
  submittedByName: string;
  submittedAt:    string;
  isUpdate:       boolean;
}

export function buildBatchAnalysisEmail(d: BatchAnalysisEmailArgs): { subject: string; html: string } {
  const verb = d.isUpdate ? "Updated" : "Saved";
  const subject = `[JSCI A-20/1] Batch Analysis ${verb} — ${d.batchNumber}`;

  const html = emailWrap(
    `Batch Analysis: ${d.batchNumber}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      Batch analysis has been ${d.isUpdate ? "updated" : "recorded"}.
    </p>
    ${table([
      ["Batch Number",   d.batchNumber],
      ["Analysis Date",  fmtDate(d.analysisDate)],
      ["Appearance",     d.appearance     || "—"],
      ["Remarks",        d.remarks        || "—"],
      ["Saved By",       d.submittedByName],
      ["Saved At",       fmtTs(d.submittedAt)],
    ])}
    <h4 style="margin:20px 0 8px;font-size:14px">Test Results</h4>
    ${testResultsTable(d.testResults)}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 5. Product QC
// ---------------------------------------------------------------------------

export interface ProductQcEmailArgs {
  productName:    string;
  batchNumber?:   string | null;
  phase:          string;
  testDate:       string | null | undefined;
  appearance?:    string | null;
  appearanceOk?:  boolean | null;
  testResults:    Record<string, unknown> | null | undefined;
  remarks:        string | null | undefined;
  submittedByName: string;
  submittedAt:    string;
  isUpdate:       boolean;
}

export function buildProductQcEmail(d: ProductQcEmailArgs): { subject: string; html: string } {
  const verb = d.isUpdate ? "Updated" : "Saved";
  const subject = `[JSCI A-20/1] Product QC ${verb} — ${d.productName} · Phase ${d.phase}`;

  const appearanceStatus =
    d.appearanceOk === true ? "OK ✅" :
    d.appearanceOk === false ? "Not OK ⚠️" : "—";

  const html = emailWrap(
    `Product QC: ${d.productName}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      Product QC results have been ${d.isUpdate ? "updated" : "recorded"}.
    </p>
    ${table([
      ["Product",          d.productName],
      ["Batch",            d.batchNumber    || "—"],
      ["Phase",            d.phase],
      ["Test Date",        fmtDate(d.testDate)],
      ["Appearance",       d.appearance     || "—"],
      ["Appearance OK",    appearanceStatus],
      ["Remarks",          d.remarks        || "—"],
      ["Saved By",         d.submittedByName],
      ["Saved At",         fmtTs(d.submittedAt)],
    ])}
    <h4 style="margin:20px 0 8px;font-size:14px">Test Results</h4>
    ${testResultsTable(d.testResults)}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 6. Post Production Test
// ---------------------------------------------------------------------------

export interface PostProductionEmailArgs {
  productName?:   string | null;
  batchNumber?:   string | null;
  testDate:       string | null | undefined;
  chemistName?:   string | null;
  testResults:    Record<string, unknown> | null | undefined;
  remarks:        string | null | undefined;
  submittedByName: string;
  submittedAt:    string;
}

export function buildPostProductionEmail(d: PostProductionEmailArgs): { subject: string; html: string } {
  const label = d.productName ? `${d.productName}${d.batchNumber ? " · " + d.batchNumber : ""}` : (d.batchNumber ?? "—");
  const subject = `[JSCI A-20/1] Post Production Test — ${label}`;

  const html = emailWrap(
    `Post Production: ${label}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      A post-production test result has been recorded.
    </p>
    ${table([
      ["Product",     d.productName   || "—"],
      ["Batch",       d.batchNumber   || "—"],
      ["Test Date",   fmtDate(d.testDate)],
      ["Chemist",     d.chemistName   || "—"],
      ["Remarks",     d.remarks       || "—"],
      ["Saved By",    d.submittedByName],
      ["Saved At",    fmtTs(d.submittedAt)],
    ])}
    <h4 style="margin:20px 0 8px;font-size:14px">Test Results</h4>
    ${testResultsTable(d.testResults)}`,
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// 7. Lab Trial
// ---------------------------------------------------------------------------

export interface LabTrialEmailArgs {
  trialCode:      string;
  productName?:   string | null;
  trialDate:      string | null | undefined;
  objective?:     string | null;
  appearance?:    string | null;
  conclusion?:    string | null;
  status:         string;
  testResults:    Record<string, unknown> | null | undefined;
  remarks:        string | null | undefined;
  submittedByName: string;
  submittedAt:    string;
}

export function buildLabTrialEmail(d: LabTrialEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Lab Trial — ${d.trialCode}${d.productName ? " · " + d.productName : ""}`;

  const html = emailWrap(
    `Lab Trial: ${d.trialCode}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">
      A lab trial result has been recorded.
    </p>
    ${table([
      ["Trial Code",  d.trialCode],
      ["Product",     d.productName  || "—"],
      ["Trial Date",  fmtDate(d.trialDate)],
      ["Status",      d.status       || "—"],
      ["Objective",   d.objective    || "—"],
      ["Appearance",  d.appearance   || "—"],
      ["Conclusion",  d.conclusion   || "—"],
      ["Remarks",     d.remarks      || "—"],
      ["Saved By",    d.submittedByName],
      ["Saved At",    fmtTs(d.submittedAt)],
    ])}
    <h4 style="margin:20px 0 8px;font-size:14px">Test Results</h4>
    ${testResultsTable(d.testResults)}`,
  );

  return { subject, html };
}

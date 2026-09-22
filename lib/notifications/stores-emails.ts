// =============================================================================
// Email formatters — Stores module (13 data-entry tabs)
//
// Each function returns { subject, html } ready to pass to notifyEvent().
// All formatters are pure — no DB calls, no side effects.
//
// NOTE: The "Job Cards" and "Oil Issue" tabs in the Stores UI are the Stores
// stage of the Job Card lifecycle (pulveriser_job_cards) — those already use
// buildStoresEmail() from pulveriser-emails.ts, not this file.
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
    <div style="background:#4e342e;padding:20px 28px">
      <p style="margin:0;font-size:11px;color:#d7ccc8;letter-spacing:1px;text-transform:uppercase">
        JSCI A-20/1 · Stores
      </p>
      <h2 style="margin:6px 0 0;font-size:20px;color:#fff">${title}</h2>
    </div>
    <div style="padding:24px 28px">
      ${body}
    </div>
    <div style="padding:16px 28px;background:#f9f9f9;border-top:1px solid #eee;
                font-size:12px;color:#999">
      This is an automated message from the JSCI A-20/1 Stores system.
      Sent at ${fmtTs(new Date().toISOString())}.
    </div>
  </div>
</body>
</html>`.trim();
}

// ---------------------------------------------------------------------------
// 1. Raw Material
// ---------------------------------------------------------------------------

export interface RawMaterialEmailArgs {
  date: string;
  product: string;
  openingBalance: number;
  qtyReceived: number;
  materialReturn: number;
  qtyIssuedProdn: number;
  qtyIssuedBal: number;
  dispatchAsIs: number;
  closingBalance: number;
  status: string;
  remarks: string | null;
  submittedByName: string;
  submittedAt: string;
}

export function buildRawMaterialEmail(d: RawMaterialEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Raw Material entry: ${d.product}`;
  const html = emailWrap(
    `Raw Material: ${d.product}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A new raw material register entry has been saved.</p>
    ${table([
      ["Date", fmtDate(d.date)],
      ["Product", d.product],
      ["Opening Balance", fmtNum(d.openingBalance)],
      ["Qty Received", fmtNum(d.qtyReceived)],
      ["Material Return", fmtNum(d.materialReturn)],
      ["Qty Issued (Prodn)", fmtNum(d.qtyIssuedProdn)],
      ["Qty Issued (Bal)", fmtNum(d.qtyIssuedBal)],
      ["Dispatch As Is", fmtNum(d.dispatchAsIs)],
      ["Closing Balance", fmtNum(d.closingBalance)],
      ["Status", d.status || "—"],
      ["Remarks", d.remarks || "—"],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 2. Received
// ---------------------------------------------------------------------------

export interface ReceivedEmailArgs {
  date: string;
  particular: string | null;
  transport: string | null;
  materials: string | null;
  vehicleNo: string | null;
  oWt: string | null;
  fWt: string | null;
  bagsLoose: string | null;
  invChlNo: string | null;
  code: string | null;
  poNo: string | null;
  remarks: string | null;
  submittedByName: string;
  submittedAt: string;
}

export function buildReceivedEmail(d: ReceivedEmailArgs): { subject: string; html: string } {
  const label = d.particular || d.materials || "Received entry";
  const subject = `[JSCI A-20/1] Stores — Received: ${label}`;
  const html = emailWrap(
    `Received: ${label}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A new Received Entry Book row has been saved.</p>
    ${table([
      ["Date", fmtDate(d.date)],
      ["Particular", d.particular || "—"],
      ["Transport", d.transport || "—"],
      ["Materials", d.materials || "—"],
      ["Vehicle No", d.vehicleNo || "—"],
      ["O/WT", d.oWt || "—"],
      ["F/Wt", d.fWt || "—"],
      ["Bags / Loose", d.bagsLoose || "—"],
      ["INV/CHL No", d.invChlNo || "—"],
      ["Code", d.code || "—"],
      ["PO No", d.poNo || "—"],
      ["Remarks", d.remarks || "—"],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 3. Supplied
// ---------------------------------------------------------------------------

export interface SuppliedEmailArgs extends ReceivedEmailArgs {}

export function buildSuppliedEmail(d: SuppliedEmailArgs): { subject: string; html: string } {
  const label = d.particular || d.materials || "Supplied entry";
  const subject = `[JSCI A-20/1] Stores — Supplied: ${label}`;
  const html = emailWrap(
    `Supplied: ${label}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A new Supplied Entry Book row has been saved.</p>
    ${table([
      ["Date", fmtDate(d.date)],
      ["Particular", d.particular || "—"],
      ["Transport", d.transport || "—"],
      ["Materials", d.materials || "—"],
      ["Vehicle No", d.vehicleNo || "—"],
      ["O/WT", d.oWt || "—"],
      ["F/Wt", d.fWt || "—"],
      ["Bags / Loose", d.bagsLoose || "—"],
      ["INV/CHL No", d.invChlNo || "—"],
      ["Code", d.code || "—"],
      ["PO No", d.poNo || "—"],
      ["Remarks", d.remarks || "—"],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 4. Daily Production
// ---------------------------------------------------------------------------

export interface DailyProductionEmailArgs {
  date: string;
  totalMt: number;
  submittedByName: string;
  submittedAt: string;
}

export function buildDailyProductionEmail(d: DailyProductionEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Daily Production ${fmtDate(d.date)}`;
  const html = emailWrap(
    `Daily Production: ${fmtDate(d.date)}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A daily production entry has been saved.</p>
    ${table([
      ["Date", fmtDate(d.date)],
      ["Total MT", fmtNum(d.totalMt, "MT")],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 5. Daily Dispatch
// ---------------------------------------------------------------------------

export interface DailyDispatchEmailArgs {
  date: string;
  totalMt: number;
  submittedByName: string;
  submittedAt: string;
}

export function buildDailyDispatchEmail(d: DailyDispatchEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Daily Dispatch ${fmtDate(d.date)}`;
  const html = emailWrap(
    `Daily Dispatch: ${fmtDate(d.date)}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A daily dispatch entry has been saved.</p>
    ${table([
      ["Date", fmtDate(d.date)],
      ["Total MT", fmtNum(d.totalMt, "MT")],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 6. Packing Material
// ---------------------------------------------------------------------------

export interface PackingMaterialEmailArgs {
  date: string;
  product: string;
  opBal: number;
  qtyReceived: number;
  byTransfer: number;
  qtyIssued: number;
  toTransfer: number;
  clBal: number;
  status: string;
  remark: string | null;
  submittedByName: string;
  submittedAt: string;
}

export function buildPackingMaterialEmail(d: PackingMaterialEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Packing Material: ${d.product}`;
  const html = emailWrap(
    `Packing Material: ${d.product}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A packing material entry has been saved.</p>
    ${table([
      ["Date", fmtDate(d.date)],
      ["Product", d.product],
      ["Op. Bal", fmtNum(d.opBal)],
      ["Qty. Rec", fmtNum(d.qtyReceived)],
      ["By Transfer", fmtNum(d.byTransfer)],
      ["Qty. Issued", fmtNum(d.qtyIssued)],
      ["To Transfer", fmtNum(d.toTransfer)],
      ["Cl. Bal", fmtNum(d.clBal)],
      ["Status", d.status || "—"],
      ["Remark", d.remark || "—"],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 7. Finished Goods
// ---------------------------------------------------------------------------

export interface FinishedGoodsEmailArgs {
  date: string;
  product: string;
  opBal: number;
  production: number;
  repackingByTr: number;
  lessPackingStock: number;
  transferToTr: number;
  dispatch: number;
  clBal: number;
  totalMt: number;
  remark: string | null;
  submittedByName: string;
  submittedAt: string;
}

export function buildFinishedGoodsEmail(d: FinishedGoodsEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Finished Goods: ${d.product}`;
  const html = emailWrap(
    `Finished Goods: ${d.product}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A finished goods entry has been saved.</p>
    ${table([
      ["Date", fmtDate(d.date)],
      ["Product", d.product],
      ["Op. Bal", fmtNum(d.opBal)],
      ["Production", fmtNum(d.production)],
      ["Repacking By Tr", fmtNum(d.repackingByTr)],
      ["Less Packing Stock", fmtNum(d.lessPackingStock)],
      ["Transfer To Tr", fmtNum(d.transferToTr)],
      ["Dispatch", fmtNum(d.dispatch)],
      ["Cl. Bal", fmtNum(d.clBal)],
      ["Total MT", fmtNum(d.totalMt, "MT")],
      ["Remark", d.remark || "—"],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 8. Ball Mill
// ---------------------------------------------------------------------------

export interface BallMillEmailArgs {
  date: string;
  sumProdBags: number;
  sumDispatchBags: number;
  balanceBags: number;
  submittedByName: string;
  submittedAt: string;
}

export function buildBallMillEmail(d: BallMillEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Ball Mill entry ${fmtDate(d.date)}`;
  const html = emailWrap(
    `Ball Mill: ${fmtDate(d.date)}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A Ball Mill production/dispatch entry has been saved.</p>
    ${table([
      ["Date", fmtDate(d.date)],
      ["Produced (bags)", fmtNum(d.sumProdBags)],
      ["Dispatched (bags)", fmtNum(d.sumDispatchBags)],
      ["Balance (bags)", fmtNum(d.balanceBags)],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 9. Batch Wise
// ---------------------------------------------------------------------------

export interface BatchWiseEmailArgs {
  batchNo: string;
  code: string;
  mfgDate: string | null;
  qtyBags: number;
  qtyMt: number;
  remainingBags: number;
  remainingMt: number;
  submittedByName: string;
  submittedAt: string;
}

export function buildBatchWiseEmail(d: BatchWiseEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Batch Wise: ${d.batchNo}`;
  const html = emailWrap(
    `Batch Wise: ${d.batchNo}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A batch wise entry has been saved.</p>
    ${table([
      ["Batch No", d.batchNo],
      ["Code", d.code],
      ["Mfg Date", fmtDate(d.mfgDate)],
      ["Qty (Bags)", fmtNum(d.qtyBags)],
      ["Qty (MT)", fmtNum(d.qtyMt, "MT")],
      ["Remaining (Bags)", fmtNum(d.remainingBags)],
      ["Remaining (MT)", fmtNum(d.remainingMt, "MT")],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 10. Oil Consumption
// ---------------------------------------------------------------------------

export interface OilConsumptionEmailArgs {
  date: string;
  oilType: string;
  tankQty: number;
  takenFromTank: number;
  addToTank: number;
  totalConsumption: number;
  submittedByName: string;
  submittedAt: string;
}

export function buildOilConsumptionEmail(d: OilConsumptionEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Oil Consumption: ${d.oilType}`;
  const html = emailWrap(
    `Oil Consumption: ${d.oilType}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">An oil consumption entry has been saved.</p>
    ${table([
      ["Date", fmtDate(d.date)],
      ["Oil Type", d.oilType || "—"],
      ["Tank Qty", fmtNum(d.tankQty)],
      ["Taken From Tank", fmtNum(d.takenFromTank)],
      ["Add To Tank", fmtNum(d.addToTank)],
      ["Total Consumption", fmtNum(d.totalConsumption)],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 11. Issue Slip
// ---------------------------------------------------------------------------

export interface IssueSlipEmailArgs {
  slipNo: string | null;
  plant: string | null;
  date: string;
  materialDescription: string;
  unit: string;
  qtyRequired: number;
  qtyIssued: number;
  usedFor: string | null;
  remaining: number;
  remark: string | null;
  submittedByName: string;
  submittedAt: string;
}

export function buildIssueSlipEmail(d: IssueSlipEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Issue Slip: ${d.materialDescription}`;
  const html = emailWrap(
    `Issue Slip: ${d.materialDescription}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A material issue slip has been saved.</p>
    ${table([
      ["No.", d.slipNo || "—"],
      ["Plant", d.plant || "—"],
      ["Date", fmtDate(d.date)],
      ["Material Description", d.materialDescription],
      ["Unit", d.unit],
      ["Qty Required", fmtNum(d.qtyRequired)],
      ["Qty Issued", fmtNum(d.qtyIssued)],
      ["Used For", d.usedFor || "—"],
      ["Remaining", fmtNum(d.remaining)],
      ["Remark", d.remark || "—"],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 12. PRN
// ---------------------------------------------------------------------------

export interface PrnEmailArgs {
  prnDate: string;
  itemDescription: string;
  bifurcation: string | null;
  requirements: string | null;
  qty: string | null;
  currentStock: string | null;
  plant: string | null;
  supplierName: string | null;
  poNo: string | null;
  poDate: string | null;
  poQty: string | null;
  nosKgs: string | null;
  invoiceNo: string | null;
  remark: string | null;
  submittedByName: string;
  submittedAt: string;
}

export function buildPrnEmail(d: PrnEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — PRN: ${d.itemDescription}`;
  const html = emailWrap(
    `PRN: ${d.itemDescription}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A new PRN entry has been saved.</p>
    ${table([
      ["PRN Date", fmtDate(d.prnDate)],
      ["Item Description", d.itemDescription],
      ["Bifurcation", d.bifurcation || "—"],
      ["Requirements", d.requirements || "—"],
      ["Qty", d.qty || "—"],
      ["Current Stock", d.currentStock || "—"],
      ["Plant", d.plant || "—"],
      ["Supplier Name", d.supplierName || "—"],
      ["PO No", d.poNo || "—"],
      ["PO Date", d.poDate ? fmtDate(d.poDate) : "—"],
      ["PO Qty", d.poQty || "—"],
      ["Nos / Kgs", d.nosKgs || "—"],
      ["Invoice No", d.invoiceNo || "—"],
      ["Remark", d.remark || "—"],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

// ---------------------------------------------------------------------------
// 13. Dispatch
// ---------------------------------------------------------------------------

export interface DispatchEmailArgs {
  transactionDate: string;
  itemName: string;
  bags: number;
  kgPerBag: number;
  dispatchQtyKg: number;
  closingBalance: number;
  vehicleNo: string | null;
  partyName: string | null;
  remark: string | null;
  submittedByName: string;
  submittedAt: string;
}

export function buildDispatchEmail(d: DispatchEmailArgs): { subject: string; html: string } {
  const subject = `[JSCI A-20/1] Stores — Dispatch: ${d.itemName}`;
  const html = emailWrap(
    `Dispatch: ${d.itemName}`,
    `<p style="margin:0 0 16px;color:#555;font-size:14px">A finished goods dispatch has been recorded.</p>
    ${table([
      ["Date", fmtDate(d.transactionDate)],
      ["Item", d.itemName],
      ["Bags", fmtNum(d.bags)],
      ["Kg / Bag", fmtNum(d.kgPerBag)],
      ["Dispatch Qty (kg)", fmtNum(d.dispatchQtyKg, "kg")],
      ["Closing Balance", fmtNum(d.closingBalance, "kg")],
      ["Vehicle No", d.vehicleNo || "—"],
      ["Party Name", d.partyName || "—"],
      ["Remark", d.remark || "—"],
      ["Entered By", d.submittedByName],
      ["Entered At", fmtTs(d.submittedAt)],
    ])}`,
  );
  return { subject, html };
}

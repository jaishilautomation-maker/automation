// =============================================================================
// Google Sheets sync — push rows to per-department master spreadsheets.
//
// FOUR separate spreadsheets, one per department, so each team only sees
// their own data:
//
//   "jobcard"     -> Job Cards tab (shared: production/stores/operator/lab all
//                    upsert the SAME row as the card moves through its stages)
//   "production"  -> Breakdown Register, Preventive Maintenance
//   "stores"      -> 16 Stores-module tabs
//   "lab"         -> 7 Lab QC tabs
//
// Public exports:
//   syncJobCardRow(row)               - upsert into the jobcard sheet
//   appendRow(target, tab, values)    - append to any tab in any sheet
//   bootstrapHeaders(only?)           - write header rows (one-time setup)
//
// Auth:
//   Reuses GMAIL_SERVICE_ACCOUNT_KEY_BASE64 (same JSON key as Gmail).
//   Scope: spreadsheets only. NO `subject` / no impersonation - Sheets does
//   not need domain-wide delegation.
//   Each spreadsheet must be shared as Editor with the service account's
//   client_email.
//
// Env vars (one Sheet ID per department):
//   GOOGLE_SHEET_ID_JOBCARD
//   GOOGLE_SHEET_ID_PRODUCTION
//   GOOGLE_SHEET_ID_STORES
//   GOOGLE_SHEET_ID_LAB
//   GOOGLE_SHEET_ID            - legacy single-sheet fallback. If a
//                                department-specific var is missing, this is
//                                used instead, so nothing breaks mid-migration.
//
// Contract:
//   - Never throws. All failures are caught and logged.
//   - Sheet sync failures NEVER block the caller's DB write or email send.
// =============================================================================

import { google } from "googleapis";

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export type SheetTarget = "jobcard" | "production" | "stores" | "lab";

const TARGET_ENV_VAR: Record<SheetTarget, string> = {
  jobcard:    "GOOGLE_SHEET_ID_JOBCARD",
  production: "GOOGLE_SHEET_ID_PRODUCTION",
  stores:     "GOOGLE_SHEET_ID_STORES",
  lab:        "GOOGLE_SHEET_ID_LAB",
};

// ---------------------------------------------------------------------------
// Job Card row type + column order
// ---------------------------------------------------------------------------

/** Full job-card row - all fields optional except job_number (the upsert key). */
export interface JobCardSheetRow {
  job_number:                     string;
  machine_number?:                string | null;
  material_code?:                 string | null;
  status?:                        string | null;
  planned_production_mt?:         number | null;
  oil_required_kg?:               number | null;
  sulphur_supplier?:              string | null;
  sulphur_lot_number?:            string | null;
  sulphur_empty_date?:            string | null;
  oil_supplier?:                  string | null;
  oil_batch_number?:              string | null;
  oil_quantity?:                  number | null;
  production_by?:                 string | null;
  production_at?:                 string | null;
  // Stores stage
  oil_issued_kg?:                 number | null;
  stores_by?:                     string | null;
  stores_at?:                     string | null;
  // Operator stage
  actual_production_mt?:          number | null;
  expected_oil_kg?:               number | null;
  actual_oil_consumption_kg?:     number | null;
  oil_variance_kg?:               number | null;
  oil_extra_leftover_balance_kg?: number | null;
  operator_by?:                   string | null;
  operator_submitted_at?:         string | null;
  // Lab stage
  lab_result?:                    string | null;
  lab_remark?:                    string | null;
  lab_by?:                        string | null;
  lab_at?:                        string | null;
}

/** Column order in the Job Cards tab - must match JOB_CARD_HEADERS below. */
const JOB_CARD_COLUMNS: (keyof JobCardSheetRow)[] = [
  "job_number",
  "machine_number",
  "material_code",
  "status",
  "planned_production_mt",
  "oil_required_kg",
  "sulphur_supplier",
  "sulphur_lot_number",
  "sulphur_empty_date",
  "oil_supplier",
  "oil_batch_number",
  "oil_quantity",
  "production_by",
  "production_at",
  "oil_issued_kg",
  "stores_by",
  "stores_at",
  "actual_production_mt",
  "expected_oil_kg",
  "actual_oil_consumption_kg",
  "oil_variance_kg",
  "oil_extra_leftover_balance_kg",
  "operator_by",
  "operator_submitted_at",
  "lab_result",
  "lab_remark",
  "lab_by",
  "lab_at",
];

export const JOB_CARD_HEADERS: string[] = [
  "Job Number",
  "Machine Number",
  "Material / Batch Code",
  "Status",
  "Planned Production (MT)",
  "Oil Required (kg)",
  "Sulphur Supplier",
  "Sulphur Lot Number",
  "Sulphur Empty Date",
  "Oil Supplier",
  "Oil Batch Number",
  "Oil Quantity (kg)",
  "Production By",
  "Production At",
  "Oil Issued (kg)",
  "Stores By",
  "Stores At",
  "Actual Production (MT)",
  "Expected Oil (kg)",
  "Actual Oil Consumed (kg)",
  "Oil Variance (kg)",
  "Oil Extra / Leftover Balance (kg)",
  "Operator By",
  "Operator Submitted At",
  "Lab Result",
  "Lab Remark",
  "Lab By",
  "Lab At",
];

// ---------------------------------------------------------------------------
// Tab -> header definitions, per target spreadsheet
// ---------------------------------------------------------------------------

const SHEET_TABS: Record<SheetTarget, Record<string, string[]>> = {
  // -------------------------------------------------------------------------
  jobcard: {
    "Job Cards": JOB_CARD_HEADERS,
  },

  // -------------------------------------------------------------------------
  production: {
    "Breakdown Register": [
      "ID", "SR No", "Machine Name", "Start At", "Finish At",
      "Nature of Breakdown", "Repair Carried Out", "Parts Replaced",
      "Corrective Action", "Remarks", "Created By", "Created At", "Factory ID",
    ],
    "Preventive Maintenance": [
      "ID", "Machine", "Component", "Task", "Frequency (weeks)",
      "Completed At", "Completed By", "Notes", "Factory ID",
    ],
  },

  // -------------------------------------------------------------------------
  // Stores module - 13 tabs. Column names taken from the actual payload keys
  // written by app/(app)/stores/page.tsx.
  // NOTE: the "Job Cards" and "Oil Issue" tabs in the Stores UI both write to
  // the SAME pulveriser_job_cards row (the Stores stage of the Job Card
  // lifecycle) - that data is synced to the jobcard spreadsheet via
  // syncJobCardRow(), not here. "Approved / Rejected" and "Stock Ledger" are
  // read-only views with no save handler, so nothing to sync for those either.
  stores: {
    "Raw Material": [
      "Date", "Product", "Opening Balance", "Qty Received", "Material Return",
      "Qty Issued (Prodn)", "Qty Issued (Bal)", "Dispatch As Is",
      "Closing Balance", "Status", "Remarks", "Qty Issued to Ball Mill",
      "Net Balance", "Entered By", "Entered At",
    ],
    "Received": [
      "Date", "Particular", "Transport", "Materials", "Vehicle No",
      "O. Wt", "F. Wt", "Bags / Loose", "Inv / Chl No", "Code",
      "PO No", "Remarks", "Entered By", "Entered At",
    ],
    "Supplied": [
      "Date", "Particular", "Transport", "Materials", "Vehicle No",
      "O. Wt", "F. Wt", "Bags / Loose", "Inv / Chl No", "Code",
      "PO No", "Remarks", "Entered By", "Entered At",
    ],
    "Daily Production": [
      "Date", "CEAT 108 Export", "M2615", "Plain 2615", "Apollo 160108",
      "Lanxess", "CEAT R5299", "Plain WE10 SA", "JKI 108",
      "Old Bags Shakti", "Rubber Maker 50kg", "Sulphur Gain",
      "Jumbo Bag", "Export Plan 25kg", "Total (MT)",
      "Entered By", "Entered At",
    ],
    "Daily Dispatch": [
      "Date", "CEAT 108 Export", "M2615", "Plain 2615", "Apollo 160108",
      "Lanxess", "CEAT R5299", "Plain WE10", "Lanxess 2% Oil", "JKI 108",
      "Old Bags 50kg", "Rubber Maker 50kg", "Sulphur Pesticide",
      "Jumbo Bag 500kg", "Export Plan 25kg", "Total (MT)",
      "Entered By", "Entered At",
    ],
    "Packing Material": [
      "Date", "Product", "Opening Balance", "Qty Received", "By Transfer",
      "Qty Issued", "To Transfer", "Closing Balance", "Status", "Remark",
      "Entered By", "Entered At",
    ],
    "Finished Goods": [
      "Date", "Product", "Bag (kg)", "Opening Balance", "Production",
      "Repacking By Tr", "Less Packing Stock", "Transfer To Tr", "Dispatch",
      "Closing Balance", "Total (MT)", "Remark", "Entered By", "Entered At",
    ],
    "Ball Mill": [
      "Date", "Shift", "Party", "Batch No", "Qty Mfg", "Kg", "Total (MT)",
      "Dispatch Date", "Location", "Dispatch Bags", "Balance Bags",
      "Entered By", "Entered At",
    ],
    "Batch Wise": [
      "Batch No", "Qty (Bags)", "Code", "Mfg Date", "Qty (MT)",
      "Remaining Bags", "Remaining (MT)", "Dispatches (JSON)",
      "Entered By", "Entered At",
    ],
    "Oil Consumption": [
      "Date", "Oil Type", "Tank Qty", "Taken From Tank", "Add To Tank",
      "Tank + Drum Qty", "Drums (JSON)", "Total Consumption",
      "Entered By", "Entered At",
    ],
    "Issue Slip": [
      "Slip No", "Plant", "Date", "Material Description", "Unit",
      "Qty Required", "Qty Issued", "Used For", "Remaining", "Remark",
      "Entered By", "Entered At",
    ],
    "PRN": [
      "PRN Date", "Item Description", "Bifurcation", "Requirements", "Qty",
      "Current Stock", "Plant", "Supplier Name", "PO No", "PO Date",
      "PO Qty", "Nos / Kgs", "Invoice No", "Remark",
      "Entered By", "Entered At",
    ],
    "Dispatch": [
      "Transaction Date", "Item Name", "Bags", "Kg / Bag", "Dispatch Qty (kg)",
      "Closing Balance", "Vehicle No", "Party Name", "Remark",
      "Entered By", "Entered At",
    ],
  },

  // -------------------------------------------------------------------------
  lab: {
    "RM Receipt": [
      "ID", "Material Type", "Batch Number", "Supplier Name", "Quantity",
      "Unit", "Received Date", "Truck Number", "Appearance",
      "Submitted By", "Submitted At", "Factory ID",
    ],
    "RM QC": [
      "ID", "Material Name", "Batch Number", "Test Date", "Chemist",
      "Test Results (JSON)", "Remarks", "Submitted By", "Submitted At", "Factory ID",
    ],
    "Hourly Reading": [
      "ID", "Batch Number", "Reading Time", "Test Results (JSON)",
      "Remarks", "Submitted By", "Submitted At", "Factory ID",
    ],
    "Batch Analysis": [
      "ID", "Batch Number", "Analysis Date", "Appearance",
      "Test Results (JSON)", "Remarks", "Submitted By", "Submitted At",
      "Is Update", "Factory ID",
    ],
    "Product QC": [
      "ID", "Product Name", "Batch Number", "Phase", "Test Date",
      "Appearance", "Appearance OK", "Overall Result",
      "Test Results (JSON)", "Remarks", "Submitted By", "Submitted At",
      "Is Update", "Factory ID",
    ],
    "Post Production": [
      "ID", "Product Name", "Batch Number", "Test Date", "Chemist",
      "Test Results (JSON)", "Remarks", "Submitted By", "Submitted At", "Factory ID",
    ],
    "Lab Trials": [
      "ID", "Trial Code", "Product Name", "Trial Date", "Status",
      "Objective", "Appearance", "Conclusion",
      "Test Results (JSON)", "Remarks", "Submitted By", "Submitted At", "Factory ID",
    ],
  },
};

// ---------------------------------------------------------------------------
// Google Sheets client (lazy, cached at module level)
// ---------------------------------------------------------------------------

let _sheetsClient: ReturnType<typeof google.sheets> | null = null;

function getSheetsClient(): ReturnType<typeof google.sheets> {
  if (_sheetsClient) return _sheetsClient;

  const keyBase64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
  if (!keyBase64) {
    throw new Error(
      "Sheets not configured: GMAIL_SERVICE_ACCOUNT_KEY_BASE64 is missing."
    );
  }

  let serviceAccountKey: { client_email: string; private_key: string };
  try {
    serviceAccountKey = JSON.parse(
      Buffer.from(keyBase64, "base64").toString("utf-8")
    );
  } catch (err) {
    throw new Error(
      "GMAIL_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON: " +
      String(err)
    );
  }

  // No `subject` / no impersonation - Sheets uses the service account's own
  // identity, not a delegated Workspace user.
  const auth = new google.auth.JWT({
    email:  serviceAccountKey.client_email,
    key:    serviceAccountKey.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

/**
 * Resolve the spreadsheet ID for a department.
 * Falls back to the legacy single-sheet GOOGLE_SHEET_ID if the
 * department-specific var isn't set yet (keeps things working mid-migration).
 */
function getSheetId(target: SheetTarget): string {
  const envVar   = TARGET_ENV_VAR[target];
  const specific = process.env[envVar];
  if (specific) return specific;

  const legacy = process.env.GOOGLE_SHEET_ID;
  if (legacy) {
    console.warn(
      `[sheets-sync] ${envVar} not set - falling back to legacy GOOGLE_SHEET_ID for target "${target}".`
    );
    return legacy;
  }

  throw new Error(
    `Sheets not configured: neither ${envVar} nor GOOGLE_SHEET_ID is set.`
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the key column (column A = job_number) from the Job Cards tab.
 * Returns the 1-based sheet row index for each non-empty data row.
 */
async function readJobCardKeyColumn(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string,
): Promise<Array<{ rowIndex: number; jobNumber: string }>> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range:         "Job Cards!A:A",
  });
  const rows = res.data.values ?? [];
  const result: Array<{ rowIndex: number; jobNumber: string }> = [];

  // Row 0 is the header - skip it. Data starts at array index 1 / sheet row 2.
  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i]?.[0];
    if (typeof cell === "string" && cell.trim()) {
      result.push({ rowIndex: i + 1, jobNumber: cell.trim() });
    }
  }
  return result;
}

/** Convert a JobCardSheetRow to an ordered array of cell values. */
function jobCardToValues(row: JobCardSheetRow): (string | number | null)[] {
  return JOB_CARD_COLUMNS.map(col => {
    const v = row[col];
    return v == null ? null : (v as string | number);
  });
}

/**
 * Merge an existing row with an incoming partial update.
 * Only overwrites cells where the incoming value is non-null - so a
 * Stores-stage write doesn't erase the Production-stage columns.
 */
function mergeJobCardValues(
  existing: (string | number | null)[],
  incoming: (string | number | null)[],
): (string | number | null)[] {
  const merged = [...existing];
  for (let i = 0; i < incoming.length; i++) {
    if (incoming[i] != null) merged[i] = incoming[i];
  }
  return merged;
}

/** Convert a 0-based column index to A1 letter notation. */
function colLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upsert a job card row in the "Job Cards" tab of the jobcard spreadsheet.
 *
 * - Finds the row where column A === job_number.
 * - Found     -> merges (non-null incoming fields win) and updates in place.
 * - Not found -> appends a new row (first write, from the Production stage).
 *
 * Never throws.
 */
export async function syncJobCardRow(data: JobCardSheetRow): Promise<void> {
  try {
    const sheets   = getSheetsClient();
    const sheetId  = getSheetId("jobcard");
    const incoming = jobCardToValues(data);

    const keyRows = await readJobCardKeyColumn(sheets, sheetId);
    const found   = keyRows.find(r => r.jobNumber === data.job_number);

    if (found) {
      const lastCol = colLetter(JOB_CARD_COLUMNS.length - 1);
      const existingRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range:         `Job Cards!A${found.rowIndex}:${lastCol}${found.rowIndex}`,
      });
      const existingValues = (existingRes.data.values?.[0] ?? []) as (string | number | null)[];
      while (existingValues.length < JOB_CARD_COLUMNS.length) existingValues.push(null);

      const merged = mergeJobCardValues(existingValues, incoming);

      await sheets.spreadsheets.values.update({
        spreadsheetId:    sheetId,
        range:            `Job Cards!A${found.rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody:      { values: [merged] },
      });

      console.info(`[sheets-sync] updated Job Cards row ${found.rowIndex} for ${data.job_number}`);
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId:    sheetId,
        range:            "Job Cards!A:A",
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody:      { values: [incoming] },
      });

      console.info(`[sheets-sync] appended new Job Cards row for ${data.job_number}`);
    }
  } catch (err) {
    console.error(
      `[sheets-sync] syncJobCardRow failed for job_number="${data.job_number}":`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Append a single row to a tab in one of the department spreadsheets.
 *
 * @param target   Which department spreadsheet to write to.
 * @param tabName  Exact tab name (case-sensitive).
 * @param rowData  Ordered cell values - must match that tab's header order.
 *
 * Never throws.
 */
export async function appendRow(
  target: SheetTarget,
  tabName: string,
  rowData: (string | number | boolean | null | undefined)[],
): Promise<void> {
  try {
    const sheets  = getSheetsClient();
    const sheetId = getSheetId(target);

    // Coerce undefined -> null; the Sheets API rejects undefined.
    const values = rowData.map(v => (v === undefined ? null : v));

    await sheets.spreadsheets.values.append({
      spreadsheetId:    sheetId,
      range:            `${tabName}!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody:      { values: [values] },
    });

    console.info(`[sheets-sync] appended row to ${target} / "${tabName}"`);
  } catch (err) {
    console.error(
      `[sheets-sync] appendRow failed for ${target} / "${tabName}":`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ---------------------------------------------------------------------------
// Header bootstrap
// ---------------------------------------------------------------------------

/**
 * Write header rows to tabs whose row 1 is currently empty.
 * Safe to run repeatedly - tabs that already have a header are skipped.
 * Tabs that don't exist in the spreadsheet are reported and skipped.
 *
 * @param only  Optional - bootstrap just one department's spreadsheet.
 * @returns     Per-tab outcome, useful for surfacing in an API response.
 */
export async function bootstrapHeaders(
  only?: SheetTarget,
): Promise<Record<string, string>> {
  const outcome: Record<string, string> = {};
  const targets: SheetTarget[] = only
    ? [only]
    : ["jobcard", "production", "stores", "lab"];

  for (const target of targets) {
    let sheets: ReturnType<typeof google.sheets>;
    let sheetId: string;
    try {
      sheets  = getSheetsClient();
      sheetId = getSheetId(target);
    } catch (err) {
      outcome[target] = "FAILED: " + (err instanceof Error ? err.message : String(err));
      continue;
    }

    for (const [tab, headers] of Object.entries(SHEET_TABS[target])) {
      const label = `${target} / ${tab}`;
      try {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range:         `${tab}!A1`,
        });
        const cell = res.data.values?.[0]?.[0];

        if (cell) {
          outcome[label] = "skipped - already has a header";
          continue;
        }

        await sheets.spreadsheets.values.update({
          spreadsheetId:    sheetId,
          range:            `${tab}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody:      { values: [headers] },
        });
        outcome[label] = `wrote ${headers.length} headers`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outcome[label] = "FAILED: " + msg;
        console.error(`[sheets-sync] bootstrapHeaders failed for ${label}:`, msg);
      }
    }
  }

  return outcome;
}

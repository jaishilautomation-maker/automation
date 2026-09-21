// =============================================================================
// Google Sheets sync — push rows to the master reference spreadsheet.
//
// Two public exports:
//   syncJobCardRow(data)   — upsert in "Job Cards" tab (one row per card,
//                            updated in-place as the card moves through stages)
//   appendRow(tab, values) — append a row to any other tab (all other modules)
//
// Auth:
//   Reuses GMAIL_SERVICE_ACCOUNT_KEY_BASE64 (same JSON key already in Vercel).
//   Scope: https://www.googleapis.com/auth/spreadsheets only.
//   NO `subject` / NO impersonation — Sheets doesn't need domain-wide delegation.
//   The service account must be shared as Editor on the spreadsheet.
//
// Sheet ID:
//   GOOGLE_SHEET_ID env var — the part between /d/ and /edit in the URL.
//
// Contract (mirrors send-email.ts):
//   - Never throws. All failures are caught and logged to console.
//   - Sheet sync failures NEVER block the caller's DB write or email send.
//
// Tab layout (Row 1 = headers, all human-readable):
//   "Job Cards"           — upsert keyed on job_number
//   "Breakdown Register"  — append
//   "Preventive Maintenance" — append
//   "RM Receipt"          — append
//   "RM QC"               — append
//   "Hourly Reading"      — append
//   "Batch Analysis"      — append
//   "Product QC"          — append
//   "Post Production"     — append
//   "Lab Trials"          — append
// =============================================================================

import { google } from "googleapis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full job-card row — all fields optional except job_number (the key). */
export interface JobCardSheetRow {
  job_number:                   string;
  machine_number?:              string | null;
  material_code?:               string | null;
  status?:                      string | null;
  planned_production_mt?:       number | null;
  oil_required_kg?:             number | null;
  sulphur_supplier?:            string | null;
  sulphur_lot_number?:          string | null;
  sulphur_empty_date?:          string | null;
  oil_supplier?:                string | null;
  oil_batch_number?:            string | null;
  oil_quantity?:                number | null;
  production_by?:               string | null;
  production_at?:               string | null;
  // Stores stage
  oil_issued_kg?:               number | null;
  stores_by?:                   string | null;
  stores_at?:                   string | null;
  // Operator stage
  actual_production_mt?:        number | null;
  expected_oil_kg?:             number | null;
  actual_oil_consumption_kg?:   number | null;
  oil_variance_kg?:             number | null;
  oil_extra_leftover_balance_kg?: number | null;
  operator_by?:                 string | null;
  operator_submitted_at?:       string | null;
  // Lab stage
  lab_result?:                  string | null;
  lab_remark?:                  string | null;
  lab_by?:                      string | null;
  lab_at?:                      string | null;
}

// The column order used in the sheet (must match the header row you create).
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

/** Human-readable header labels for the Job Cards tab (Row 1). */
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
// Google Sheets client (lazy, cached at module level)
// ---------------------------------------------------------------------------

let _sheetsClient: ReturnType<typeof google.sheets> | null = null;

function getSheetsClient(): ReturnType<typeof google.sheets> {
  if (_sheetsClient) return _sheetsClient;

  const keyBase64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
  if (!keyBase64) {
    throw new Error(
      "Sheets not configured: GMAIL_SERVICE_ACCOUNT_KEY_BASE64 is missing. " +
      "Set it in your environment variables (same value as for Gmail)."
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

  // No `subject` / no impersonation — Sheets access goes through the service
  // account's own identity, not a delegated Workspace user.
  const auth = new google.auth.JWT({
    email:  serviceAccountKey.client_email,
    key:    serviceAccountKey.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

function getSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error(
      "Sheets not configured: GOOGLE_SHEET_ID is missing. " +
      "Add it to your environment variables — it's the part between /d/ and /edit in the sheet URL."
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the key column (column A = job_number) from the Job Cards tab.
 * Returns [ [rowIndex_1based, job_number], ... ] for all data rows (skips header).
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

  // Row 0 is the header ("Job Number") — skip it; data starts at row index 1.
  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i]?.[0];
    if (typeof cell === "string" && cell.trim()) {
      result.push({ rowIndex: i + 1, jobNumber: cell.trim() }); // Sheets rows are 1-based
    }
  }
  return result;
}

/** Convert a JobCardSheetRow to an ordered array of cell values. */
function jobCardToValues(row: JobCardSheetRow): (string | number | null)[] {
  return JOB_CARD_COLUMNS.map(col => {
    const v = row[col];
    if (v == null) return null;
    return v as string | number;
  });
}

/**
 * Merge an existing row (as a values array) with the incoming partial update.
 * Only overwrites cells where the incoming value is non-null/non-undefined.
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

/** Convert column index (0-based) to A1 letter notation. */
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
 * Upsert a job card row in the "Job Cards" tab.
 *
 * - Looks up the row where column A === job_number.
 * - If found: reads the existing row and merges (non-null incoming fields win),
 *   then writes the merged row back in place.
 * - If not found: appends a new row (first write, from Production stage).
 *
 * Merge behaviour means calling syncJobCardRow() at the Stores stage doesn't
 * erase the Production-stage fields — it just fills in the Stores columns.
 *
 * Never throws.
 */
export async function syncJobCardRow(data: JobCardSheetRow): Promise<void> {
  try {
    const sheets  = getSheetsClient();
    const sheetId = getSheetId();
    const incoming = jobCardToValues(data);

    // --- Look up existing row ------------------------------------------------
    const keyRows = await readJobCardKeyColumn(sheets, sheetId);
    const found   = keyRows.find(r => r.jobNumber === data.job_number);

    if (found) {
      // Read the full existing row so we can merge without erasing prior fields.
      const existingRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range:         `Job Cards!A${found.rowIndex}:${colLetter(JOB_CARD_COLUMNS.length - 1)}${found.rowIndex}`,
      });
      const existingValues = (existingRes.data.values?.[0] ?? []) as (string | number | null)[];
      // Pad to full width so mergeJobCardValues doesn't create gaps.
      while (existingValues.length < JOB_CARD_COLUMNS.length) existingValues.push(null);

      const merged = mergeJobCardValues(existingValues, incoming);

      await sheets.spreadsheets.values.update({
        spreadsheetId:     sheetId,
        range:             `Job Cards!A${found.rowIndex}`,
        valueInputOption:  "USER_ENTERED",
        requestBody:       { values: [merged] },
      });

      console.info(`[sheets-sync] updated Job Cards row ${found.rowIndex} for ${data.job_number}`);
    } else {
      // First time we see this job card — append.
      await sheets.spreadsheets.values.append({
        spreadsheetId:     sheetId,
        range:             "Job Cards!A:A",
        valueInputOption:  "USER_ENTERED",
        insertDataOption:  "INSERT_ROWS",
        requestBody:       { values: [incoming] },
      });

      console.info(`[sheets-sync] appended new Job Cards row for ${data.job_number}`);
    }
  } catch (err) {
    // Never block the caller — log and continue.
    console.error(
      `[sheets-sync] syncJobCardRow failed for job_number="${data.job_number}":`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Append a single row to any tab in the master spreadsheet.
 *
 * Used for all append-only modules:
 *   Breakdown Register, Preventive Maintenance,
 *   RM Receipt, RM QC, Hourly Reading, Batch Analysis,
 *   Product QC, Post Production, Lab Trials.
 *
 * @param tabName   Exact sheet tab name (case-sensitive, matches the sheet).
 * @param rowData   Ordered array of cell values — must match the header row order.
 *
 * Never throws.
 */
export async function appendRow(
  tabName: string,
  rowData: (string | number | boolean | null | undefined)[],
): Promise<void> {
  try {
    const sheets  = getSheetsClient();
    const sheetId = getSheetId();

    // Coerce undefined → null so the Sheets API doesn't choke on it.
    const values = rowData.map(v => (v === undefined ? null : v));

    await sheets.spreadsheets.values.append({
      spreadsheetId:     sheetId,
      range:             `${tabName}!A:A`,
      valueInputOption:  "USER_ENTERED",
      insertDataOption:  "INSERT_ROWS",
      requestBody:       { values: [values] },
    });

    console.info(`[sheets-sync] appended row to tab "${tabName}"`);
  } catch (err) {
    console.error(
      `[sheets-sync] appendRow failed for tab "${tabName}":`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ---------------------------------------------------------------------------
// Header bootstrap helper (call once manually, or on first run)
// ---------------------------------------------------------------------------

/**
 * Write header rows to every tab if row 1 is currently empty.
 * Safe to call multiple times — skips tabs that already have a header.
 * Not called automatically; invoke via a one-off script or admin API if needed.
 */
export async function bootstrapHeaders(): Promise<void> {
  const tabHeaders: Record<string, string[]> = {
    "Job Cards": JOB_CARD_HEADERS,
    "Breakdown Register": [
      "ID", "SR No", "Machine Name", "Start At", "Finish At",
      "Nature of Breakdown", "Repair Carried Out", "Parts Replaced",
      "Corrective Action", "Remarks", "Created By", "Created At", "Factory ID",
    ],
    "Preventive Maintenance": [
      "ID", "Machine", "Component", "Task", "Frequency (weeks)",
      "Completed At", "Completed By", "Notes", "Factory ID",
    ],
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
    "COA Documents": [
      "ID", "Test Report No", "Customer Name", "Product", "Batch No", "Lot No",
      "Quantity", "Invoice No", "Vehicle No", "Mfg Date",
      "PDF URL", "Generated By", "Generated At", "Factory ID",
    ],
  };

  try {
    const sheets  = getSheetsClient();
    const sheetId = getSheetId();

    for (const [tab, headers] of Object.entries(tabHeaders)) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range:         `${tab}!A1`,
      });
      const cell = res.data.values?.[0]?.[0];
      if (!cell) {
        await sheets.spreadsheets.values.update({
          spreadsheetId:    sheetId,
          range:            `${tab}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody:      { values: [headers] },
        });
        console.info(`[sheets-sync] wrote headers to tab "${tab}"`);
      } else {
        console.info(`[sheets-sync] tab "${tab}" already has a header — skipped`);
      }
    }
  } catch (err) {
    console.error("[sheets-sync] bootstrapHeaders failed:", err instanceof Error ? err.message : String(err));
  }
}

// =============================================================================
// stores-sheets.ts
//
// Dedicated Google Sheets sync for the JSCI Stores Register — a SEPARATE
// spreadsheet from the main pulveriser Job Cards sheet.
//
// Sheet ID:  STORES_SHEET_ID env var
// Auth:      Same GMAIL_SERVICE_ACCOUNT_KEY_BASE64 service account
//
// Tab layout (one tab per stores section):
//   "Job Cards"          — Oil Issue entries (pulveriser job cards issued by Stores)
//   "Raw Material"       — RM stock register entries
//   "Received"           — Received Entry Book
//   "Supplied"           — Supplied Entry Book
//   "Daily Production"   — Daily production bag counts + Total MT
//   "Daily Dispatch"     — Daily dispatch bag counts + Total MT
//   "Packing Material"   — PM stock ledger
//   "Finished Goods"     — FG stock ledger
//   "Ball Mill"          — Ball mill production + dispatch
//   "Batch Wise"         — Batch-wise stock + dispatch slots
//   "Oil Consumption"    — Oil tank + drum consumption log
//   "Issue Slips"        — Material issue slips
//   "PRN"                — Purchase Requisition Notes
//   "Dispatch"           — FG dispatch records
//
// Usage:
//   import { appendToStoresSheet, bootstrapStoresHeaders } from "@/lib/notifications/stores-sheets";
//
//   // Append a row to a tab (fire-and-forget from API route):
//   await appendToStoresSheet("Raw Material", [...values]);
//
//   // Write all headers once (call /api/stores-sheets-bootstrap):
//   await bootstrapStoresHeaders();
//
// Never throws — all errors are caught and logged.
// =============================================================================

import { google } from "googleapis";

// ---------------------------------------------------------------------------
// Auth + client (lazy, cached)
// ---------------------------------------------------------------------------

let _client: ReturnType<typeof google.sheets> | null = null;

function getClient(): ReturnType<typeof google.sheets> {
  if (_client) return _client;
  const keyBase64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
  if (!keyBase64) throw new Error("GMAIL_SERVICE_ACCOUNT_KEY_BASE64 is not set.");
  const key = JSON.parse(Buffer.from(keyBase64, "base64").toString("utf-8")) as {
    client_email: string;
    private_key: string;
  };
  const auth = new google.auth.JWT({
    email:  key.client_email,
    key:    key.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _client = google.sheets({ version: "v4", auth });
  return _client;
}

function getSheetId(): string {
  // Use STORES_SHEET_ID if set, otherwise fall back to the main GOOGLE_SHEET_ID.
  // This allows the Stores tabs to live in the same spreadsheet as Job Cards,
  // or in a separate one if STORES_SHEET_ID is configured.
  const id = process.env.STORES_SHEET_ID ?? process.env.GOOGLE_SHEET_ID;
  if (!id || id === "PASTE_YOUR_STORES_SHEET_ID_HERE") {
    throw new Error(
      "No sheet ID configured. Set STORES_SHEET_ID (for a dedicated Stores sheet) " +
      "or GOOGLE_SHEET_ID (to reuse the existing sheet) in your environment variables."
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Tab definitions — name + headers (must stay in sync with stores/page.tsx)
// ---------------------------------------------------------------------------

export const STORES_SHEET_TABS = {
  JOB_CARDS:         "Job Cards",
  RAW_MATERIAL:      "Raw Material",
  RECEIVED:          "Received",
  SUPPLIED:          "Supplied",
  DAILY_PRODUCTION:  "Daily Production",
  DAILY_DISPATCH:    "Daily Dispatch",
  PACKING_MATERIAL:  "Packing Material",
  FINISHED_GOODS:    "Finished Goods",
  BALL_MILL:         "Ball Mill",
  BATCH_WISE:        "Batch Wise",
  OIL_CONSUMPTION:   "Oil Consumption",
  ISSUE_SLIPS:       "Issue Slips",
  PRN:               "PRN",
  DISPATCH:          "Dispatch",
} as const;

export type StoresSheetTab = typeof STORES_SHEET_TABS[keyof typeof STORES_SHEET_TABS];

const TAB_HEADERS: Record<StoresSheetTab, string[]> = {
  "Job Cards": [
    "Date", "Job Number", "Machine", "Shift", "Batch No (Material Code)",
    "Party / Code", "Planned Production (MT)", "Oil Required (kg)",
    "Oil Issued (kg)", "Stores Incharge Note",
    "Production Sent At", "Oil Issued At", "Issued By", "Saved At",
  ],
  "Raw Material": [
    "Date", "Product",
    "Opening Balance", "Qty Received", "Material Return",
    "Qty Issued for Production", "Qty Issued to Balance", "Dispatch As-Is",
    "Closing Balance", "Qty Issued to Ball Mill", "Net Balance",
    "Status", "Remarks", "Entered By", "Saved At",
  ],
  "Received": [
    "Date", "Particular", "Transport", "Materials", "Vehicle No",
    "O/WT", "F/WT", "Bags / Loose", "INV / CHL No", "Code",
    "PO No", "Remarks", "Entered By", "Saved At",
  ],
  "Supplied": [
    "Date", "Particular", "Transport", "Materials", "Vehicle No",
    "O/WT", "F/WT", "Bags / Loose", "INV / CHL No", "Code",
    "PO No", "Remarks", "Entered By", "Saved At",
  ],
  "Daily Production": [
    "Date",
    "CEAT 108 / Export (25kg bags)", "M2615 (25kg)", "PLAIN-2615 (25kg)",
    "APOLLO 160108 (25kg)", "LANXESS (25kg)", "CEAT R5299 (25kg)",
    "PLAIN / WE-10 / SA (25kg)", "Export Plan 25kg",
    "JKI-108 (50kg)", "Old Bags Shakti (50kg)", "Rubber Maker 50kg",
    "Sulphur Gain (50kg)", "Jumbo Bag (250kg)",
    "Total MT", "Entered By", "Saved At",
  ],
  "Daily Dispatch": [
    "Date",
    "CEAT 108 / Export (25kg)", "M2615 (25kg)", "PLAIN-2615 (25kg)",
    "APOLLO 160108 (25kg)", "LANXESS (25kg)", "CEAT R5299 (25kg)",
    "PLAIN / WE-10 (25kg)", "Lanxess 2% Oil (25kg)", "Export Plan 25kg",
    "JKI-108 (50kg)", "Old Bags 50kg", "Rubber Maker 50kg",
    "Sulphur Pesticide (50kg)", "Jumbo Bag 500kg (550kg)",
    "Total MT", "Entered By", "Saved At",
  ],
  "Packing Material": [
    "Date", "Product",
    "Opening Balance", "Qty Received", "By Transfer",
    "Qty Issued", "To Transfer", "Closing Balance",
    "Status", "Remark", "Entered By", "Saved At",
  ],
  "Finished Goods": [
    "Date", "Product", "Bag (kg)",
    "Opening Balance (bags)", "Production (bags)", "Repacking By TR (bags)",
    "Less Packing Stock (bags)", "Transfer To TR (bags)", "Dispatch (bags)",
    "Closing Balance (bags)", "Total MT", "Remark",
    "Entered By", "Saved At",
  ],
  "Ball Mill": [
    "Date", "Shift", "Party", "Batch No",
    "Qty MFG (bags)", "KG (bags x 25)", "Total MT",
    "Dispatch Date", "Dispatch Location", "Dispatch Batch No", "Dispatch Bags",
    "Balance Bags", "Entered By", "Saved At",
  ],
  "Batch Wise": [
    "Mfg Date", "Batch No", "Code", "Qty Bags", "Qty MT",
    "Dispatch 1 Date", "Dispatch 1 INV No", "Dispatch 1 Bags",
    "Dispatch 2 Date", "Dispatch 2 INV No", "Dispatch 2 Bags",
    "Remaining Bags", "Remaining MT",
    "Entered By", "Saved At",
  ],
  "Oil Consumption": [
    "Date", "Oil Type",
    "Tank Qty", "Taken From Tank", "Add To Tank",
    "Tank + Drum Qty", "Total Consumption",
    "Drum 1", "Drum 2", "Drum 3", "Drum 4", "Drum 5",
    "Drum 6", "Drum 7", "Drum 8", "Drum 9", "Drum 10", "Drum 11",
    "Entered By", "Saved At",
  ],
  "Issue Slips": [
    "Slip No", "Plant", "Date", "Material", "Unit",
    "Qty Required", "Qty Issued", "Used For", "Remaining Balance",
    "Remark", "Entered By", "Saved At",
  ],
  "PRN": [
    "PRN Date", "Item Description", "Bifurcation",
    "Requirements", "Qty", "Current Stock", "Plant",
    "Supplier Name", "PO No", "PO Date", "PO Qty", "Nos / Kgs", "Invoice No",
    "Remark", "Entered By", "Saved At",
  ],
  "Dispatch": [
    "Date", "Item Name", "Bags", "Kg / Bag", "Total Kg",
    "Vehicle No", "Party Name", "Remark",
    "Entered By", "Saved At",
  ],
};

// ---------------------------------------------------------------------------
// Public: appendToStoresSheet
// ---------------------------------------------------------------------------

/**
 * Append one row to the given tab in the Stores spreadsheet.
 * Never throws — catches and logs all errors.
 */
export async function appendToStoresSheet(
  tab: StoresSheetTab,
  values: (string | number | boolean | null | undefined)[],
): Promise<void> {
  try {
    const sheets  = getClient();
    const sheetId = getSheetId();
    const row     = values.map(v => (v === undefined ? null : v));

    await sheets.spreadsheets.values.append({
      spreadsheetId:    sheetId,
      range:            `${tab}!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody:      { values: [row] },
    });

    console.info(`[stores-sheets] appended row to "${tab}"`);
  } catch (err) {
    console.error(
      `[stores-sheets] appendToStoresSheet failed for tab "${tab}":`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------------
// Public: bootstrapStoresHeaders
// ---------------------------------------------------------------------------

/**
 * Write header rows (Row 1) to every tab in the Stores spreadsheet.
 * Safe to call multiple times — skips tabs that already have a header in A1.
 * Call this once via GET /api/stores-sheets-bootstrap after creating the sheet.
 */
export async function bootstrapStoresHeaders(): Promise<{
  created: string[];
  skipped: string[];
  errors:  string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors:  string[] = [];

  try {
    const sheets  = getClient();
    const sheetId = getSheetId();

    for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
      try {
        // Check if A1 already has content
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range:         `${tab}!A1`,
        });
        const existing = res.data.values?.[0]?.[0];

        if (existing) {
          console.info(`[stores-sheets] "${tab}" already has header — skipped`);
          skipped.push(tab);
        } else {
          await sheets.spreadsheets.values.update({
            spreadsheetId:    sheetId,
            range:            `${tab}!A1`,
            valueInputOption: "USER_ENTERED",
            requestBody:      { values: [headers] },
          });
          console.info(`[stores-sheets] wrote ${headers.length} headers to "${tab}"`);
          created.push(tab);
        }
      } catch (tabErr) {
        // Common cause: tab doesn't exist yet in the sheet — user must create it manually
        // or via the Sheets API batchUpdate. Log and continue with other tabs.
        const msg = tabErr instanceof Error ? tabErr.message : String(tabErr);
        console.error(`[stores-sheets] error on tab "${tab}": ${msg}`);
        errors.push(`${tab}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stores-sheets] bootstrapStoresHeaders fatal: ${msg}`);
    errors.push(`fatal: ${msg}`);
  }

  return { created, skipped, errors };
}

// ---------------------------------------------------------------------------
// Public: createAllTabs
// ---------------------------------------------------------------------------

/**
 * Creates ALL tab sheets inside the spreadsheet if they don't already exist,
 * then writes headers. Call this once via /api/stores-sheets-bootstrap.
 * Never throws.
 */
export async function createAllTabsAndHeaders(): Promise<{
  created: string[];
  skipped: string[];
  errors:  string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors:  string[] = [];

  try {
    const sheets  = getClient();
    const sheetId = getSheetId();

    // Get existing sheet tab names
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const existingTabs = new Set(
      (meta.data.sheets ?? []).map(s => s.properties?.title ?? "")
    );

    const tabNames = Object.keys(TAB_HEADERS) as StoresSheetTab[];

    // Create missing tabs in one batchUpdate call
    const toCreate = tabNames.filter(t => !existingTabs.has(t));
    if (toCreate.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: toCreate.map(title => ({
            addSheet: { properties: { title } },
          })),
        },
      });
      console.info(`[stores-sheets] created tabs: ${toCreate.join(", ")}`);
    }

    // Now write headers to every tab
    const headerResults = await bootstrapStoresHeaders();
    created.push(...toCreate, ...headerResults.created);
    skipped.push(...headerResults.skipped);
    errors.push(...headerResults.errors);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stores-sheets] createAllTabsAndHeaders fatal: ${msg}`);
    errors.push(`fatal: ${msg}`);
  }

  return { created, skipped, errors };
}

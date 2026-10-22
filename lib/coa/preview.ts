// =============================================================================
// COA preview resolver (server-side, read-only).
//
// Used by POST /api/coa/generate { action: "preview" } to drive the live
// preview table + guard banners on the chemist form. Reads the SAME data the
// generator uses (party specs + each batch's batch_analysis) via the service
// client, runs the shared resolveCoa(), and returns a UI-friendly shape. It
// NEVER claims a report number or writes anything.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  resolveCoa,
  headerFromTestResults,
  type CoaSpec,
  type ResolvedBatch,
} from "./resolve-coa";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

function db(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export interface CoaPreviewResult {
  rows: Array<{
    sr: number;
    sub?: "a" | "b" | "c";
    label: string;
    min: number | null;
    max: number | null;
    method: string | null;
    remarks: string | null;
    hasSpec: boolean;
    needsVerification: boolean;
    rowStatus: "pass" | "fail" | "none";
    actuals: Array<{ batchNumber: string; value: number | null; status: "pass" | "fail" | "none" }>;
  }>;
  batchNumbers: string[];
  customerName: string;
  defaultShipTo: string | null;
  shipToOptions: Array<{ label: string; address: string }>;
  lotNos: string[];
  mfgDates: string[];
  expiryDate: string | null;   // earliest mfg + 2 years (ISO), null if no mfg date
  // guard flags
  missingBatches: string[];
  gaps: Array<{ label: string; field: string }>;
  outOfSpec: Array<{ label: string; batchNumber: string; value: number }>;
  noSpecRows: boolean;
  anyMissing: boolean;
  anyGap: boolean;
  anyOutOfSpec: boolean;
  canGenerate: boolean;
  duplicateInvoiceHint: boolean; // computed client-side separately; kept false here
  // the batch's own party (so the UI can hint when the chosen party differs)
  batchPartyCodes: Array<{ batchNumber: string; partyCode: string | null }>;
}

async function loadSpecs(client: DB, partyCode: string): Promise<CoaSpec[]> {
  const { data, error } = await client
    .from("coa_customer_specs")
    .select("parameter, parameter_label, unit, min_value, max_value, target_value, test_method, remarks, sort_order, needs_verification")
    .eq("party_code", partyCode)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as CoaSpec[];
}

async function loadBatch(client: DB, factoryId: string, batchNumber: string): Promise<ResolvedBatch> {
  const { data: batchRow } = await client
    .from("batches")
    .select("id, lot_number")
    .eq("factory_id", factoryId)
    .eq("batch_number", batchNumber)
    .maybeSingle();
  if (!batchRow) return { batchNumber, testResults: null, lotNo: null, mfgDate: null, partyCode: null };

  const { data: ba } = await client
    .from("batch_analysis")
    .select("test_results, party_code")
    .eq("batch_id", batchRow.id)
    .maybeSingle();
  if (!ba) return { batchNumber, testResults: null, lotNo: batchRow.lot_number ?? null, mfgDate: null, partyCode: null };

  const tr = (ba.test_results ?? {}) as Record<string, unknown>;
  const { lotNo, mfgDate } = headerFromTestResults(tr);
  return {
    batchNumber,
    testResults: tr,
    lotNo: lotNo ?? batchRow.lot_number ?? null,
    mfgDate,
    partyCode: ba.party_code ?? null,
  };
}

export async function resolveCoaPreview(
  factoryId: string,
  partyCode: string,
  batchNumbers: string[],
): Promise<CoaPreviewResult> {
  const client = db();

  const [specs, batches, party, shipTos] = await Promise.all([
    loadSpecs(client, partyCode),
    Promise.all(batchNumbers.map((bn) => loadBatch(client, factoryId, bn))),
    client.from("parties").select("customer_name, default_ship_to").eq("party_code", partyCode).maybeSingle(),
    client.from("party_ship_to_addresses").select("label, address").eq("party_code", partyCode).eq("is_active", true).order("sort_order"),
  ]);

  const resolved = resolveCoa(batches, specs);
  const customerName = (party.data?.customer_name as string) || partyCode;

  const canGenerate =
    specs.length > 0 &&
    !resolved.anyMissing &&
    !resolved.anyGap &&
    !resolved.anyOutOfSpec;

  return {
    rows: resolved.rows.map((r) => ({
      sr: r.sr,
      sub: r.sub,
      label: r.label,
      min: r.min,
      max: r.max,
      method: r.method,
      remarks: r.remarks,
      hasSpec: r.hasSpec,
      needsVerification: r.needsVerification,
      rowStatus: r.rowStatus,
      actuals: r.actuals,
    })),
    batchNumbers,
    customerName,
    defaultShipTo: (party.data?.default_ship_to as string) ?? null,
    shipToOptions: (shipTos.data ?? []) as Array<{ label: string; address: string }>,
    lotNos: resolved.lotNos,
    mfgDates: resolved.mfgDates,
    expiryDate: resolved.expiryDate,
    missingBatches: resolved.missingBatches,
    gaps: resolved.gaps,
    outOfSpec: resolved.outOfSpec,
    noSpecRows: resolved.noSpecRows,
    anyMissing: resolved.anyMissing,
    anyGap: resolved.anyGap,
    anyOutOfSpec: resolved.anyOutOfSpec,
    canGenerate,
    duplicateInvoiceHint: false,
    batchPartyCodes: batches.map((b) => ({ batchNumber: b.batchNumber, partyCode: b.partyCode })),
  };
}

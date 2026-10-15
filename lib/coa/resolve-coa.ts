// =============================================================================
// COA resolver — turn (batch numbers + party) into fully-resolved rows.
//
// Shared by BOTH the live preview (client) and the submit path (server), so the
// previewed table and the saved snapshot are guaranteed identical. Pure
// functions: callers supply the already-fetched data (batches, specs); this
// does the mapping, per-batch pass/fail, averaging/precision, and gap/guard
// detection. No DB or network here.
//
// Pass/fail logic mirrors the Batch Analysis page exactly:
//   fail  if (min != null && v < min) OR (max != null && v > max)
//   pass  otherwise (when a spec + numeric value exist)
//   none  no spec, or no/NaN value
// =============================================================================

import {
  COA_CATALOG,
  BATCH_ANALYSIS_KEYS,
  BATCH_HEADER_KEYS,
  type CoaCatalogRow,
} from "./catalog";

/** A party spec row as stored in coa_customer_specs (070 adds method/remarks/order). */
export interface CoaSpec {
  parameter:        string;        // == qc_source_field (batch_analysis test_key)
  parameter_label:  string;        // display label on the certificate
  unit:             string | null;
  min_value:        number | null;
  max_value:        number | null;
  target_value:     number | null;
  test_method:      string | null;
  remarks:          string | null;
  sort_order:       number | null;
  needs_verification: boolean;
}

/** A resolved batch: its number + the batch_analysis.test_results JSONB. */
export interface ResolvedBatch {
  batchNumber: string;
  /** null when no batch_analysis row was found for this batch number. */
  testResults: Record<string, unknown> | null;
  lotNo:   string | null;
  mfgDate: string | null;        // ISO date or null
  partyCode: string | null;      // batch_analysis.party_code (the batch's own party)
}

export type RowStatus = "pass" | "fail" | "none";

export interface ResolvedActual {
  batchNumber: string;
  /** Raw numeric value, or null if the batch has no value for this field. */
  value:  number | null;
  status: RowStatus;
}

export interface ResolvedRow {
  sr:        number;
  sub?:      "a" | "b" | "c";
  label:     string;
  qcSourceField: string | null;
  min:       number | null;
  max:       number | null;
  method:    string | null;
  remarks:   string | null;
  /** One entry per batch (per-batch columns — the confirmed layout). */
  actuals:   ResolvedActual[];
  /** Average across batches that have a value, at source precision. "-" if none. */
  average:   string;
  /** Does this row carry a party spec at all? */
  hasSpec:   boolean;
  needsVerification: boolean;
  /** Overall row status (fail if ANY batch fails). */
  rowStatus: RowStatus;
}

export interface ResolveResult {
  rows: ResolvedRow[];
  /** Batch numbers with no finalized batch_analysis record. */
  missingBatches: string[];
  /** Party spec rows whose qc_source_field has no batch_analysis key (gaps). */
  gaps: Array<{ label: string; field: string }>;
  /** Rows where at least one batch is out of spec. */
  outOfSpec: Array<{ label: string; batchNumber: string; value: number }>;
  /** Convenience flags for the UI/API guards. */
  anyMissing:   boolean;
  anyGap:       boolean;
  anyOutOfSpec: boolean;
  noSpecRows:   boolean;
  /** Lot no(s) and mfg date(s) collected from the batches. */
  lotNos:   string[];
  mfgDates: string[];
}

// ─── helpers ────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function statusFor(v: number | null, min: number | null, max: number | null): RowStatus {
  if (v == null) return "none";
  if (min == null && max == null) return "none";
  if (min != null && v < min) return "fail";
  if (max != null && v > max) return "fail";
  return "pass";
}

/** Count decimal places in a raw source value's string form. */
function decimals(v: unknown): number {
  if (v == null) return 0;
  const s = String(v);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Average of present values, printed at the HIGHEST source precision. */
function averageAtSourcePrecision(raws: unknown[]): string {
  const present = raws.filter((r) => num(r) != null);
  if (present.length === 0) return "-";
  const sum = present.reduce<number>((a, r) => a + (num(r) as number), 0);
  const maxDp = Math.max(...present.map(decimals));
  return (sum / present.length).toFixed(maxDp);
}

// ─── main resolver ────────────────────────────────────────────────────────────

/**
 * @param batches  resolved batches, in the order the user added them
 * @param specs    the selected party's coa_customer_specs rows
 */
export function resolveCoa(batches: ResolvedBatch[], specs: CoaSpec[]): ResolveResult {
  const missingBatches = batches.filter((b) => b.testResults == null).map((b) => b.batchNumber);

  // Index specs by their qc_source_field (parameter) for override lookup.
  const specByField = new Map<string, CoaSpec>();
  for (const s of specs) specByField.set(s.parameter, s);

  // A party may spec a field that is NOT in the fixed catalog slots at all; we
  // still want to surface its gap if it has no batch_analysis key. Collect every
  // spec field, mark those with no QC source as gaps.
  const gaps: ResolveResult["gaps"] = [];
  for (const s of specs) {
    if (!BATCH_ANALYSIS_KEYS.has(s.parameter)) {
      gaps.push({ label: s.parameter_label, field: s.parameter });
    }
  }

  const outOfSpec: ResolveResult["outOfSpec"] = [];
  const rows: ResolvedRow[] = [];

  for (const slot of COA_CATALOG) {
    const row = resolveSlot(slot, batches, specByField);
    for (const a of row.actuals) {
      if (a.status === "fail" && a.value != null) {
        outOfSpec.push({ label: row.label, batchNumber: a.batchNumber, value: a.value });
      }
    }
    rows.push(row);
  }

  const lotNos = Array.from(
    new Set(batches.map((b) => b.lotNo).filter((x): x is string => !!x && x.trim() !== "")),
  );
  const mfgDates = batches
    .map((b) => b.mfgDate)
    .filter((x): x is string => !!x && x.trim() !== "");

  return {
    rows,
    missingBatches,
    gaps,
    outOfSpec,
    anyMissing:   missingBatches.length > 0,
    anyGap:       gaps.length > 0,
    anyOutOfSpec: outOfSpec.length > 0,
    noSpecRows:   specs.length === 0,
    lotNos,
    mfgDates,
  };
}

function resolveSlot(
  slot: CoaCatalogRow,
  batches: ResolvedBatch[],
  specByField: Map<string, CoaSpec>,
): ResolvedRow {
  // Which spec applies to this slot? The spec whose parameter equals the slot's
  // qcSourceField wins (that's how row 1 switches between CS2-purity and
  // toluene-insolubility: the party either specs purity_percent or
  // insolubility_toluene, each mapping to its own slot/label).
  const spec = slot.qcSourceField ? specByField.get(slot.qcSourceField) : undefined;

  const field  = slot.qcSourceField;
  const label  = spec?.parameter_label ?? slot.defaultLabel;
  const min    = spec?.min_value ?? null;
  const max    = spec?.max_value ?? null;
  const method = spec?.test_method ?? null;
  const remarks = spec?.remarks ?? null;
  const hasSpec = !!spec;
  const needsVerification = spec?.needs_verification ?? false;

  const rawPerBatch: unknown[] = [];
  const actuals: ResolvedActual[] = batches.map((b) => {
    const raw = field && b.testResults ? b.testResults[field] : undefined;
    rawPerBatch.push(raw);
    const value = num(raw);
    return { batchNumber: b.batchNumber, value, status: statusFor(value, min, max) };
  });

  const rowStatus: RowStatus = actuals.some((a) => a.status === "fail")
    ? "fail"
    : actuals.some((a) => a.status === "pass")
      ? "pass"
      : "none";

  return {
    sr: slot.sr,
    sub: slot.sub,
    label,
    qcSourceField: field,
    min,
    max,
    method,
    remarks,
    actuals,
    average: averageAtSourcePrecision(rawPerBatch),
    hasSpec,
    needsVerification,
    rowStatus,
  };
}

/** Pull lot_no / mfg_date out of a batch_analysis.test_results JSONB blob. */
export function headerFromTestResults(tr: Record<string, unknown> | null): {
  lotNo: string | null;
  mfgDate: string | null;
} {
  if (!tr) return { lotNo: null, mfgDate: null };
  const lot = tr[BATCH_HEADER_KEYS.lotNo];
  const mfg = tr[BATCH_HEADER_KEYS.mfgDate];
  return {
    lotNo:   lot != null && String(lot).trim() !== "" ? String(lot) : null,
    mfgDate: mfg != null && String(mfg).trim() !== "" ? String(mfg) : null,
  };
}

// =============================================================================
// A-20 COA - pure helpers (no DB, no server-only imports) shared by the server
// generator and the PDF renderer: snapshot types, date helpers, spec text and
// the row resolver that turns template + QC data + typed values into rows.
// =============================================================================

import type { A20ProductTemplate, A20RowDef, A20SpecStyle, A20DocStyle } from "./catalog";
import { A20_EXPIRY_YEARS } from "./catalog";

export interface A20SnapshotRow {
  sr: number;
  label: string;
  unit: string;
  /** Printed spec: single column text (also used for "suffix" style). */
  specText: string;
  /** Printed Min / Max cells (minmax style). */
  specMin: string;
  specMax: string;
  actual: string;
}

export interface A20CoaSnapshot {
  testReportNo: number;
  coaDate: string;          // dd-mm-yyyy
  productCode: string;
  productTitle: string;
  docStyle: A20DocStyle;
  specStyle: A20SpecStyle;
  batchNumber: string;
  mfgDate: string;          // dd-mm-yyyy or "-"
  expiryDate: string | null; // dd-mm-yyyy; null = not printed
  qtyLabel: string;
  qty: string;
  invoiceNo: string;
  invoiceDate: string;
  lorryNo: string;
  rows: A20SnapshotRow[];
  checkedBy: string;
  draft?: boolean;
}

// ─── dates ──────────────────────────────────────────────────────────────────
const p2 = (n: number) => String(n).padStart(2, "0");

export function isoToDdMmYyyy(iso: string | null | undefined): string {
  if (!iso) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** mfg + N years - 1 day, e.g. 2026-09-02 -> 2028-09-01. Returns ISO or null. */
export function expiryFromMfg(mfgIso: string | null | undefined): string | null {
  const m = mfgIso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(mfgIso) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]) + A20_EXPIRY_YEARS, Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

// ─── spec formatting ────────────────────────────────────────────────────────
const trim = (n: number) => String(Number(n));

export interface ResolvedRowSpec {
  min: number | null;
  max: number | null;
}

export function specTextFor(def: A20RowDef, spec: ResolvedRowSpec, style: A20SpecStyle): string {
  if (def.specText) return def.specText;
  const { min, max } = spec;
  if (min == null && max == null) return "-";
  if (style === "suffix") {
    const f = (v: number) => (def.decimals != null ? v.toFixed(def.decimals) : trim(v));
    if (min != null && max != null) return `${f(min)} - ${f(max)}`;
    return min != null ? `${f(min)} (Min)` : `${f(max as number)} (Max)`;
  }
  if (min != null && max != null) return `${trim(min)}-${trim(max)}`;
  return min != null ? `>${trim(min)}` : `<${trim(max as number)}`;
}

// ─── row resolution ─────────────────────────────────────────────────────────
export interface QcSpecRow {
  test_key: string;
  min_value: number | null;
  max_value: number | null;
}

export interface PreviewRowOut {
  key: string;
  label: string;
  unit: string;
  source: "qc" | "manual" | "appearance";
  editable: boolean;
  optional: boolean;
  /** QC value (number) or appearance text prefill; null = not available. */
  qcValue: number | string | null;
  specMin: number | null;
  specMax: number | null;
  specText: string;
  decimals: number | null;
}

export function resolveRowSpec(def: A20RowDef, dbSpecs: QcSpecRow[]): ResolvedRowSpec {
  const db = def.testKey ? dbSpecs.find((s) => s.test_key === def.testKey) : undefined;
  if (db && (db.min_value != null || db.max_value != null)) {
    return {
      min: db.min_value != null ? Number(db.min_value) : null,
      max: db.max_value != null ? Number(db.max_value) : null,
    };
  }
  return { min: def.spec?.min ?? null, max: def.spec?.max ?? null };
}

export function buildPreviewRows(
  tpl: A20ProductTemplate,
  testResults: Record<string, unknown> | null,
  appearance: string | null,
  dbSpecs: QcSpecRow[],
): PreviewRowOut[] {
  return tpl.rows.map((def) => {
    const spec = resolveRowSpec(def, dbSpecs);
    let qcValue: number | string | null = null;
    if (def.appearance) {
      qcValue = appearance?.trim() ? appearance.trim() : null;
    } else if (def.testKey) {
      const raw = testResults?.[def.testKey];
      const n = typeof raw === "number" ? raw : raw != null && raw !== "" ? Number(raw) : NaN;
      qcValue = Number.isFinite(n) ? n : null;
    }
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      source: def.appearance ? "appearance" : def.testKey ? "qc" : "manual",
      editable: !def.testKey,
      optional: !!def.optional,
      qcValue,
      specMin: spec.min,
      specMax: spec.max,
      specText: specTextFor(def, spec, tpl.specStyle),
      decimals: def.decimals ?? null,
    };
  });
}

export interface FinalizeResult {
  rows: A20SnapshotRow[];
  problems: string[];
}

/**
 * Turn preview rows + chemist-typed values into the printable rows. Enforces
 * the same guards for every row: a value must exist, be numeric where the spec
 * is numeric, and sit inside the spec. QC-sourced values are never taken from
 * `typed` - they always come from the saved QC record.
 */
export function finalizeRows(
  tpl: A20ProductTemplate,
  preview: PreviewRowOut[],
  typed: Record<string, string>,
): FinalizeResult {
  const rows: A20SnapshotRow[] = [];
  const problems: string[] = [];
  let sr = 0;

  for (const r of preview) {
    const def = tpl.rows.find((d) => d.key === r.key)!;
    let actual: string;
    let numeric: number | null = null;

    if (r.source === "qc") {
      if (r.qcValue == null) {
        problems.push(`${r.label}: no value in the saved Product QC record.`);
        continue;
      }
      numeric = r.qcValue as number;
      actual = r.decimals != null ? numeric.toFixed(r.decimals) : String(numeric);
    } else if (r.source === "appearance") {
      const t = (typed[r.key] ?? "").replace(/\s+/g, " ").trim();
      actual = t || (typeof r.qcValue === "string" ? r.qcValue : "");
      if (!actual) {
        problems.push(`${r.label}: enter the appearance.`);
        continue;
      }
    } else {
      const t = (typed[r.key] ?? "").trim();
      if (!t) {
        if (r.optional) continue;
        problems.push(`${r.label}: enter the result.`);
        continue;
      }
      const n = Number(t);
      if (!Number.isFinite(n)) {
        problems.push(`${r.label}: "${t}" is not a number.`);
        continue;
      }
      numeric = n;
      actual = t;
    }

    if (numeric != null) {
      if (r.specMin != null && numeric < r.specMin) problems.push(`${r.label}: ${actual} is below the minimum ${trim(r.specMin)}.`);
      if (r.specMax != null && numeric > r.specMax) problems.push(`${r.label}: ${actual} is above the maximum ${trim(r.specMax)}.`);
    }

    rows.push({
      sr: ++sr,
      label: r.label,
      unit: r.unit,
      specText: r.specText,
      specMin: r.specMin != null ? (def.decimals != null && tpl.specStyle === "suffix" ? r.specMin.toFixed(def.decimals) : trim(r.specMin)) : "-",
      specMax: r.specMax != null ? (def.decimals != null && tpl.specStyle === "suffix" ? r.specMax.toFixed(def.decimals) : trim(r.specMax)) : "-",
      actual,
    });
  }
  return { rows, problems };
}

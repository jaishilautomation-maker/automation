"use client";

// =============================================================================
// Lab QC — Batch Analysis (Sulphur Powder, Factory A-20/1)
//
// One analysis per batch (UNIQUE batch_id on batch_analysis table).
// User enters a BATCH NUMBER (text input). If existing → loads for edit.
// If new → creates batch on save then inserts analysis.
//
// Form sections:
//   1. Batch identifier + date
//   2. RAW INPUTS — Purity/Ash (M1, M), Acidity (V1, V2, N), Mesh sieves
//      (200/170/325 pairs)  ← NEW in migration 012
//   3. AUTO-CALCULATED RESULTS panel — live read-only display of the six
//      computed values as the chemist types
//   4. Existing dynamic qc_test_definitions fields (phase='B') for any
//      additional parameters seeded in the DB
//   5. Confirmation / Non-Confirmation + remarks (unchanged)
//
// Auto-calculation formulas (confirmed against SOP JSCI/QC/01-05):
//   Purity  % = 100 − (M1 / M) × 100
//   Ash     % = (M1 / M) × 100
//   Acidity % = (V1 − V2) × N × 4.904 / M
//   Mesh fineness % = 100 × (1 − retained / sample)  [for each mesh size]
// =============================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { evalFormula } from "@/lib/formula";
import { notifyQcFinalized } from "@/lib/qc-exchange/notify";
import QcFieldRenderer, { type PhotoUploadProps } from "@/components/QcFieldRenderer";
import type { PhotoUploaderHandle } from "@/components/PhotoUploader";
import type { QcTestDefinition, BatchAnalysis } from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { buildBatchAnalysisEmail } from "@/lib/notifications/lab-qc-emails";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeNum(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function calcOrBlank(formula: () => number | null): string {
  try {
    const r = formula();
    if (r === null || !isFinite(r)) return "";
    return (Math.round(r * 10000) / 10000).toString();
  } catch {
    return "";
  }
}

// Colour coding for a calculated result field
function resultStyle(hasValue: boolean): React.CSSProperties {
  return {
    background: hasValue ? "var(--ok-soft, #e8f5e9)" : "var(--surface, #fafafa)",
    fontWeight: hasValue ? 700 : 400,
    color:      hasValue ? "var(--ok, #2e7d32)" : "var(--ink-soft, #999)",
    border:     "1px solid var(--line, #e0e0e0)",
    borderRadius: 6,
    padding:    "8px 10px",
    fontSize:   14,
    lineHeight: "1.4",
  };
}

export default function BatchAnalysisPage() {
  const { user, profile } = useAuth();
  const { showToast }     = useToast();
  const { activeFactory } = useModule();
  const supabase          = createClient();

  // Batch number (free text)
  const [batchNumber, setBatchNumber]         = useState("");
  const [resolvedBatchId, setResolvedBatchId] = useState<string | null>(null);
  const [resolving, setResolving]             = useState(false);

  // Test definitions (additional DB-driven fields beyond the hardcoded raw inputs)
  const [testDefs, setTestDefs]       = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);

  // Existing analysis for resolved batch
  const [existingAnalysis, setExistingAnalysis] = useState<BatchAnalysis | null>(null);

  // ── RAW INPUT STATE ──────────────────────────────────────────────────────
  // Purity / Ash
  const [baM1, setBaM1]   = useState("");   // mass of residue
  const [baM, setBaM]     = useState("");   // mass of sample

  // Acidity
  const [baV1, setBaV1]   = useState("");   // titre with material
  const [baV2, setBaV2]   = useState("");   // titre with blank
  const [baN, setBaN]     = useState("");   // normality of NaOH

  // Mesh sieves (sample, retained pairs)
  const [mesh200S, setMesh200S] = useState(""); const [mesh200R, setMesh200R] = useState("");
  const [mesh170S, setMesh170S] = useState(""); const [mesh170R, setMesh170R] = useState("");
  const [mesh325S, setMesh325S] = useState(""); const [mesh325R, setMesh325R] = useState("");

  // ── FORM META STATE ───────────────────────────────────────────────────────
  const [values, setValues]             = useState<Record<string, string>>({});
  const [analysisDate, setAnalysisDate] = useState(new Date().toISOString().slice(0, 10));
  const [chemistName, setChemistName]   = useState("");
  const [remarks, setRemarks]           = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});

  // ── LIVE CALCULATIONS ─────────────────────────────────────────────────────
  const m1 = safeNum(baM1); const m = safeNum(baM);
  const v1 = safeNum(baV1); const v2 = safeNum(baV2); const n = safeNum(baN);

  const calcPurity   = calcOrBlank(() => (m1 !== null && m !== null && m !== 0) ? 100 - (m1 / m) * 100 : null);
  const calcAsh      = calcOrBlank(() => (m1 !== null && m !== null && m !== 0) ? (m1 / m) * 100 : null);
  const calcAcidity  = calcOrBlank(() =>
    (v1 !== null && v2 !== null && n !== null && m !== null && m !== 0)
      ? (v1 - v2) * n * 4.904 / m : null);

  const m200s = safeNum(mesh200S); const m200r = safeNum(mesh200R);
  const m170s = safeNum(mesh170S); const m170r = safeNum(mesh170R);
  const m325s = safeNum(mesh325S); const m325r = safeNum(mesh325R);

  const calcMesh200 = calcOrBlank(() => (m200s && m200r !== null && m200s !== 0) ? 100 * (1 - m200r! / m200s!) : null);
  const calcMesh170 = calcOrBlank(() => (m170s && m170r !== null && m170s !== 0) ? 100 * (1 - m170r! / m170s!) : null);
  const calcMesh325 = calcOrBlank(() => (m325s && m325r !== null && m325s !== 0) ? 100 * (1 - m325r! / m325s!) : null);

  // ── Load test definitions (additional fields from qc_test_definitions) ────
  // We load ALL phase='B' defs for SULPHUR_POWDER. The raw-input keys added
  // by migration 012 (ba_m1, ba_m, ba_v1, ba_v2, ba_n, ba_mesh*) are already
  // in testDefs — we skip rendering them directly since we handle them with
  // the explicit inputs above. The calculated result keys (ba_*_result) are
  // also skipped in QcFieldRenderer (is_calculated=true, handled in the
  // results panel). All OTHER defs (appearance, colour, photo, etc.) render
  // via QcFieldRenderer as before.
  useEffect(() => {
    supabase
      .from("materials")
      .select("id")
      .eq("code", "SULPHUR_POWDER")
      .single()
      .then(({ data: mat }) => {
        if (!mat) { setLoadingDefs(false); return; }
        return supabase
          .from("qc_test_definitions")
          .select("*")
          .eq("material_id", mat.id)
          .eq("phase", "B")
          .eq("is_active", true)
          .order("sort_order");
      })
      .then(res => {
        if (res) {
          const defs = (res.data ?? []) as QcTestDefinition[];
          setTestDefs(defs);
          const init: Record<string, string> = {};
          defs.forEach(d => { init[d.test_key] = ""; });
          setValues(init);
        }
        setLoadingDefs(false);
      });
  }, [supabase]);

  // ── Resolve batch number on blur ──────────────────────────────────────────
  const resolveBatch = useCallback(async (bn: string) => {
    if (!bn.trim() || !activeFactory) {
      setResolvedBatchId(null); setExistingAnalysis(null); return;
    }
    setResolving(true);

    const { data: batchRow } = await supabase
      .from("batches").select("id")
      .eq("factory_id", activeFactory.id)
      .eq("batch_number", bn.trim())
      .maybeSingle();

    const bid = batchRow?.id ?? null;
    setResolvedBatchId(bid);

    if (bid) {
      const { data: analysis } = await supabase
        .from("batch_analysis").select("*")
        .eq("batch_id", bid).maybeSingle();

      const existing = analysis as BatchAnalysis | null;
      setExistingAnalysis(existing);

      if (existing) {
        setAnalysisDate(existing.analysis_date);
        setRemarks(existing.remarks ?? "");
        const tr = (existing.test_results ?? {}) as Record<string, unknown>;
        // Pre-fill dynamic fields
        const prefill: Record<string, string> = {};
        testDefs.forEach(d => {
          const v = tr[d.test_key];
          prefill[d.test_key] = v !== undefined && v !== null ? String(v) : "";
        });
        setValues(prefill);
        // Pre-fill raw inputs
        setBaM1(tr["ba_m1"] !== undefined ? String(tr["ba_m1"]) : "");
        setBaM( tr["ba_m"]  !== undefined ? String(tr["ba_m"])  : "");
        setBaV1(tr["ba_v1"] !== undefined ? String(tr["ba_v1"]) : "");
        setBaV2(tr["ba_v2"] !== undefined ? String(tr["ba_v2"]) : "");
        setBaN( tr["ba_n"]  !== undefined ? String(tr["ba_n"])  : "");
        setMesh200S(tr["ba_mesh200_sample"]   !== undefined ? String(tr["ba_mesh200_sample"])   : "");
        setMesh200R(tr["ba_mesh200_retained"] !== undefined ? String(tr["ba_mesh200_retained"]) : "");
        setMesh170S(tr["ba_mesh170_sample"]   !== undefined ? String(tr["ba_mesh170_sample"])   : "");
        setMesh170R(tr["ba_mesh170_retained"] !== undefined ? String(tr["ba_mesh170_retained"]) : "");
        setMesh325S(tr["ba_mesh325_sample"]   !== undefined ? String(tr["ba_mesh325_sample"])   : "");
        setMesh325R(tr["ba_mesh325_retained"] !== undefined ? String(tr["ba_mesh325_retained"]) : "");
      } else {
        resetForm();
      }
    } else {
      setExistingAnalysis(null); resetForm();
    }
    setResolving(false);
  }, [activeFactory, supabase, testDefs]);

  const resetForm = () => {
    const init: Record<string, string> = {};
    testDefs.forEach(d => { init[d.test_key] = ""; });
    setValues(init);
    setRemarks("");
    setBaM1(""); setBaM(""); setBaV1(""); setBaV2(""); setBaN("");
    setMesh200S(""); setMesh200R("");
    setMesh170S(""); setMesh170R("");
    setMesh325S(""); setMesh325R("");
  };

  // ── Dynamic field change (for QcFieldRenderer fields) ────────────────────
  const handleChange = useCallback((key: string, val: string) => {
    setValues(prev => {
      const next = { ...prev, [key]: val };
      testDefs.filter(d => d.is_calculated && d.formula).forEach(d => {
        const result = evalFormula(d.formula!, next);
        next[d.test_key] = result !== null ? String(result) : "";
      });
      return next;
    });
  }, [testDefs]);

  // Keys handled by explicit raw-input fields — omit from QcFieldRenderer loop
  const RAW_INPUT_KEYS = new Set([
    "ba_m1","ba_m","ba_v1","ba_v2","ba_n",
    "ba_mesh200_sample","ba_mesh200_retained",
    "ba_mesh170_sample","ba_mesh170_retained",
    "ba_mesh325_sample","ba_mesh325_retained",
    "ba_purity_result","ba_ash_result","ba_acidity_result",
    "ba_mesh200_result","ba_mesh170_result","ba_mesh325_result",
  ]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!batchNumber.trim())     { showToast("Batch number is required.", true); return; }
    if (!chemistName.trim() && !existingAnalysis) {
      showToast("Enter chemist name.", true); return;
    }

    setSubmitting(true);
    try {
      // Resolve or create batch
      let batchId = resolvedBatchId;
      if (!batchId) {
        const { data: newBatch, error: batchErr } = await supabase
          .from("batches")
          .insert({
            batch_number:    batchNumber.trim(),
            factory_id:      activeFactory.id,
            material_id:     null,
            product_id:      null,
            batch_type:      "fg",
            production_date: new Date().toISOString().slice(0, 10),
            quantity:        null,
            unit:            "kg",
            source_batch_id: null,
            created_by:      user.id,
          })
          .select("id").single();

        if (batchErr || !newBatch) {
          showToast("Could not create batch: " + (batchErr?.message ?? "unknown"), true); return;
        }
        batchId = newBatch.id;
        setResolvedBatchId(batchId);
      }

      // Build test_results JSONB — include raw inputs + DB-driven fields
      const testResults: Record<string, number | string | boolean> = {};

      // Raw inputs (store for traceability)
      const rawPairs: Array<[string, string]> = [
        ["ba_m1", baM1], ["ba_m", baM],
        ["ba_v1", baV1], ["ba_v2", baV2], ["ba_n", baN],
        ["ba_mesh200_sample", mesh200S], ["ba_mesh200_retained", mesh200R],
        ["ba_mesh170_sample", mesh170S], ["ba_mesh170_retained", mesh170R],
        ["ba_mesh325_sample", mesh325S], ["ba_mesh325_retained", mesh325R],
      ];
      rawPairs.forEach(([k, v]) => {
        if (v === "") return;
        const n = parseFloat(v);
        if (!isNaN(n)) testResults[k] = n;
      });

      // Calculated results (store final computed values)
      if (calcPurity)   testResults["ba_purity_result"]   = parseFloat(calcPurity);
      if (calcAsh)      testResults["ba_ash_result"]       = parseFloat(calcAsh);
      if (calcAcidity)  testResults["ba_acidity_result"]   = parseFloat(calcAcidity);
      if (calcMesh200)  testResults["ba_mesh200_result"]   = parseFloat(calcMesh200);
      if (calcMesh170)  testResults["ba_mesh170_result"]   = parseFloat(calcMesh170);
      if (calcMesh325)  testResults["ba_mesh325_result"]   = parseFloat(calcMesh325);

      // DB-driven fields (appearance, photo, etc.)
      testDefs.forEach(d => {
        if (RAW_INPUT_KEYS.has(d.test_key)) return; // already handled above
        const raw = values[d.test_key];
        if (raw === "" || raw === undefined) return;
        if (d.input_type === "number") {
          const n = parseFloat(raw);
          if (!isNaN(n)) testResults[d.test_key] = n;
        } else if (d.input_type === "boolean") {
          testResults[d.test_key] = raw === "true";
        } else {
          testResults[d.test_key] = raw;
        }
      });

      const appearanceVal  = values["colour_appearance"] ?? null;
      const appearanceOkRaw = values["appearance_ok"];
      const appearanceOk   =
        appearanceOkRaw === "true"  ? true  :
        appearanceOkRaw === "false" ? false : null;

      const nowISO = new Date().toISOString();

      if (existingAnalysis) {
        const { error } = await supabase
          .from("batch_analysis")
          .update({
            analysis_date: analysisDate,
            appearance:    appearanceVal,
            appearance_ok: appearanceOk,
            test_results:  testResults,
            remarks:       remarks.trim() || null,
            updated_by:    user.id,
          })
          .eq("id", existingAnalysis.id);

        if (error) { showToast("Update failed: " + error.message, true); return; }
        await Promise.all(Object.values(uploaderRefs.current).filter(Boolean).map(r => r!.flush(existingAnalysis.id)));

        void notifyQcFinalized({
          sourceTable:    "batch_analysis",
          sourceRecordId: existingAnalysis.id,
          factoryId:      activeFactory.id,
          batchId:        batchId!,
          overallResult:  appearanceOk === true ? "pass" : appearanceOk === false ? "fail" : "pending",
          testDate:       analysisDate,
          testResults,
          extra:          { appearance: appearanceVal, remarks: remarks.trim() || null },
        });

        const { subject, html } = buildBatchAnalysisEmail({
          batchNumber:     batchNumber.trim(),
          analysisDate,
          appearance:      appearanceVal,
          testResults:     testResults as Record<string, unknown>,
          remarks:         remarks.trim() || null,
          submittedByName: profile?.full_name ?? "—",
          submittedAt:     nowISO,
          isUpdate:        true,
        });
        void notifyEvent({
          eventType: "lab_qc_batch_analysis",
          subject, html,
          factoryId:   activeFactory.id,
          referenceId: existingAnalysis.id,
          sheetData: {
            type: "append", tab: "Batch Analysis",
            values: [
              existingAnalysis.id, batchNumber.trim(), analysisDate,
              appearanceVal || null, JSON.stringify(testResults),
              remarks.trim() || null, profile?.full_name ?? null,
              nowISO, true, activeFactory.id,
            ],
          },
        });
        showToast("Batch analysis updated ✓");

      } else {
        const { data: newRow, error } = await supabase
          .from("batch_analysis")
          .insert({
            batch_id:      batchId,
            factory_id:    activeFactory.id,
            chemist_id:    user.id,
            analysis_date: analysisDate,
            appearance:    appearanceVal,
            appearance_ok: appearanceOk,
            test_results:  testResults,
            remarks:       remarks.trim() || null,
          })
          .select("id").single();

        if (error || !newRow) {
          showToast("Could not save: " + (error?.message ?? "unknown"), true); return;
        }
        await Promise.all(Object.values(uploaderRefs.current).filter(Boolean).map(r => r!.flush(newRow.id)));

        void notifyQcFinalized({
          sourceTable:    "batch_analysis",
          sourceRecordId: newRow.id,
          factoryId:      activeFactory.id,
          batchId:        batchId!,
          overallResult:  appearanceOk === true ? "pass" : appearanceOk === false ? "fail" : "pending",
          testDate:       analysisDate,
          testResults,
          extra:          { appearance: appearanceVal, remarks: remarks.trim() || null },
        });

        const { subject, html } = buildBatchAnalysisEmail({
          batchNumber:     batchNumber.trim(),
          analysisDate,
          appearance:      appearanceVal,
          testResults:     testResults as Record<string, unknown>,
          remarks:         remarks.trim() || null,
          submittedByName: profile?.full_name ?? "—",
          submittedAt:     nowISO,
          isUpdate:        false,
        });
        void notifyEvent({
          eventType: "lab_qc_batch_analysis",
          subject, html,
          factoryId:   activeFactory.id,
          referenceId: newRow.id,
          sheetData: {
            type: "append", tab: "Batch Analysis",
            values: [
              newRow.id, batchNumber.trim(), analysisDate,
              appearanceVal || null, JSON.stringify(testResults),
              remarks.trim() || null, profile?.full_name ?? null,
              nowISO, false, activeFactory.id,
            ],
          },
        });
        showToast("Batch analysis saved ✓");
      }

      setChemistName("");
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  const photoProps: PhotoUploadProps | undefined = (user && activeFactory) ? {
    factoryCode:  activeFactory.code,
    factoryId:    activeFactory.id,
    entityType:   "batch_analysis",
    entityId:     null,
    userId:       user.id,
    onUploaded:   (key, path) => handleChange(key, path),
    uploaderRefs,
  } : undefined;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      {/* ── Batch identifier ── */}
      <div className="card">
        <h3>Batch Analysis — Sulphur Powder</h3>

        <label>Batch Number *</label>
        <input
          type="text"
          placeholder="e.g. SP-260824-001"
          value={batchNumber}
          onChange={e => setBatchNumber(e.target.value)}
          onBlur={() => resolveBatch(batchNumber)}
        />
        {resolving && <div className="field-hint">Looking up batch…</div>}
        {!resolving && batchNumber.trim() && resolvedBatchId && !existingAnalysis && (
          <div className="field-hint" style={{ color: "var(--ok)" }}>
            ✓ Batch found — no existing analysis. A new record will be created.
          </div>
        )}
        {!resolving && batchNumber.trim() && existingAnalysis && (
          <div className="field-hint" style={{ color: "#f57c00" }}>
            ⚠ Existing analysis loaded — saving will update it.
          </div>
        )}
        {!resolving && batchNumber.trim() && !resolvedBatchId && (
          <div className="field-hint">
            Batch not found — a new batch record will be created on save.
          </div>
        )}

        <div className="row2" style={{ marginTop: 12 }}>
          <div>
            <label>Analysis Date *</label>
            <input type="date" value={analysisDate} onChange={e => setAnalysisDate(e.target.value)} />
          </div>
          <div>
            <label>Chemist Name {!existingAnalysis ? "*" : ""}</label>
            <input
              type="text"
              placeholder="Name"
              value={chemistName}
              onChange={e => setChemistName(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Section 1: Purity / Ash raw inputs ── */}
      <div className="card">
        <h3>Purity &amp; Ash — Raw Inputs</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          From the crucible weighing (SOP JSCI/QC/01 / QC/05).
          Purity% and Ash% are auto-calculated from M1 and M.
        </div>

        <div className="row2">
          <div>
            <label>M1 — Mass of residue after ignition (g)</label>
            <input type="number" step="any" placeholder="0.0000"
              value={baM1} onChange={e => setBaM1(e.target.value)} />
          </div>
          <div>
            <label>M — Mass of sample taken (g)</label>
            <input type="number" step="any" placeholder="0.0000"
              value={baM} onChange={e => setBaM(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Section 2: Acidity raw inputs ── */}
      <div className="card">
        <h3>Acidity — Raw Inputs</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          NaOH back-titration (SOP JSCI/QC/02).
          Acidity% = (V1 − V2) × N × 4.904 / M.
        </div>

        <div className="row2">
          <div>
            <label>V1 — Titre with material (mL)</label>
            <input type="number" step="any" placeholder="0.00"
              value={baV1} onChange={e => setBaV1(e.target.value)} />
          </div>
          <div>
            <label>V2 — Titre with blank (mL)</label>
            <input type="number" step="any" placeholder="0.00"
              value={baV2} onChange={e => setBaV2(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>N — Normality of NaOH solution</label>
          <input type="number" step="any" placeholder="0.0000"
            value={baN} onChange={e => setBaN(e.target.value)} />
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>
          Uses same M (sample mass) entered in Purity/Ash section above.
        </div>
      </div>

      {/* ── Section 3: Mesh Sieve raw inputs ── */}
      <div className="card">
        <h3>Mesh Sieve Analysis — Raw Inputs</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Dry sieve (SOP JSCI/QC/03). Fineness% = 100 × (1 − retained / sample).
        </div>

        {/* 200 mesh */}
        <label style={{ fontWeight: 600, fontSize: 13 }}>200 Mesh</label>
        <div className="row2">
          <div>
            <label>Sample M (g)</label>
            <input type="number" step="any" placeholder="0.0000"
              value={mesh200S} onChange={e => setMesh200S(e.target.value)} />
          </div>
          <div>
            <label>Retained m (g)</label>
            <input type="number" step="any" placeholder="0.0000"
              value={mesh200R} onChange={e => setMesh200R(e.target.value)} />
          </div>
        </div>

        {/* 170 mesh */}
        <label style={{ fontWeight: 600, fontSize: 13, marginTop: 10 }}>170 Mesh</label>
        <div className="row2">
          <div>
            <label>Sample M (g)</label>
            <input type="number" step="any" placeholder="0.0000"
              value={mesh170S} onChange={e => setMesh170S(e.target.value)} />
          </div>
          <div>
            <label>Retained m (g)</label>
            <input type="number" step="any" placeholder="0.0000"
              value={mesh170R} onChange={e => setMesh170R(e.target.value)} />
          </div>
        </div>

        {/* 325 mesh */}
        <label style={{ fontWeight: 600, fontSize: 13, marginTop: 10 }}>325 Mesh</label>
        <div className="row2">
          <div>
            <label>Sample M (g)</label>
            <input type="number" step="any" placeholder="0.0000"
              value={mesh325S} onChange={e => setMesh325S(e.target.value)} />
          </div>
          <div>
            <label>Retained m (g)</label>
            <input type="number" step="any" placeholder="0.0000"
              value={mesh325R} onChange={e => setMesh325R(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Section 4: Auto-Calculated Results panel ── */}
      <div className="card">
        <h3>Auto-Calculated Results</h3>
        <div className="field-hint" style={{ marginBottom: 12 }}>
          These values update live as you enter raw inputs above.
          Green = calculated; grey = inputs still needed.
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          {([ 
            ["Purity %", calcPurity,  "100 − (M1/M)×100"],
            ["Ash %",    calcAsh,     "(M1/M)×100"],
            ["Acidity % (H₂SO₄)", calcAcidity, "(V1−V2)×N×4.904/M"],
            ["200 Mesh Fineness %", calcMesh200, "100×(1−m/M)"],
            ["170 Mesh Fineness %", calcMesh170, "100×(1−m/M)"],
            ["325 Mesh Fineness %", calcMesh325, "100×(1−m/M)"],
          ] as [string, string, string][]).map(([label, val, formula]) => (
            <div key={label}>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 3 }}>
                {label}
              </div>
              <div style={resultStyle(!!val)}>
                {val || "—"}
                {val && <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 6,
                  color: "var(--ok, #2e7d32)" }}>%</span>}
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 2 }}>
                {formula}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 5: Additional dynamic fields from qc_test_definitions ── */}
      {!loadingDefs && testDefs.filter(d => !RAW_INPUT_KEYS.has(d.test_key)).length > 0 && (
        <div className="card">
          <h3>Additional Parameters</h3>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            Appearance, confirmations, and any other test parameters.
          </div>
          {testDefs
            .filter(d => !RAW_INPUT_KEYS.has(d.test_key))
            .map(def => (
              <QcFieldRenderer
                key={def.id}
                def={def}
                value={values[def.test_key] ?? ""}
                onChange={handleChange}
                photoUploadProps={photoProps}
              />
            ))}
        </div>
      )}

      {/* ── Remarks ── */}
      <div className="card">
        <h3>Confirmation &amp; Remarks</h3>
        <div className="field-hint" style={{ marginBottom: 8 }}>
          Note any non-conformance, deviation from expected values,
          or corrective actions taken.
        </div>
        <textarea
          placeholder="Batch confirmed / Non-confirmation reason / Additional observations…"
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          rows={4}
        />
      </div>

      <button
        className="btn btn-primary"
        type="button"
        disabled={submitting || loadingDefs || !batchNumber.trim()}
        onClick={handleSubmit}
      >
        {submitting ? "Saving…" : existingAnalysis ? "Update Analysis" : "Save Analysis"}
      </button>
    </>
  );
}

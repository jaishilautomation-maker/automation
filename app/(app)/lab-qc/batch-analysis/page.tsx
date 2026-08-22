"use client";

// =============================================================================
// Lab QC — Batch Analysis (Sulphur Powder, Factory A 20/1)
//
// One analysis per batch (UNIQUE batch_id on batch_analysis table).
// When a batch already has an analysis:
//   → Load it, show in edit mode, submit = UPDATE
// When no analysis exists yet:
//   → Show blank form, submit = INSERT
//
// test_results driven by qc_test_definitions WHERE material_id = SULPHUR_POWDER
//                                               AND phase = 'B'
// (39 fields — purity, acidity, mesh, melting point, moisture, ash,
//  oil content, specific gravity, bulk density)
// =============================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { evalFormula } from "@/lib/formula";
import QcFieldRenderer, { type PhotoUploadProps } from "@/components/QcFieldRenderer";
import type { PhotoUploaderHandle } from "@/components/PhotoUploader";
import type { QcTestDefinition, BatchAnalysis } from "@/lib/types";

interface BatchOption {
  id: string;
  batch_number: string;
  lot_number: string | null;
  production_date: string;
}

export default function BatchAnalysisPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // Batches
  const [batches, setBatches]           = useState<BatchOption[]>([]);
  const [batchId, setBatchId]           = useState("");
  const [loadingBatches, setLoadingBatches] = useState(true);

  // Test definitions
  const [testDefs, setTestDefs]         = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs]   = useState(true);

  // Existing analysis for selected batch (null = none yet)
  const [existingAnalysis, setExistingAnalysis] = useState<BatchAnalysis | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);

  // Form state
  const [values, setValues]             = useState<Record<string, string>>({});
  const [analysisDate, setAnalysisDate] = useState(new Date().toISOString().slice(0, 10));
  const [chemistName, setChemistName]   = useState("");
  const [remarks, setRemarks]           = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});

  // -------------------------------------------------------------------------
  // Load batches
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!activeFactory) return;

    supabase
      .from("materials")
      .select("id")
      .eq("code", "SULPHUR_POWDER")
      .single()
      .then(({ data: mat }) => {
        if (!mat) { setLoadingBatches(false); return; }
        return supabase
          .from("batches")
          .select("id, batch_number, lot_number, production_date")
          .eq("factory_id", activeFactory.id)
          .eq("material_id", mat.id)
          .order("production_date", { ascending: false })
          .limit(50);
      })
      .then(res => {
        if (res) setBatches((res.data ?? []) as BatchOption[]);
        setLoadingBatches(false);
      });
  }, [activeFactory, supabase]);

  // -------------------------------------------------------------------------
  // Load test definitions (phase = 'B' for batch analysis)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // When batch changes — check for existing analysis (INSERT vs UPDATE)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!batchId) {
      setExistingAnalysis(null);
      return;
    }
    setCheckingExisting(true);
    supabase
      .from("batch_analysis")
      .select("*")
      .eq("batch_id", batchId)
      .maybeSingle()
      .then(({ data }) => {
        const analysis = data as BatchAnalysis | null;
        setExistingAnalysis(analysis);
        if (analysis) {
          // Pre-fill form with existing values
          setAnalysisDate(analysis.analysis_date);
          setRemarks(analysis.remarks ?? "");
          const prefill: Record<string, string> = {};
          const tr = (analysis.test_results ?? {}) as Record<string, unknown>;
          testDefs.forEach(d => {
            const v = tr[d.test_key];
            prefill[d.test_key] = v !== undefined && v !== null ? String(v) : "";
          });
          setValues(prefill);
        } else {
          // Clear to blank for a fresh entry
          const init: Record<string, string> = {};
          testDefs.forEach(d => { init[d.test_key] = ""; });
          setValues(init);
          setRemarks("");
        }
        setCheckingExisting(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, supabase]);
  // testDefs is intentionally excluded to avoid re-triggering when defs load;
  // prefill only runs when the user actively changes batchId.

  // -------------------------------------------------------------------------
  // Field change with live formula recalculation
  // -------------------------------------------------------------------------
  const handleChange = useCallback(
    (key: string, val: string) => {
      setValues(prev => {
        const next = { ...prev, [key]: val };
        testDefs
          .filter(d => d.is_calculated && d.formula)
          .forEach(d => {
            const result = evalFormula(d.formula!, next);
            next[d.test_key] = result !== null ? String(result) : "";
          });
        return next;
      });
    },
    [testDefs]
  );

  // -------------------------------------------------------------------------
  // Submit (INSERT or UPDATE based on existingAnalysis)
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!batchId) { showToast("Select a batch.", true); return; }
    if (!chemistName.trim() && !existingAnalysis) {
      showToast("Enter chemist name.", true); return;
    }

    setSubmitting(true);
    try {
      // Build test_results JSONB
      const testResults: Record<string, number | string | boolean> = {};
      testDefs.forEach(d => {
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

      const appearanceVal = values["colour_appearance"] ?? null;
      const appearanceOkRaw = values["appearance_ok"];
      const appearanceOk =
        appearanceOkRaw === "true" ? true :
        appearanceOkRaw === "false" ? false : null;

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
        // Flush photos against the existing record id
        await Promise.all(Object.values(uploaderRefs.current).filter(Boolean).map(r => r!.flush(existingAnalysis.id)));
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
          .select("id")
          .single();

        if (error || !newRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }
        await Promise.all(Object.values(uploaderRefs.current).filter(Boolean).map(r => r!.flush(newRow.id)));
        showToast("Batch analysis saved ✓");
        setBatchId(prev => { setTimeout(() => setBatchId(prev), 0); return ""; });
      }

      setChemistName("");
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Batch Analysis — Sulphur Powder</h3>

        <label>Batch *</label>
        {loadingBatches ? (
          <div className="field-hint">Loading batches…</div>
        ) : batches.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            No Sulphur Powder batches at {activeFactory?.name}.
          </div>
        ) : (
          <select value={batchId} onChange={e => setBatchId(e.target.value)}>
            <option value="">— Select batch —</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>
                {b.batch_number}
                {b.lot_number ? ` · Lot ${b.lot_number}` : ""}
                {" · "}{b.production_date}
              </option>
            ))}
          </select>
        )}

        {checkingExisting && (
          <div className="field-hint">Checking for existing analysis…</div>
        )}

        {batchId && !checkingExisting && existingAnalysis && (
          <div
            className="readonly-block"
            style={{ background: "var(--ok-soft)", color: "var(--ok)", marginTop: 10 }}
          >
            ✓ An analysis already exists for this batch (submitted{" "}
            {new Date(existingAnalysis.submitted_at).toLocaleDateString("en-IN")}).
            You are editing it — saving will update the existing record.
          </div>
        )}
      </div>

      {batchId && !checkingExisting && (
        <>
          <div className="card">
            <h3>Analysis Details</h3>
            <div className="row2">
              <div>
                <label>Analysis Date *</label>
                <input
                  type="date"
                  value={analysisDate}
                  onChange={e => setAnalysisDate(e.target.value)}
                />
              </div>
              <div>
                <label>Chemist Name {!existingAnalysis && "*"}</label>
                <input
                  type="text"
                  placeholder="Name"
                  value={chemistName}
                  onChange={e => setChemistName(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Dynamic test fields — 39 fields grouped by the sort_order in DB */}
          {loadingDefs ? (
            <div className="card"><div className="empty">Loading test fields…</div></div>
          ) : (
            <div className="card">
              <h3>Test Results</h3>
              <div className="field-hint" style={{ marginBottom: 12 }}>
                Green fields are auto-calculated. Enter input values and they update automatically.
              </div>
              {testDefs.map(def => (
                <QcFieldRenderer
                  key={def.id}
                  def={def}
                  value={values[def.test_key] ?? ""}
                  onChange={handleChange}
                  photoUploadProps={(user && activeFactory) ? {
                    factoryCode:  activeFactory.code,
                    factoryId:    activeFactory.id,
                    entityType:   "batch_analysis",
                    entityId:     existingAnalysis?.id ?? null,
                    userId:       user.id,
                    onUploaded:   (key, path) => handleChange(key, path),
                    uploaderRefs,
                  } : undefined}
                />
              ))}
            </div>
          )}

          <div className="card">
            <h3>Remarks</h3>
            <textarea
              placeholder="Any additional observations…"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              rows={3}
            />
          </div>

          <p className="field-hint" style={{ marginBottom: 8 }}>
            Factory: <strong>{activeFactory?.name ?? "—"}</strong>
          </p>

          <button
            className="btn btn-primary"
            type="button"
            disabled={submitting || loadingDefs}
            onClick={handleSubmit}
          >
            {submitting
              ? "Saving…"
              : existingAnalysis
              ? "Update Analysis"
              : "Save Analysis"}
          </button>
        </>
      )}
    </>
  );
}

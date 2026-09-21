"use client";

// =============================================================================
// Lab QC — Batch Analysis (Sulphur Powder, Factory A 20/1)
//
// One analysis per batch (UNIQUE batch_id on batch_analysis table).
// User enters a BATCH NUMBER (text input). If existing → loads for edit.
// If new → creates batch on save then inserts analysis.
//
// test_results driven by qc_test_definitions WHERE material_id = SULPHUR_POWDER
//                                               AND phase = 'B'
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

export default function BatchAnalysisPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // Batch number (free text)
  const [batchNumber, setBatchNumber] = useState("");
  const [resolvedBatchId, setResolvedBatchId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  // Test definitions
  const [testDefs, setTestDefs]         = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs]   = useState(true);

  // Existing analysis for resolved batch (null = none yet)
  const [existingAnalysis, setExistingAnalysis] = useState<BatchAnalysis | null>(null);

  // Form state
  const [values, setValues]             = useState<Record<string, string>>({});
  const [analysisDate, setAnalysisDate] = useState(new Date().toISOString().slice(0, 10));
  const [chemistName, setChemistName]   = useState("");
  const [remarks, setRemarks]           = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});

  // ── Report generation (reads the saved analysis above, no re-entry) ──────
  const [generatingFG, setGeneratingFG] = useState(false);
  const [fiModalOpen, setFiModalOpen]   = useState(false);
  const [generatingFI, setGeneratingFI] = useState(false);
  const [fiExtra, setFiExtra] = useState({ srNo: "", jobNo: "", shift: "Day" });

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
  // Resolve batch number on blur → find existing batch + analysis
  // -------------------------------------------------------------------------
  const resolveBatch = useCallback(async (bn: string) => {
    if (!bn.trim() || !activeFactory) {
      setResolvedBatchId(null);
      setExistingAnalysis(null);
      return;
    }

    setResolving(true);

    // Look for existing batch
    const { data: batchRow } = await supabase
      .from("batches")
      .select("id")
      .eq("factory_id", activeFactory.id)
      .eq("batch_number", bn.trim())
      .maybeSingle();

    const bid = batchRow?.id ?? null;
    setResolvedBatchId(bid);

    // Check for existing analysis
    if (bid) {
      const { data: analysis } = await supabase
        .from("batch_analysis")
        .select("*")
        .eq("batch_id", bid)
        .maybeSingle();

      const existing = analysis as BatchAnalysis | null;
      setExistingAnalysis(existing);

      if (existing) {
        setAnalysisDate(existing.analysis_date);
        setRemarks(existing.remarks ?? "");
        const prefill: Record<string, string> = {};
        const tr = (existing.test_results ?? {}) as Record<string, unknown>;
        testDefs.forEach(d => {
          const v = tr[d.test_key];
          prefill[d.test_key] = v !== undefined && v !== null ? String(v) : "";
        });
        setValues(prefill);
      } else {
        resetForm();
      }
    } else {
      setExistingAnalysis(null);
      resetForm();
    }

    setResolving(false);
  }, [activeFactory, supabase, testDefs]);

  const resetForm = () => {
    const init: Record<string, string> = {};
    testDefs.forEach(d => { init[d.test_key] = ""; });
    setValues(init);
    setRemarks("");
  };

  const handleBatchBlur = () => { resolveBatch(batchNumber); };

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
    if (!batchNumber.trim()) { showToast("Batch number is required.", true); return; }
    if (!chemistName.trim() && !existingAnalysis) {
      showToast("Enter chemist name.", true); return;
    }

    setSubmitting(true);
    try {
      // Resolve or create batch (direct client — same pattern as rm-receipt)
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
          .select("id")
          .single();

        if (batchErr || !newBatch) {
          showToast("Could not create batch: " + (batchErr?.message ?? "unknown"), true);
          return;
        }
        batchId = newBatch.id;
        setResolvedBatchId(batchId);
      }

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
        await Promise.all(Object.values(uploaderRefs.current).filter(Boolean).map(r => r!.flush(existingAnalysis.id)));
        void notifyQcFinalized({
          sourceTable:   "batch_analysis",
          sourceRecordId: existingAnalysis.id,
          factoryId:     activeFactory.id,
          batchId:       batchId!,
          overallResult: appearanceOk === true ? "pass" : appearanceOk === false ? "fail" : "pending",
          testDate:      analysisDate,
          testResults:   testResults,
          extra:         { appearance: appearanceVal, remarks: remarks.trim() || null },
        });

        // Fire-and-forget email (UPDATE path)
        const baUpdateISO = new Date().toISOString();
        const { subject: baUpdSubj, html: baUpdHtml } = buildBatchAnalysisEmail({
          batchNumber:     batchNumber.trim(),
          analysisDate,
          appearance:      appearanceVal,
          testResults:     testResults as Record<string, unknown>,
          remarks:         remarks.trim() || null,
          submittedByName: profile?.full_name ?? "—",
          submittedAt:     baUpdateISO,
          isUpdate:        true,
        });
        void notifyEvent({
          eventType: "lab_qc_batch_analysis",
          subject: baUpdSubj,
          html: baUpdHtml,
          factoryId: activeFactory.id,
          referenceId: existingAnalysis.id,
          sheetData: {
            type: "append",
            tab: "Batch Analysis",
            values: [
              existingAnalysis.id,
              batchNumber.trim(),
              analysisDate,
              appearanceVal || null,
              JSON.stringify(testResults),
              remarks.trim() || null,
              profile?.full_name ?? null,
              baUpdateISO,
              true,  // isUpdate
              activeFactory.id,
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
          .select("id")
          .single();

        if (error || !newRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }
        await Promise.all(Object.values(uploaderRefs.current).filter(Boolean).map(r => r!.flush(newRow.id)));
        void notifyQcFinalized({
          sourceTable:   "batch_analysis",
          sourceRecordId: newRow.id,
          factoryId:     activeFactory.id,
          batchId:       batchId!,
          overallResult: appearanceOk === true ? "pass" : appearanceOk === false ? "fail" : "pending",
          testDate:      analysisDate,
          testResults:   testResults,
          extra:         { appearance: appearanceVal, remarks: remarks.trim() || null },
        });

        // Fire-and-forget email (INSERT path)
        const baInsertISO = new Date().toISOString();
        const { subject: baInsSubj, html: baInsHtml } = buildBatchAnalysisEmail({
          batchNumber:     batchNumber.trim(),
          analysisDate,
          appearance:      appearanceVal,
          testResults:     testResults as Record<string, unknown>,
          remarks:         remarks.trim() || null,
          submittedByName: profile?.full_name ?? "—",
          submittedAt:     baInsertISO,
          isUpdate:        false,
        });
        void notifyEvent({
          eventType: "lab_qc_batch_analysis",
          subject: baInsSubj,
          html: baInsHtml,
          factoryId: activeFactory.id,
          referenceId: newRow.id,
          sheetData: {
            type: "append",
            tab: "Batch Analysis",
            values: [
              newRow.id,
              batchNumber.trim(),
              analysisDate,
              appearanceVal || null,
              JSON.stringify(testResults),
              remarks.trim() || null,
              profile?.full_name ?? null,
              baInsertISO,
              false,  // isUpdate
              activeFactory.id,
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

  // -------------------------------------------------------------------------
  // Generate Finish Goods Testing report (Doc 2) — no new data entry.
  // -------------------------------------------------------------------------
  const handleGenerateFinishGoods = async () => {
    if (!activeFactory || !existingAnalysis) { showToast("Save the analysis first.", true); return; }
    setGeneratingFG(true);
    try {
      const res = await fetch("/api/lab-qc/generate-batch-analysis-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_analysis_id: existingAnalysis.id,
          factory_id: activeFactory.id,
          report_type: "finish_goods",
        }),
      });
      const json = await res.json();
      if (!res.ok) { showToast("Report failed: " + (json?.error ?? "unknown"), true); return; }
      showToast("Finish Goods report generated ✓");
      if (json.pdf_url) window.open(json.pdf_url, "_blank");
    } catch {
      showToast("Network error generating report.", true);
    } finally {
      setGeneratingFG(false);
    }
  };

  // -------------------------------------------------------------------------
  // Generate Final Inspection Record report (Doc 3, JSCI/QC/16) — no new
  // data entry beyond srNo/jobNo/shift, which have no home in batch_analysis.
  // -------------------------------------------------------------------------
  const handleGenerateFinalInspection = async () => {
    if (!activeFactory || !existingAnalysis) { showToast("Save the analysis first.", true); return; }
    setGeneratingFI(true);
    try {
      const res = await fetch("/api/lab-qc/generate-batch-analysis-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_analysis_id: existingAnalysis.id,
          factory_id: activeFactory.id,
          report_type: "final_inspection",
          extra: fiExtra,
        }),
      });
      const json = await res.json();
      if (!res.ok) { showToast("Report failed: " + (json?.error ?? "unknown"), true); return; }
      showToast("Final Inspection report generated ✓");
      setFiModalOpen(false);
      if (json.pdf_url) window.open(json.pdf_url, "_blank");
    } catch {
      showToast("Network error generating report.", true);
    } finally {
      setGeneratingFI(false);
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

        <label>Batch Number *</label>
        <input
          type="text"
          placeholder="Enter batch number e.g. SP-260824-001"
          value={batchNumber}
          onChange={e => setBatchNumber(e.target.value)}
          onBlur={handleBatchBlur}
        />
        {resolving && <div className="field-hint">Looking up batch…</div>}
        {!resolving && batchNumber.trim() && resolvedBatchId && !existingAnalysis && (
          <div className="field-hint" style={{ color: "var(--ok)" }}>
            ✓ Batch found — no analysis yet
          </div>
        )}
        {!resolving && batchNumber.trim() && !resolvedBatchId && (
          <div className="field-hint">
            New batch — will be created on save
          </div>
        )}

        {!resolving && batchNumber.trim() && existingAnalysis && (
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

      {batchNumber.trim() && !resolving && (
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

          {/* Dynamic test fields */}
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

          {/* ── Generate reports (read the saved analysis above, no re-entry) ── */}
          {existingAnalysis && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>Generate Reports</h3>
              <div className="field-hint" style={{ marginBottom: 12 }}>
                Reports are built from the saved analysis above — no data is
                re-entered.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={generatingFG}
                  onClick={handleGenerateFinishGoods}
                  style={{ flex: "0 0 auto", width: "auto" }}
                >
                  {generatingFG ? "Generating…" : "Finish Goods Testing Report"}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setFiModalOpen(true)}
                  style={{ flex: "0 0 auto", width: "auto" }}
                >
                  Final Inspection Record (JSCI/QC/16)
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Final Inspection Record modal (srNo / jobNo / shift) ── */}
      {fiModalOpen && existingAnalysis && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={() => !generatingFI && setFiModalOpen(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 440, width: "100%", margin: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <h3>Final Inspection Record Details</h3>
            <div className="field-hint" style={{ marginBottom: 12 }}>
              These fields aren&rsquo;t captured on the batch analysis form —
              enter them for this report.
            </div>

            <label>Sr No</label>
            <input type="text" placeholder="e.g. 393"
              value={fiExtra.srNo} onChange={e => setFiExtra(f => ({ ...f, srNo: e.target.value }))} />

            <label style={{ marginTop: 10 }}>Job No</label>
            <input type="text" placeholder="e.g. P-324"
              value={fiExtra.jobNo} onChange={e => setFiExtra(f => ({ ...f, jobNo: e.target.value }))} />

            <label style={{ marginTop: 10 }}>Shift</label>
            <select value={fiExtra.shift} onChange={e => setFiExtra(f => ({ ...f, shift: e.target.value }))}>
              <option value="Day">Day</option>
              <option value="Night">Night</option>
            </select>

            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                className="btn btn-primary"
                type="button"
                disabled={generatingFI}
                onClick={handleGenerateFinalInspection}
                style={{ flex: 1 }}
              >
                {generatingFI ? "Generating…" : "Generate Report"}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={generatingFI}
                onClick={() => setFiModalOpen(false)}
                style={{ flex: "0 0 auto", width: "auto" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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

interface PartyOption {
  party_code: string;
  customer_name: string | null;
}

interface SpecRow {
  parameter: string;
  parameter_label: string;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  target_value: number | null;
  needs_verification: boolean;
}

type RiskStatus = "pass" | "fail" | "none";

type ReworkAction = "downgrade_grade_b" | "reroute_repackaging";

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

  // Party selection + customer specs (for live pass/fail)
  const [parties, setParties]           = useState<PartyOption[]>([]);
  const [partyCode, setPartyCode]       = useState("");
  const [specs, setSpecs]               = useState<SpecRow[]>([]);

  // Form state
  const [values, setValues]             = useState<Record<string, string>>({});
  const [analysisDate, setAnalysisDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks]           = useState("");
  const [reworkAction, setReworkAction] = useState<ReworkAction | "">("");
  const [submitting, setSubmitting]     = useState(false);
  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});


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
  // Load party list (single master — §0)
  // -------------------------------------------------------------------------
  useEffect(() => {
    supabase
      .from("parties")
      .select("party_code, customer_name")
      .eq("is_active", true)
      .order("party_code")
      .then(({ data }) => setParties((data ?? []) as PartyOption[]));
  }, [supabase]);

  // -------------------------------------------------------------------------
  // Load customer specs for the selected party (drives live pass/fail)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!partyCode) { setSpecs([]); return; }
    supabase
      .from("coa_customer_specs")
      .select("parameter, parameter_label, unit, min_value, max_value, target_value, needs_verification")
      .eq("party_code", partyCode)
      .eq("is_active", true)
      .then(({ data }) => setSpecs((data ?? []) as SpecRow[]));
  }, [partyCode, supabase]);

  // -------------------------------------------------------------------------
  // Pass/fail evaluation of a single value against its spec
  // -------------------------------------------------------------------------
  const specFor = useCallback(
    (paramKey: string): SpecRow | undefined => specs.find(s => s.parameter === paramKey),
    [specs]
  );

  const statusFor = useCallback(
    (paramKey: string, rawVal: string): RiskStatus => {
      const spec = specFor(paramKey);
      if (!spec) return "none";
      const v = parseFloat(rawVal);
      if (rawVal === "" || isNaN(v)) return "none";
      if (spec.min_value != null && v < spec.min_value) return "fail";
      if (spec.max_value != null && v > spec.max_value) return "fail";
      return "pass";
    },
    [specFor]
  );

  // Overall pass/fail across all parameters that have a spec + a value
  const evaluatedRows = specs
    .map(s => ({ spec: s, raw: values[s.parameter] ?? "", status: statusFor(s.parameter, values[s.parameter] ?? "") }))
    .filter(r => r.status !== "none");
  const anyFail = evaluatedRows.some(r => r.status === "fail");
  const overallStatus: RiskStatus =
    evaluatedRows.length === 0 ? "none" : anyFail ? "fail" : "pass";

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
        setPartyCode((existing as BatchAnalysis & { party_code?: string | null }).party_code ?? "");
        setReworkAction(
          ((existing as BatchAnalysis & { rework_action?: ReworkAction | null }).rework_action ?? "") as ReworkAction | ""
        );
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
    setReworkAction("");
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
    if (anyFail && !reworkAction) {
      showToast("This batch fails spec — select a rework action before saving.", true); return;
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
            party_code:    partyCode || null,
            appearance:    appearanceVal,
            appearance_ok: appearanceOk,
            test_results:  testResults,
            rework_action: anyFail ? (reworkAction || null) : null,
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
            target: "lab",
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
            party_code:    partyCode || null,
            appearance:    appearanceVal,
            appearance_ok: appearanceOk,
            test_results:  testResults,
            rework_action: anyFail ? (reworkAction || null) : null,
            remarks:       remarks.trim() || null,
          })
          .select("*")
          .single();

        if (error || !newRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }
        // Reflect the just-saved record immediately so the "already exists"
        // banner shows and re-saving takes the UPDATE path — otherwise the
        // page kept showing "Batch found — no analysis yet" after a
        // successful save (existingAnalysis was never populated post-insert).
        setExistingAnalysis(newRow as BatchAnalysis);
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
            target: "lab",
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
                <label>Customer / Party</label>
                <select value={partyCode} onChange={e => setPartyCode(e.target.value)}>
                  <option value="">— Select party —</option>
                  {parties.map(p => (
                    <option key={p.party_code} value={p.party_code}>
                      {p.party_code}{p.customer_name && p.customer_name !== p.party_code ? ` · ${p.customer_name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="field-hint" style={{ marginTop: 8 }}>
              Analyst: <strong>{profile?.full_name ?? "—"}</strong> (from your login)
              {partyCode && specs.length === 0 && (
                <> · <span style={{ color: "var(--warn)" }}>No specs on file for this party — pass/fail checks unavailable.</span></>
              )}
            </p>
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

          {/* Live spec pass/fail vs selected party's coa_customer_specs */}
          {partyCode && specs.length > 0 && (
            <div className="card">
              <h3>
                Spec Check — {partyCode}
                {overallStatus !== "none" && (
                  <span style={{
                    marginLeft: 10, fontSize: 13, padding: "2px 10px", borderRadius: 12,
                    background: overallStatus === "pass" ? "var(--ok-soft)" : "#fde8e8",
                    color: overallStatus === "pass" ? "var(--ok)" : "#c0392b",
                  }}>
                    {overallStatus === "pass" ? "PASS" : "FAIL"}
                  </span>
                )}
              </h3>
              <div className="field-hint" style={{ marginBottom: 10 }}>
                Live comparison of your entered values against this party&rsquo;s spec limits.
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--ink-soft)" }}>
                    <th style={{ padding: "4px 8px" }}>Parameter</th>
                    <th style={{ padding: "4px 8px" }}>Value</th>
                    <th style={{ padding: "4px 8px" }}>Spec</th>
                    <th style={{ padding: "4px 8px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {specs.map(s => {
                    const raw = values[s.parameter] ?? "";
                    const st = statusFor(s.parameter, raw);
                    const specText =
                      (s.min_value != null ? `min ${s.min_value}` : "") +
                      (s.min_value != null && s.max_value != null ? " · " : "") +
                      (s.max_value != null ? `max ${s.max_value}` : "") +
                      (s.target_value != null ? ` (target ${s.target_value})` : "");
                    const color = st === "pass" ? "var(--ok)" : st === "fail" ? "#c0392b" : "var(--ink-soft)";
                    return (
                      <tr key={s.parameter} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "4px 8px" }}>
                          {s.parameter_label}{s.unit ? ` (${s.unit})` : ""}
                          {s.needs_verification && (
                            <span title="Spec value needs verification against the physical sheet"
                              style={{ marginLeft: 6, color: "var(--warn)", fontSize: 11 }}>⚠ unverified</span>
                          )}
                        </td>
                        <td style={{ padding: "4px 8px", fontWeight: 600 }}>{raw || "—"}</td>
                        <td style={{ padding: "4px 8px", color: "var(--ink-soft)" }}>{specText || "—"}</td>
                        <td style={{ padding: "4px 8px", color, fontWeight: 700 }}>
                          {st === "pass" ? "✓ Pass" : st === "fail" ? "✗ Fail" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Rework action — required when the batch fails spec */}
          {anyFail && (
            <div className="card" style={{ border: "1px solid #c0392b" }}>
              <h3 style={{ color: "#c0392b" }}>Batch fails spec — rework required</h3>
              <label>Rework Action *</label>
              <select value={reworkAction} onChange={e => setReworkAction(e.target.value as ReworkAction | "")}>
                <option value="">— Select rework action —</option>
                <option value="downgrade_grade_b">Downgrade to Grade B</option>
                <option value="reroute_repackaging">Reroute for repackaging</option>
              </select>
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

          {existingAnalysis && (
            <p className="field-hint" style={{ marginTop: 12 }}>
              To download reports for this batch, use the{" "}
              <Link href="/lab-qc/reports" style={{ color: "var(--clay)" }}>Report Generation</Link>{" "}
              tab.
            </p>
          )}
        </>
      )}
    </>
  );
}

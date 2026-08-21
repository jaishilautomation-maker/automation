"use client";

// =============================================================================
// Lab QC — Raw Material QC (Dynamic form)
//
// Flow:
//   1. Chemist picks a material → form fields load from qc_test_definitions
//   2. Chemist picks a batch (rm_receipts for that material + factory)
//   3. Fills in test_results; calculated fields update live
//   4. On submit:
//      - If factory = Factory A 20 (DBV_20_2) AND material = SULPHUR_POWDER:
//          → Read-through: query v_rm_qc_with_source, show 20/1 result read-only
//      - Otherwise: INSERT into rm_qc
//
// Special case — Sulphur Powder at Factory A 20:
//   The UI queries v_rm_qc_with_source via the batch's source_batch_id.
//   No INSERT is performed; the Factory A 20/1 result is shown read-only.
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { evalFormula } from "@/lib/formula";
import type { Material, QcTestDefinition, RmQcWithSource } from "@/lib/types";

// ---------------------------------------------------------------------------
// Batch selector option
// ---------------------------------------------------------------------------
interface BatchOption {
  id: string;
  batch_number: string;
  lot_number: string | null;
  production_date: string;
  source_batch_id: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function RmQcPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // Master data
  const [materials, setMaterials]   = useState<Material[]>([]);
  const [loadingMats, setLoadingMats] = useState(true);

  // Selection state
  const [materialId, setMaterialId] = useState("");
  const [batchId, setBatchId]       = useState("");

  // Batches for the selected material at this factory
  const [batches, setBatches]       = useState<BatchOption[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  // Test definitions for selected material
  const [testDefs, setTestDefs]     = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(false);

  // Form fields: key → raw string value
  const [values, setValues]         = useState<Record<string, string>>({});

  // Common fields
  const [testDate, setTestDate]     = useState(new Date().toISOString().slice(0, 10));
  const [chemistName, setChemistName] = useState("");
  const [remarks, setRemarks]       = useState("");

  // Sulphur Powder read-through
  const [readThrough, setReadThrough]         = useState<RmQcWithSource | null>(null);
  const [loadingReadThrough, setLoadingReadThrough] = useState(false);
  const [isReadThrough, setIsReadThrough]     = useState(false);

  // Submission
  const [submitting, setSubmitting] = useState(false);

  // Whether this material+factory is the Sulphur Powder read-through case
  const selectedMaterial = materials.find(m => m.id === materialId);
  const isSulphurPowderAtFactory2 =
    selectedMaterial?.code === "SULPHUR_POWDER" &&
    activeFactory?.code === "DBV_20_2";

  // -------------------------------------------------------------------------
  // Load materials
  // -------------------------------------------------------------------------
  useEffect(() => {
    supabase
      .from("materials")
      .select("*")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        setMaterials((data ?? []) as Material[]);
        setLoadingMats(false);
      });
  }, [supabase]);

  // -------------------------------------------------------------------------
  // Load batches when material changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!materialId || !activeFactory) {
      setBatches([]);
      setBatchId("");
      return;
    }

    setLoadingBatches(true);
    supabase
      .from("batches")
      .select("id, batch_number, lot_number, production_date, source_batch_id")
      .eq("factory_id", activeFactory.id)
      .eq("material_id", materialId)
      .eq("batch_type", "rm")
      .order("production_date", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setBatches((data ?? []) as BatchOption[]);
        setBatchId("");
        setLoadingBatches(false);
      });
  }, [materialId, activeFactory, supabase]);

  // -------------------------------------------------------------------------
  // Load test definitions when material changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!materialId) {
      setTestDefs([]);
      setValues({});
      return;
    }

    setLoadingDefs(true);
    supabase
      .from("qc_test_definitions")
      .select("*")
      .eq("material_id", materialId)
      .eq("phase", "none")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        const defs = (data ?? []) as QcTestDefinition[];
        setTestDefs(defs);
        // Initialise values map — calculated fields start empty
        const init: Record<string, string> = {};
        defs.forEach(d => { init[d.test_key] = ""; });
        setValues(init);
        setLoadingDefs(false);
      });
  }, [materialId, supabase]);

  // -------------------------------------------------------------------------
  // Handle Sulphur Powder read-through when batch is selected
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!batchId || !isSulphurPowderAtFactory2) {
      setReadThrough(null);
      setIsReadThrough(false);
      return;
    }

    // Check whether this batch has a source_batch_id (i.e. it's linked to 20/1)
    const selectedBatch = batches.find(b => b.id === batchId);
    if (!selectedBatch?.source_batch_id) {
      setIsReadThrough(false);
      return;
    }

    setLoadingReadThrough(true);
    supabase
      .from("v_rm_qc_with_source")
      .select("*")
      .eq("batch_id", batchId)
      .single()
      .then(({ data }) => {
        if (data) {
          setReadThrough(data as RmQcWithSource);
          setIsReadThrough(data.is_read_through);
        }
        setLoadingReadThrough(false);
      });
  }, [batchId, isSulphurPowderAtFactory2, batches, supabase]);

  // -------------------------------------------------------------------------
  // Field change handler — recalculates dependent fields live
  // -------------------------------------------------------------------------
  const handleChange = useCallback(
    (key: string, val: string) => {
      setValues(prev => {
        const next = { ...prev, [key]: val };
        // Recompute all calculated fields using the new values
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
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!materialId)  { showToast("Select a material.", true); return; }
    if (!batchId)     { showToast("Select a batch.", true); return; }
    if (!chemistName.trim()) { showToast("Enter chemist name.", true); return; }
    if (isReadThrough) {
      showToast("Sulphur Powder QC for this batch is a read-through from Factory 20/1 — no entry needed.", true);
      return;
    }

    setSubmitting(true);
    try {
      // Build test_results JSONB — only include non-empty values
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

      const { error } = await supabase.from("rm_qc").insert({
        batch_id:     batchId,
        factory_id:   activeFactory.id,
        material_id:  materialId,
        chemist_id:   user.id,
        test_date:    testDate,
        appearance:   values["appearance"] ?? null,
        appearance_ok: values["appearance_ok"] === "true"
          ? true
          : values["appearance_ok"] === "false"
          ? false
          : null,
        test_results: testResults,
        remarks:      remarks.trim() || null,
      });

      if (error) {
        showToast("Could not save: " + error.message, true);
        return;
      }

      showToast("QC results saved ✓");
      // Reset to ready state for next entry
      setBatchId("");
      setValues(prev => Object.fromEntries(Object.keys(prev).map(k => [k, ""])));
      setChemistName("");
      setRemarks("");
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  function renderField(def: QcTestDefinition) {
    const val = values[def.test_key] ?? "";
    const label = (
      <label key={`lbl-${def.id}`}>
        {def.label}
        {def.unit && <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}> ({def.unit})</span>}
        {def.is_calculated && (
          <span style={{ color: "var(--ok)", fontWeight: 400 }}> — auto</span>
        )}
      </label>
    );

    if (def.input_type === "photo") {
      // Photo upload — placeholder for now (Supabase Storage integration in a later step)
      return (
        <div key={def.id}>
          {label}
          <div
            style={{
              border: "1px dashed var(--line)",
              borderRadius: 8,
              padding: "12px",
              textAlign: "center",
              fontSize: 12,
              color: "var(--ink-soft)",
            }}
          >
            📷 Photo upload — coming soon
          </div>
        </div>
      );
    }

    if (def.input_type === "boolean") {
      return (
        <div key={def.id}>
          {label}
          <select
            value={val}
            onChange={e => handleChange(def.test_key, e.target.value)}
          >
            <option value="">— Select —</option>
            <option value="true">Yes / Pass</option>
            <option value="false">No / Fail</option>
          </select>
        </div>
      );
    }

    if (def.input_type === "select" && def.options) {
      return (
        <div key={def.id}>
          {label}
          <select value={val} onChange={e => handleChange(def.test_key, e.target.value)}>
            <option value="">— Select —</option>
            {def.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }

    if (def.input_type === "text") {
      return (
        <div key={def.id}>
          {label}
          <input
            type="text"
            value={val}
            placeholder={def.label}
            onChange={e => handleChange(def.test_key, e.target.value)}
          />
        </div>
      );
    }

    // Default: number (including calculated)
    return (
      <div key={def.id}>
        {label}
        <input
          type="number"
          step="any"
          value={val}
          placeholder={def.is_calculated ? "auto" : "0"}
          disabled={def.is_calculated}
          onChange={e => handleChange(def.test_key, e.target.value)}
          style={def.is_calculated ? { background: "var(--ok-soft)", color: "var(--ok)" } : {}}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      {/* Step 1: Material + Batch selection */}
      <div className="card">
        <h3>Raw Material QC</h3>

        <label>Material *</label>
        {loadingMats ? (
          <div className="field-hint">Loading…</div>
        ) : (
          <select value={materialId} onChange={e => { setMaterialId(e.target.value); setReadThrough(null); }}>
            <option value="">— Select material —</option>
            {materials.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}

        {materialId && (
          <>
            <label>Batch *</label>
            {loadingBatches ? (
              <div className="field-hint">Loading batches…</div>
            ) : batches.length === 0 ? (
              <div className="field-hint" style={{ color: "var(--warn)" }}>
                No batches found for this material at {activeFactory?.name}.{" "}
                <Link href="/lab-qc/rm-receipt" style={{ color: "var(--clay)" }}>
                  Create a receipt first →
                </Link>
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
          </>
        )}
      </div>

      {/* Sulphur Powder read-through at Factory A 20 */}
      {isSulphurPowderAtFactory2 && batchId && (
        <div className="card">
          {loadingReadThrough ? (
            <div className="empty">Checking source batch…</div>
          ) : isReadThrough && readThrough ? (
            <div>
              <h3 style={{ color: "var(--ok)" }}>Read-through from Factory 20/1</h3>
              <div className="readonly-block">
                Sulphur Powder QC at Factory 20/2 is sourced from the Factory 20/1 batch analysis.
                Showing Factory 20/1 result — no new entry is required.
              </div>
              <div className="row2">
                <div>
                  <label>Source batch</label>
                  <input type="text" disabled value={readThrough.source_batch_number ?? "—"} />
                </div>
                <div>
                  <label>Test date</label>
                  <input type="text" disabled value={readThrough.test_date ?? "—"} />
                </div>
              </div>
              <label>Appearance</label>
              <input type="text" disabled value={readThrough.appearance ?? "—"} />
              <label>Test Results (read-only)</label>
              <textarea
                disabled
                rows={6}
                value={JSON.stringify(readThrough.test_results ?? {}, null, 2)}
                style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
              />
              <div className="field-hint" style={{ color: "var(--ok)" }}>
                ✓ This record is read-only — data is from Factory 20/1 via batch traceability chain.
              </div>
            </div>
          ) : (
            <div className="field-hint" style={{ color: "var(--warn)" }}>
              No source batch linked. If this Sulphur Powder batch should be linked to Factory 20/1,
              set <code>source_batch_id</code> on the batch record.
            </div>
          )}
        </div>
      )}

      {/* QC entry form — shown when material is selected, not a read-through */}
      {materialId && batchId && !isReadThrough && (
        <>
          {/* Common fields */}
          <div className="card">
            <h3>Test Details</h3>
            <div className="row2">
              <div>
                <label>Test Date *</label>
                <input
                  type="date"
                  value={testDate}
                  onChange={e => setTestDate(e.target.value)}
                />
              </div>
              <div>
                <label>Chemist Name *</label>
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
          ) : testDefs.length === 0 ? (
            <div className="card">
              <div className="field-hint">No test definitions found for this material.</div>
            </div>
          ) : (
            <div className="card">
              <h3>Test Results</h3>
              <div className="field-hint" style={{ marginBottom: 12 }}>
                Green fields are auto-calculated from your inputs.
              </div>
              {testDefs.map(def => renderField(def))}
            </div>
          )}

          {/* Remarks */}
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
            Factory: <strong>{activeFactory?.name ?? "—"}</strong> ·{" "}
            Material: <strong>{selectedMaterial?.name ?? "—"}</strong>
          </p>

          <button
            className="btn btn-primary"
            type="button"
            disabled={submitting || loadingDefs}
            onClick={handleSubmit}
          >
            {submitting ? "Saving…" : "Save QC Results"}
          </button>
        </>
      )}
    </>
  );
}

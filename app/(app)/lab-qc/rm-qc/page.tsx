"use client";

// =============================================================================
// Lab QC — Raw Material QC (Dynamic form)
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
import type { Material, QcTestDefinition, RmQcWithSource } from "@/lib/types";

interface BatchOption {
  id: string;
  batch_number: string;
  lot_number: string | null;
  production_date: string;
  source_batch_id: string | null;
}

export default function RmQcPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [materials, setMaterials]     = useState<Material[]>([]);
  const [loadingMats, setLoadingMats] = useState(true);
  const [materialId, setMaterialId]   = useState("");
  const [batchId, setBatchId]         = useState("");
  const [batches, setBatches]         = useState<BatchOption[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [testDefs, setTestDefs]       = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(false);
  const [values, setValues]           = useState<Record<string, string>>({});
  const [testDate, setTestDate]       = useState(new Date().toISOString().slice(0, 10));
  const [chemistName, setChemistName] = useState("");
  const [remarks, setRemarks]         = useState("");
  const [readThrough, setReadThrough] = useState<RmQcWithSource | null>(null);
  const [loadingReadThrough, setLoadingReadThrough] = useState(false);
  const [isReadThrough, setIsReadThrough] = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  // Photo uploader refs — keyed by test_key
  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});

  const selectedMaterial = materials.find(m => m.id === materialId);
  const isSulphurPowderAtFactory2 =
    selectedMaterial?.code === "SULPHUR_POWDER" &&
    activeFactory?.code === "DBV_20_2";

  // Load Crude Sulphur only — A-20/1 RM QC is for Crude Sulphur exclusively
  useEffect(() => {
    const sb = createClient();
    sb.from("materials").select("*").eq("code", "SULPHUR_CRUDE").eq("is_active", true).single()
      .then(({ data }) => {
        if (data) {
          setMaterials([data as Material]);
          setMaterialId((data as Material).id); // auto-select
        }
        setLoadingMats(false);
      });
  }, []);

  // Load batches
  useEffect(() => {
    if (!materialId || !activeFactory) { setBatches([]); setBatchId(""); return; }
    setLoadingBatches(true);
    supabase.from("batches").select("id, batch_number, lot_number, production_date, source_batch_id")
      .eq("factory_id", activeFactory.id).eq("material_id", materialId).eq("batch_type", "rm")
      .order("production_date", { ascending: false }).limit(50)
      .then(({ data }) => { setBatches((data ?? []) as BatchOption[]); setBatchId(""); setLoadingBatches(false); });
  }, [materialId, activeFactory, supabase]);

  // Load test definitions
  useEffect(() => {
    if (!materialId) { setTestDefs([]); setValues({}); return; }
    setLoadingDefs(true);
    supabase.from("qc_test_definitions").select("*")
      .eq("material_id", materialId).eq("phase", "none").eq("is_active", true).order("sort_order")
      .then(({ data }) => {
        const defs = (data ?? []) as QcTestDefinition[];
        setTestDefs(defs);
        const init: Record<string, string> = {};
        defs.forEach(d => { init[d.test_key] = ""; });
        setValues(init);
        setLoadingDefs(false);
      });
  }, [materialId, supabase]);

  // Sulphur Powder read-through
  useEffect(() => {
    if (!batchId || !isSulphurPowderAtFactory2) { setReadThrough(null); setIsReadThrough(false); return; }
    const selectedBatch = batches.find(b => b.id === batchId);
    if (!selectedBatch?.source_batch_id) { setIsReadThrough(false); return; }
    setLoadingReadThrough(true);
    supabase.from("v_rm_qc_with_source").select("*").eq("batch_id", batchId).single()
      .then(({ data }) => {
        if (data) { setReadThrough(data as RmQcWithSource); setIsReadThrough(data.is_read_through); }
        setLoadingReadThrough(false);
      });
  }, [batchId, isSulphurPowderAtFactory2, batches, supabase]);

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

  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!materialId) { showToast("Select a material.", true); return; }
    if (!batchId)    { showToast("Select a batch.", true); return; }
    if (!chemistName.trim()) { showToast("Enter chemist name.", true); return; }
    if (isReadThrough) { showToast("Read-through from Factory 20/1 — no entry needed.", true); return; }

    setSubmitting(true);
    try {
      const testResults: Record<string, number | string | boolean> = {};
      testDefs.forEach(d => {
        const raw = values[d.test_key];
        if (raw === "" || raw === undefined) return;
        if (d.input_type === "number") {
          const n = parseFloat(raw); if (!isNaN(n)) testResults[d.test_key] = n;
        } else if (d.input_type === "boolean") {
          testResults[d.test_key] = raw === "true";
        } else {
          testResults[d.test_key] = raw; // storage_path for photos
        }
      });

      // INSERT and get back the new row id for photo linking
      const { data: newRow, error } = await supabase.from("rm_qc").insert({
        batch_id:      batchId,
        factory_id:    activeFactory.id,
        material_id:   materialId,
        chemist_id:    user.id,
        test_date:     testDate,
        appearance:    values["appearance"] ?? null,
        appearance_ok: values["appearance_ok"] === "true" ? true
          : values["appearance_ok"] === "false" ? false : null,
        test_results:  testResults,
        remarks:       remarks.trim() || null,
      }).select("id").single();

      if (error || !newRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }

      // Flush any pending photo uploads now that we have the entity id
      const flushPromises = Object.values(uploaderRefs.current)
        .filter(Boolean)
        .map(ref => ref!.flush(newRow.id));
      await Promise.all(flushPromises);

      showToast("QC results saved ✓");
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

  // Photo upload props
  const photoProps: PhotoUploadProps | undefined = (user && activeFactory) ? {
    factoryCode:  activeFactory.code,
    factoryId:    activeFactory.id,
    entityType:   "rm_qc",
    entityId:     null, // null until after save — PhotoUploader defers upload
    userId:       user.id,
    onUploaded:   (key, path) => handleChange(key, path),
    uploaderRefs,
  } : undefined;

  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Raw Material QC</h3>
        <label>Material</label>
        {loadingMats ? <div className="field-hint">Loading…</div> : (
          <input
            type="text"
            disabled
            value={materials[0]?.name ?? "Crude Sulphur"}
            style={{ background: "var(--surface)", color: "var(--ink)", fontWeight: 600 }}
          />
        )}
        {materialId && (
          <>
            <label>Batch *</label>
            {loadingBatches ? <div className="field-hint">Loading batches…</div>
              : batches.length === 0 ? (
                <div className="field-hint" style={{ color: "var(--warn)" }}>
                  No batches found.{" "}
                  <Link href="/lab-qc/rm-receipt" style={{ color: "var(--clay)" }}>Create a receipt first →</Link>
                </div>
              ) : (
                <select value={batchId} onChange={e => setBatchId(e.target.value)}>
                  <option value="">— Select batch —</option>
                  {batches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.batch_number}{b.lot_number ? ` · Lot ${b.lot_number}` : ""} · {b.production_date}
                    </option>
                  ))}
                </select>
              )}
          </>
        )}
      </div>

      {/* Sulphur Powder read-through */}
      {isSulphurPowderAtFactory2 && batchId && (
        <div className="card">
          {loadingReadThrough ? <div className="empty">Checking source batch…</div>
            : isReadThrough && readThrough ? (
              <div>
                <h3 style={{ color: "var(--ok)" }}>Read-through from Factory 20/1</h3>
                <div className="readonly-block">
                  Sulphur Powder QC at Factory 20/2 is sourced from the Factory 20/1 batch analysis.
                  Showing Factory 20/1 result — no new entry required.
                </div>
                <div className="row2">
                  <div><label>Source batch</label><input type="text" disabled value={readThrough.source_batch_number ?? "—"} /></div>
                  <div><label>Test date</label><input type="text" disabled value={readThrough.test_date ?? "—"} /></div>
                </div>
                <label>Appearance</label>
                <input type="text" disabled value={readThrough.appearance ?? "—"} />
                <label>Test Results (read-only)</label>
                <textarea disabled rows={6} value={JSON.stringify(readThrough.test_results ?? {}, null, 2)}
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                <div className="field-hint" style={{ color: "var(--ok)" }}>
                  ✓ Read-only — data from Factory 20/1 via batch traceability chain.
                </div>
              </div>
            ) : (
              <div className="field-hint" style={{ color: "var(--warn)" }}>
                No source batch linked. Set <code>source_batch_id</code> on the batch record.
              </div>
            )}
        </div>
      )}

      {/* QC entry form */}
      {materialId && batchId && !isReadThrough && (
        <>
          <div className="card">
            <h3>Test Details</h3>
            <div className="row2">
              <div>
                <label>Test Date *</label>
                <input type="date" value={testDate} onChange={e => setTestDate(e.target.value)} />
              </div>
              <div>
                <label>Chemist Name *</label>
                <input type="text" placeholder="Name" value={chemistName} onChange={e => setChemistName(e.target.value)} />
              </div>
            </div>
          </div>

          {loadingDefs ? (
            <div className="card"><div className="empty">Loading test fields…</div></div>
          ) : testDefs.length === 0 ? (
            <div className="card"><div className="field-hint">No test definitions found for this material.</div></div>
          ) : (
            <div className="card">
              <h3>Test Results</h3>
              <div className="field-hint" style={{ marginBottom: 12 }}>
                Green fields are auto-calculated. 📷 Photo fields upload when you save.
              </div>
              {testDefs.map(def => (
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

          <div className="card">
            <h3>Remarks</h3>
            <textarea placeholder="Any additional observations…" value={remarks}
              onChange={e => setRemarks(e.target.value)} rows={3} />
          </div>

          <p className="field-hint" style={{ marginBottom: 8 }}>
            Factory: <strong>{activeFactory?.name ?? "—"}</strong> ·{" "}
            Material: <strong>{selectedMaterial?.name ?? "—"}</strong>
          </p>

          <button className="btn btn-primary" type="button" disabled={submitting || loadingDefs} onClick={handleSubmit}>
            {submitting ? "Saving…" : "Save QC Results"}
          </button>
        </>
      )}
    </>
  );
}

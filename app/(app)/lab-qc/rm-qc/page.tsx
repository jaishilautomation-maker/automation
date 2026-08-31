"use client";

// =============================================================================
// Lab QC — Raw Material QC
//
// A-20/1: Crude Sulphur only — dynamic form driven by qc_test_definitions
//
// A-20:   5 RM materials
//   - Sulphur Powder → special branch: search qc_imports for A-20/1 source QC
//     by batch number. Shows imported QC read-only if found.
//   - Zinc Oxide, Calcium Chloride, Tebuconazole, Boric Powder →
//     standard dynamic form from qc_test_definitions
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
import type { Material, QcTestDefinition } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BatchOption {
  id: string;
  batch_number: string;
  lot_number: string | null;
  production_date: string;
}

interface QcImportRow {
  id: string;
  source_factory: string;
  source_batch_number: string | null;
  material: string | null;
  test_result: string | null;
  qc_status: string;
  tested_at: string | null;
  finalized_at: string | null;
  transferred_at: string;
  payload: Record<string, unknown>;
  status: string;
}

const isA20_1 = process.env.NEXT_PUBLIC_FACTORY_CODE === "A20_1";

// A-20/1 QC type
type QcRmType = "crude_sulphur" | "oil";

const A20_RM_CODES = [
  "SULPHUR_POWDER",
  "ZINC_OXIDE",
  "CALCIUM_CHLORIDE",
  "TEBUCONAZOLE",
  "BORIC_POWDER",
];

export default function RmQcPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // A-20/1 type selector
  const [qcRmType, setQcRmType] = useState<QcRmType>("crude_sulphur");

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
  const [submitting, setSubmitting]   = useState(false);

  // Oil QC fields
  const [oilBatchNumber, setOilBatchNumber] = useState("");
  const [oilAppearance, setOilAppearance]   = useState("");
  const [oilMass, setOilMass]               = useState("");
  const [oilVolume, setOilVolume]           = useState("");
  const [oilViscosity, setOilViscosity]     = useState("");
  const [oilSubmitting, setOilSubmitting]   = useState(false);

  const oilDensity = (parseFloat(oilMass) && parseFloat(oilVolume))
    ? (parseFloat(oilMass) / parseFloat(oilVolume)).toFixed(4)
    : "";

  // Sulphur Powder cross-factory state (A-20 only)
  const [spBatchSearch, setSpBatchSearch]       = useState("");
  const [spSearching, setSpSearching]           = useState(false);
  const [spImport, setSpImport]                 = useState<QcImportRow | null>(null);
  const [spNotFound, setSpNotFound]             = useState(false);

  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});

  const selectedMaterial = materials.find(m => m.id === materialId);
  const isSulphurPowder  = selectedMaterial?.code === "SULPHUR_POWDER";

  // ---------------------------------------------------------------------------
  // Load materials
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const sb = createClient();
    if (isA20_1) {
      sb.from("materials").select("*").eq("code", "SULPHUR_CRUDE").eq("is_active", true)
        .maybeSingle()
        .then(({ data }) => {
          if (data) { setMaterials([data as Material]); setMaterialId((data as Material).id); }
          setLoadingMats(false);
        });
    } else {
      sb.from("materials").select("*").in("code", A20_RM_CODES).eq("is_active", true)
        .then(({ data }) => {
          const sorted = A20_RM_CODES
            .map(code => (data ?? []).find((m: Material) => m.code === code))
            .filter(Boolean) as Material[];
          setMaterials(sorted);
          setLoadingMats(false);
        });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Load batches (for A-20/1 crude sulphur these are invoice-number entries)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!activeFactory) { setBatches([]); setBatchId(""); return; }
    if (!isA20_1 && (!materialId || isSulphurPowder)) {
      setBatches([]); setBatchId(""); return;
    }
    // For A-20/1: skip if oil type is selected
    if (isA20_1 && qcRmType !== "crude_sulphur") {
      setBatches([]); setBatchId(""); return;
    }
    setLoadingBatches(true);

    let query = supabase.from("batches")
      .select("id, batch_number, lot_number, production_date")
      .eq("factory_id", activeFactory.id)
      .eq("batch_type", "rm")
      .order("production_date", { ascending: false })
      .limit(50);

    // For A-20 (non A-20/1), filter by material
    if (!isA20_1 && materialId) {
      query = query.eq("material_id", materialId);
    }

    query.then(({ data }) => {
        setBatches((data ?? []) as BatchOption[]);
        setBatchId("");
        setLoadingBatches(false);
      });
  }, [materialId, activeFactory, isSulphurPowder, supabase, qcRmType]);

  // ---------------------------------------------------------------------------
  // Load test definitions
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!materialId || isSulphurPowder) { setTestDefs([]); setValues({}); return; }
    setLoadingDefs(true);
    supabase.from("qc_test_definitions").select("*")
      .eq("material_id", materialId).eq("phase", "none").eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        const defs = (data ?? []) as QcTestDefinition[];
        setTestDefs(defs);
        const init: Record<string, string> = {};
        defs.forEach(d => { init[d.test_key] = ""; });
        setValues(init);
        setLoadingDefs(false);
      });
  }, [materialId, isSulphurPowder, supabase]);

  // ---------------------------------------------------------------------------
  // Sulphur Powder: search qc_imports by batch number
  // ---------------------------------------------------------------------------
  const searchSulphurQc = useCallback(async () => {
    const q = spBatchSearch.trim();
    if (!q) { showToast("Enter a batch number to search.", true); return; }

    setSpSearching(true);
    setSpImport(null);
    setSpNotFound(false);

    const { data, error } = await supabase
      .from("qc_imports")
      .select("*")
      .eq("source_batch_number", q)
      .eq("status", "active")
      .maybeSingle();

    setSpSearching(false);
    if (error) { showToast("Search failed: " + error.message, true); return; }
    if (data) {
      setSpImport(data as QcImportRow);
    } else {
      setSpNotFound(true);
    }
  }, [spBatchSearch, supabase, showToast]);

  // ---------------------------------------------------------------------------
  // Field change
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Submit (non-Sulphur Powder materials)
  // ---------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!materialId) { showToast("Select a material.", true); return; }
    if (!batchId)    { showToast("Select a batch.", true); return; }
    if (!chemistName.trim()) { showToast("Enter chemist name.", true); return; }

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
          testResults[d.test_key] = raw;
        }
      });

      const { data: newRow, error } = await supabase.from("rm_qc").insert({
        batch_id:      batchId,
        factory_id:    activeFactory.id,
        material_id:   materialId,
        chemist_id:    user.id,
        test_date:     testDate,
        appearance:    values["appearance"] ?? null,
        appearance_ok: null,
        test_results:  testResults,
        remarks:       remarks.trim() || null,
      }).select("id").single();

      if (error || !newRow) {
        showToast("Could not save: " + (error?.message ?? "unknown"), true); return;
      }

      const flushPromises = Object.values(uploaderRefs.current)
        .filter(Boolean).map(ref => ref!.flush(newRow.id));
      await Promise.all(flushPromises);

      void notifyQcFinalized({
        sourceTable:   "rm_qc",
        sourceRecordId: newRow.id,
        factoryId:     activeFactory.id,
        batchId:       batchId,
        overallResult: "pending",
        testDate:      testDate,
        testResults:   testResults,
        extra:         { material_name: selectedMaterial?.name ?? null, appearance: values["appearance"] ?? null, remarks: remarks.trim() || null },
      });

      showToast("QC results saved ✓");
      setBatchId("");
      setValues(prev => Object.fromEntries(Object.keys(prev).map(k => [k, ""])));
      setChemistName(""); setRemarks("");
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  const photoProps: PhotoUploadProps | undefined = (user && activeFactory) ? {
    factoryCode:  activeFactory.code,
    factoryId:    activeFactory.id,
    entityType:   "rm_qc",
    entityId:     null,
    userId:       user.id,
    onUploaded:   (key, path) => handleChange(key, path),
    uploaderRefs,
  } : undefined;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Raw Material QC</h3>

        {/* A-20/1: type selector */}
        {isA20_1 ? (
          <>
            <label>Material Type *</label>
            <select value={qcRmType} onChange={e => { setQcRmType(e.target.value as QcRmType); }}>
              <option value="crude_sulphur">Crude Sulphur</option>
              <option value="oil">Oil</option>
            </select>
          </>
        ) : (
          <>
            <label>Raw Material *</label>
            {loadingMats ? (
              <div className="field-hint">Loading…</div>
            ) : (
              <select value={materialId} onChange={e => {
                setMaterialId(e.target.value);
                setSpImport(null); setSpNotFound(false); setSpBatchSearch("");
                setBatchId(""); setValues({});
              }}>
                <option value="">— Select raw material —</option>
                {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
          </>
        )}
      </div>

      {/* ── A-20/1 Crude Sulphur QC (batch selector + dynamic test form) ── */}
      {isA20_1 && qcRmType === "crude_sulphur" && (
        <>
          <div className="card">
            <label>Invoice Number *</label>
            {loadingBatches ? <div className="field-hint">Loading…</div>
              : batches.length === 0 ? (
                <div className="field-hint" style={{ color: "var(--warn)" }}>
                  No receipts found.{" "}
                  <Link href="/lab-qc/rm-receipt" style={{ color: "var(--clay)" }}>Create a receipt first →</Link>
                </div>
              ) : (
                <select value={batchId} onChange={e => setBatchId(e.target.value)}>
                  <option value="">— Select invoice —</option>
                  {batches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.batch_number} · {b.production_date}
                    </option>
                  ))}
                </select>
              )}
          </div>

          {batchId && (
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
                    <input type="text" placeholder="Name" value={chemistName}
                      onChange={e => setChemistName(e.target.value)} />
                  </div>
                </div>
              </div>

              {loadingDefs ? (
                <div className="card"><div className="empty">Loading test fields…</div></div>
              ) : (
                <div className="card">
                  <h3>Test Results — Crude Sulphur</h3>
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
                <textarea placeholder="Additional observations…" value={remarks}
                  onChange={e => setRemarks(e.target.value)} rows={3} />
              </div>

              <button className="btn btn-primary" type="button"
                disabled={submitting || loadingDefs} onClick={handleSubmit}>
                {submitting ? "Saving…" : "Save QC Results"}
              </button>
            </>
          )}
        </>
      )}

      {/* ── A-20/1 Oil QC ── */}
      {isA20_1 && qcRmType === "oil" && (
        <div className="card">
          <h3>Oil QC</h3>

          <label>Batch Number *</label>
          <input type="text" placeholder="e.g. OIL-260824-001"
            value={oilBatchNumber} onChange={e => setOilBatchNumber(e.target.value)} />

          <h3 style={{ marginTop: 16 }}>Test Results</h3>

          <label>Appearance</label>
          <input type="text" placeholder="Clear & Bright"
            value={oilAppearance} onChange={e => setOilAppearance(e.target.value)} />

          <label style={{ marginTop: 12 }}>Density</label>
          <div className="row2">
            <div>
              <label>Mass of sample, M (g)</label>
              <input type="number" step="any" placeholder="0"
                value={oilMass} onChange={e => setOilMass(e.target.value)} />
            </div>
            <div>
              <label>Volume of sample, V (mL)</label>
              <input type="number" step="any" placeholder="0"
                value={oilVolume} onChange={e => setOilVolume(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 4 }}>
            <label>Density = M/V (g/mL)</label>
            <input type="text" readOnly value={oilDensity}
              style={{ background: "var(--ok-soft)", fontWeight: 600 }}
              placeholder="Auto-calculated" />
          </div>

          <label style={{ marginTop: 12 }}>Viscosity</label>
          <input type="number" step="any" placeholder="Viscosity value"
            value={oilViscosity} onChange={e => setOilViscosity(e.target.value)} />

          <button className="btn btn-primary" type="button"
            disabled={oilSubmitting}
            onClick={async () => {
              if (!user || !activeFactory) { showToast("Session error.", true); return; }
              if (!oilBatchNumber.trim()) { showToast("Batch number required.", true); return; }

              setOilSubmitting(true);
              try {
                // Find the batch by number
                const { data: batchRow } = await supabase
                  .from("batches")
                  .select("id")
                  .eq("factory_id", activeFactory.id)
                  .eq("batch_number", oilBatchNumber.trim())
                  .maybeSingle();

                let bId = batchRow?.id;
                if (!bId) {
                  // Create batch
                  const { data: nb, error: be } = await supabase.from("batches").insert({
                    batch_number: oilBatchNumber.trim(),
                    factory_id: activeFactory.id,
                    material_id: null, product_id: null,
                    batch_type: "rm",
                    production_date: new Date().toISOString().slice(0, 10),
                    quantity: null, unit: "kg",
                    source_batch_id: null, created_by: user.id,
                  }).select("id").single();
                  if (be || !nb) { showToast("Could not create batch: " + (be?.message ?? ""), true); return; }
                  bId = nb.id;
                }

                const testResults: Record<string, string | number> = {};
                if (oilAppearance) testResults["appearance"] = oilAppearance;
                if (oilMass) testResults["mass_g"] = parseFloat(oilMass);
                if (oilVolume) testResults["volume_ml"] = parseFloat(oilVolume);
                if (oilDensity) testResults["density_g_ml"] = parseFloat(oilDensity);
                if (oilViscosity) testResults["viscosity"] = parseFloat(oilViscosity);

                const { data: oilRow, error } = await supabase.from("rm_qc").insert({
                  batch_id: bId,
                  factory_id: activeFactory.id,
                  material_id: null,
                  chemist_id: user.id,
                  test_date: new Date().toISOString().slice(0, 10),
                  appearance: oilAppearance || null,
                  appearance_ok: null,
                  test_results: testResults,
                  remarks: null,
                }).select("id").single();

                if (error || !oilRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }
                void notifyQcFinalized({
                  sourceTable:   "rm_qc",
                  sourceRecordId: oilRow.id,
                  factoryId:     activeFactory.id,
                  batchId:       bId,
                  overallResult: "pending",
                  testDate:      new Date().toISOString().slice(0, 10),
                  testResults:   testResults,
                  extra:         { material_name: "Oil", appearance: oilAppearance || null },
                });
                showToast("Oil QC saved ✓");
                setOilBatchNumber(""); setOilAppearance("");
                setOilMass(""); setOilVolume(""); setOilViscosity("");
              } catch { showToast("Network error.", true); }
              finally { setOilSubmitting(false); }
            }}
            style={{ marginTop: 12 }}>
            {oilSubmitting ? "Saving…" : "Save Oil QC"}
          </button>
        </div>
      )}

      {/* ── Sulphur Powder: cross-factory QC lookup (A-20 only) ── */}
      {isSulphurPowder && (
        <div className="card">
          <h3>Sulphur Powder QC</h3>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            Sulphur Powder QC is performed at Factory A-20/1.
            Enter the batch number to retrieve the finalized QC record.
          </div>

          <label>Batch Number *</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="e.g. SP-260824-001"
              value={spBatchSearch}
              onChange={e => { setSpBatchSearch(e.target.value); setSpImport(null); setSpNotFound(false); }}
              onKeyDown={e => e.key === "Enter" && searchSulphurQc()}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-secondary"
              type="button"
              disabled={spSearching}
              onClick={searchSulphurQc}
            >
              {spSearching ? "Searching…" : "Look up"}
            </button>
          </div>

          {/* Found */}
          {spImport && (
            <div style={{ marginTop: 14 }}>
              <div style={{
                padding: "10px 14px",
                background: "var(--ok-soft)",
                border: "1px solid var(--ok)",
                borderRadius: 8,
                marginBottom: 12,
              }}>
                <div style={{ fontWeight: 700, color: "var(--ok)", marginBottom: 4 }}>
                  ✓ Source QC found
                </div>
                <div style={{ fontSize: 13 }}>
                  <strong>Source:</strong> {spImport.source_factory}<br />
                  <strong>Material:</strong> {spImport.material ?? "Sulphur Powder"}<br />
                  <strong>Batch:</strong> {spImport.source_batch_number}<br />
                  <strong>QC Status:</strong>{" "}
                  <span style={{
                    fontWeight: 700,
                    color: spImport.test_result === "pass" ? "var(--ok)" : "var(--warn)",
                  }}>
                    {(spImport.test_result ?? spImport.qc_status ?? "—").toUpperCase()}
                  </span><br />
                  <strong>QC Date:</strong> {spImport.tested_at ? new Date(spImport.tested_at).toLocaleDateString("en-IN") : "—"}<br />
                  <strong>Received at A-20:</strong> {new Date(spImport.transferred_at).toLocaleDateString("en-IN")}<br />
                  <strong>Source QC ID:</strong> <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{spImport.id}</span>
                </div>
              </div>

              {/* Full payload read-only */}
              <details>
                <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--clay)", marginBottom: 6 }}>
                  View QC Details (read-only)
                </summary>
                <textarea
                  readOnly
                  rows={10}
                  value={JSON.stringify(spImport.payload, null, 2)}
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: 11, width: "100%",
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: 6, padding: 10,
                    resize: "vertical",
                  }}
                />
              </details>

              <div className="field-hint" style={{ marginTop: 8, color: "var(--ok)" }}>
                This record is read-only. It was finalized by Factory A-20/1 and cannot be modified here.
              </div>
            </div>
          )}

          {/* Not found */}
          {spNotFound && (
            <div style={{
              marginTop: 12, padding: "10px 14px",
              background: "#fff3e0",
              border: "1px solid var(--warn)",
              borderRadius: 8, fontSize: 13, color: "var(--warn)",
            }}>
              Source QC not found for batch <strong>&ldquo;{spBatchSearch}&rdquo;</strong>.
              Verify the batch number or wait for QC synchronization from A-20/1.
            </div>
          )}
        </div>
      )}

      {/* ── Standard dynamic QC form for non-Sulphur-Powder materials (A-20 only) ── */}
      {!isA20_1 && materialId && !isSulphurPowder && (
        <>
          {/* Batch selector (shows invoice number for A-20/1 crude sulphur) */}
          <div className="card">
            <label>{isA20_1 ? "Invoice Number" : "Batch"} *</label>
            {loadingBatches ? <div className="field-hint">Loading…</div>
              : batches.length === 0 ? (
                <div className="field-hint" style={{ color: "var(--warn)" }}>
                  No receipts found.{" "}
                  <Link href="/lab-qc/rm-receipt" style={{ color: "var(--clay)" }}>Create a receipt first →</Link>
                </div>
              ) : (
                <select value={batchId} onChange={e => setBatchId(e.target.value)}>
                  <option value="">{isA20_1 ? "— Select invoice —" : "— Select batch —"}</option>
                  {batches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.batch_number}{b.lot_number ? ` · Lot ${b.lot_number}` : ""} · {b.production_date}
                    </option>
                  ))}
                </select>
              )}
          </div>

          {batchId && (
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
                    <input type="text" placeholder="Name" value={chemistName}
                      onChange={e => setChemistName(e.target.value)} />
                  </div>
                </div>
              </div>

              {loadingDefs ? (
                <div className="card"><div className="empty">Loading test fields…</div></div>
              ) : testDefs.length === 0 ? (
                <div className="card">
                  <div className="field-hint">
                    No test definitions found for {selectedMaterial?.name}.
                    Run migration 003_a20_qc_seed.sql in the Supabase SQL editor.
                  </div>
                </div>
              ) : (
                <div className="card">
                  <h3>Test Results — {selectedMaterial?.name}</h3>
                  <div className="field-hint" style={{ marginBottom: 12 }}>
                    All test fields are optional unless marked *.
                    Leave blank if the test was not performed.
                    Green fields are auto-calculated from the values you enter.
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
                <textarea placeholder="Additional observations…" value={remarks}
                  onChange={e => setRemarks(e.target.value)} rows={3} />
              </div>

              <button className="btn btn-primary" type="button"
                disabled={submitting || loadingDefs} onClick={handleSubmit}>
                {submitting ? "Saving…" : "Save QC Results"}
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}

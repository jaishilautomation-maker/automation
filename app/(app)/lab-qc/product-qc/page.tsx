"use client";

// =============================================================================
// Lab QC — Product QC (dynamic per-product forms)
//
// Flow:
//   1. Pick product (non-trial-only products only)
//   2. For phase-aware products (Sulphur SC, Zinc SC): pick Phase A or B
//      For others: phase is 'none' automatically
//   3. Pick batch (fg batches for that product at this factory)
//   4. Dynamic form renders from qc_test_definitions WHERE product_id = X
//      AND phase = selected
//   5. Calculated fields update live; submit = INSERT or UPDATE
//      (UNIQUE constraint: batch_id + product_id + phase)
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
import type { Product, QcTestDefinition, ProductQc, QcPhase } from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { buildProductQcEmail } from "@/lib/notifications/lab-qc-emails";

interface BatchOption {
  id: string;
  batch_number: string;
  lot_number: string | null;
  production_date: string;
}

// Products that have Phase A + B
const PHASE_AWARE_CODES = ["SULPHUR_SC", "ZINC_SC"];

export default function ProductQcPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // Step 1: product selection
  const [products, setProducts]         = useState<Product[]>([]);
  const [productId, setProductId]       = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Step 2: phase selection (for phase-aware products)
  const [phase, setPhase]               = useState<QcPhase>("none");

  // Step 3: batch selection
  const [batches, setBatches]           = useState<BatchOption[]>([]);
  const [batchId, setBatchId]           = useState("");
  const [loadingBatches, setLoadingBatches] = useState(false);

  // A-20 direct batch entry (no batch-analysis / hourly-reading in this factory)
  const [directBatchNumber, setDirectBatchNumber] = useState("");
  const [directLotNumber, setDirectLotNumber]     = useState("");

  // Test definitions for selected product + phase
  const [testDefs, setTestDefs]         = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs]   = useState(false);

  // Existing QC record for selected batch+product+phase
  const [existingRecord, setExistingRecord] = useState<ProductQc | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);

  // Form state
  const [values, setValues]             = useState<Record<string, string>>({});
  const [testDate, setTestDate]         = useState(new Date().toISOString().slice(0, 10));
  const [chemistName, setChemistName]   = useState("");
  const [remarks, setRemarks]           = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});

  const selectedProduct = products.find(p => p.id === productId);
  const isPhaseAware    = PHASE_AWARE_CODES.includes(selectedProduct?.code ?? "");

  // A-20 uses direct batch/lot entry (batch analysis & hourly reading do not
  // exist in this factory). A-20/1 keeps the batch dropdown.
  const isA20 = process.env.NEXT_PUBLIC_FACTORY_CODE === "A20";

  // -------------------------------------------------------------------------
  // Load products — A-20: filter to 5 known Lab QC products by code
  //                 A-20/1: all non-trial active products
  // -------------------------------------------------------------------------
  const A20_PRODUCT_CODES = ["SULPHUR_SC", "ZINC_SC", "ZIDDI", "LIQUID_CALCIUM", "LIQUID_BORON"];

  useEffect(() => {
    const q = supabase.from("products").select("*").eq("is_active", true);
    const finalQ = isA20
      ? q.in("code", A20_PRODUCT_CODES)
      : q.eq("is_trial_only", false);
    finalQ.order("name")
      .then(({ data }) => {
        setProducts((data ?? []) as Product[]);
        setLoadingProducts(false);
      });
  }, [supabase]);

  // -------------------------------------------------------------------------
  // Reset phase when product changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    setPhase(isPhaseAware ? "A" : "none");
    setBatchId("");
    setDirectBatchNumber("");
    setDirectLotNumber("");
    setExistingRecord(null);
    setValues({});
    setRemarks("");
  }, [productId, isPhaseAware]);

  // -------------------------------------------------------------------------
  // Load batches when product changes
  // For A-20/1: also load SULPHUR_POWDER material batches (batch_type='fg')
  // since hourly-reading / batch-analysis create them with material_id
  // -------------------------------------------------------------------------
  useEffect(() => {
    // A-20 uses direct batch/lot entry — no dropdown to populate.
    if (isA20) { setBatches([]); return; }
    if (!productId || !activeFactory) { setBatches([]); return; }

    setLoadingBatches(true);

    // For A-20/1 Sulphur Powder products, also check material-based batches
    const isA20_1 = process.env.NEXT_PUBLIC_FACTORY_CODE === "A20_1";
    const selectedCode = products.find(p => p.id === productId)?.code;
    const isSulphurProduct = selectedCode === "SULPHUR_SC" || selectedCode === "SULPHUR_POWDER";

    if (isA20_1 && isSulphurProduct) {
      // Load all fg-type batches at this factory — these are
      // created by hourly-reading / batch-analysis pages
      supabase
        .from("batches")
        .select("id, batch_number, lot_number, production_date")
        .eq("factory_id", activeFactory.id)
        .eq("batch_type", "fg")
        .order("production_date", { ascending: false })
        .limit(50)
        .then(({ data }) => {
          setBatches((data ?? []) as BatchOption[]);
          setLoadingBatches(false);
        });
    } else {
      supabase
        .from("batches")
        .select("id, batch_number, lot_number, production_date")
        .eq("factory_id", activeFactory.id)
        .eq("product_id", productId)
        .order("production_date", { ascending: false })
        .limit(50)
        .then(({ data }) => {
          setBatches((data ?? []) as BatchOption[]);
          setLoadingBatches(false);
        });
    }
  }, [productId, activeFactory, supabase, products]);

  // -------------------------------------------------------------------------
  // Load test definitions when product + phase change
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!productId) { setTestDefs([]); setValues({}); return; }

    setLoadingDefs(true);
    supabase
      .from("qc_test_definitions")
      .select("*")
      .eq("product_id", productId)
      .eq("phase", phase)
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        const defs = (data ?? []) as QcTestDefinition[];
        setTestDefs(defs);
        const init: Record<string, string> = {};
        defs.forEach(d => { init[d.test_key] = ""; });
        setValues(init);
        setLoadingDefs(false);
      });
  }, [productId, phase, supabase]);

  // -------------------------------------------------------------------------
  // Check for existing record when batch+product+phase all known
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!batchId || !productId) { setExistingRecord(null); return; }

    setCheckingExisting(true);
    supabase
      .from("product_qc")
      .select("*")
      .eq("batch_id", batchId)
      .eq("product_id", productId)
      .eq("phase", phase)
      .maybeSingle()
      .then(({ data }) => {
        const rec = data as ProductQc | null;
        setExistingRecord(rec);
        if (rec) {
          setTestDate(rec.test_date);
          setRemarks(rec.remarks ?? "");
          const prefill: Record<string, string> = {};
          const tr = (rec.test_results ?? {}) as Record<string, unknown>;
          testDefs.forEach(d => {
            const v = tr[d.test_key];
            prefill[d.test_key] = v !== undefined && v !== null ? String(v) : "";
          });
          // Recompute calculated fields on prefill
          testDefs
            .filter(d => d.is_calculated && d.formula)
            .forEach(d => {
              const result = evalFormula(d.formula!, prefill);
              if (result !== null) prefill[d.test_key] = String(result);
            });
          setValues(prefill);
        } else {
          const init: Record<string, string> = {};
          testDefs.forEach(d => { init[d.test_key] = ""; });
          setValues(init);
          setRemarks("");
        }
        setCheckingExisting(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, productId, phase, supabase]);

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
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!user || !activeFactory)       { showToast("Session error — refresh.", true); return; }
    if (!productId)                    { showToast("Select a product.", true); return; }
    if (!isA20 && !batchId)            { showToast("Select a batch.", true); return; }
    if (isA20 && !directBatchNumber.trim()) { showToast("Enter a batch number.", true); return; }
    if (!chemistName.trim() && !existingRecord) {
      showToast("Enter chemist name.", true); return;
    }

    setSubmitting(true);
    try {
      // A-20: resolve (or create) the fg batch from the typed batch/lot number.
      // The chemist enters these directly since batch analysis / hourly reading
      // do not exist in this factory.
      let effectiveBatchId = batchId;
      if (isA20) {
        const bn = directBatchNumber.trim();
        const ln = directLotNumber.trim() || null;

        const { data: existingBatch } = await supabase
          .from("batches")
          .select("id")
          .eq("factory_id", activeFactory.id)
          .eq("product_id", productId)
          .eq("batch_number", bn)
          .maybeSingle();

        if (existingBatch) {
          effectiveBatchId = existingBatch.id;
        } else {
          const { data: newBatch, error: batchErr } = await supabase
            .from("batches")
            .insert({
              batch_number:    bn,
              lot_number:      ln,
              factory_id:      activeFactory.id,
              material_id:     null,
              product_id:      productId,
              batch_type:      "fg",
              production_date: testDate,
              quantity:        null,
              unit:            null,
              source_batch_id: null,
              created_by:      user.id,
            })
            .select("id")
            .single();

          if (batchErr || !newBatch) {
            showToast("Could not create batch: " + (batchErr?.message ?? "unknown"), true);
            setSubmitting(false);
            return;
          }
          effectiveBatchId = newBatch.id;
        }

        // Guard against a duplicate QC record for this batch/product/phase.
        const { data: dup } = await supabase
          .from("product_qc")
          .select("id")
          .eq("batch_id", effectiveBatchId)
          .eq("product_id", productId)
          .eq("phase", phase)
          .maybeSingle();
        if (dup) {
          showToast("A QC record already exists for this batch, product and phase.", true);
          setSubmitting(false);
          return;
        }
      }

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

      const appearanceOkRaw = values["appearance_ok"];
      const appearanceOk =
        appearanceOkRaw === "true" ? true :
        appearanceOkRaw === "false" ? false : null;

      if (existingRecord) {
        const { error } = await supabase
          .from("product_qc")
          .update({
            test_date:     testDate,
            appearance:    values["colour_physical_state"] ?? null,
            appearance_ok: appearanceOk,
            test_results:  testResults,
            remarks:       remarks.trim() || null,
            updated_by:    user.id,
          })
          .eq("id", existingRecord.id);

        if (error) { showToast("Update failed: " + error.message, true); return; }
        await Promise.all(Object.values(uploaderRefs.current).filter(Boolean).map(r => r!.flush(existingRecord.id)));
        {
          const { data: fresh } = await supabase
            .from("product_qc").select("overall_result").eq("id", existingRecord.id).maybeSingle();
          void notifyQcFinalized({
            sourceTable:   "product_qc",
            sourceRecordId: existingRecord.id,
            factoryId:     activeFactory.id,
            batchId:       existingRecord.batch_id,
            phase,
            overallResult: fresh?.overall_result ?? (appearanceOk === true ? "pass" : appearanceOk === false ? "fail" : "pending"),
            testDate:      testDate,
            testResults:   testResults,
            extra:         { product_name: selectedProduct?.name ?? null, appearance: values["colour_physical_state"] ?? null, remarks: remarks.trim() || null },
          });
        }

        // Fire-and-forget email (UPDATE path)
        const pqcUpdISO = new Date().toISOString();
        const { subject: pqcUpdSubj, html: pqcUpdHtml } = buildProductQcEmail({
          productName:     selectedProduct?.name ?? "Product",
          batchNumber:     batches.find(b => b.id === existingRecord.batch_id)?.batch_number,
          phase,
          testDate,
          appearance:      values["colour_physical_state"] ?? null,
          appearanceOk,
          testResults:     testResults as Record<string, unknown>,
          remarks:         remarks.trim() || null,
          submittedByName: profile?.full_name ?? "—",
          submittedAt:     pqcUpdISO,
          isUpdate:        true,
        });
        void notifyEvent({ eventType: "lab_qc_product_qc", subject: pqcUpdSubj, html: pqcUpdHtml, factoryId: activeFactory.id, referenceId: existingRecord.id });

        showToast("Product QC updated ✓");
      } else {
        const { data: newRow, error } = await supabase
          .from("product_qc")
          .insert({
            batch_id:      effectiveBatchId,
            factory_id:    activeFactory.id,
            product_id:    productId,
            phase,
            chemist_id:    user.id,
            test_date:     testDate,
            appearance:    values["colour_physical_state"] ?? null,
            appearance_ok: appearanceOk,
            test_results:  testResults,
            remarks:       remarks.trim() || null,
          })
          .select("id")
          .single();

        if (error || !newRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }
        await Promise.all(Object.values(uploaderRefs.current).filter(Boolean).map(r => r!.flush(newRow.id)));
        {
          const { data: fresh } = await supabase
            .from("product_qc").select("overall_result").eq("id", newRow.id).maybeSingle();
          void notifyQcFinalized({
            sourceTable:   "product_qc",
            sourceRecordId: newRow.id,
            factoryId:     activeFactory.id,
            batchId:       effectiveBatchId,
            phase,
            overallResult: fresh?.overall_result ?? (appearanceOk === true ? "pass" : appearanceOk === false ? "fail" : "pending"),
            testDate:      testDate,
            testResults:   testResults,
            extra:         { product_name: selectedProduct?.name ?? null, appearance: values["colour_physical_state"] ?? null, remarks: remarks.trim() || null },
          });
        }

        // Fire-and-forget email (INSERT path)
        const pqcInsISO = new Date().toISOString();
        const batchNum = isA20 ? directBatchNumber.trim() : (batches.find(b => b.id === effectiveBatchId)?.batch_number ?? null);
        const { subject: pqcInsSubj, html: pqcInsHtml } = buildProductQcEmail({
          productName:     selectedProduct?.name ?? "Product",
          batchNumber:     batchNum,
          phase,
          testDate,
          appearance:      values["colour_physical_state"] ?? null,
          appearanceOk,
          testResults:     testResults as Record<string, unknown>,
          remarks:         remarks.trim() || null,
          submittedByName: profile?.full_name ?? "—",
          submittedAt:     pqcInsISO,
          isUpdate:        false,
        });
        void notifyEvent({ eventType: "lab_qc_product_qc", subject: pqcInsSubj, html: pqcInsHtml, factoryId: activeFactory.id, referenceId: newRow.id });

        showToast("Product QC saved ✓");
        setBatchId("");
        setDirectBatchNumber("");
        setDirectLotNumber("");
        setExistingRecord(null);
        setValues(prev => Object.fromEntries(Object.keys(prev).map(k => [k, ""])));
        setRemarks("");
        setChemistName("");
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

      {/* Step 1+2: product + phase */}
      <div className="card">
        <h3>Product QC</h3>

        <label>Product *</label>
        {loadingProducts ? (
          <div className="field-hint">Loading products…</div>
        ) : (
          <select value={productId} onChange={e => { setProductId(e.target.value); setBatchId(""); }}>
            <option value="">— Select product —</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        {isPhaseAware && productId && (
          <>
            <label>Phase *</label>
            <div className="chip-group">
              {(["A", "B"] as QcPhase[]).map(ph => (
                <div
                  key={ph}
                  className={`chip${phase === ph ? " selected" : ""}`}
                  onClick={() => { setPhase(ph); setBatchId(""); }}
                >
                  Phase {ph}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Step 3 (A-20): direct batch number + lot number entry.
          No batch analysis / hourly reading exists in this factory, so the
          chemist enters the batch and lot numbers straight from the product. */}
      {isA20 && productId && (
        <div className="card">
          <h3>Batch</h3>
          <div className="row2">
            <div>
              <label>Batch Number *</label>
              <input
                type="text"
                placeholder="e.g. SSC-260824-001"
                value={directBatchNumber}
                onChange={e => setDirectBatchNumber(e.target.value)}
              />
            </div>
            <div>
              <label>Lot Number</label>
              <input
                type="text"
                placeholder="e.g. LOT-01"
                value={directLotNumber}
                onChange={e => setDirectLotNumber(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 3 (A-20/1): batch dropdown from hourly reading / batch analysis */}
      {!isA20 && productId && (
        <div className="card">
          <h3>Batch</h3>
          <label>Batch Number *</label>
          {loadingBatches ? (
            <div className="field-hint">Loading batches…</div>
          ) : batches.length === 0 ? (
            <div className="field-hint" style={{ color: "var(--warn)" }}>
              No batches for {selectedProduct?.name ?? "this product"} at {activeFactory?.name}.
              <br />
              <span style={{ fontSize: 12 }}>Create a batch via Hourly Reading or Batch Analysis first.</span>
            </div>
          ) : (
            <select value={batchId} onChange={e => setBatchId(e.target.value)}>
              <option value="">— Select batch number —</option>
              {batches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.batch_number}
                  {b.lot_number ? ` · Lot ${b.lot_number}` : ""}
                  {" · "}{b.production_date}
                </option>
              ))}
            </select>
          )}

          {checkingExisting && <div className="field-hint">Checking for existing record…</div>}

          {batchId && !checkingExisting && existingRecord && (
            <div
              className="readonly-block"
              style={{ background: "var(--ok-soft)", color: "var(--ok)", marginTop: 10 }}
            >
              ✓ A QC record already exists for this batch / phase
              (submitted {new Date(existingRecord.submitted_at).toLocaleDateString("en-IN")}).
              Saving will update it.
            </div>
          )}
        </div>
      )}

      {/* Step 4: form */}
      {productId && (isA20 ? directBatchNumber.trim() !== "" : (batchId && !checkingExisting)) && (
        <>
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
                <label>Chemist Name {!existingRecord && "*"}</label>
                <input
                  type="text"
                  placeholder="Name"
                  value={chemistName}
                  onChange={e => setChemistName(e.target.value)}
                />
              </div>
            </div>
          </div>

          {loadingDefs ? (
            <div className="card"><div className="empty">Loading test fields…</div></div>
          ) : testDefs.length === 0 ? (
            <div className="card">
              <div className="field-hint">
                No test definitions for {selectedProduct?.name ?? "this product"}
                {isPhaseAware ? ` Phase ${phase}` : ""}.
              </div>
            </div>
          ) : (
            <div className="card">
              <h3>
                Test Results — {selectedProduct?.name}
                {isPhaseAware ? ` · Phase ${phase}` : ""}
              </h3>
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
                    entityType:   "product_qc",
                    entityId:     existingRecord?.id ?? null,
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
              placeholder="Additional observations…"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              rows={3}
            />
          </div>

          <p className="field-hint" style={{ marginBottom: 8 }}>
            Factory: <strong>{activeFactory?.name ?? "—"}</strong> ·{" "}
            Product: <strong>{selectedProduct?.name ?? "—"}</strong>
            {isPhaseAware ? ` · Phase ${phase}` : ""}
          </p>

          <button
            className="btn btn-primary"
            type="button"
            disabled={submitting || loadingDefs}
            onClick={handleSubmit}
          >
            {submitting
              ? "Saving…"
              : existingRecord
              ? "Update QC Record"
              : "Save QC Record"}
          </button>
        </>
      )}
    </>
  );
}

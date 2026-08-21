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

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { evalFormula } from "@/lib/formula";
import QcFieldRenderer from "@/components/QcFieldRenderer";
import type { Product, QcTestDefinition, ProductQc, QcPhase } from "@/lib/types";

interface BatchOption {
  id: string;
  batch_number: string;
  lot_number: string | null;
  production_date: string;
}

// Products that have Phase A + B
const PHASE_AWARE_CODES = ["SULPHUR_SC", "ZINC_SC"];

export default function ProductQcPage() {
  const { user } = useAuth();
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

  const selectedProduct = products.find(p => p.id === productId);
  const isPhaseAware    = PHASE_AWARE_CODES.includes(selectedProduct?.code ?? "");

  // -------------------------------------------------------------------------
  // Load non-trial products
  // -------------------------------------------------------------------------
  useEffect(() => {
    supabase
      .from("products")
      .select("*")
      .eq("is_trial_only", false)
      .eq("is_active", true)
      .order("name")
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
    setExistingRecord(null);
    setValues({});
    setRemarks("");
  }, [productId, isPhaseAware]);

  // -------------------------------------------------------------------------
  // Load batches when product changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!productId || !activeFactory) { setBatches([]); return; }

    setLoadingBatches(true);
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
  }, [productId, activeFactory, supabase]);

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
    if (!batchId)                      { showToast("Select a batch.", true); return; }
    if (!chemistName.trim() && !existingRecord) {
      showToast("Enter chemist name.", true); return;
    }

    setSubmitting(true);
    try {
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
        showToast("Product QC updated ✓");
      } else {
        const { error } = await supabase
          .from("product_qc")
          .insert({
            batch_id:      batchId,
            factory_id:    activeFactory.id,
            product_id:    productId,
            phase,
            chemist_id:    user.id,
            test_date:     testDate,
            appearance:    values["colour_physical_state"] ?? null,
            appearance_ok: appearanceOk,
            test_results:  testResults,
            remarks:       remarks.trim() || null,
          });

        if (error) { showToast("Could not save: " + error.message, true); return; }
        showToast("Product QC saved ✓");
        setBatchId("");
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

      {/* Step 3: batch */}
      {productId && (
        <div className="card">
          <h3>Batch</h3>
          <label>Batch *</label>
          {loadingBatches ? (
            <div className="field-hint">Loading batches…</div>
          ) : batches.length === 0 ? (
            <div className="field-hint" style={{ color: "var(--warn)" }}>
              No batches for {selectedProduct?.name ?? "this product"} at {activeFactory?.name}.
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
      {productId && batchId && !checkingExisting && (
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

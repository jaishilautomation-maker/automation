"use client";

// =============================================================================
// Lab QC — Post Production Tests
//
// Stability / retest tracking.
// product_qc_id is nullable (workflow not yet fully confirmed).
//
// Form fields driven by qc_test_definitions where applicable;
// for now uses the 5 known fields from docs/qc_test_definitions_seed.md §12
// stored as JSONB in test_results.
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type { Product } from "@/lib/types";

interface BatchOption {
  id: string;
  batch_number: string;
  lot_number: string | null;
  production_date: string;
}

interface PqcOption {
  id: string;
  test_date: string;
  phase: string;
  overall_result: string | null;
}

const TRACKING_TYPES = ["Stability", "Retest", "Other"] as const;

export default function PostProductionPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [products, setProducts]         = useState<Product[]>([]);
  const [productId, setProductId]       = useState("");
  const [batches, setBatches]           = useState<BatchOption[]>([]);
  const [batchId, setBatchId]           = useState("");
  const [pqcOptions, setPqcOptions]     = useState<PqcOption[]>([]);
  const [linkedPqcId, setLinkedPqcId]   = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingBatches, setLoadingBatches]   = useState(false);

  // Form fields
  const [testDate, setTestDate]               = useState(new Date().toISOString().slice(0, 10));
  const [chemistName, setChemistName]         = useState("");
  const [productBeingRetested, setProductBeingRetested] = useState("");
  const [trackingType, setTrackingType]       = useState<string>("");
  const [parametersChecked, setParametersChecked] = useState("");
  const [stabilityResult, setStabilityResult] = useState("");
  const [stabilityReadingDate, setStabilityReadingDate] = useState("");
  const [remarks, setRemarks]                 = useState("");
  const [submitting, setSubmitting]           = useState(false);

  // Load products
  useEffect(() => {
    supabase
      .from("products")
      .select("*")
      .eq("is_trial_only", false)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => { setProducts((data ?? []) as Product[]); setLoadingProducts(false); });
  }, [supabase]);

  // Load batches when product changes
  useEffect(() => {
    if (!productId || !activeFactory) { setBatches([]); setBatchId(""); return; }
    setLoadingBatches(true);
    supabase
      .from("batches")
      .select("id, batch_number, lot_number, production_date")
      .eq("factory_id", activeFactory.id)
      .eq("product_id", productId)
      .order("production_date", { ascending: false })
      .limit(50)
      .then(({ data }) => { setBatches((data ?? []) as BatchOption[]); setBatchId(""); setLoadingBatches(false); });
  }, [productId, activeFactory, supabase]);

  // Load existing product_qc records for this batch (for optional linking)
  useEffect(() => {
    if (!batchId || !productId) { setPqcOptions([]); setLinkedPqcId(""); return; }
    supabase
      .from("product_qc")
      .select("id, test_date, phase, overall_result")
      .eq("batch_id", batchId)
      .eq("product_id", productId)
      .order("test_date", { ascending: false })
      .then(({ data }) => { setPqcOptions((data ?? []) as PqcOption[]); });
  }, [batchId, productId, supabase]);

  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!batchId)    { showToast("Select a batch.", true); return; }
    if (!chemistName.trim()) { showToast("Enter chemist name.", true); return; }

    setSubmitting(true);
    try {
      const testResults: Record<string, string> = {};
      if (productBeingRetested) testResults["product_being_retested"] = productBeingRetested;
      if (trackingType)         testResults["tracking_type"]          = trackingType;
      if (parametersChecked)    testResults["parameters_checked"]     = parametersChecked;
      if (stabilityResult)      testResults["stability_result"]       = stabilityResult;
      if (stabilityReadingDate) testResults["stability_reading_date"] = stabilityReadingDate;

      const { error } = await supabase
        .from("post_production_tests")
        .insert({
          product_qc_id: linkedPqcId || null,
          batch_id:      batchId,
          factory_id:    activeFactory.id,
          chemist_id:    user.id,
          test_date:     testDate,
          test_results:  testResults,
          remarks:       remarks.trim() || null,
        });

      if (error) { showToast("Could not save: " + error.message, true); return; }

      showToast("Post-production test saved ✓");
      setBatchId(""); setProductId(""); setLinkedPqcId("");
      setTrackingType(""); setParametersChecked(""); setStabilityResult("");
      setStabilityReadingDate(""); setRemarks(""); setChemistName("");
      setProductBeingRetested("");
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Post Production Test</h3>

        <label>Product</label>
        {loadingProducts ? <div className="field-hint">Loading…</div> : (
          <select value={productId} onChange={e => setProductId(e.target.value)}>
            <option value="">— Select product —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        {productId && (
          <>
            <label>Batch *</label>
            {loadingBatches ? <div className="field-hint">Loading batches…</div> : (
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

        {batchId && pqcOptions.length > 0 && (
          <>
            <label>Link to QC Record (optional)</label>
            <select value={linkedPqcId} onChange={e => setLinkedPqcId(e.target.value)}>
              <option value="">— None / standalone —</option>
              {pqcOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.test_date} · Phase {p.phase} · {p.overall_result ?? "result pending"}
                </option>
              ))}
            </select>
            <div className="field-hint">Link to the original QC record this test refers to.</div>
          </>
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
                <input type="text" placeholder="Name" value={chemistName} onChange={e => setChemistName(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Stability / Retest Information</h3>

            <label>Product Being Retested</label>
            <input type="text" placeholder="Product name" value={productBeingRetested}
              onChange={e => setProductBeingRetested(e.target.value)} />

            <label>Tracking Type</label>
            <select value={trackingType} onChange={e => setTrackingType(e.target.value)}>
              <option value="">— Select —</option>
              {TRACKING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <label>Parameters Checked</label>
            <textarea rows={2} placeholder="e.g. Sulphur content, Suspensibility"
              value={parametersChecked} onChange={e => setParametersChecked(e.target.value)} />

            <label>Stability Test Result</label>
            <input type="text" placeholder="Pass / Fail / Observation"
              value={stabilityResult} onChange={e => setStabilityResult(e.target.value)} />

            <label>Date of Stability Reading</label>
            <input type="date" value={stabilityReadingDate}
              onChange={e => setStabilityReadingDate(e.target.value)} />

            <label>Remarks</label>
            <textarea rows={2} placeholder="Additional observations"
              value={remarks} onChange={e => setRemarks(e.target.value)} />
          </div>

          <p className="field-hint" style={{ marginBottom: 8 }}>
            Factory: <strong>{activeFactory?.name ?? "—"}</strong>
          </p>

          <button className="btn btn-primary" type="button" disabled={submitting} onClick={handleSubmit}>
            {submitting ? "Saving…" : "Save Post-Production Test"}
          </button>
        </>
      )}
    </>
  );
}

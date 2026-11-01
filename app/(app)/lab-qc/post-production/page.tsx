"use client";

// =============================================================================
// Lab QC — Post Production Tests
//
// Flow:
//   1. Pick product (same A-20 product list as Product QC)
//   2. Type batch number → debounced lookup (400 ms); batch MUST already exist
//   3. Dynamic test fields driven from qc_test_definitions (same source as
//      Product QC — single source of truth)
//   4. Optional link to an existing product_qc record for this batch
//   5. Stability / retest metadata card (static — not in qc_test_definitions)
// =============================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import DateField from "@/components/DateField";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { useFormDraft, draftKey } from "@/lib/use-form-draft";
import { evalFormula } from "@/lib/formula";
import { flushPhotoUploads, PHOTO_UPLOAD_FAILED_MSG } from "@/lib/upload";
import QcFieldRenderer, { type PhotoUploadProps } from "@/components/QcFieldRenderer";
import type { PhotoUploaderHandle } from "@/components/PhotoUploader";
import type { Product, QcTestDefinition } from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { buildPostProductionEmail } from "@/lib/notifications/lab-qc-emails";

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

// Calculated fields that support "Enter manually" toggle (Calcium, Boron)
const MANUAL_OVERRIDE_KEYS = new Set(["calcium_content", "boron_content"]);

const TRACKING_TYPES = ["Stability", "Retest", "Other"] as const;

// A-20 product codes shown in Post Production (same as Product QC)
const A20_PRODUCT_CODES = ["SULPHUR_SC", "ZINC_SC", "ZIDDI", "LIQUID_CALCIUM", "LIQUID_BORON"];

export default function PostProductionPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const isA20 = process.env.NEXT_PUBLIC_FACTORY_CODE === "A20";

  // ── Draft autosave ──────────────────────────────────────────────────────
  const pathname = usePathname();
  interface DraftShape {
    productId: string;
    batchNumber: string;
    linkedPqcId: string;
    testDate: string;
    chemistName: string;
    values: Record<string, string>;
    trackingType: string;
    parametersChecked: string;
    stabilityResult: string;
    stabilityReadingDate: string;
    remarks: string;
  }
  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, activeFactory?.id, user?.id),
  );
  const d0 = draft.restored;
  const [initialDraft] = useState<DraftShape | null>(() => draft.restored);

  // ── Product ─────────────────────────────────────────────────────────────
  const [products, setProducts]             = useState<Product[]>([]);
  const [productId, setProductId]           = useState(d0?.productId ?? "");
  const [loadingProducts, setLoadingProducts] = useState(true);

  // ── Batch — typed + debounced lookup ───────────────────────────────────
  const [batchNumber, setBatchNumber]       = useState(d0?.batchNumber ?? "");
  const [batchId, setBatchId]               = useState("");
  const [lookedUpBatch, setLookedUpBatch]   = useState<BatchOption | null>(null);
  const [batchLookupState, setBatchLookupState] = useState<
    "idle" | "searching" | "found" | "not_found"
  >("idle");
  const batchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── QC record link ───────────────────────────────────────────────────────
  const [pqcOptions, setPqcOptions]         = useState<PqcOption[]>([]);
  const [linkedPqcId, setLinkedPqcId]       = useState(d0?.linkedPqcId ?? "");

  // ── Test definitions (same source as Product QC) ─────────────────────────
  const [testDefs, setTestDefs]             = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs]       = useState(false);
  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});

  // ── Form state ───────────────────────────────────────────────────────────
  const [values, setValues]                 = useState<Record<string, string>>({});
  const [testDate, setTestDate]             = useState(d0?.testDate ?? new Date().toISOString().slice(0, 10));
  const [chemistName, setChemistName]       = useState(d0?.chemistName ?? "");
  const [trackingType, setTrackingType]     = useState<string>(d0?.trackingType ?? "");
  const [parametersChecked, setParametersChecked] = useState(d0?.parametersChecked ?? "");
  const [stabilityResult, setStabilityResult] = useState(d0?.stabilityResult ?? "");
  const [stabilityReadingDate, setStabilityReadingDate] = useState(d0?.stabilityReadingDate ?? "");
  const [remarks, setRemarks]               = useState(d0?.remarks ?? "");
  const [submitting, setSubmitting]         = useState(false);

  // ── Draft save ────────────────────────────────────────────────────────────
  const draftSave = draft.save;
  useEffect(() => {
    draftSave({
      productId, batchNumber, linkedPqcId, testDate, chemistName, values,
      trackingType, parametersChecked, stabilityResult, stabilityReadingDate, remarks,
    });
  }, [productId, batchNumber, linkedPqcId, testDate, chemistName, values,
      trackingType, parametersChecked, stabilityResult, stabilityReadingDate,
      remarks, draftSave]);

  // ── Load products ─────────────────────────────────────────────────────────
  useEffect(() => {
    const q = supabase.from("products").select("*").eq("is_active", true);
    const finalQ = isA20
      ? q.in("code", A20_PRODUCT_CODES)
      : q.eq("is_trial_only", false);
    finalQ.order("name")
      .then(({ data }) => { setProducts((data ?? []) as Product[]); setLoadingProducts(false); });
  }, [supabase]);

  // ── Reset batch/defs/values when product changes ─────────────────────────
  useEffect(() => {
    setBatchNumber("");
    setBatchId("");
    setLookedUpBatch(null);
    setBatchLookupState("idle");
    setPqcOptions([]);
    setLinkedPqcId("");
    setTestDefs([]);
    setValues({});
  }, [productId]);

  // ── Debounced batch lookup ────────────────────────────────────────────────
  useEffect(() => {
    if (!productId || !activeFactory) return;
    const bn = batchNumber.trim();
    if (!bn) {
      setBatchLookupState("idle");
      setLookedUpBatch(null);
      setBatchId("");
      return;
    }
    setBatchLookupState("searching");
    if (batchDebounceRef.current) clearTimeout(batchDebounceRef.current);
    batchDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("batches")
        .select("id, batch_number, lot_number, production_date")
        .eq("factory_id", activeFactory.id)
        .eq("product_id", productId)
        .eq("batch_number", bn)
        .maybeSingle();
      if (data) {
        setLookedUpBatch(data as BatchOption);
        setBatchId(data.id);
        setBatchLookupState("found");
      } else {
        setLookedUpBatch(null);
        setBatchId("");
        setBatchLookupState("not_found");
      }
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchNumber, productId, activeFactory]);

  // ── Load PQC options when batch found ────────────────────────────────────
  useEffect(() => {
    if (!batchId || !productId) { setPqcOptions([]); setLinkedPqcId(""); return; }
    supabase
      .from("product_qc")
      .select("id, test_date, phase, overall_result")
      .eq("batch_id", batchId)
      .eq("product_id", productId)
      .order("test_date", { ascending: false })
      .then(({ data }) => setPqcOptions((data ?? []) as PqcOption[]));
  }, [batchId, productId, supabase]);

  // ── Load test definitions when product changes ────────────────────────────
  // Uses the same qc_test_definitions as Product QC (phase = 'none' or both
  // phases depending on product). For post-production we load phase='none'
  // first; if the product is phase-aware we load both phases' defs.
  useEffect(() => {
    if (!productId) { setTestDefs([]); setValues({}); return; }
    setLoadingDefs(true);
    supabase
      .from("qc_test_definitions")
      .select("*")
      .eq("product_id", productId)
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        const defs = (data ?? []) as QcTestDefinition[];
        setTestDefs(defs);
        const init: Record<string, string> = {};
        defs.forEach(d => { init[d.test_key] = ""; });
        setValues({ ...init, ...(initialDraft?.values ?? {}) });
        setLoadingDefs(false);
      });
  }, [productId, supabase, initialDraft]);

  // ── Live formula recalculation ─────────────────────────────────────────────
  const handleChange = useCallback(
    (key: string, val: string) => {
      setValues(prev => {
        const next = { ...prev, [key]: val };
        testDefs
          .filter(d => d.is_calculated && d.formula)
          .forEach(d => {
            if (next[d.test_key + "_manual_mode"] === "1") return;
            const result = evalFormula(d.formula!, next, d.unit);
            next[d.test_key] = result !== null ? String(result) : "";
          });
        return next;
      });
    },
    [testDefs],
  );

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!productId)              { showToast("Select a product.", true); return; }
    if (batchLookupState !== "found") {
      showToast("Enter a valid batch number that already exists.", true); return;
    }
    if (!chemistName.trim())     { showToast("Enter chemist name.", true); return; }

    setSubmitting(true);
    try {
      // Build test_results from dynamic fields
      const testResults: Record<string, string | number | boolean> = {};
      testDefs.forEach(d => {
        const raw = values[d.test_key];
        if (raw === "" || raw === undefined) return;
        if (d.input_type === "number" && !(d.is_calculated && values[d.test_key + "_manual_mode"] === "1")) {
          const n = parseFloat(raw);
          if (!isNaN(n)) testResults[d.test_key] = n;
        } else if (d.input_type === "boolean") {
          testResults[d.test_key] = raw === "true";
        } else {
          testResults[d.test_key] = raw;
        }
        // Sidecar keys
        const manualKey = d.test_key + "_manual_mode";
        if (values[manualKey]) testResults[manualKey] = values[manualKey];
        const otherKey = d.test_key + "_other";
        if (values[otherKey]) testResults[otherKey] = values[otherKey];
      });

      // Stability metadata
      if (trackingType)         testResults["tracking_type"]          = trackingType;
      if (parametersChecked)    testResults["parameters_checked"]     = parametersChecked;
      if (stabilityResult)      testResults["stability_result"]       = stabilityResult;
      if (stabilityReadingDate) testResults["stability_reading_date"] = stabilityReadingDate;

      const { data: newRow, error } = await supabase
        .from("post_production_tests")
        .insert({
          product_qc_id: linkedPqcId || null,
          batch_id:      batchId,
          factory_id:    activeFactory.id,
          chemist_id:    user.id,
          test_date:     testDate,
          test_results:  testResults,
          remarks:       remarks.trim() || null,
        })
        .select("id")
        .single();

      if (error || !newRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }
      if (!await flushPhotoUploads(Object.values(uploaderRefs.current), newRow.id)) {
        showToast(PHOTO_UPLOAD_FAILED_MSG, true);
      }

      // Fire-and-forget notification
      const ppNowISO = new Date().toISOString();
      const selectedProduct = products.find(p => p.id === productId);
      const { subject: ppSubj, html: ppHtml } = buildPostProductionEmail({
        productName:     selectedProduct?.name,
        batchNumber:     lookedUpBatch?.batch_number,
        testDate,
        chemistName:     chemistName.trim() || null,
        testResults:     testResults as Record<string, string>,
        remarks:         remarks.trim() || null,
        submittedByName: profile?.full_name ?? "—",
        submittedAt:     ppNowISO,
      });
      void notifyEvent({
        eventType: "lab_qc_post_production",
        subject: ppSubj,
        html: ppHtml,
        factoryId: activeFactory.id,
        sheetData: {
          type: "append",
          target: "lab",
          tab: "Post Production",
          values: [
            newRow.id,
            selectedProduct?.name ?? null,
            lookedUpBatch?.batch_number ?? null,
            testDate,
            chemistName.trim() || null,
            JSON.stringify(testResults),
            remarks.trim() || null,
            profile?.full_name ?? null,
            ppNowISO,
            activeFactory.id,
          ],
        },
      });

      showToast("Post-production test saved ✓");
      // Reset form
      setProductId("");
      setBatchNumber("");
      setBatchId("");
      setLookedUpBatch(null);
      setBatchLookupState("idle");
      setLinkedPqcId("");
      setValues({});
      setTrackingType("");
      setParametersChecked("");
      setStabilityResult("");
      setStabilityReadingDate("");
      setRemarks("");
      setChemistName("");
      draft.clear();
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedProduct = products.find(p => p.id === productId);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      {/* ── Step 1: Product ─────────────────────────────────────────────── */}
      <div className="card">
        <h3>Post Production Test</h3>

        <label>Product *</label>
        {loadingProducts ? (
          <div className="field-hint">Loading…</div>
        ) : (
          <select value={productId} onChange={e => setProductId(e.target.value)}>
            <option value="">— Select product —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {/* ── Step 2: Batch — debounced typed lookup ───────────────────────── */}
      {productId && (
        <div className="card">
          <h3>Batch</h3>
          <label>Batch Number *</label>
          <input
            type="text"
            placeholder="e.g. SSC-260824-001"
            value={batchNumber}
            onChange={e => {
              setBatchNumber(e.target.value);
              setBatchLookupState("idle");
            }}
          />
          {batchLookupState === "searching" && (
            <div className="field-hint">Searching…</div>
          )}
          {batchLookupState === "not_found" && batchNumber.trim() && (
            <div className="field-hint" style={{ color: "var(--warn)" }}>
              ✕ Batch &ldquo;{batchNumber.trim()}&rdquo; not found for this product.
              Create the batch via Production Job Card first.
            </div>
          )}
          {batchLookupState === "found" && lookedUpBatch && (
            <div className="readonly-block" style={{ background: "var(--ok-soft)", color: "var(--ok)", marginTop: 8 }}>
              ✓ {lookedUpBatch.batch_number}
              {lookedUpBatch.lot_number ? ` · Lot ${lookedUpBatch.lot_number}` : ""}
              {" · "}{lookedUpBatch.production_date}
            </div>
          )}

          {/* Optional link to existing Product QC record */}
          {batchLookupState === "found" && pqcOptions.length > 0 && (
            <>
              <label style={{ marginTop: 16 }}>Link to QC Record (optional)</label>
              <select value={linkedPqcId} onChange={e => setLinkedPqcId(e.target.value)}>
                <option value="">— None / standalone —</option>
                {pqcOptions.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.test_date} · Phase {p.phase} · {p.overall_result ?? "result pending"}
                  </option>
                ))}
              </select>
              <div className="field-hint">Link to the original Product QC record this test refers to.</div>
            </>
          )}
        </div>
      )}

      {/* ── Steps 3–5: form body (shown once batch found) ────────────────── */}
      {batchLookupState === "found" && (
        <>
          {/* Test Details */}
          <div className="card">
            <h3>Test Details</h3>
            <div className="row2">
              <div>
                <label>Test Date *</label>
                <DateField value={testDate} onChange={setTestDate} />
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

          {/* Dynamic product QC fields from qc_test_definitions */}
          {loadingDefs ? (
            <div className="card"><div className="empty">Loading test fields…</div></div>
          ) : testDefs.length > 0 ? (
            <div className="card">
              <h3>
                Test Results — {selectedProduct?.name}
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
                  allValues={values}
                  manualOverrideKeys={MANUAL_OVERRIDE_KEYS}
                  photoUploadProps={(user && activeFactory) ? {
                    factoryCode:  activeFactory.code,
                    factoryId:    activeFactory.id,
                    entityType:   "post_production_test" as const,
                    entityId:     null,
                    userId:       user.id,
                    onUploaded:   (key, path) => handleChange(key, path),
                    uploaderRefs,
                  } : undefined}
                />
              ))}
            </div>
          ) : null}

          {/* Stability / Retest metadata — always shown, not in qc_test_definitions */}
          <div className="card">
            <h3>Stability / Retest Information</h3>

            <label>Tracking Type</label>
            <select value={trackingType} onChange={e => setTrackingType(e.target.value)}>
              <option value="">— Select —</option>
              {TRACKING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <label>Parameters Checked</label>
            <textarea
              rows={2}
              placeholder="e.g. Sulphur content, Suspensibility"
              value={parametersChecked}
              onChange={e => setParametersChecked(e.target.value)}
            />

            <label>Stability Test Result</label>
            <input
              type="text"
              placeholder="Pass / Fail / Observation"
              value={stabilityResult}
              onChange={e => setStabilityResult(e.target.value)}
            />

            <label>Date of Stability Reading</label>
            <DateField value={stabilityReadingDate} onChange={setStabilityReadingDate} />

            <label>Remarks</label>
            <textarea
              rows={2}
              placeholder="Additional observations"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
            />
          </div>

          <p className="field-hint" style={{ marginBottom: 8 }}>
            Factory: <strong>{activeFactory?.name ?? "—"}</strong> ·{" "}
            Product: <strong>{selectedProduct?.name ?? "—"}</strong>
          </p>

          <button
            className="btn btn-primary"
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Saving…" : "Save Post-Production Test"}
          </button>
        </>
      )}
    </>
  );
}

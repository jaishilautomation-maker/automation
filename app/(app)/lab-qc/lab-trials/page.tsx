"use client";

// =============================================================================
// Lab QC — Lab Trials
//
// Trial records including trial-only products (is_trial_only = true).
// batch_id and product_id are nullable — a trial may not have a formal
// batch or named product yet.
// =============================================================================

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type { Product, LabTrialStatus } from "@/lib/types";
import PhotoUploader, { type PhotoUploaderHandle } from "@/components/PhotoUploader";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { buildLabTrialEmail } from "@/lib/notifications/lab-qc-emails";

interface BatchOption {
  id: string;
  batch_number: string;
  production_date: string;
}

const TRIAL_STATUSES: LabTrialStatus[] = ["ongoing", "completed", "abandoned"];

export default function LabTrialsPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // All products (regular + trial-only)
  const [products, setProducts]     = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Batches (optional — trial may not have a batch)
  const [batches, setBatches]       = useState<BatchOption[]>([]);

  // Form state
  const [trialCode, setTrialCode]   = useState("");
  const [trialDate, setTrialDate]   = useState(new Date().toISOString().slice(0, 10));
  const [productId, setProductId]   = useState("");
  const [batchId, setBatchId]       = useState("");
  const [objective, setObjective]   = useState("");
  const [appearance, setAppearance] = useState("");
  const [density, setDensity]       = useState("");
  const [phNeat, setPhNeat]         = useState("");
  const [ph5pct, setPh5pct]         = useState("");
  const [suspensibility, setSuspensibility] = useState("");
  const [remarksIfFailed, setRemarksIfFailed] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [status, setStatus]         = useState<LabTrialStatus>("ongoing");
  const [remarks, setRemarks]       = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Photo uploader refs
  const productPhotoRef   = useRef<PhotoUploaderHandle | null>(null);
  const jobCardPhotoRef   = useRef<PhotoUploaderHandle | null>(null);

  // Load all products (including trial-only)
  useEffect(() => {
    supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("is_trial_only", { ascending: false }) // trial-only at top
      .then(({ data }) => { setProducts((data ?? []) as Product[]); setLoadingProducts(false); });
  }, [supabase]);

  // Load batches (optional — any batch type at this factory)
  useEffect(() => {
    if (!activeFactory) return;
    supabase
      .from("batches")
      .select("id, batch_number, production_date")
      .eq("factory_id", activeFactory.id)
      .order("production_date", { ascending: false })
      .limit(50)
      .then(({ data }) => setBatches((data ?? []) as BatchOption[]));
  }, [activeFactory, supabase]);

  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!trialCode.trim()) { showToast("Trial code is required.", true); return; }

    setSubmitting(true);
    try {
      const testResults: Record<string, string | number> = {};
      if (appearance)    testResults["appearance"]    = appearance;
      if (density)       testResults["density"]       = parseFloat(density) || density;
      if (phNeat)        testResults["ph_neat"]       = parseFloat(phNeat) || phNeat;
      if (ph5pct)        testResults["ph_5pct"]       = parseFloat(ph5pct) || ph5pct;
      if (suspensibility) testResults["suspensibility"] = parseFloat(suspensibility) || suspensibility;
      if (remarksIfFailed) testResults["remarks_if_failed"] = remarksIfFailed;

      const { error } = await supabase
        .from("lab_trials")
        .insert({
          batch_id:     batchId  || null,
          factory_id:   activeFactory.id,
          product_id:   productId || null,
          trial_code:   trialCode.trim(),
          trial_date:   trialDate,
          chemist_id:   user.id,
          objective:    objective.trim() || null,
          appearance:   appearance || null,
          appearance_ok: null,
          test_results: testResults,
          conclusion:   conclusion.trim() || null,
          status,
          remarks:      remarks.trim() || null,
        });

      if (error) { showToast("Could not save: " + error.message, true); return; }

      // Flush pending photos now we have the trial id
      const trialId = (await supabase.from("lab_trials").select("id")
        .eq("trial_code", trialCode.trim())
        .eq("factory_id", activeFactory.id)
        .order("submitted_at", { ascending: false })
        .limit(1).single()).data?.id;

      if (trialId) {
        const flushes = [productPhotoRef, jobCardPhotoRef]
          .filter(r => r.current?.hasPending)
          .map(r => r.current!.flush(trialId));
        await Promise.all(flushes);
      }

      // Fire-and-forget email (reuses testResults already built above)
      const ltNowISO = new Date().toISOString();
      const selectedProduct = products.find(p => p.id === productId);
      const { subject: ltSubj, html: ltHtml } = buildLabTrialEmail({
        trialCode,
        productName:     selectedProduct?.name,
        trialDate,
        objective:       objective.trim() || null,
        appearance:      appearance || null,
        conclusion:      conclusion.trim() || null,
        status,
        testResults,
        remarks:         remarks.trim() || null,
        submittedByName: profile?.full_name ?? "—",
        submittedAt:     ltNowISO,
      });
      void notifyEvent({ eventType: "lab_qc_lab_trial", subject: ltSubj, html: ltHtml, factoryId: activeFactory.id, referenceId: trialId });

      showToast("Lab trial saved ✓");
      setTrialCode(""); setObjective(""); setAppearance(""); setDensity("");
      setPhNeat(""); setPh5pct(""); setSuspensibility(""); setRemarksIfFailed("");
      setConclusion(""); setRemarks(""); setProductId(""); setBatchId("");
      setStatus("ongoing");
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
        <h3>Lab Trial Entry</h3>

        <div className="row2">
          <div>
            <label>Trial Code *</label>
            <input type="text" placeholder="e.g. TRIAL-001" value={trialCode}
              onChange={e => setTrialCode(e.target.value)} />
          </div>
          <div>
            <label>Trial Date *</label>
            <input type="date" value={trialDate} onChange={e => setTrialDate(e.target.value)} />
          </div>
        </div>

        <label>Product (optional)</label>
        {loadingProducts ? <div className="field-hint">Loading…</div> : (
          <select value={productId} onChange={e => setProductId(e.target.value)}>
            <option value="">— Unknown / new product —</option>
            {products.filter(p => p.is_trial_only).length > 0 && (
              <optgroup label="Trial-Only Products">
                {products.filter(p => p.is_trial_only).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Regular Products">
              {products.filter(p => !p.is_trial_only).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          </select>
        )}

        <label>Batch (optional)</label>
        <select value={batchId} onChange={e => setBatchId(e.target.value)}>
          <option value="">— No batch assigned —</option>
          {batches.map(b => (
            <option key={b.id} value={b.id}>
              {b.batch_number} · {b.production_date}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        <h3>Objective & Observations</h3>

        <label>Objective</label>
        <textarea rows={2} placeholder="Purpose of this trial"
          value={objective} onChange={e => setObjective(e.target.value)} />

        <label>Appearance</label>
        <input type="text" placeholder="Physical state, colour"
          value={appearance} onChange={e => setAppearance(e.target.value)} />
      </div>

      <div className="card">
        <h3>Test Results</h3>
        <div className="row2">
          <div>
            <label>Density (g/cm³)</label>
            <input type="number" step="any" placeholder="0" value={density}
              onChange={e => setDensity(e.target.value)} />
          </div>
          <div>
            <label>pH (neat)</label>
            <input type="number" step="any" placeholder="0" value={phNeat}
              onChange={e => setPhNeat(e.target.value)} />
          </div>
        </div>
        <div className="row2">
          <div>
            <label>pH (5%)</label>
            <input type="number" step="any" placeholder="0" value={ph5pct}
              onChange={e => setPh5pct(e.target.value)} />
          </div>
          <div>
            <label>Suspensibility (%)</label>
            <input type="number" step="any" placeholder="0" value={suspensibility}
              onChange={e => setSuspensibility(e.target.value)} />
          </div>
        </div>

        <label>Remarks if Failed</label>
        <textarea rows={2} placeholder="Failure reason or observations"
          value={remarksIfFailed} onChange={e => setRemarksIfFailed(e.target.value)} />

        {/* Photos */}
        {user && activeFactory && (
          <>
            <label style={{ marginTop: 8 }}>Product Photo</label>
            <PhotoUploader
              ref={productPhotoRef}
              label="Product Photo"
              fieldKey="product_photo"
              factoryCode={activeFactory.code}
              entityType="lab_trial"
              entityId={null}
              userId={user.id}
              factoryId={activeFactory.id}
              onUploaded={() => {}}
            />

            <label style={{ marginTop: 8 }}>Job Card Photo</label>
            <PhotoUploader
              ref={jobCardPhotoRef}
              label="Job Card Photo"
              fieldKey="job_card_photo"
              factoryCode={activeFactory.code}
              entityType="lab_trial"
              entityId={null}
              userId={user.id}
              factoryId={activeFactory.id}
              onUploaded={() => {}}
            />
          </>
        )}
      </div>

      <div className="card">
        <h3>Conclusion & Status</h3>

        <label>Conclusion</label>
        <textarea rows={2} placeholder="Trial conclusion / next steps"
          value={conclusion} onChange={e => setConclusion(e.target.value)} />

        <label>Trial Status</label>
        <div className="chip-group">
          {TRIAL_STATUSES.map(s => (
            <div
              key={s}
              className={`chip${status === s ? " selected" : ""}`}
              onClick={() => setStatus(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </div>
          ))}
        </div>

        <label>Remarks</label>
        <textarea rows={2} placeholder="Additional notes"
          value={remarks} onChange={e => setRemarks(e.target.value)} />
      </div>

      <p className="field-hint" style={{ marginBottom: 8 }}>
        Factory: <strong>{activeFactory?.name ?? "—"}</strong>
      </p>

      <button className="btn btn-primary" type="button" disabled={submitting} onClick={handleSubmit}>
        {submitting ? "Saving…" : "Save Trial Record"}
      </button>
    </>
  );
}

"use client";

// =============================================================================
// Pulveriser Job Card — Production (Form JSCI/PROD/02)
//
// Production login creates the record and fills ONLY their 10 fields.
// On save, status = 'pending'. Operator then fills the rest.
//
// Production-owned fields (per authority-approved flow):
//   machine_number, job_number, shift, job_date, material_code,
//   sulphur_supplier, sulphur_lot_number, sulphur_empty_date,
//   oil_supplier, oil_batch_number, oil_quantity
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import {
  PULVERISER_MACHINES,
  type PulveriserMachine,
  type VfdParameter,
} from "@/lib/types";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function PulveriserProductionPage() {
  const { user } = useAuth();
  const { activeFactory } = useModule();
  const { showToast } = useToast();
  const supabase = createClient();

  const [machine, setMachine]           = useState<PulveriserMachine>("M1");
  const [jobNumber, setJobNumber]       = useState("");
  const [shift, setShift]               = useState<"Day" | "Night" | "">("");
  const [jobDate, setJobDate]           = useState(todayISO());
  const [materialCode, setMaterialCode] = useState("");
  const [plannedMt, setPlannedMt]       = useState("");
  const [sulSupplier, setSulSupplier]   = useState("");
  const [sulLot, setSulLot]             = useState("");
  const [sulEmptyDate, setSulEmptyDate] = useState("");
  const [oilSupplier, setOilSupplier]   = useState("");
  const [oilBatch, setOilBatch]         = useState("");
  const [oilQty, setOilQty]             = useState("");
  const [submitting, setSubmitting]     = useState(false);

  // Mill-type VFD rows drive the material-code dropdown + oil standard lookup.
  const [millParams, setMillParams] = useState<VfdParameter[]>([]);

  const loadParams = useCallback(async () => {
    const { data, error } = await supabase
      .from("vfd_parameters")
      .select("*")
      .eq("machine_type", "mill")
      .order("party_code");
    if (error) { showToast("VFD codes load nahi hue: " + error.message, true); return; }
    setMillParams((data ?? []) as VfdParameter[]);
  }, [supabase, showToast]);

  useEffect(() => { loadParams(); }, [loadParams]);

  // Selected code's oil standard → live oil_required_kg preview.
  const selectedParam = useMemo(
    () => millParams.find(p => p.party_code === materialCode) ?? null,
    [millParams, materialCode],
  );
  const oilStd = selectedParam?.oil_feed_std ?? null;
  const plannedMtNum = plannedMt.trim() === "" ? null : Number(plannedMt);
  const oilRequiredPreview =
    plannedMtNum !== null && oilStd !== null && Number.isFinite(plannedMtNum)
      ? plannedMtNum * 1000 * oilStd
      : null;

  const reset = () => {
    setJobNumber(""); setShift(""); setJobDate(todayISO()); setMaterialCode("");
    setPlannedMt("");
    setSulSupplier(""); setSulLot(""); setSulEmptyDate("");
    setOilSupplier(""); setOilBatch(""); setOilQty("");
  };

  const handleCreate = async () => {
    if (!user) { showToast("Session expired — sign in again.", true); return; }
    if (!activeFactory) {
      showToast("Select a factory/module first.", true);
      return;
    }
    if (!materialCode) {
      showToast("माल का कोड नंबर (material code) is required — operator waits on it.", true);
      return;
    }

    setSubmitting(true);
    try {
      // oil_required_kg is also recomputed by the DB trigger from the
      // vfd_parameters oil_feed_std lookup; we send our client value too so the
      // row is correct even if read back before the trigger result is fetched.
      // Chain .select() so a row blocked by RLS surfaces a real error instead
      // of PostgREST's silent 204 (which otherwise reports a false success).
      const { data, error } = await supabase
        .from("pulveriser_job_cards")
        .insert({
          factory_id:         activeFactory.id,
          status:             "pending_stores",
          machine_number:     machine,
          job_number:         jobNumber.trim() || null,
          shift:              shift || null,
          job_date:           jobDate || null,
          material_code:      materialCode,
          planned_production_mt: plannedMtNum,
          oil_required_kg:    oilRequiredPreview,
          sulphur_supplier:   sulSupplier.trim() || null,
          sulphur_lot_number: sulLot.trim() || null,
          sulphur_empty_date: sulEmptyDate || null,
          oil_supplier:       oilSupplier.trim() || null,
          oil_batch_number:   oilBatch.trim() || null,
          oil_quantity:       oilQty.trim() === "" ? null : Number(oilQty),
          production_by:      user.id,
          production_at:      new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) { showToast("Could not create job card: " + error.message, true); return; }
      if (!data) {
        showToast("Save was blocked — your account may not have access to this factory.", true);
        return;
      }
      showToast("Job card created ✓ — Stores will issue oil, then the operator fills their part.");
      reset();
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="card">
        <h3>New Pulveriser Job Card</h3>
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Production fills these fields only. Operator fills the rest after this is saved.
        </div>

        <div className="row2">
          <div>
            <label>Machine Number *</label>
            <select value={machine} onChange={e => setMachine(e.target.value as PulveriserMachine)}>
              {PULVERISER_MACHINES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label>Job Number</label>
            <input type="text" placeholder="e.g. JB-0451" value={jobNumber}
              onChange={e => setJobNumber(e.target.value)} />
          </div>
        </div>

        <div className="row2">
          <div>
            <label>Job Date</label>
            <input type="date" value={jobDate} onChange={e => setJobDate(e.target.value)} />
          </div>
          <div>
            <label>Shift</label>
            <div className="chip-group">
              {(["Day", "Night"] as const).map(s => (
                <div key={s} className={`chip${shift === s ? " selected" : ""}`}
                  onClick={() => setShift(s)}>
                  {s === "Day" ? "Day (8am–8pm)" : "Night (8pm–8am)"}
                </div>
              ))}
            </div>
          </div>
        </div>

        <label>माल का कोड नंबर (Material Code) *</label>
        <select value={materialCode} onChange={e => setMaterialCode(e.target.value)}>
          <option value="">— select code —</option>
          {millParams.map(p => (
            <option key={p.id} value={p.party_code}>{p.party_code}</option>
          ))}
        </select>
        {materialCode && selectedParam && (
          <div className="field-hint" style={{ marginTop: 6 }}>
            Oil standard (oil_feed_std): {oilStd ?? "NA"}
            {" · "}Classifier VFD: {selectedParam.classifier_vfd ?? "—"}
            {" · "}Feeder VFD: {selectedParam.feeder_vfd ?? "—"}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Production Plan</h3>
        <label>Planned Production (MT)</label>
        <input type="number" min="0" step="0.001" placeholder="0"
          value={plannedMt} onChange={e => setPlannedMt(e.target.value)} />
        <div className="field-hint" style={{ marginTop: 8 }}>
          Oil required (auto): {" "}
          {oilRequiredPreview !== null ? (
            <b>{oilRequiredPreview.toFixed(3)} kg</b>
          ) : oilStd === null && materialCode ? (
            <span>— no oil standard for this code (NA)</span>
          ) : (
            <span>— enter planned MT and select a code</span>
          )}
        </div>
        <div className="field-hint">
          = Planned MT × 1000 × oil standard. Stores issues this oil before the operator can run the batch.
        </div>
      </div>

      <div className="card">
        <h3>Sulphur</h3>
        <div className="row2">
          <div>
            <label>Supplier</label>
            <input type="text" value={sulSupplier} onChange={e => setSulSupplier(e.target.value)} />
          </div>
          <div>
            <label>Lot Number</label>
            <input type="text" value={sulLot} onChange={e => setSulLot(e.target.value)} />
          </div>
        </div>
        <label>खाली करने की तारीख (Empty Date)</label>
        <input type="date" value={sulEmptyDate} onChange={e => setSulEmptyDate(e.target.value)} />
      </div>

      <div className="card">
        <h3>Oil</h3>
        <div className="row2">
          <div>
            <label>Supplier</label>
            <input type="text" value={oilSupplier} onChange={e => setOilSupplier(e.target.value)} />
          </div>
          <div>
            <label>Batch Number</label>
            <input type="text" value={oilBatch} onChange={e => setOilBatch(e.target.value)} />
          </div>
        </div>
        <label>Oil Quantity</label>
        <input type="number" min="0" step="0.001" placeholder="0" value={oilQty}
          onChange={e => setOilQty(e.target.value)} />
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting} onClick={handleCreate}>
        {submitting ? "Creating…" : "Create Job Card"}
      </button>
    </>
  );
}

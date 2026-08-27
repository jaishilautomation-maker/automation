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

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { PULVERISER_MACHINES, type PulveriserMachine } from "@/lib/types";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function PulveriserProductionPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [machine, setMachine]           = useState<PulveriserMachine>("M1");
  const [jobNumber, setJobNumber]       = useState("");
  const [shift, setShift]               = useState<"Day" | "Night" | "">("");
  const [jobDate, setJobDate]           = useState(todayISO());
  const [materialCode, setMaterialCode] = useState("");
  const [sulSupplier, setSulSupplier]   = useState("");
  const [sulLot, setSulLot]             = useState("");
  const [sulEmptyDate, setSulEmptyDate] = useState("");
  const [oilSupplier, setOilSupplier]   = useState("");
  const [oilBatch, setOilBatch]         = useState("");
  const [oilQty, setOilQty]             = useState("");
  const [submitting, setSubmitting]     = useState(false);

  const reset = () => {
    setJobNumber(""); setShift(""); setJobDate(todayISO()); setMaterialCode("");
    setSulSupplier(""); setSulLot(""); setSulEmptyDate("");
    setOilSupplier(""); setOilBatch(""); setOilQty("");
  };

  const handleCreate = async () => {
    if (!user) { showToast("Session expired — sign in again.", true); return; }
    if (!materialCode.trim()) {
      showToast("माल का कोड नंबर (material code) is required — operator waits on it.", true);
      return;
    }

    setSubmitting(true);
    try {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("factory_id")
        .eq("user_id", user.id)
        .not("factory_id", "is", null)
        .limit(1)
        .single();
      const factoryId = roleRow?.factory_id ?? null;
      if (!factoryId) {
        showToast("No factory assigned to your account.", true);
        return;
      }

      const { error } = await supabase.from("pulveriser_job_cards").insert({
        factory_id:         factoryId,
        status:             "pending",
        machine_number:     machine,
        job_number:         jobNumber.trim() || null,
        shift:              shift || null,
        job_date:           jobDate || null,
        material_code:      materialCode.trim(),
        sulphur_supplier:   sulSupplier.trim() || null,
        sulphur_lot_number: sulLot.trim() || null,
        sulphur_empty_date: sulEmptyDate || null,
        oil_supplier:       oilSupplier.trim() || null,
        oil_batch_number:   oilBatch.trim() || null,
        oil_quantity:       oilQty.trim() === "" ? null : Number(oilQty),
        production_by:      user.id,
        production_at:      new Date().toISOString(),
      });

      if (error) { showToast("Could not create job card: " + error.message, true); return; }
      showToast("Job card created ✓ — operator will now fill their part.");
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
        <input type="text" placeholder="e.g. SC-001" value={materialCode}
          onChange={e => setMaterialCode(e.target.value)} />
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

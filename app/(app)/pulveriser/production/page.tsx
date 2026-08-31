"use client";

// =============================================================================
// Pulveriser Job Card — Production (Form JSCI/PROD/02)
//
// Production creates 1–3 ENTRIES under a single shared JOB NUMBER. Each entry
// is its own pulveriser_job_cards row (Option A) with its own Party/CODE and a
// full set of details (batch number + production plan + sulphur + oil), filled
// in sequence. On "Create", one row per entry is inserted, all sharing the same
// job_number / machine / date / shift. Each row starts as 'pending_stores' and
// moves through Stores → Operator → Lab independently.
//
// Shared (header) fields: machine_number, job_number, shift, job_date.
// Per-entry fields: party_code, material_code (BATCH NUMBER), planned_production_mt,
//   sulphur_supplier/lot/empty_date, oil_supplier/batch/quantity.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import {
  PULVERISER_MACHINES,
  type PulveriserMachine,
  type VfdParameter,
} from "@/lib/types";

const MAX_ENTRIES = 3;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// One Party/CODE entry within a job. Each becomes its own job-card row.
interface Entry {
  key: string;
  partyCode: string;
  batchNumber: string;      // was माल का कोड नंबर — stored in material_code
  plannedMt: string;
  sulSupplier: string;
  sulLot: string;
  sulEmptyDate: string;
  oilSupplier: string;
  oilBatch: string;
  oilQty: string;
}

function blankEntry(): Entry {
  return {
    key: `e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    partyCode: "", batchNumber: "", plannedMt: "",
    sulSupplier: "", sulLot: "", sulEmptyDate: "",
    oilSupplier: "", oilBatch: "", oilQty: "",
  };
}

export default function PulveriserProductionPage() {
  const { user } = useAuth();
  const { activeFactory } = useModule();
  const { showToast } = useToast();
  const supabase = createClient();

  // Shared header
  const [machine, setMachine]     = useState<PulveriserMachine>("M1");
  const [jobNumber, setJobNumber] = useState("");
  const [shift, setShift]         = useState<"Day" | "Night" | "">("");
  const [jobDate, setJobDate]     = useState(todayISO());

  // 1–3 entries
  const [entries, setEntries]     = useState<Entry[]>([blankEntry()]);
  const [submitting, setSubmitting] = useState(false);

  // Mill-type VFD rows drive the Party/CODE dropdown + oil standard lookup.
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

  const oilStdFor = (partyCode: string): number | null =>
    millParams.find(p => p.party_code === partyCode)?.oil_feed_std ?? null;
  const paramFor = (partyCode: string): VfdParameter | null =>
    millParams.find(p => p.party_code === partyCode) ?? null;

  const oilRequiredFor = (e: Entry): number | null => {
    const std = oilStdFor(e.partyCode);
    const mt = e.plannedMt.trim() === "" ? null : Number(e.plannedMt);
    return mt !== null && std !== null && Number.isFinite(mt) ? mt * 1000 * std : null;
  };

  const updateEntry = (key: string, patch: Partial<Entry>) =>
    setEntries(prev => prev.map(e => e.key === key ? { ...e, ...patch } : e));

  const addEntry = () => {
    if (entries.length >= MAX_ENTRIES) {
      showToast(`Ek job number mein maximum ${MAX_ENTRIES} entries.`, true);
      return;
    }
    setEntries(prev => [...prev, blankEntry()]);
  };

  const removeEntry = (key: string) => {
    if (entries.length === 1) { showToast("Kam se kam ek entry zaroori hai.", true); return; }
    setEntries(prev => prev.filter(e => e.key !== key));
  };

  const reset = () => {
    setJobNumber(""); setShift(""); setJobDate(todayISO());
    setEntries([blankEntry()]);
  };

  const handleCreate = async () => {
    if (!user) { showToast("Session expired — sign in again.", true); return; }
    if (!activeFactory) { showToast("Select a factory/module first.", true); return; }

    // Validate every entry before inserting anything.
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.partyCode) {
        showToast(`Entry ${i + 1}: Party/CODE required (drives the oil standard).`, true);
        return;
      }
      if (!e.batchNumber.trim()) {
        showToast(`Entry ${i + 1}: Batch Number required.`, true);
        return;
      }
    }

    setSubmitting(true);
    try {
      const nowISO = new Date().toISOString();
      const rows = entries.map(e => {
        const mt = e.plannedMt.trim() === "" ? null : Number(e.plannedMt);
        return {
          factory_id:            activeFactory.id,
          status:                "pending_stores" as const,
          machine_number:        machine,
          job_number:            jobNumber.trim() || null,
          shift:                 shift || null,
          job_date:              jobDate || null,
          material_code:         e.batchNumber.trim(),   // BATCH NUMBER
          party_code:            e.partyCode,
          planned_production_mt: mt,
          oil_required_kg:       oilRequiredFor(e),
          sulphur_supplier:      e.sulSupplier.trim() || null,
          sulphur_lot_number:    e.sulLot.trim() || null,
          sulphur_empty_date:    e.sulEmptyDate || null,
          oil_supplier:          e.oilSupplier.trim() || null,
          oil_batch_number:      e.oilBatch.trim() || null,
          oil_quantity:          e.oilQty.trim() === "" ? null : Number(e.oilQty),
          production_by:         user.id,
          production_at:         nowISO,
        };
      });

      // Insert all entries in one call. .select() so an RLS-blocked insert
      // surfaces a real error instead of a silent 204.
      const { data, error } = await supabase
        .from("pulveriser_job_cards")
        .insert(rows)
        .select("id");

      if (error) { showToast("Could not create job card: " + error.message, true); return; }
      if (!data || data.length === 0) {
        showToast("Save was blocked — your account may not have access to this factory.", true);
        return;
      }
      showToast(
        `${data.length} ${data.length === 1 ? "entry" : "entries"} created ✓ — ` +
        "Stores will issue oil, then the operator fills their part.",
      );
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
          One Job Number can hold up to {MAX_ENTRIES} entries (different Party/CODE).
          Fill each entry fully, then add another or create.
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
      </div>

      {entries.map((e, idx) => {
        const param = paramFor(e.partyCode);
        const oilStd = param?.oil_feed_std ?? null;
        const oilReq = oilRequiredFor(e);
        return (
          <div className="card" key={e.key} style={{ borderColor: "var(--brand, var(--line))" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Entry {idx + 1}</h3>
              {entries.length > 1 && (
                <button type="button" className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "3px 10px", color: "var(--warn)" }}
                  onClick={() => removeEntry(e.key)}>
                  Remove
                </button>
              )}
            </div>

            {/* Identity: Party/CODE + Batch Number */}
            <div className="row2">
              <div>
                <label>Party / CODE *</label>
                <select value={e.partyCode}
                  onChange={ev => updateEntry(e.key, { partyCode: ev.target.value })}>
                  <option value="">— select party/code —</option>
                  {millParams.map(p => (
                    <option key={p.id} value={p.party_code}>{p.party_code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Batch Number *</label>
                <input type="text" placeholder="e.g. B-1024" value={e.batchNumber}
                  onChange={ev => updateEntry(e.key, { batchNumber: ev.target.value })} />
              </div>
            </div>
            {e.partyCode && param && (
              <div className="field-hint" style={{ marginTop: 6 }}>
                Oil standard (oil_feed_std): {oilStd ?? "NA"}
                {" · "}Classifier VFD: {param.classifier_vfd ?? "—"}
                {" · "}Feeder VFD: {param.feeder_vfd ?? "—"}
              </div>
            )}

            {/* Production plan */}
            <label style={{ marginTop: 12 }}>Planned Production (MT)</label>
            <input type="number" min="0" step="0.001" placeholder="0"
              value={e.plannedMt}
              onChange={ev => updateEntry(e.key, { plannedMt: ev.target.value })} />
            <div className="field-hint" style={{ marginTop: 8 }}>
              Oil required (auto):{" "}
              {oilReq !== null ? (
                <b>{oilReq.toFixed(3)} kg</b>
              ) : oilStd === null && e.partyCode ? (
                <span>— no oil standard for this code (NA)</span>
              ) : (
                <span>— enter planned MT and select a code</span>
              )}
            </div>

            {/* Sulphur */}
            <div style={{ marginTop: 14, fontWeight: 700, fontSize: 13 }}>Sulphur</div>
            <div className="row2">
              <div>
                <label>Supplier</label>
                <input type="text" value={e.sulSupplier}
                  onChange={ev => updateEntry(e.key, { sulSupplier: ev.target.value })} />
              </div>
              <div>
                <label>Lot Number</label>
                <input type="text" value={e.sulLot}
                  onChange={ev => updateEntry(e.key, { sulLot: ev.target.value })} />
              </div>
            </div>
            <label>खाली करने की तारीख (Empty Date)</label>
            <input type="date" value={e.sulEmptyDate}
              onChange={ev => updateEntry(e.key, { sulEmptyDate: ev.target.value })} />

            {/* Oil */}
            <div style={{ marginTop: 14, fontWeight: 700, fontSize: 13 }}>Oil</div>
            <div className="row2">
              <div>
                <label>Supplier</label>
                <input type="text" value={e.oilSupplier}
                  onChange={ev => updateEntry(e.key, { oilSupplier: ev.target.value })} />
              </div>
              <div>
                <label>Oil Batch Number</label>
                <input type="text" value={e.oilBatch}
                  onChange={ev => updateEntry(e.key, { oilBatch: ev.target.value })} />
              </div>
            </div>
            <label>Oil Quantity</label>
            <input type="number" min="0" step="0.001" placeholder="0" value={e.oilQty}
              onChange={ev => updateEntry(e.key, { oilQty: ev.target.value })} />
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost"
          disabled={entries.length >= MAX_ENTRIES} onClick={addEntry}>
          + Add entry ({entries.length}/{MAX_ENTRIES})
        </button>
        <button className="btn btn-primary" type="button"
          disabled={submitting} onClick={handleCreate}>
          {submitting
            ? "Creating…"
            : `Create Job Card${entries.length > 1 ? ` (${entries.length} entries)` : ""}`}
        </button>
      </div>
    </>
  );
}

"use client";

// =============================================================================
// Pulveriser Job Card — Production (Form JSCI/PROD/02)
//
// Production creates 1–6 ENTRIES under a single shared JOB NUMBER. Each entry
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
  groupByJobNumber,
  type PulveriserMachine,
  type VfdParameter,
  type PulveriserJobCard,
  type Vendor,
  type SulphurLotRemaining,
} from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { buildProductionEmail } from "@/lib/notifications/pulveriser-emails";

// Crude sulphur vendor list is loaded from the vendors table (migration 058).
// The static SULPHUR_VENDORS array has been replaced by a DB query on mount.

const MAX_ENTRIES = 6;

// Preferred display order for the Party/CODE dropdown (matches vfd_parameters
// party_code labels after migration 043). Codes not listed here fall to the end,
// alphabetically.
const PARTY_CODE_ORDER = [
  "Ceat 108",
  "M2615",
  "Plain-2615",
  "Apollo 160108",
  "LANXESS",
  "Ceat R5299",
  "Plain Lanxess",
  "JKI-108",
  "Shakti",
  "Rubber",
  "Sulphur Powder",
] as const;

function partyCodeRank(code: string): number {
  const idx = PARTY_CODE_ORDER.indexOf(code as (typeof PARTY_CODE_ORDER)[number]);
  return idx === -1 ? PARTY_CODE_ORDER.length : idx;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// One Party/CODE entry within a job. Each becomes its own job-card row.
interface Entry {
  key: string;
  partyCode: string;
  batchNumber: string;      // was माल का कोड नंबर — stored in material_code
  plannedKg: string;        // entered in KG; converted to MT (÷1000) on save
  sulVendorId: string;      // selected vendor id (from vendors table)
  sulSourceReceiptId: string; // selected rm_receipts.id (from v_sulphur_receipt_remaining)
  sulLot: string;
  sulEmptyDate: string;
  oilSupplier: string;
  oilBatch: string;
  oilQty: string;
}

function blankEntry(): Entry {
  return {
    key: `e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    partyCode: "", batchNumber: "", plannedKg: "",
    sulVendorId: "", sulSourceReceiptId: "", sulLot: "", sulEmptyDate: "",
    oilSupplier: "", oilBatch: "", oilQty: "",
  };
}

export default function PulveriserProductionPage() {
  const { user, profile } = useAuth();
  const { activeFactory } = useModule();
  const { showToast } = useToast();
  const supabase = createClient();

  // Which sub-view is showing: the new-job-card form or the rejected queue.
  const [view, setView] = useState<"new" | "rejected">("new");
  // Rejected-card count, reported up by TriageQueue so the tab can badge it.
  const [rejectedCount, setRejectedCount] = useState(0);

  // Shared header
  const [machine, setMachine]     = useState<PulveriserMachine>("M1");
  const [jobNumber, setJobNumber] = useState("");
  const [shift, setShift]         = useState<"Day" | "Night" | "">("");
  const [jobDate, setJobDate]     = useState(todayISO());

  // 1–6 entries
  const [entries, setEntries]     = useState<Entry[]>([blankEntry()]);
  const [submitting, setSubmitting] = useState(false);

  // Mill-type VFD rows drive the Party/CODE dropdown + oil standard lookup.
  const [millParams, setMillParams] = useState<VfdParameter[]>([]);
  // Customer names keyed by party_code — loaded from the parties table so the
  // production dropdown shows the same "code · name" label as batch analysis.
  const [partyNames, setPartyNames] = useState<Record<string, string>>({});
  // Crude sulphur vendors (from vendors table, migration 058).
  const [sulVendors, setSulVendors] = useState<Vendor[]>([]);
  // Available receipt lots keyed by vendor_id (from v_sulphur_lot_remaining).
  // Only lots with quantity_remaining_mt > 0 are shown; depleted ones are
  // listed separately so Production can see but is warned.
  const [sulLots, setSulLots] = useState<SulphurLotRemaining[]>([]);

  const loadParams = useCallback(async () => {
    const [{ data, error }, { data: pData }, { data: vData }, { data: lData }] = await Promise.all([
      supabase.from("vfd_parameters").select("*").eq("machine_type", "mill").order("party_code"),
      supabase.from("parties").select("party_code, customer_name").eq("is_active", true),
      supabase.from("vendors").select("*").eq("vendor_type", "crude_sulphur").eq("is_active", true).order("vendor_name"),
      supabase.from("v_sulphur_receipt_remaining").select("*").order("received_date", { ascending: false }),
    ]);
    if (error) { showToast("VFD codes load nahi hue: " + error.message, true); return; }
    setMillParams((data ?? []) as VfdParameter[]);
    const names: Record<string, string> = {};
    for (const p of (pData ?? []) as { party_code: string; customer_name: string | null }[]) {
      if (p.customer_name && p.customer_name !== p.party_code) names[p.party_code] = p.customer_name;
    }
    setPartyNames(names);
    setSulVendors((vData ?? []) as Vendor[]);
    setSulLots((lData ?? []) as SulphurLotRemaining[]);
  }, [supabase, showToast]);

  useEffect(() => { loadParams(); }, [loadParams]);

  // Party codes that run without oil dosing. If their mill row ever has a NULL
  // oil_feed_std (data drift after the 043 renames), treat it as 0 so oil
  // required computes to a real 0 kg instead of showing "NA". Migration 051
  // fixes the DB side; this keeps the UI correct even before it is applied.
  const ZERO_OIL_CODES = new Set<string>([
    "Shakti", "Rubber", "Ceat 108", "Plain-2615", "Plain Lanxess", "Sulphur Powder",
  ]);

  const oilStdFor = (partyCode: string): number | null => {
    const std = millParams.find(p => p.party_code === partyCode)?.oil_feed_std ?? null;
    if (std === null && ZERO_OIL_CODES.has(partyCode)) return 0;
    return std;
  };
  const paramFor = (partyCode: string): VfdParameter | null =>
    millParams.find(p => p.party_code === partyCode) ?? null;

  // Planned production is entered in KG. The DB column planned_production_mt is
  // still in MT (no schema change), so convert KG → MT (÷1000) at the boundary.
  const plannedMtFor = (e: Entry): number | null => {
    const kg = e.plannedKg.trim() === "" ? null : Number(e.plannedKg);
    return kg !== null && Number.isFinite(kg) ? kg / 1000 : null;
  };

  const oilRequiredFor = (e: Entry): number | null => {
    const std = oilStdFor(e.partyCode);
    const kg = e.plannedKg.trim() === "" ? null : Number(e.plannedKg);
    // oil required (kg) = planned KG × oil_feed_std  (== MT×1000×std)
    return kg !== null && std !== null && Number.isFinite(kg) ? kg * std : null;
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
        const mt = plannedMtFor(e);
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
          // Backward-compat: populate legacy text fields from the selected receipt
          // so downstream pages (operator, lab, stores, reports) still read them.
          sulphur_supplier:      (() => {
            const v = sulVendors.find(v => v.id === e.sulVendorId);
            return v ? v.vendor_name : (e.sulLot.trim() || null);
          })(),
          sulphur_lot_number:    e.sulLot.trim() || null,
          sulphur_empty_date:    (() => {
            const lot = sulLots.find(l => l.receipt_id === e.sulSourceReceiptId);
            return lot?.received_date ?? (e.sulEmptyDate || null);
          })(),
          // Receipt link (migration 060)
          sulphur_source_receipt_id: e.sulSourceReceiptId || null,
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

      // Fire-and-forget email for each created job card entry (reuses nowISO from above)
      for (let i = 0; i < entries.length; i++) {
        const e  = entries[i];
        // Derive backward-compat sulphur fields from the receipt selection.
        const sulVendorName = sulVendors.find(v => v.id === e.sulVendorId)?.vendor_name ?? null;
        const sulReceiptDate = sulLots.find(l => l.receipt_id === e.sulSourceReceiptId)?.received_date ?? (e.sulEmptyDate || null);
        const { subject, html } = buildProductionEmail({
          jobNumber:           jobNumber.trim() || null,
          machineNumber:       machine,
          materialCode:        e.batchNumber.trim(),
          partyCode:           e.partyCode,
          plannedProductionMt: plannedMtFor(e),
          oilRequiredKg:       oilRequiredFor(e),
          sulphurSupplier:     sulVendorName,
          sulphurLotNumber:    e.sulLot.trim()  || null,
          sulphurEmptyDate:    sulReceiptDate,
          oilSupplier:         e.oilSupplier.trim()  || null,
          oilBatchNumber:      e.oilBatch.trim()     || null,
          oilQuantity:         e.oilQty.trim() === "" ? null : Number(e.oilQty),
          submittedByName:     profile?.full_name ?? "—",
          submittedAt:         nowISO,
          jobDate:             jobDate || null,
          shift:               shift   || null,
        });
        void notifyEvent({
          eventType:   "pulveriser_production",
          subject,
          html,
          factoryId:   activeFactory.id,
          referenceId: data[i]?.id,
          sheetData: {
            type: "job_card",
            row: {
              job_number:            jobNumber.trim() || `row-${data[i]?.id}`,
              party_code:            e.partyCode || null,
              machine_number:        machine,
              material_code:         e.batchNumber.trim(),
              status:                "pending_stores",
              planned_production_mt: plannedMtFor(e),
              oil_required_kg:       oilRequiredFor(e),
              sulphur_supplier:      sulVendorName,
              sulphur_lot_number:    e.sulLot.trim()  || null,
              sulphur_empty_date:    sulReceiptDate,
              oil_supplier:          e.oilSupplier.trim()  || null,
              oil_batch_number:      e.oilBatch.trim()     || null,
              oil_quantity:          e.oilQty.trim() === "" ? null : Number(e.oilQty),
              production_by:         profile?.full_name ?? null,
              production_at:         nowISO,
            },
          },
        });
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
      {/* Sub-tabs: New Job Card | Rejected Job Cards */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button type="button"
          className={`chip${view === "new" ? " selected" : ""}`}
          onClick={() => setView("new")}>
          New Pulveriser Job Card
        </button>
        <button type="button"
          className={`chip${view === "rejected" ? " selected" : ""}`}
          onClick={() => setView("rejected")}
          style={rejectedCount > 0 ? { borderColor: "var(--warn)", color: "var(--warn)" } : undefined}>
          Rejected Job Cards
          {rejectedCount > 0 && (
            <span style={{
              marginLeft: 8, background: "var(--warn)", color: "#fff",
              borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700,
            }}>{rejectedCount}</span>
          )}
        </button>
      </div>

      {/* Keep TriageQueue mounted so it always reports the live count for the
          badge, but only show its full UI on the Rejected tab. */}
      <TriageQueue onCount={setRejectedCount} hidden={view !== "rejected"} />

      {view === "new" && (
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
                  {[...millParams]
                    .sort((a, b) => {
                      const ra = partyCodeRank(a.party_code);
                      const rb = partyCodeRank(b.party_code);
                      return ra !== rb ? ra - rb : a.party_code.localeCompare(b.party_code);
                    })
                    .map(p => (
                      <option key={p.id} value={p.party_code}>
                        {p.party_code}{partyNames[p.party_code] ? ` · ${partyNames[p.party_code]}` : ""}
                      </option>
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
            <label style={{ marginTop: 12 }}>Planned Production (kg)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={e.plannedKg}
              onChange={ev => updateEntry(e.key, { plannedKg: ev.target.value })} />
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

            {/* Crude Sulphur */}
            <div style={{ marginTop: 14, fontWeight: 700, fontSize: 13 }}>Crude Sulphur</div>
            {/* Step 1 — Vendor */}
            <label>Vendor</label>
            <select value={e.sulVendorId}
              onChange={ev => {
                // Switching vendor clears the receipt selection.
                updateEntry(e.key, { sulVendorId: ev.target.value, sulSourceReceiptId: "", sulEmptyDate: "" });
              }}>
              <option value="">-- Select vendor --</option>
              {sulVendors.map(v => (
                <option key={v.id} value={v.id}>{v.vendor_name}</option>
              ))}
            </select>

            {/* Step 2 — Receipt date (filtered to this vendor's available lots) */}
            {e.sulVendorId && (() => {
              const vendorLots = sulLots.filter(l => l.vendor_id === e.sulVendorId);
              const availableLots = vendorLots.filter(l => (l.quantity_remaining_mt ?? 0) > 0);
              const depletedLots  = vendorLots.filter(l => (l.quantity_remaining_mt ?? 0) <= 0);
              const selectedLot   = sulLots.find(l => l.receipt_id === e.sulSourceReceiptId);

              return (
                <>
                  {vendorLots.length === 0 ? (
                    <div className="field-hint" style={{ marginTop: 6, color: "var(--warn)" }}>
                      No receipts recorded for this vendor yet. Ask Lab to enter
                      the incoming inspection (RM QC) for this delivery first.
                    </div>
                  ) : (
                    <>
                      <label style={{ marginTop: 10 }}>Receipt Date</label>
                      <select value={e.sulSourceReceiptId}
                        onChange={ev => {
                          const lot = sulLots.find(l => l.receipt_id === ev.target.value);
                          updateEntry(e.key, {
                            sulSourceReceiptId: ev.target.value,
                            sulEmptyDate: lot?.received_date ?? "",
                          });
                        }}>
                        <option value="">-- Select receipt --</option>
                        {availableLots.map(l => (
                          <option key={l.receipt_id} value={l.receipt_id}>
                            {l.received_date} — {l.quantity_remaining_mt?.toFixed(3)} MT remaining
                            {l.has_null_ratio_cards ? " ⚠ estimate (ratio not set)" : ""}
                          </option>
                        ))}
                        {depletedLots.length > 0 && (
                          <optgroup label="— Depleted / over-allocated —">
                            {depletedLots.map(l => (
                              <option key={l.receipt_id} value={l.receipt_id} disabled>
                                {l.received_date} — {l.quantity_remaining_mt?.toFixed(3)} MT (depleted)
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>

                      {/* Stock display for selected lot */}
                      {selectedLot && (
                        <div style={{
                          marginTop: 8, padding: "8px 12px", borderRadius: 6, fontSize: 13,
                          background: (selectedLot.quantity_remaining_mt ?? 0) <= 0
                            ? "var(--warn-soft)"
                            : (selectedLot.quantity_remaining_mt ?? 0) < 5
                              ? "#fff8e1"
                              : "var(--ok-soft)",
                        }}>
                          <div>
                            <b>Received:</b> {selectedLot.quantity_received_mt?.toFixed(3)} MT
                            {" · "}
                            <b>Drawn (planned):</b> {selectedLot.total_planned_draw_mt.toFixed(3)} MT
                            {" · "}
                            <b style={{ color: (selectedLot.quantity_remaining_mt ?? 0) <= 0 ? "var(--warn)" : "var(--ok)" }}>
                              Remaining: {selectedLot.quantity_remaining_mt?.toFixed(3)} MT
                            </b>
                          </div>
                          {selectedLot.has_null_ratio_cards && (
                            <div style={{ marginTop: 4, color: "var(--warn)", fontSize: 12 }}>
                              ⚠ Some linked job cards have no sulphur_ratio set — remaining is an underestimate.
                            </div>
                          )}
                          {(selectedLot.quantity_remaining_mt ?? 0) <= 0 && (
                            <div style={{ marginTop: 4, color: "var(--warn)", fontWeight: 700 }}>
                              ⚠ This lot is depleted. Select a different receipt or ask Lab to record a new delivery.
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              );
            })()}

            <div className="row2" style={{ marginTop: 12 }}>
              <div>
                <label>Lot Number</label>
                <input type="text" value={e.sulLot}
                  onChange={ev => updateEntry(e.key, { sulLot: ev.target.value })} />
              </div>
              <div>
                <label>Date RM was received</label>
                <input type="date" value={e.sulEmptyDate}
                  onChange={ev => updateEntry(e.key, { sulEmptyDate: ev.target.value })} />
              </div>
            </div>

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
            {/* Oil Quantity input removed (29-09-26): oil required is
                auto-calculated from Planned Production × oil standard. */}
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
      )}
    </>
  );
}

// =============================================================================
// TriageQueue — rejected job cards awaiting Production's decision.
//
// When Lab marks a card NOT OK, the DB trigger sets it to 'pending_production'
// (migration 052/053). Production reviews the Lab remark here and decides:
//   • Stores issue   → route back to 'pending_stores' (Stores re-issues oil)
//   • Operator issue → route back to 'pending'        (Operator re-runs batch)
// From there the card flows normally back to Lab for final approval.
// =============================================================================

interface RejectInfo {
  remark: string | null;
  rejected_stage: string | null;
  reviewed_at: string;
}

function TriageQueue({ onCount, hidden }: {
  onCount?: (n: number) => void;
  hidden?: boolean;
}) {
  const { user } = useAuth();
  const { activeFactory } = useModule();
  const { showToast } = useToast();
  const supabase = createClient();

  const [cards, setCards]     = useState<PulveriserJobCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectInfo, setRejectInfo] = useState<Record<string, RejectInfo>>({});
  const [routingId, setRoutingId]   = useState<string | null>(null);

  // Report the live count up so the parent tab can show a badge.
  useEffect(() => { onCount?.(cards.length); }, [cards.length, onCount]);

  const load = useCallback(async () => {
    if (!activeFactory) { setCards([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("pulveriser_job_cards")
      .select("*")
      .eq("status", "pending_production")
      .eq("factory_id", activeFactory.id)
      .order("updated_at", { ascending: false });
    if (error) { showToast("Rejected cards load nahi hue: " + error.message, true); setLoading(false); return; }
    const rows = (data ?? []) as PulveriserJobCard[];
    setCards(rows);

    // Pull the latest NOT-OK review for each card (Lab remark + suggested stage).
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const { data: reviews } = await supabase
        .from("pulveriser_job_card_reviews")
        .select("job_card_id, result, remark, rejected_stage, reviewed_at")
        .in("job_card_id", ids)
        .eq("result", "not_ok")
        .order("reviewed_at", { ascending: false });
      const map: Record<string, RejectInfo> = {};
      for (const rv of (reviews ?? []) as {
        job_card_id: string; remark: string | null; rejected_stage: string | null; reviewed_at: string;
      }[]) {
        // First (most recent) wins because the query is ordered desc.
        if (!map[rv.job_card_id]) {
          map[rv.job_card_id] = {
            remark: rv.remark, rejected_stage: rv.rejected_stage, reviewed_at: rv.reviewed_at,
          };
        }
      }
      setRejectInfo(map);
    } else {
      setRejectInfo({});
    }
    setLoading(false);
  }, [supabase, activeFactory, showToast]);

  useEffect(() => { load(); }, [load]);

  // Route a rejected card onward. target:
  //   'pending_stores' = Stores issue (re-issue oil)
  //   'pending'        = Operator issue (operator re-runs)
  const route = async (jc: PulveriserJobCard, target: "pending_stores" | "pending") => {
    if (!user) { showToast("Session expired — sign in again.", true); return; }
    if (target === "pending" && jc.oil_issued_kg == null) {
      showToast("Operator ko bhejne se pehle oil issue hona zaroori hai. Stores ko bhejein.", true);
      return;
    }
    setRoutingId(jc.id);
    try {
      const { data, error } = await supabase
        .from("pulveriser_job_cards")
        .update({ status: target })
        .eq("id", jc.id)
        .eq("status", "pending_production")
        .select("id");
      if (error) { showToast("Route nahi hua: " + error.message, true); return; }
      if (!data || data.length === 0) {
        showToast("Save blocked — check your access or the card status.", true);
        return;
      }
      void notifyEvent({
        eventType: "pulveriser_production_triage",
        subject: `Rework routed: ${jc.job_number ?? jc.id} → ${target === "pending_stores" ? "Stores" : "Operator"}`,
        html: `<p>Production routed rejected job card <b>${jc.job_number ?? jc.id}</b> `
          + `(Party/CODE ${jc.party_code ?? "—"}) to `
          + `<b>${target === "pending_stores" ? "Stores (re-issue oil)" : "Operator (re-run batch)"}</b>.</p>`,
        factoryId: jc.factory_id,
        referenceId: jc.id,
        sheetData: {
          type: "job_card",
          row: {
            job_number: jc.job_number ?? jc.id,
            party_code: jc.party_code ?? null,
            status:     target,
          },
        },
      });
      showToast(
        target === "pending_stores"
          ? "Sent to Stores — they will re-issue oil / material."
          : "Sent to Operator — they will re-run the batch."
      );
      load();
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setRoutingId(null);
    }
  };

  // Stay mounted (so the count keeps reporting) but render nothing when the
  // parent is showing the New Job Card tab.
  if (hidden) return null;

  if (loading) {
    return (
      <div className="card">
        <h3>Rejected Job Cards</h3>
        <div className="empty">Loading…</div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="card">
        <h3>Rejected Job Cards</h3>
        <div className="empty">No rejected job cards right now. 🎉</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ borderColor: "var(--warn)" }}>
      <h3 style={{ color: "var(--warn)" }}>
        Rejected by Lab — decide where each batch goes ({cards.length})
      </h3>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        Lab marked these NOT OK. Review the reason, then send each card to Stores
        (oil / material issue) or Operator (re-run the batch). It goes back to Lab
        for final approval afterwards.
      </div>

      {groupByJobNumber(cards).map(group => (
        <div key={group.jobNumber ?? group.entries[0].id} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", margin: "4px 2px" }}>
            Job: {group.jobNumber ?? "—"}
            {group.entries.length > 1 && ` · ${group.entries.length} entries`}
          </div>
          {group.entries.map((jc, i) => {
            const info = rejectInfo[jc.id];
            const suggested = info?.rejected_stage;
            return (
              <div key={jc.id} style={{
                border: "1px solid var(--line)", borderRadius: 8,
                padding: 12, marginBottom: 10,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  Entry {i + 1} · {jc.machine_number ?? "—"} · Batch {jc.material_code ?? "—"}
                  {" · "}Party/CODE {jc.party_code ?? "—"}
                </div>

                {info?.remark && (
                  <div style={{
                    marginTop: 8, padding: "8px 12px", borderRadius: 6,
                    background: "var(--warn-soft)", fontSize: 13,
                  }}>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 2 }}>
                      Lab remark ({new Date(info.reviewed_at).toLocaleString("en-IN")}):
                    </div>
                    <div style={{ fontWeight: 600, color: "var(--warn)" }}>{info.remark}</div>
                  </div>
                )}

                {suggested && (
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>
                    Lab suggested: <b>{suggested === "production" ? "Production/Stores issue" : "Operator issue"}</b>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <button type="button" className="btn btn-secondary"
                    style={{ width: "auto", padding: "8px 16px", marginTop: 0 }}
                    disabled={routingId === jc.id}
                    onClick={() => route(jc, "pending_stores")}>
                    {routingId === jc.id ? "…" : "Send to Stores (oil / material issue)"}
                  </button>
                  <button type="button" className="btn btn-primary"
                    style={{ width: "auto", padding: "8px 16px", marginTop: 0 }}
                    disabled={routingId === jc.id || jc.oil_issued_kg == null}
                    title={jc.oil_issued_kg == null ? "Oil not issued yet — send to Stores first" : undefined}
                    onClick={() => route(jc, "pending")}>
                    {routingId === jc.id ? "…" : "Send to Operator (re-run batch)"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

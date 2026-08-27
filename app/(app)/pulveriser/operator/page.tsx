"use client";

// =============================================================================
// Pulveriser Job Card — Operator (Form JSCI/PROD/02)
//
// Operator sees 'pending' cards that Production has filled (material_code set),
// reads material_code as reference, and fills everything else:
//   classifier_vfd, blower_inlet_valve, blower_outlet_valve,
//   finished_goods_bag, packing_size, qc_incharge_note, stores_incharge_note,
//   work_details, checkpoints (3), + repeatable hourly readings.
//
// "Submit for QC" sets status='submitted_for_qc', operator_submitted_at=now().
// The button is disabled until required fields are present.
//
// After a Lab NOT-OK the card returns to 'pending', so it reappears here for
// correction and resubmission (rework loop).
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import {
  PULVERISER_LOW_PROD_REASONS,
  type PulveriserJobCard,
} from "@/lib/types";

interface HourlyRow {
  id: string;            // local row id (uuid from DB after save, or temp key)
  persistedId: string | null;
  machine: string;
  start_time: string;
  stop_time: string;
  planned_production: string;
  low_production_reason: string;
  batch_no: string;
  bags: string;
  reading_date: string;
}

function calcHours(start: string, stop: string): number {
  if (!start || !stop) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = stop.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

function blankRow(): HourlyRow {
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    persistedId: null,
    machine: "", start_time: "", stop_time: "",
    planned_production: "", low_production_reason: "",
    batch_no: "", bags: "", reading_date: new Date().toISOString().slice(0, 10),
  };
}

export default function PulveriserOperatorPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [pending, setPending]         = useState<PulveriserJobCard[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive]           = useState<PulveriserJobCard | null>(null);
  const [submitting, setSubmitting]   = useState(false);

  // Operator-owned fields
  const [classifierVfd, setClassifierVfd] = useState("");
  const [blowerIn, setBlowerIn]           = useState("");
  const [blowerOut, setBlowerOut]         = useState("");
  const [fgBag, setFgBag]                 = useState("");
  const [packingSize, setPackingSize]     = useState("");
  const [qcNote, setQcNote]               = useState("");
  const [storesNote, setStoresNote]       = useState("");
  const [workDetails, setWorkDetails]     = useState("");
  const [chkClean, setChkClean]           = useState(false);
  const [chkRoller, setChkRoller]         = useState(false);
  const [chkMesh, setChkMesh]             = useState(false);
  const [rows, setRows]                   = useState<HourlyRow[]>([blankRow()]);

  const loadPending = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await supabase
      .from("pulveriser_job_cards")
      .select("*")
      .eq("status", "pending")
      .not("material_code", "is", null)
      .order("created_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setPending((data ?? []) as PulveriserJobCard[]);
    setLoadingList(false);
  }, [supabase, showToast]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const openCard = async (jc: PulveriserJobCard) => {
    setActive(jc);
    // Pre-fill operator fields (may already hold values from a prior rework)
    setClassifierVfd(jc.classifier_vfd ?? "");
    setBlowerIn(jc.blower_inlet_valve ?? "");
    setBlowerOut(jc.blower_outlet_valve ?? "");
    setFgBag(jc.finished_goods_bag ?? "");
    setPackingSize(jc.packing_size ?? "");
    setQcNote(jc.qc_incharge_note ?? "");
    setStoresNote(jc.stores_incharge_note ?? "");
    setWorkDetails(jc.work_details ?? "");
    setChkClean(jc.checkpoint_machine_cleaning);
    setChkRoller(jc.checkpoint_roller_check);
    setChkMesh(jc.checkpoint_mesh_cloth_check);

    // Load any existing hourly readings (rework case)
    const { data } = await supabase
      .from("pulveriser_hourly_readings")
      .select("*")
      .eq("job_card_id", jc.id)
      .order("created_at");
    const existing = (data ?? []).map(r => ({
      id: r.id,
      persistedId: r.id as string,
      machine: r.machine ?? "",
      start_time: r.start_time ?? "",
      stop_time: r.stop_time ?? "",
      planned_production: r.planned_production?.toString() ?? "",
      low_production_reason: r.low_production_reason ?? "",
      batch_no: r.batch_no ?? "",
      bags: r.bags?.toString() ?? "",
      reading_date: r.reading_date ?? new Date().toISOString().slice(0, 10),
    })) as HourlyRow[];
    setRows(existing.length ? existing : [blankRow()]);
  };

  const goBack = () => { setActive(null); setRows([blankRow()]); };

  const updateRow = (id: string, field: keyof HourlyRow, val: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));
  };
  const addRow = () => setRows(prev => [...prev, blankRow()]);
  const removeRow = async (row: HourlyRow) => {
    if (rows.length === 1) { showToast("At least one hourly reading row.", true); return; }
    if (row.persistedId) {
      const { error } = await supabase
        .from("pulveriser_hourly_readings")
        .delete()
        .eq("id", row.persistedId);
      if (error) { showToast("Could not remove row: " + error.message, true); return; }
    }
    setRows(prev => prev.filter(r => r.id !== row.id));
  };

  // Submit is allowed once the core operator fields are present.
  const canSubmit =
    classifierVfd.trim() !== "" &&
    blowerIn.trim() !== "" &&
    blowerOut.trim() !== "" &&
    workDetails.trim() !== "";

  const persistOperatorFields = async (jcId: string, submit: boolean) => {
    const payload: Record<string, unknown> = {
      classifier_vfd:      classifierVfd.trim() || null,
      blower_inlet_valve:  blowerIn.trim() || null,
      blower_outlet_valve: blowerOut.trim() || null,
      finished_goods_bag:  fgBag.trim() || null,
      packing_size:        packingSize.trim() || null,
      qc_incharge_note:    qcNote.trim() || null,
      stores_incharge_note: storesNote.trim() || null,
      work_details:        workDetails.trim() || null,
      checkpoint_machine_cleaning: chkClean,
      checkpoint_roller_check:     chkRoller,
      checkpoint_mesh_cloth_check: chkMesh,
      operator_by:         user?.id ?? null,
    };
    if (submit) {
      payload.status = "submitted_for_qc";
      payload.operator_submitted_at = new Date().toISOString();
    }
    // .select() so an RLS-blocked / zero-row update surfaces instead of a
    // silent success (PostgREST returns 204 with no error otherwise).
    return supabase
      .from("pulveriser_job_cards")
      .update(payload)
      .eq("id", jcId)
      .select("id");
  };

  const syncHourlyRows = async (jc: PulveriserJobCard) => {
    for (const r of rows) {
      const hours = calcHours(r.start_time, r.stop_time);
      const body = {
        job_card_id:           jc.id,
        factory_id:            jc.factory_id,
        machine:               r.machine.trim() || jc.machine_number,
        start_time:            r.start_time || null,
        stop_time:             r.stop_time || null,
        total_hours:           hours > 0 ? hours : null,
        planned_production:    r.planned_production.trim() === "" ? null : Number(r.planned_production),
        low_production_reason: r.low_production_reason || null,
        batch_no:              r.batch_no.trim() || null,
        bags:                  r.bags.trim() === "" ? null : Number(r.bags),
        reading_date:          r.reading_date || null,
      };
      if (r.persistedId) {
        const { error } = await supabase
          .from("pulveriser_hourly_readings")
          .update(body)
          .eq("id", r.persistedId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("pulveriser_hourly_readings")
          .insert(body);
        if (error) throw error;
      }
    }
  };

  const handleSave = async (submit: boolean) => {
    if (!active || !user) return;
    if (submit && !canSubmit) {
      showToast("Fill Classifier VFD, both blower valves and work details before submitting.", true);
      return;
    }
    setSubmitting(true);
    try {
      // Save hourly rows first (they require the card to still be 'pending').
      await syncHourlyRows(active);
      const { data, error } = await persistOperatorFields(active.id, submit);
      if (error) { showToast("Could not save: " + error.message, true); return; }
      if (!data || data.length === 0) {
        showToast("Save was blocked — check your factory access or the card status.", true);
        return;
      }
      showToast(submit ? "Submitted for QC ✓" : "Progress saved ✓");
      goBack();
      loadPending();
    } catch (e: unknown) {
      showToast("Could not save: " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── List view ───────────────────────────────────────────────────────────
  if (!active) {
    return (
      <div className="card">
        <h3>Job cards to fill</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Production created these. Fill your details and submit for QC.
        </div>
        {loadingList ? (
          <div className="empty">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="empty">No pending job cards.</div>
        ) : (
          pending.map(jc => (
            <div className="pending-item" key={jc.id} onClick={() => openCard(jc)}>
              <div className="pi-top">
                <span>{jc.machine_number} · {jc.job_date ?? "—"}</span>
                <span>{jc.shift ?? "—"}</span>
              </div>
              <div className="pi-sub">
                Material: {jc.material_code} · Job: {jc.job_number ?? "—"}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  // ── Fill view ─────────────────────────────────────────────────────────────
  return (
    <>
      <button className="back-link" type="button" onClick={goBack}>← Back to list</button>

      {/* Read-only production reference */}
      <div className="readonly-block">
        <b>{active.machine_number}</b> · {active.job_date ?? "—"} · {active.shift ?? "—"} shift<br />
        <b>माल Code:</b> {active.material_code} · Job: {active.job_number ?? "—"}<br />
        <b>Sulphur:</b> {active.sulphur_supplier ?? "—"} / {active.sulphur_lot_number ?? "—"} / {active.sulphur_empty_date ?? "—"}<br />
        <b>Oil:</b> {active.oil_supplier ?? "—"} / {active.oil_batch_number ?? "—"} / {active.oil_quantity ?? "—"}
      </div>

      {/* Operator machine settings */}
      <div className="card">
        <h3>Machine settings</h3>
        <div className="row2">
          <div>
            <label>Classifier VFD *</label>
            <input type="text" value={classifierVfd} onChange={e => setClassifierVfd(e.target.value)} />
          </div>
          <div>
            <label>Blower Inlet Valve *</label>
            <input type="text" value={blowerIn} onChange={e => setBlowerIn(e.target.value)} />
          </div>
        </div>
        <label>Blower Outlet Valve *</label>
        <input type="text" value={blowerOut} onChange={e => setBlowerOut(e.target.value)} />
      </div>

      {/* Packing / notes */}
      <div className="card">
        <h3>Packing & notes</h3>
        <div className="row2">
          <div>
            <label>Finished Goods Bag</label>
            <input type="text" value={fgBag} onChange={e => setFgBag(e.target.value)} />
          </div>
          <div>
            <label>Packing Size</label>
            <input type="text" value={packingSize} onChange={e => setPackingSize(e.target.value)} />
          </div>
        </div>
        <div className="row2">
          <div>
            <label>QC Incharge Note</label>
            <input type="text" value={qcNote} onChange={e => setQcNote(e.target.value)} />
          </div>
          <div>
            <label>Stores Incharge Note</label>
            <input type="text" value={storesNote} onChange={e => setStoresNote(e.target.value)} />
          </div>
        </div>
        <label>Work Details *</label>
        <textarea rows={2} value={workDetails} onChange={e => setWorkDetails(e.target.value)} />
      </div>

      {/* Hourly readings (repeatable) */}
      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>Hourly Readings</h3>
          <span className="count">{rows.length}</span>
        </div>
        {rows.map((r, i) => {
          const hours = calcHours(r.start_time, r.stop_time);
          return (
            <div key={r.id} style={{
              border: "1px solid var(--line)", borderRadius: 8,
              padding: 14, marginBottom: 10, background: "var(--surface)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>Reading {i + 1}</span>
                {rows.length > 1 && (
                  <button type="button" className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "3px 10px", color: "var(--warn)" }}
                    onClick={() => removeRow(r)}>
                    Remove
                  </button>
                )}
              </div>

              <div className="row2">
                <div>
                  <label>Machine</label>
                  <input type="text" placeholder={active.machine_number ?? ""} value={r.machine}
                    onChange={e => updateRow(r.id, "machine", e.target.value)} />
                </div>
                <div>
                  <label>Reading Date</label>
                  <input type="date" value={r.reading_date}
                    onChange={e => updateRow(r.id, "reading_date", e.target.value)} />
                </div>
              </div>
              <div className="row3">
                <div>
                  <label>Start</label>
                  <input type="time" value={r.start_time}
                    onChange={e => updateRow(r.id, "start_time", e.target.value)} />
                </div>
                <div>
                  <label>Stop</label>
                  <input type="time" value={r.stop_time}
                    onChange={e => updateRow(r.id, "stop_time", e.target.value)} />
                </div>
                <div>
                  <label>Total Hours</label>
                  <input type="text" disabled value={hours > 0 ? hours.toFixed(2) : ""} placeholder="0.00" />
                </div>
              </div>
              <div className="row3">
                <div>
                  <label>Planned Production</label>
                  <input type="number" min="0" step="0.001" value={r.planned_production}
                    onChange={e => updateRow(r.id, "planned_production", e.target.value)} />
                </div>
                <div>
                  <label>Batch No.</label>
                  <input type="text" value={r.batch_no}
                    onChange={e => updateRow(r.id, "batch_no", e.target.value)} />
                </div>
                <div>
                  <label>Bags</label>
                  <input type="number" min="0" value={r.bags}
                    onChange={e => updateRow(r.id, "bags", e.target.value)} />
                </div>
              </div>
              <label>Low Production Reason (if any)</label>
              <select value={r.low_production_reason}
                onChange={e => updateRow(r.id, "low_production_reason", e.target.value)}>
                <option value="">— None / target met —</option>
                {PULVERISER_LOW_PROD_REASONS.map(reason => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </div>
          );
        })}
        <button type="button" className="btn btn-ghost" onClick={addRow}>
          + Add hourly reading
        </button>
      </div>

      {/* Checkpoints */}
      <div className="card">
        <h3>Checkpoints</h3>
        <div className="checkline">
          <input type="checkbox" checked={chkClean} onChange={e => setChkClean(e.target.checked)} />
          <span>Machine cleaning (मशीन की सफाई)</span>
        </div>
        <div className="checkline">
          <input type="checkbox" checked={chkRoller} onChange={e => setChkRoller(e.target.checked)} />
          <span>Roller check (रोलर की जाँच)</span>
        </div>
        <div className="checkline">
          <input type="checkbox" checked={chkMesh} onChange={e => setChkMesh(e.target.checked)} />
          <span>Mesh cloth check (जाली के कपड़े की जाँच)</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-ghost" type="button"
          disabled={submitting} onClick={() => handleSave(false)}>
          {submitting ? "Saving…" : "Save progress"}
        </button>
        <button className="btn btn-primary" type="button"
          disabled={submitting || !canSubmit} onClick={() => handleSave(true)}>
          {submitting ? "Submitting…" : "Submit for QC"}
        </button>
      </div>
    </>
  );
}

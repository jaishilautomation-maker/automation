"use client";

// =============================================================================
// Pulveriser Job Card — Lab review (Form JSCI/PROD/02)
//
// Lab reviews a 'submitted_for_qc' card (read-only view of ALL fields):
//   OK     → inserts review(result='ok');  DB trigger sets card 'finalized'.
//   NOT OK → inserts review(result='not_ok'); DB trigger sets card 'pending'
//            (rework). Optionally flag rejected_stage='production' to reopen
//            Production's fields instead of the default (operator).
//
// Every review is appended to pulveriser_job_card_reviews — full history is
// kept and shown if the card has been through rework before.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type {
  PulveriserJobCard,
  PulveriserHourlyReading,
  PulveriserJobCardReview,
} from "@/lib/types";

/** Read-only labelled field row. */
function F({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
      <b>{label}:</b> {value ?? "—"}
    </div>
  );
}

export default function PulveriserLabPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [pending, setPending]         = useState<PulveriserJobCard[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive]           = useState<PulveriserJobCard | null>(null);
  const [readings, setReadings]       = useState<PulveriserHourlyReading[]>([]);
  const [history, setHistory]         = useState<PulveriserJobCardReview[]>([]);
  const [remark, setRemark]           = useState("");
  const [reopenProduction, setReopenProduction] = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  const loadPending = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await supabase
      .from("pulveriser_job_cards")
      .select("*")
      .eq("status", "submitted_for_qc")
      .order("operator_submitted_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setPending((data ?? []) as PulveriserJobCard[]);
    setLoadingList(false);
  }, [supabase, showToast]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const openCard = async (jc: PulveriserJobCard) => {
    setActive(jc);
    setRemark("");
    setReopenProduction(false);
    const [{ data: rd }, { data: hist }] = await Promise.all([
      supabase.from("pulveriser_hourly_readings").select("*")
        .eq("job_card_id", jc.id).order("created_at"),
      supabase.from("pulveriser_job_card_reviews").select("*")
        .eq("job_card_id", jc.id).order("reviewed_at", { ascending: false }),
    ]);
    setReadings((rd ?? []) as PulveriserHourlyReading[]);
    setHistory((hist ?? []) as PulveriserJobCardReview[]);
  };

  const goBack = () => { setActive(null); setReadings([]); setHistory([]); };

  const submitReview = async (result: "ok" | "not_ok") => {
    if (!active || !user) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("pulveriser_job_card_reviews")
        .insert({
          job_card_id:    active.id,
          factory_id:     active.factory_id,
          reviewed_by:    user.id,
          result,
          remark:         remark.trim() || null,
          rejected_stage: result === "not_ok" ? (reopenProduction ? "production" : "operator") : null,
        })
        .select("id")
        .single();
      if (error) { showToast("Could not submit review: " + error.message, true); return; }
      if (!data) {
        showToast("Review was blocked — check your factory access or the card status.", true);
        return;
      }
      showToast(result === "ok"
        ? "Marked OK ✓ — job card finalized."
        : "Marked NOT OK — sent back for rework.");
      goBack();
      loadPending();
    } catch (e: unknown) {
      showToast("Could not submit: " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── List view ───────────────────────────────────────────────────────────
  if (!active) {
    return (
      <div className="card">
        <h3>Job cards awaiting QC review</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Operator has submitted these. Review and mark OK or NOT OK.
        </div>
        {loadingList ? (
          <div className="empty">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="empty">No job cards awaiting review.</div>
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

  // ── Review view (read-only) ───────────────────────────────────────────────
  return (
    <>
      <button className="back-link" type="button" onClick={goBack}>← Back to list</button>

      {history.length > 0 && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <h3>Review history ({history.length})</h3>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            This card has been through review before.
          </div>
          {history.map(h => (
            <div key={h.id} className="batch-block">
              <span className={`badge ${h.result === "ok" ? "ok" : "warn"}`}>
                {h.result === "ok" ? "OK" : "NOT OK"}
              </span>{" "}
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                {new Date(h.reviewed_at).toLocaleString()}
                {h.rejected_stage && ` · reopened: ${h.rejected_stage}`}
              </span>
              {h.remark && <div style={{ fontSize: 13, marginTop: 4 }}>{h.remark}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Production details</h3>
        <F label="Machine" value={active.machine_number} />
        <F label="Job Number" value={active.job_number} />
        <F label="Shift" value={active.shift} />
        <F label="Job Date" value={active.job_date} />
        <F label="माल Code" value={active.material_code} />
        <F label="Sulphur Supplier" value={active.sulphur_supplier} />
        <F label="Sulphur Lot" value={active.sulphur_lot_number} />
        <F label="Sulphur Empty Date" value={active.sulphur_empty_date} />
        <F label="Oil Supplier" value={active.oil_supplier} />
        <F label="Oil Batch" value={active.oil_batch_number} />
        <F label="Oil Quantity" value={active.oil_quantity} />
      </div>

      <div className="card">
        <h3>Operator details</h3>
        <F label="Classifier VFD" value={active.classifier_vfd} />
        <F label="Blower Inlet Valve" value={active.blower_inlet_valve} />
        <F label="Blower Outlet Valve" value={active.blower_outlet_valve} />
        <F label="Finished Goods Bag" value={active.finished_goods_bag} />
        <F label="Packing Size" value={active.packing_size} />
        <F label="QC Incharge Note" value={active.qc_incharge_note} />
        <F label="Stores Incharge Note" value={active.stores_incharge_note} />
        <F label="Work Details" value={active.work_details} />
        <F label="Machine Cleaning" value={active.checkpoint_machine_cleaning ? "✓" : "✗"} />
        <F label="Roller Check" value={active.checkpoint_roller_check ? "✓" : "✗"} />
        <F label="Mesh Cloth Check" value={active.checkpoint_mesh_cloth_check ? "✓" : "✗"} />
      </div>

      <div className="card">
        <h3>Hourly readings ({readings.length})</h3>
        {readings.length === 0 ? (
          <div className="empty">No readings recorded.</div>
        ) : (
          readings.map((r, i) => (
            <div className="batch-block" key={r.id}>
              <span className="batch-label">Reading {i + 1} · {r.reading_date ?? "—"}</span>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                {r.machine ?? "—"} · {r.start_time ?? "—"}–{r.stop_time ?? "—"} ·{" "}
                {r.total_hours ?? "—"} hrs · Planned {r.planned_production ?? "—"} ·{" "}
                Batch {r.batch_no ?? "—"} · {r.bags ?? "—"} bags
                {r.low_production_reason && (
                  <div style={{ color: "var(--warn)" }}>Low prod: {r.low_production_reason}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h3>QC decision</h3>
        <label>Remark (optional)</label>
        <textarea rows={2} value={remark} onChange={e => setRemark(e.target.value)} />
        <div className="checkline" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={reopenProduction}
            onChange={e => setReopenProduction(e.target.checked)} />
          <span>NOT OK is about Production&apos;s fields (reopen Production instead of Operator)</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" type="button"
          disabled={submitting} onClick={() => submitReview("ok")}>
          {submitting ? "…" : "OK — Finalize"}
        </button>
        <button className="btn btn-ghost" type="button"
          style={{ color: "var(--warn)" }}
          disabled={submitting} onClick={() => submitReview("not_ok")}>
          {submitting ? "…" : "NOT OK — Send back"}
        </button>
      </div>
    </>
  );
}

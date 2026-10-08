"use client";

// =============================================================================
// Pulveriser Job Card — Lab review (Form JSCI/PROD/02)
//
// Lab reviews a 'submitted_for_qc' card (read-only view of ALL fields):
//   OK     → inserts review(result='ok');  DB trigger sets card 'finalized'.
//   NOT OK → inserts review(result='not_ok'); DB trigger sets card
//            'pending_production' (migration 052/053). Production then triages
//            the reject and routes it to Stores or Operator, and it comes back
//            here for final approval. The rejected_stage flag ('production' vs
//            'operator') is a hint shown to Production to pre-select its route.
//
// Every review is appended to pulveriser_job_card_reviews — full history is
// kept and shown if the card has been through rework before.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { isoToDisplay } from "@/components/DateField";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import {
  groupByJobNumber,
  type PulveriserJobCard,
  type PulveriserHourlyReading,
  type PulveriserJobCardReview,
} from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { notifyReport } from "@/lib/reports/notify-report-client";
import { buildLabEmail } from "@/lib/notifications/pulveriser-emails";

/** Read-only labelled field row. */
function F({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
      <b>{label}:</b> {value ?? "—"}
    </div>
  );
}

export default function PulveriserLabPage() {
  const { user, profile } = useAuth();
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

      // Fire-and-forget email notification
      const nowISO = new Date().toISOString();
      const { subject, html } = buildLabEmail({
        jobNumber:      active.job_number,
        materialCode:   active.material_code,
        result,
        remark:         remark.trim() || null,
        reviewedByName: profile?.full_name ?? "—",
        reviewedAt:     nowISO,
      });
      void notifyEvent({
        eventType:   "pulveriser_lab",
        subject,
        html,
        factoryId:   active.factory_id,
        referenceId: active.id,
        sheetData: {
          type: "job_card",
          row: {
            job_number:  active.job_number ?? active.id,
            party_code:  active.party_code ?? null,
            status:      result === "ok" ? "finalized" : "pending_production",
            lab_result:  result,
            lab_remark:  remark.trim() || null,
            lab_by:      profile?.full_name ?? null,
            lab_at:      nowISO,
          },
        },
      });

      // On OK the card is finalized — generate + email the job-card Excel report
      // (automation@ + factory@). Fire-and-forget; NOT OK sends it to rework so
      // no report is issued.
      if (result === "ok") {
        void notifyReport({ source: "job_card", recordId: active.id });
      }

      showToast(result === "ok"
        ? "Marked OK ✓ — job card finalized."
        : "Marked NOT OK — sent to Production to decide the rework route.");
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
          groupByJobNumber(pending).map(group => (
            <div key={group.jobNumber ?? group.entries[0].id} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", margin: "4px 2px" }}>
                Job: {group.jobNumber ?? "—"}
                {group.entries.length > 1 && ` · ${group.entries.length} entries`}
              </div>
              {group.entries.map((jc, i) => (
                <div className="pending-item" key={jc.id} onClick={() => openCard(jc)}>
                  <div className="pi-top">
                    <span>Entry {i + 1} · {jc.machine_number} · {jc.job_date ?? "—"}</span>
                    <span>{jc.shift ?? "—"}</span>
                  </div>
                  <div className="pi-sub">
                    Batch: {jc.material_code} · Party/CODE: {jc.party_code ?? "—"}
                  </div>
                  {jc.operator_submitted_at && (
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4 }}>
                      ✅ Submitted for QC:{" "}
                      {new Date(jc.operator_submitted_at).toLocaleString("en-IN", {
                        day: "2-digit", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </div>
                  )}
                </div>
              ))}
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
        <F label="Batch Number" value={active.material_code} />
        <F label="Party / CODE" value={active.party_code} />
        <F label="Sulphur Supplier" value={active.sulphur_supplier} />
        <F label="Sulphur Lot" value={active.sulphur_lot_number} />
        <F label="Sulphur Empty Date" value={active.sulphur_empty_date} />
        <F label="Oil Supplier" value={active.oil_supplier} />
        <F label="Oil Received Date" value={active.oil_batch_number ? (isoToDisplay(active.oil_batch_number) || active.oil_batch_number) : null} />
        <F label="Oil Quantity" value={active.oil_quantity} />
        <F label="Planned Production (kg)" value={active.planned_production_mt != null ? active.planned_production_mt * 1000 : null} />
        <F label="Oil Required (kg)" value={active.oil_required_kg} />
        {(active.production_at || active.oil_issued_at || active.operator_submitted_at) && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 6 }}>
              Timeline
            </div>
            {active.production_at && (
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                📋 <b>Sent by Production:</b>{" "}
                {new Date(active.production_at).toLocaleString("en-IN", {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
            )}
            {active.oil_issued_at && (
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                🛢 <b>Oil issued by Stores:</b>{" "}
                {new Date(active.oil_issued_at).toLocaleString("en-IN", {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
            )}
            {active.operator_submitted_at && (
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                ✅ <b>Submitted for QC by Operator:</b>{" "}
                {new Date(active.operator_submitted_at).toLocaleString("en-IN", {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Stores &amp; oil consumption</h3>
        <F label="Oil Issued (kg)" value={active.oil_issued_kg} />
        <F label="Actual Production (kg)" value={active.actual_production_mt != null ? active.actual_production_mt * 1000 : null} />
        <F label="Expected Oil (kg)" value={active.expected_oil_kg} />
        <F label="Actual Oil Consumption (kg)" value={active.actual_oil_consumption_kg} />
        <F label="Oil Variance (kg)" value={active.oil_variance_kg} />
        <F label="Extra / Leftover Balance (kg)" value={active.oil_extra_leftover_balance_kg} />
        <F label="Oil Consumption %" value={
          active.oil_consumption_percent != null
            ? `${active.oil_consumption_percent.toFixed(2)}%`
            : null
        } />
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
                {r.machine ?? "—"} · reading {r.start_time ?? "—"}→{r.stop_time ?? "—"} ·{" "}
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
          <span>This looks like a Production / Stores issue (hint for Production&apos;s triage)</span>
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>
          NOT OK goes to Production first. They decide whether it&apos;s a Stores
          issue or an Operator issue and route the batch accordingly; it returns
          here for final approval.
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
          {submitting ? "…" : "NOT OK — Send to Production"}
        </button>
      </div>
    </>
  );
}

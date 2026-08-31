"use client";

// =============================================================================
// Pulveriser Job Card — Stores (Form JSCI/PROD/02 + oil-dosing addendum)
//
// New stage between Production and Operator. Stores sees 'pending_stores' cards
// (Production filled material_code + planned_production_mt, oil_required_kg is
// computed), issues the oil (oil_issued_kg), and advances the card to 'pending'
// so the Operator can run the batch. The batch cannot run before oil is issued.
//
// After a Lab NOT-OK the card returns to 'pending_stores' for a full rework, so
// it reappears here for re-issue.
//
// Stores owns exactly one field: oil_issued_kg (+ audit oil_issued_by/at).
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { groupByJobNumber, type PulveriserJobCard } from "@/lib/types";

export default function PulveriserStoresPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [pending, setPending]         = useState<PulveriserJobCard[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive]           = useState<PulveriserJobCard | null>(null);
  const [oilIssued, setOilIssued]     = useState("");
  const [submitting, setSubmitting]   = useState(false);

  const loadPending = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await supabase
      .from("pulveriser_job_cards")
      .select("*")
      .eq("status", "pending_stores")
      .not("material_code", "is", null)
      .order("created_at", { ascending: false });
    if (error) showToast("Load nahi hua: " + error.message, true);
    else setPending((data ?? []) as PulveriserJobCard[]);
    setLoadingList(false);
  }, [supabase, showToast]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const openCard = (jc: PulveriserJobCard) => {
    setActive(jc);
    setOilIssued(jc.oil_issued_kg?.toString() ?? "");
  };
  const goBack = () => { setActive(null); setOilIssued(""); };

  const canSubmit = oilIssued.trim() !== "" && Number.isFinite(Number(oilIssued));

  const handleIssue = async () => {
    if (!active || !user) return;
    if (!canSubmit) { showToast("Oil issued (kg) sahi bharein.", true); return; }
    setSubmitting(true);
    try {
      // .select() so an RLS-blocked / zero-row update surfaces instead of a
      // silent 204 success.
      const { data, error } = await supabase
        .from("pulveriser_job_cards")
        .update({
          oil_issued_kg: Number(oilIssued),
          oil_issued_by: user.id,
          oil_issued_at: new Date().toISOString(),
          status:        "pending",   // open for the Operator
        })
        .eq("id", active.id)
        .select("id");
      if (error) { showToast("Save nahi hua: " + error.message, true); return; }
      if (!data || data.length === 0) {
        showToast("Save blocked — factory access ya card status jaanchein.", true);
        return;
      }
      showToast("Oil issued ✓ — operator ab batch chala sakta hai.");
      goBack();
      loadPending();
    } catch (e: unknown) {
      showToast("Save nahi hua: " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── List view ───────────────────────────────────────────────────────────
  if (!active) {
    return (
      <div className="card">
        <h3>Oil issue karne ke liye job cards</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Production ne ye banaye hain. Required oil issue karein, phir operator batch chalayega.
        </div>
        {loadingList ? (
          <div className="empty">Load ho raha hai…</div>
        ) : pending.length === 0 ? (
          <div className="empty">Koi card oil issue ke liye pending nahi hai.</div>
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
                    Batch: {jc.material_code} · Party/CODE: {jc.party_code ?? "—"} · Oil required:{" "}
                    {jc.oil_required_kg != null ? `${jc.oil_required_kg} kg` : "NA"}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    );
  }

  // ── Issue view ────────────────────────────────────────────────────────────
  return (
    <>
      <button className="back-link" type="button" onClick={goBack}>← List par wapas</button>

      <div className="readonly-block">
        <b>{active.machine_number}</b> · {active.job_date ?? "—"} · {active.shift ?? "—"} shift<br />
        <b>Batch:</b> {active.material_code} · <b>Party/CODE:</b> {active.party_code ?? "—"} · Job: {active.job_number ?? "—"}<br />
        <b>Planned production:</b> {active.planned_production_mt ?? "—"} MT<br />
        <b>Oil required (auto):</b>{" "}
        {active.oil_required_kg != null ? `${active.oil_required_kg} kg` : "NA (no oil standard for this code)"}
      </div>

      <div className="card">
        <h3>Oil issue</h3>
        <label>Oil issued (kg) *</label>
        <input type="number" min="0" step="0.001" placeholder="0"
          value={oilIssued} onChange={e => setOilIssued(e.target.value)} />
        <div className="field-hint" style={{ marginTop: 6 }}>
          Issue karte hi card operator ke liye khul jaayega.
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !canSubmit} onClick={handleIssue}>
        {submitting ? "Save ho raha hai…" : "Issue oil & operator ko bhejein"}
      </button>
    </>
  );
}

"use client";

// =============================================================================
// PhaseWorkflowPanel - operator-side view of the Phase A -> chemist -> Phase B
// flow, shared by every job-card form that uses it.
//
// Shows: the current stage, the chemist's calculation (read-only), the
// LIMIT EXCEEDED alert with the mandatory operator remark, and the next-lot
// compensation note. Buttons that change status (Start Phase B, Close lot...)
// stay in the host form; this panel only needs `remarkSaved` to know when the
// remark exists.
// =============================================================================

import { useState } from "react";
import { fmtKg, fmtPct } from "@/lib/job-card/phase-b-calc";
import { statusColors, statusLabel } from "@/lib/job-card/phase-workflow";
import type { PhaseBSnapshot } from "@/lib/job-card/phase-b-review";

interface Props {
  jobCardId: string | null;
  status: string;
  snapshot: PhaseBSnapshot | null;
  limitCase: number | null;
  limitRemark: string;
  onRemarkSaved: (remark: string) => void;
  activeIngredient?: string;
  accent: string;
}

export default function PhaseWorkflowPanel({
  jobCardId, status, snapshot, limitCase, limitRemark, onRemarkSaved, activeIngredient = "Active", accent,
}: Props) {
  const [draftRemark, setDraftRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colors = statusColors(status);
  const o = snapshot?.outputs ?? null;
  const inp = snapshot?.inputs;
  const limited = status === "rejected_limit_exceeded";
  const comp = snapshot?.compensation;

  async function saveRemark() {
    const remark = draftRemark.trim();
    if (!remark) { setError("A remark is required before you can continue."); return; }
    if (!jobCardId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/job-card/phase-b", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remark", jobCardId, remark }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Could not save the remark."); return; }
      onRemarkSaved(remark);
    } catch {
      setError("Network error - try again.");
    } finally {
      setBusy(false);
    }
  }

  const stageText: Record<string, string> = {
    draft: "Fill Phase A, then submit it to the chemist. Phase B quantities are calculated by the chemist.",
    phase_a_submitted: "Waiting for the chemist to review Phase A. Phase B quantities will appear here once they save.",
    phase_b_ready: "The chemist has approved Phase A. Phase B quantities below are fixed. Start Phase B when ready.",
    phase_b_started: "Phase B is in progress. The quantities are locked.",
    rejected_limit_exceeded: "The chemist's calculation exceeded a limit. This lot is rejected.",
    submitted: "This job card is complete.",
  };

  return (
    <div className="card" style={{ borderLeft: `4px solid ${limited ? "#b71c1c" : accent}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Workflow status</span>
        <span style={{
          fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 12,
          background: colors.bg, color: colors.fg,
        }}>
          {statusLabel(status)}
        </span>
      </div>
      <div className="field-hint" style={{ marginBottom: 8 }}>{stageText[status] ?? ""}</div>

      {o && inp && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 6, fontSize: 13, margin: "8px 0" }}>
          <div>Phase A weight: <b>{fmtKg(inp.phaseAKg)} kg</b></div>
          <div>{activeIngredient} in Phase A: <b>{fmtPct(inp.concPct)} %</b>
            {inp.concSource === "manual" ? " (typed by chemist)" : " (QC record)"}</div>
          <div>Target active: <b>{fmtPct(inp.appliedTargetPct)} %</b></div>
          <div>{activeIngredient} (active): <b>{fmtKg(o.activeKg)} kg</b></div>
          <div>Target batch weight: <b>{fmtKg(o.targetWeight)} kg</b></div>
          <div>Phase B total: <b>{fmtKg(o.phaseBTotal)} kg</b></div>
        </div>
      )}

      {comp && inp && inp.compMode !== "none" && (
        <div className="field-hint" style={{ margin: "6px 0", color: "#1565c0" }}>
          Target adjusted to {fmtPct(inp.appliedTargetPct)} % to compensate the previous rejected lot{" "}
          <b>{comp.previousLot}</b>.
        </div>
      )}

      {limited && snapshot?.limit && (
        <div role="alert" style={{
          marginTop: 10, padding: "12px 14px", borderRadius: 8,
          background: "#fdecea", border: "1px solid #e57373", color: "#7f0000", fontSize: 13,
        }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>LIMIT EXCEEDED - lot rejected</div>
          <div style={{ marginBottom: 6 }}>{snapshot.limit.message}</div>
          {limitCase === 1 ? (
            <div>Target batch weight {fmtKg(o?.targetWeight)} kg is not above the Phase A weight {fmtKg(inp?.phaseAKg)} kg. No Phase B quantities are issued.</div>
          ) : (
            <div>
              Needed {fmtKg(o?.neededKg)} kg, available {fmtKg(o?.availableKg)} kg. Water is 0.
              Achieved active content: <b>{fmtPct(o?.achievedActivePct)} %</b>.
            </div>
          )}
          <div style={{ marginTop: 4 }}>Management has been notified by email.</div>

          <div style={{ marginTop: 10 }}>
            <label htmlFor="limit-remark" style={{ fontWeight: 700 }}>
              Operator remark (required to continue)
            </label>
            {limitRemark ? (
              <div style={{ marginTop: 4, padding: "6px 10px", background: "#fff", borderRadius: 6, color: "#222" }}>
                {limitRemark}
              </div>
            ) : (
              <>
                <textarea
                  id="limit-remark" rows={3} value={draftRemark}
                  onChange={e => setDraftRemark(e.target.value)}
                  aria-required="true" aria-invalid={!!error}
                  style={{ width: "100%", marginTop: 4 }}
                  placeholder="Why is this lot being continued / closed?"
                />
                {error && <div style={{ color: "#b71c1c", marginTop: 4 }}>{error}</div>}
                <button type="button" className="btn btn-primary" disabled={busy || !jobCardId}
                  style={{ marginTop: 8 }} onClick={saveRemark}>
                  {busy ? "Saving..." : "Save remark & notify management"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

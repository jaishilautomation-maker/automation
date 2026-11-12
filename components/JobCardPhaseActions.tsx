"use client";

// =============================================================================
// JobCardPhaseActions
//
// Renders the correct set of action buttons at the bottom of a production job
// card form based on the current workflow status:
//
//   draft / phase_a_rejected  → [Save Phase A] [Save as Draft] [Cancel]
//   phase_a_pending           → disabled "Pending Chemist – Phase A" indicator + [Cancel]
//   phase_a_approved          → [Save Phase B] [Cancel]
//     + for single-phase products that don't have a Phase B:
//       phase_a_approved      → [Mark Completed] [Cancel]
//   phase_b_pending           → disabled "Pending Chemist – Phase B" indicator + [Cancel]
//   phase_b_rejected          → [Save Phase B] [Cancel]
//   completed                 → read-only banner + [Close]
//   submitted (legacy)        → [Save Changes] for existing old records
//
// Props:
//   status        — current JobCardStatus
//   isEdit        — whether we are editing an existing card
//   submitting    — whether a save is in progress
//   isSinglePhase — K_GUM has no Phase B; skip the Phase B step
//   lang          — "en" | "hi"
//   accent        — hex color from the form
//   onSavePhaseA  — called when "Save Phase A" is clicked
//   onSaveDraft   — called when "Save as Draft" is clicked (only in Phase A stage)
//   onSavePhaseB  — called when "Save Phase B" is clicked
//   onCancel      — called when "Cancel" / "Close" is clicked
// =============================================================================

import { type JobCardStatus, canSubmitPhaseA, canSubmitPhaseB, isCompleted } from "@/lib/job-card-workflow";

interface Props {
  status: JobCardStatus;
  isEdit: boolean;
  submitting: boolean;
  isSinglePhase?: boolean;
  lang: "en" | "hi";
  accent: string;
  onSavePhaseA: () => void;
  onSaveDraft: () => void;
  onSavePhaseB: () => void;
  onCancel: () => void;
}

export default function JobCardPhaseActions({
  status,
  isEdit,
  submitting,
  isSinglePhase = false,
  lang,
  accent,
  onSavePhaseA,
  onSaveDraft,
  onSavePhaseB,
  onCancel,
}: Props) {
  const isHi = lang === "hi";

  const L = {
    savePhaseA:      isHi ? "फेज़ A सेव करें" : "Save Phase A",
    saveAsDraft:     isHi ? "ड्राफ्ट सेव करें" : "Save as Draft",
    savePhaseB:      isHi ? "फेज़ B सेव करें" : "Save Phase B",
    saveChanges:     isHi ? "बदलाव सेव करें" : "Save Changes",
    cancel:          isHi ? "रद्द करें" : "Cancel",
    close:           isHi ? "बंद करें" : "Close",
    saving:          isHi ? "सेव हो रहा है…" : "Saving…",
    pendingA:        isHi ? "⏳ केमिस्ट अनुमोदन प्रतीक्षित – फेज़ A" : "⏳ Pending Chemist Approval – Phase A",
    pendingB:        isHi ? "⏳ केमिस्ट अनुमोदन प्रतीक्षित – फेज़ B" : "⏳ Pending Chemist Approval – Phase B",
    completed:       isHi ? "✓ अंतिम अनुमोदित – केवल देखें" : "✓ Final Approved – Read Only",
    markCompleted:   isHi ? "पूर्ण के रूप में सेव करें" : "Submit for Final Approval",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "9px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700,
    background: accent, color: "#fff", border: "none",
    cursor: submitting ? "not-allowed" : "pointer",
    opacity: submitting ? 0.7 : 1,
  };
  const btnSecondary: React.CSSProperties = {
    padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
    background: "#fff8f3", color: accent, border: `1px solid ${accent}50`,
    cursor: submitting ? "not-allowed" : "pointer",
  };
  const btnGhost: React.CSSProperties = {
    padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
    background: "none", color: "var(--ink-soft)", border: "1px solid var(--line)",
    cursor: "pointer",
  };
  const pendingStyle: React.CSSProperties = {
    padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
    background: "#e3f2fd", color: "#1565c0", border: "1px solid #90caf9",
    cursor: "not-allowed",
  };

  // ── Completed ─────────────────────────────────────────────────────────────
  if (isCompleted(status)) {
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <span style={{ ...pendingStyle, background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7" }}>
          {L.completed}
        </span>
        <button type="button" onClick={onCancel} style={btnGhost}>{L.close}</button>
      </div>
    );
  }

  // ── Phase A pending ───────────────────────────────────────────────────────
  if (status === "phase_a_pending") {
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <span style={pendingStyle}>{L.pendingA}</span>
        <button type="button" onClick={onCancel} style={btnGhost}>{L.cancel}</button>
      </div>
    );
  }

  // ── Phase B pending ───────────────────────────────────────────────────────
  if (status === "phase_b_pending") {
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <span style={pendingStyle}>{L.pendingB}</span>
        <button type="button" onClick={onCancel} style={btnGhost}>{L.cancel}</button>
      </div>
    );
  }

  // ── Legacy submitted ──────────────────────────────────────────────────────
  if (status === "submitted" && isEdit) {
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <button type="button" disabled={submitting} onClick={onSavePhaseA} style={btnPrimary}>
          {submitting ? L.saving : L.saveChanges}
        </button>
        <button type="button" onClick={onCancel} style={btnGhost}>{L.cancel}</button>
      </div>
    );
  }

  // ── Phase A stage (draft or phase_a_rejected) ────────────────────────────
  if (canSubmitPhaseA(status)) {
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <button type="button" disabled={submitting} onClick={onSavePhaseA} style={btnPrimary}>
          {submitting ? L.saving : L.savePhaseA}
        </button>
        {!isEdit && (
          <button type="button" disabled={submitting} onClick={onSaveDraft} style={btnSecondary}>
            {submitting ? L.saving : L.saveAsDraft}
          </button>
        )}
        <button type="button" onClick={onCancel} style={btnGhost}>{L.cancel}</button>
      </div>
    );
  }

  // ── Phase B stage (phase_a_approved or phase_b_rejected) ─────────────────
  if (canSubmitPhaseB(status)) {
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <button type="button" disabled={submitting} onClick={onSavePhaseB} style={btnPrimary}>
          {submitting ? L.saving : isSinglePhase ? L.markCompleted : L.savePhaseB}
        </button>
        <button type="button" onClick={onCancel} style={btnGhost}>{L.cancel}</button>
      </div>
    );
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
      <button type="button" disabled={submitting} onClick={onSavePhaseA} style={btnPrimary}>
        {submitting ? L.saving : L.saveChanges}
      </button>
      <button type="button" onClick={onCancel} style={btnGhost}>{L.cancel}</button>
    </div>
  );
}

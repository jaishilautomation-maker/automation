"use client";

// Action bar for job-card forms that use the Phase A -> chemist -> Phase B flow.
// The host form owns saving; `onSave(status)` moves to that status, `onSave(null)`
// saves in place. The database trigger enforces which moves are legal.

interface Props {
  isEdit: boolean;
  isLegacy: boolean;
  status: string;
  limitCase: number | null;
  limitRemark: string;
  submitting: boolean;
  hindi?: boolean;
  labels: { saving: string; saveChanges: string; saveAsDraft: string; submitJobCard: string; cancel: string };
  onSave: (status: string | null) => void;
  onCancel: () => void;
}

export default function PhaseWorkflowActions({
  isEdit, isLegacy, status, limitCase, limitRemark, submitting, hindi, labels, onSave, onCancel,
}: Props) {
  const remarkMissing = !limitRemark.trim();
  const remarkHint = remarkMissing ? (hindi ? "पहले रिमार्क दर्ज करके सेव करें" : "Enter and save the remark first") : undefined;
  const busy = (label: string) => (submitting ? labels.saving : label);

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
      {isLegacy && (
        <button className="btn btn-primary" type="button" disabled={submitting} onClick={() => onSave(null)}>
          {busy(labels.saveChanges)}
        </button>
      )}

      {!isLegacy && (!isEdit || status === "draft") && (
        <>
          <button className="btn btn-primary" type="button" disabled={submitting} onClick={() => onSave("phase_a_submitted")}>
            {busy(hindi ? "फेज़ A केमिस्ट को भेजें" : "Submit Phase A to Chemist")}
          </button>
          <button className="btn btn-secondary" type="button" disabled={submitting} onClick={() => onSave("draft")}>
            {labels.saveAsDraft}
          </button>
        </>
      )}

      {isEdit && !isLegacy && ["phase_a_submitted", "phase_b_ready", "phase_b_started", "submitted"].includes(status) && (
        <button className="btn btn-secondary" type="button" disabled={submitting} onClick={() => onSave(null)}>
          {busy(labels.saveChanges)}
        </button>
      )}

      {isEdit && status === "phase_b_ready" && (
        <button className="btn btn-primary" type="button" disabled={submitting} onClick={() => onSave("phase_b_started")}>
          {hindi ? "फेज़ B शुरू करें (मात्रा लॉक)" : "Start Phase B (locks quantities)"}
        </button>
      )}

      {isEdit && status === "rejected_limit_exceeded" && (
        <>
          {limitCase === 2 && (
            <button className="btn btn-primary" type="button" disabled={submitting || remarkMissing}
              title={remarkHint} onClick={() => onSave("phase_b_started")}>
              Continue to Phase B (water = 0)
            </button>
          )}
          <button className="btn btn-secondary" type="button" disabled={submitting || remarkMissing}
            title={remarkHint} onClick={() => onSave("submitted")}>
            Close rejected lot
          </button>
        </>
      )}

      {isEdit && status === "phase_b_started" && (
        <button className="btn btn-primary" type="button" disabled={submitting} onClick={() => onSave("submitted")}>
          {labels.submitJobCard}
        </button>
      )}

      <button className="btn btn-ghost" type="button" disabled={submitting} onClick={onCancel}>{labels.cancel}</button>
    </div>
  );
}

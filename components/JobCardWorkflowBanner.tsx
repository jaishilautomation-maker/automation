"use client";

// =============================================================================
// JobCardWorkflowBanner
//
// Displays the current Phase A / Phase B approval status prominently at the
// top of every production job card form.  Shows:
//   • Current workflow stage
//   • Chemist rejection remarks (Phase A or Phase B) when applicable
//   • A clear indication of what the operator should do next
//
// This component is purely informational — action buttons are in the form itself.
// =============================================================================

import {
  type JobCardStatus,
  STATUS_LABEL_EN,
  STATUS_LABEL_HI,
  statusBadgeStyle,
} from "@/lib/job-card-workflow";

interface Props {
  status: JobCardStatus;
  chemistRemarksA?: string | null;
  chemistRemarksB?: string | null;
  lang: "en" | "hi";
}

export default function JobCardWorkflowBanner({
  status,
  chemistRemarksA,
  chemistRemarksB,
  lang,
}: Props) {
  const isHi    = lang === "hi";
  const label   = isHi ? STATUS_LABEL_HI[status] : STATUS_LABEL_EN[status];
  const badge   = statusBadgeStyle(status);

  const showRemarksA = status === "phase_a_rejected" && chemistRemarksA;
  const showRemarksB = status === "phase_b_rejected" && chemistRemarksB;

  return (
    <div style={{
      borderRadius: 10,
      border: `1.5px solid ${badge.color}40`,
      background: badge.background,
      padding: "12px 16px",
      marginBottom: 16,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      {/* Status row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px",
          color: "var(--ink-soft)", textTransform: "uppercase" }}>
          {isHi ? "स्थिति" : "Status"}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: badge.color,
          padding: "3px 12px",
          borderRadius: 12,
          background: badge.color + "18",
          border: `1px solid ${badge.color}40`,
        }}>
          {label}
        </span>
      </div>

      {/* Phase A rejection remarks */}
      {showRemarksA && (
        <div style={{
          background: "#fff",
          border: "1px solid #e57373",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 13,
        }}>
          <span style={{ fontWeight: 700, color: "#c62828" }}>
            {isHi ? "केमिस्ट टिप्पणी (फेज़ A):" : "Chemist Remarks (Phase A):"}
          </span>
          <p style={{ margin: "4px 0 0", color: "#333" }}>{chemistRemarksA}</p>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#c62828", fontWeight: 600 }}>
            {isHi
              ? "कृपया फेज़ A सही करें और पुनः सबमिट करें।"
              : "Please correct Phase A and resubmit for approval."}
          </p>
        </div>
      )}

      {/* Phase B rejection remarks */}
      {showRemarksB && (
        <div style={{
          background: "#fff",
          border: "1px solid #e57373",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 13,
        }}>
          <span style={{ fontWeight: 700, color: "#c62828" }}>
            {isHi ? "केमिस्ट टिप्पणी (फेज़ B):" : "Chemist Remarks (Phase B):"}
          </span>
          <p style={{ margin: "4px 0 0", color: "#333" }}>{chemistRemarksB}</p>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#c62828", fontWeight: 600 }}>
            {isHi
              ? "कृपया फेज़ B सही करें और पुनः सबमिट करें।"
              : "Please correct Phase B and resubmit for approval."}
          </p>
        </div>
      )}

      {/* Pending hints */}
      {(status === "phase_a_pending" || status === "phase_b_pending") && (
        <p style={{ margin: 0, fontSize: 12, color: "#1565c0", fontWeight: 600 }}>
          {isHi
            ? "केमिस्ट की समीक्षा प्रतीक्षित है। इस समय संपादन उपलब्ध नहीं है।"
            : "Awaiting chemist review. Editing is not available at this time."}
        </p>
      )}

      {/* Phase A approved — prompt to start Phase B */}
      {status === "phase_a_approved" && (
        <p style={{ margin: 0, fontSize: 12, color: "#2e7d32", fontWeight: 600 }}>
          {isHi
            ? "✓ फेज़ A अनुमोदित। अब फेज़ B भरें और सबमिट करें।"
            : "✓ Phase A approved. You can now complete Phase B and submit it for review."}
        </p>
      )}

      {/* Completed */}
      {status === "completed" && (
        <p style={{ margin: 0, fontSize: 12, color: "#1b5e20", fontWeight: 600 }}>
          {isHi
            ? "✓ जॉब कार्ड पूर्ण। दोनों फेज़ अनुमोदित।"
            : "✓ Job card fully approved and completed. No further edits are permitted."}
        </p>
      )}
    </div>
  );
}

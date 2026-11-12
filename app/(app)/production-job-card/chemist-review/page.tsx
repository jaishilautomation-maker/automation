"use client";

// =============================================================================
// Chemist Review Page — /production-job-card/chemist-review
//
// A-20 only.  Accessible to: chemist, lab_manager, factory_admin, company_admin.
//
// Shows all production job cards that are awaiting chemist review
// (status = 'phase_a_pending' or 'phase_b_pending') plus a full history table.
//
// Chemist actions:
//   Approve Phase A → sets status = 'phase_a_approved'
//   Reject  Phase A → sets status = 'phase_a_rejected' + stores remarks
//   Approve Phase B → sets status = 'completed'
//   Reject  Phase B → sets status = 'phase_b_rejected' + stores remarks
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import {
  type JobCardStatus,
  statusBadgeStyle,
  awaitingChemist,
} from "@/lib/job-card-workflow";
import { statusLabel, CALC_FLOW_PRODUCT_CODES } from "@/lib/job-card/phase-workflow";
import type { ProductionJobCard } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExtCard = ProductionJobCard & {
  operator_name: string | null;
  products: { name: string; code: string } | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtTs(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

const thS: React.CSSProperties = {
  padding: "7px 12px", textAlign: "left", fontWeight: 600,
  color: "var(--ink-soft)", whiteSpace: "nowrap", fontSize: 12,
  borderBottom: "2px solid var(--line)",
};
const tdS: React.CSSProperties = { padding: "7px 12px", fontSize: 13 };

const PRODUCT_TITLES: Record<string, string> = {
  SULPHUR_SC_UPL: "Sulphur SC UPL",
  SULPHUR_SC:     "Sulphur SC 55.16%",
  NUTRIZIN:       "Nutrizin (ZnO 39.5%)",
  INSTACAL:       "InstaCal 160",
  K_GUM:          "Kelzan Plus 1.4%",
  INSTABORE:      "InstaBor 150",
};

// ---------------------------------------------------------------------------
// ApprovalDialog — inline approval / rejection form
// ---------------------------------------------------------------------------

interface ApprovalDialogProps {
  card: ExtCard;
  phase: "A" | "B";
  accent: string;
  onDecision: (cardId: string, decision: "approve" | "reject", remarks: string) => Promise<void>;
  onCancel: () => void;
}

function ApprovalDialog({ card, phase, accent, onDecision, onCancel }: ApprovalDialogProps) {
  const [remarks, setRemarks] = useState("");
  const [action, setAction]   = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy]       = useState(false);

  async function submit() {
    if (!action) return;
    if (action === "reject" && !remarks.trim()) {
      alert("Please enter rejection remarks before rejecting.");
      return;
    }
    setBusy(true);
    await onDecision(card.id, action, remarks.trim());
    setBusy(false);
  }

  const productTitle = PRODUCT_TITLES[card.products?.code ?? ""] ?? card.products?.name ?? "—";

  return (
    <div style={{
      background: "#fff",
      border: `2px solid ${accent}`,
      borderRadius: 12,
      padding: "20px 24px",
      marginBottom: 16,
      boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
    }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: accent }}>
        Review Phase {phase}: {productTitle}
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 16 }}>
        Lot {card.lot_no} · {fmtDate(card.job_date)} · {card.batch_size_kg} kg
        {card.operator_name ? ` · Operator: ${card.operator_name}` : ""}
      </div>

      {/* Decision buttons */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button type="button"
          onClick={() => setAction("approve")}
          style={{
            padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            border: action === "approve" ? "2px solid #2e7d32" : "1.5px solid var(--line)",
            background: action === "approve" ? "#e8f5e9" : "#fff",
            color: action === "approve" ? "#2e7d32" : "var(--ink)",
            cursor: "pointer",
          }}>
          ✓ Approve Phase {phase}
        </button>
        <button type="button"
          onClick={() => setAction("reject")}
          style={{
            padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            border: action === "reject" ? "2px solid #c62828" : "1.5px solid var(--line)",
            background: action === "reject" ? "#fce4ec" : "#fff",
            color: action === "reject" ? "#c62828" : "var(--ink)",
            cursor: "pointer",
          }}>
          ✗ Reject Phase {phase}
        </button>
      </div>

      {/* Remarks */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
          Remarks / Notes
          {action === "reject" && <span style={{ color: "#c62828" }}> *</span>}
        </label>
        <textarea
          rows={3}
          placeholder={action === "reject"
            ? "Enter rejection reason (required)…"
            : "Optional inspection notes for Phase " + phase + "…"}
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          style={{ width: "100%", resize: "vertical", fontSize: 13, padding: "8px 10px",
            borderRadius: 8, border: "1px solid var(--line)",
            borderColor: action === "reject" && !remarks.trim() ? "#e57373" : undefined }}
        />
      </div>

      {/* Submit / Cancel */}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button"
          disabled={!action || busy}
          onClick={submit}
          style={{
            padding: "8px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            background: action === "approve" ? "#2e7d32" : action === "reject" ? "#c62828" : "#ccc",
            color: "#fff", border: "none",
            cursor: (!action || busy) ? "not-allowed" : "pointer",
            opacity: (!action || busy) ? 0.7 : 1,
          }}>
          {busy ? "Saving…" : "Confirm Decision"}
        </button>
        <button type="button" onClick={onCancel}
          style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13,
            border: "1px solid var(--line)", background: "none", cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ChemistReviewPage() {
  const { user, profile } = useAuth();
  const { activeFactory } = useModule();
  const supabase          = createClient();
  const { showToast }     = useToast();

  const [pending, setPending]   = useState<ExtCard[]>([]);
  const [history, setHistory]   = useState<ExtCard[]>([]);
  // Sulphur SC / Zinc SC cards waiting for the Phase B calculation (separate review page)
  const [calcPending, setCalcPending] = useState<ExtCard[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeCard, setActiveCard] = useState<ExtCard | null>(null);

  // Role gate — this page is for chemist / lab_manager / admins
  const role = profile?.role;
  const canReview = role === "chemist" || role === "lab_manager"
    || role === "factory_admin" || role === "company_admin";

  const load = useCallback(async () => {
    if (!activeFactory) return;
    setLoading(true);
    const { data } = await supabase
      .from("production_job_cards")
      .select("*, products(name, code)")
      .eq("factory_id", activeFactory.id)
      .order("updated_at", { ascending: false })
      .limit(200);

    const all = (data ?? []) as ExtCard[];
    const isCalcWaiting = (c: ExtCard) =>
      c.status === "phase_a_submitted" && CALC_FLOW_PRODUCT_CODES.includes(c.products?.code ?? "");
    setPending(all.filter(c => awaitingChemist(c.status as JobCardStatus)));
    setCalcPending(all.filter(isCalcWaiting));
    setHistory(all.filter(c => !awaitingChemist(c.status as JobCardStatus)
      && !isCalcWaiting(c)
      && c.status !== "draft"));
    setLoading(false);
  }, [supabase, activeFactory]);

  useEffect(() => { load(); }, [load]);

  // ── Handle approval / rejection ──────────────────────────────────────────
  async function handleDecision(
    cardId: string,
    decision: "approve" | "reject",
    remarks: string,
  ) {
    if (!user) return;
    const card = pending.find(c => c.id === cardId);
    if (!card) return;

    const isPhaseA = card.status === "phase_a_pending";
    let newStatus: JobCardStatus;
    if (isPhaseA) {
      newStatus = decision === "approve" ? "phase_a_approved" : "phase_a_rejected";
    } else {
      newStatus = decision === "approve" ? "completed" : "phase_b_rejected";
    }

    const patch: Record<string, unknown> = {
      status: newStatus,
    };
    if (isPhaseA) {
      patch.chemist_remarks_phase_a = remarks || null;
      patch.approved_by_phase_a     = user.id;
      patch.phase_a_reviewed_at     = new Date().toISOString();
    } else {
      patch.chemist_remarks_phase_b = remarks || null;
      patch.approved_by_phase_b     = user.id;
      patch.phase_b_reviewed_at     = new Date().toISOString();
    }

    const { error } = await supabase
      .from("production_job_cards")
      .update(patch)
      .eq("id", cardId);

    if (error) {
      showToast("Could not save decision: " + error.message, true);
      return;
    }

    const phaseLabel = isPhaseA ? "Phase A" : "Phase B";
    showToast(decision === "approve"
      ? `${phaseLabel} approved ✓`
      : `${phaseLabel} rejected — operator notified`);
    setActiveCard(null);
    load();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!canReview) {
    return (
      <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--ink-soft)" }}>
        <p style={{ fontSize: 15 }}>You do not have permission to access this page.</p>
      </div>
    );
  }

  function renderCard(c: ExtCard) {
    const isActive  = activeCard?.id === c.id;
    const status    = c.status as JobCardStatus;
    const badge     = statusBadgeStyle(status);
    const isPhaseA  = status === "phase_a_pending";
    const phase     = isPhaseA ? "A" : "B";
    const color     = "#1565c0";
    const title     = PRODUCT_TITLES[c.products?.code ?? ""] ?? c.products?.name ?? "—";

    return (
      <div key={c.id} style={{ marginBottom: 12 }}>
        {isActive ? (
          <ApprovalDialog
            card={c}
            phase={phase as "A" | "B"}
            accent={color}
            onDecision={handleDecision}
            onCancel={() => setActiveCard(null)}
          />
        ) : (
          <div style={{
            display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
            padding: "12px 16px", borderRadius: 10,
            background: "#f8f9ff",
            border: "1.5px solid #e3e8ff",
          }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                Lot {c.lot_no} · {fmtDate(c.job_date)} · {c.batch_size_kg} kg
                {c.operator_name ? ` · ${c.operator_name}` : ""}
              </div>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10,
              background: badge.background, color: badge.color,
              border: `1px solid ${badge.color}30`,
            }}>
              {statusLabel(status)}
            </span>
            <button type="button"
              onClick={() => setActiveCard(c)}
              style={{
                padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: color, color: "#fff", border: "none", cursor: "pointer",
              }}>
              Review Phase {phase}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0 40px" }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800 }}>
          Chemist Review — Production Job Cards
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>
          {activeFactory?.name ?? "A-20"} · Review and approve or reject submitted Phase A and Phase B.
        </p>
      </div>

      {/* ── Phase B calculation (Sulphur SC / Zinc SC) ──────────────────── */}
      {calcPending.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid #1565c0" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>
            ⚗️ Phase A review &amp; Phase B calculation
            <span style={{
              marginLeft: 8, fontSize: 12, fontWeight: 700,
              background: "#e3f2fd", color: "#1565c0", padding: "2px 8px", borderRadius: 10,
            }}>{calcPending.length}</span>
          </h3>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            Sulphur SC and Zinc SC: confirm the Phase A concentration and save. Phase B quantities are calculated and sent back to the operator.
          </div>
          {calcPending.map(c => (
            <div key={c.id} style={{
              display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
              padding: "10px 14px", marginBottom: 8, borderRadius: 10,
              background: "#f8f9ff", border: "1.5px solid #e3e8ff",
            }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {PRODUCT_TITLES[c.products?.code ?? ""] ?? c.products?.name ?? "—"}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                  Lot {c.lot_no} · {fmtDate(c.job_date)} · {c.batch_size_kg} kg
                  {c.operator_name ? ` · ${c.operator_name}` : ""}
                </div>
              </div>
              <Link href={`/lab-qc/phase-a-review?card=${c.id}`}
                style={{
                  padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: "#1565c0", color: "#fff", textDecoration: "none",
                }}>
                Review &amp; calculate
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* ── Pending review ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>
          ⏳ Awaiting Review
          {!loading && pending.length > 0 && (
            <span style={{
              marginLeft: 8, fontSize: 12, fontWeight: 700,
              background: "#e3f2fd", color: "#1565c0",
              padding: "2px 8px", borderRadius: 10,
            }}>
              {pending.length}
            </span>
          )}
        </h3>

        {loading ? (
          <div className="field-hint">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="field-hint">No job cards awaiting review.</div>
        ) : (
          pending.map(renderCard)
        )}
      </div>

      {/* ── Reviewed history ─────────────────────────────────────────────── */}
      <div className="card">
        <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>📋 Review History</h3>

        {loading ? (
          <div className="field-hint">Loading…</div>
        ) : history.length === 0 ? (
          <div className="field-hint">No reviewed records yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thS}>Product</th>
                  <th style={thS}>Lot No</th>
                  <th style={thS}>Date</th>
                  <th style={thS}>Batch (kg)</th>
                  <th style={thS}>Operator</th>
                  <th style={thS}>Status</th>
                  <th style={thS}>Phase A Reviewed</th>
                  <th style={thS}>Phase B Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c, i) => {
                  const status = c.status as JobCardStatus;
                  const badge  = statusBadgeStyle(status);
                  return (
                    <tr key={c.id}
                      style={{ background: i % 2 === 0 ? "#fafafa" : "#fff",
                               borderBottom: "1px solid var(--line)" }}>
                      <td style={tdS}>
                        {PRODUCT_TITLES[c.products?.code ?? ""] ?? c.products?.name ?? "—"}
                      </td>
                      <td style={{ ...tdS, fontWeight: 700 }}>{c.lot_no}</td>
                      <td style={tdS}>{fmtDate(c.job_date)}</td>
                      <td style={tdS}>{c.batch_size_kg}</td>
                      <td style={tdS}>{c.operator_name ?? "—"}</td>
                      <td style={tdS}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 8px",
                          borderRadius: 10, background: badge.background, color: badge.color,
                          border: `1px solid ${badge.color}30`,
                          whiteSpace: "nowrap",
                        }}>
                          {statusLabel(status)}
                        </span>
                      </td>
                      <td style={tdS}>{fmtTs(c.phase_a_reviewed_at)}</td>
                      <td style={tdS}>{fmtTs(c.phase_b_reviewed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

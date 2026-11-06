"use client";

// =============================================================================
// Lab QC - Phase A Review (job cards with a Phase B)
//
// The chemist opens a job card the operator has submitted, checks the Phase A
// concentration (fetched from Product QC by lot, or typed), and SAVES. The
// server calculates the Phase B quantities (lib/job-card/phase-b-review.ts) and
// sends the card back to the operator. Saving again recalculates, until the
// operator starts Phase B.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import NumericInput from "@/components/NumericInput";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import { fmtKg, fmtPct } from "@/lib/job-card/phase-b-calc";
import { statusColors, statusLabel } from "@/lib/job-card/phase-workflow";
import type { PhaseBSnapshot, CompMode } from "@/lib/job-card/phase-b-review";

interface CardListRow {
  id: string;
  lot_no: string;
  status: string;
  batch_size_kg: number;
  collected_slurry_phase_a_kg: number | null;
  created_at: string;
  lot_rejected: boolean;
  products: { code: string; name: string } | null;
}

interface Preview {
  productName: string;
  productCode: string;
  config: { active_ingredient: string; qc_phase_a_test_key: string; default_target_pct: number | null };
  lot: string;
  status: string;
  qc: { recordId: string; batchNo: string | null; testDate: string | null; concPct: number | null; testKey: string } | null;
  snapshot: PhaseBSnapshot;
  canSave: boolean;
  blockers: string[];
}

const REVIEW_STATUSES = ["phase_a_submitted", "phase_b_ready", "rejected_limit_exceeded"];

export default function PhaseAReviewPage() {
  const { user } = useAuth();
  const { activeFactory } = useModule();
  const { showToast } = useToast();
  const supabase = createClient();

  const [cards, setCards] = useState<CardListRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // chemist inputs (undefined = let the server default them)
  const [concSource, setConcSource] = useState<"qc_record" | "manual">("qc_record");
  const [manualConc, setManualConc] = useState("");
  const [target, setTarget] = useState("");
  const [compMode, setCompMode] = useState<CompMode>("suggested");
  const [overrideTarget, setOverrideTarget] = useState("");
  const seededFor = useRef<string | null>(null);

  // ---- list ---------------------------------------------------------------
  const loadList = useCallback(async () => {
    if (!activeFactory) return;
    setLoadingList(true);
    const { data: cfg } = await supabase.from("job_card_phase_config")
      .select("job_card_product_code").eq("is_active", true);
    const codes = new Set((cfg ?? []).map(c => c.job_card_product_code as string));
    const { data } = await supabase.from("production_job_cards")
      .select("id, lot_no, status, batch_size_kg, collected_slurry_phase_a_kg, created_at, lot_rejected, products(code, name)")
      .eq("factory_id", activeFactory.id).in("status", REVIEW_STATUSES)
      .order("created_at", { ascending: false }).limit(100);
    const rows = ((data ?? []) as unknown as CardListRow[]).filter(r => r.products && codes.has(r.products.code));
    setCards(rows);
    setLoadingList(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFactory]);

  useEffect(() => { loadList(); }, [loadList]);

  // deep link: /lab-qc/phase-a-review?card=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("card");
    if (id) setSelectedId(id);
  }, []);

  // ---- API ----------------------------------------------------------------
  const buildBody = useCallback((action: "preview" | "save") => ({
    action,
    jobCardId: selectedId,
    concSource,
    concPct: concSource === "manual" && manualConc !== "" ? parseFloat(manualConc) : null,
    targetPct: target !== "" ? parseFloat(target) : null,
    compMode,
    overrideTargetPct: compMode === "override" && overrideTarget !== "" ? parseFloat(overrideTarget) : null,
  }), [selectedId, concSource, manualConc, target, compMode, overrideTarget]);

  const runPreview = useCallback(async () => {
    if (!selectedId) return;
    setPreviewing(true);
    try {
      const res = await fetch("/api/job-card/phase-b", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody("preview")),
      });
      const json = await res.json();
      if (!res.ok) { setApiError(json.error ?? "Could not calculate."); setPreview(null); return; }
      setApiError(null);
      setPreview(json as Preview);
    } catch {
      setApiError("Network error - try again.");
    } finally {
      setPreviewing(false);
    }
  }, [selectedId, buildBody]);

  // Reset inputs when a different card is opened.
  useEffect(() => {
    seededFor.current = null;
    setPreview(null); setApiError(null);
    setConcSource("qc_record"); setManualConc(""); setTarget("");
    setCompMode("suggested"); setOverrideTarget("");
  }, [selectedId]);

  // Seed inputs from the first server response (saved values / config default).
  useEffect(() => {
    if (!preview || seededFor.current === selectedId) return;
    seededFor.current = selectedId;
    const inp = preview.snapshot.inputs;
    setTarget(inp.targetPctBase != null ? String(inp.targetPctBase) : "");
    setConcSource(inp.concSource);
    if (inp.concSource === "manual" && inp.concPct != null) setManualConc(String(inp.concPct));
    setCompMode(inp.compMode === "none" ? "suggested" : inp.compMode);
    if (inp.compMode === "override" && inp.appliedTargetPct != null) setOverrideTarget(String(inp.appliedTargetPct));
  }, [preview, selectedId]);

  // Debounced live preview on any input change.
  useEffect(() => {
    if (!selectedId) return;
    const h = setTimeout(runPreview, 350);
    return () => clearTimeout(h);
  }, [selectedId, runPreview]);

  async function save() {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/job-card/phase-b", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody("save")),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? "Save failed.", true); return; }
      if (json.status === "rejected_limit_exceeded") {
        showToast(
          json.email && !json.email.configured
            ? "LIMIT EXCEEDED - lot rejected. No management recipients are configured, default mailbox notified."
            : "LIMIT EXCEEDED - lot rejected. Management notified.",
          true,
        );
      } else {
        showToast("Phase A saved - Phase B quantities sent to the operator ✓");
      }
      await loadList();
      await runPreview();
    } catch {
      showToast("Network error - try again.", true);
    } finally {
      setSaving(false);
    }
  }

  // ---- render -------------------------------------------------------------
  const snap = preview?.snapshot ?? null;
  const out = snap?.outputs ?? null;
  const comp = snap?.compensation ?? null;
  const qc = preview?.qc ?? null;
  const ing = preview?.config.active_ingredient ?? "Active";
  const qcHasValue = qc?.concPct != null;

  return (
    <div className="module-wrap">
      <div className="module-header">
        <div className="title">🧪 Phase A Review</div>
        <div className="sub">
          {activeFactory?.name} · Review the operator&apos;s Phase A and calculate Phase B
        </div>
      </div>

      <Link href="/lab-qc" className="back-link">← Lab QC</Link>

      {/* ---- pending list ------------------------------------------------- */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Job cards to review</h3>
        {loadingList ? (
          <div className="empty">Loading...</div>
        ) : cards.length === 0 ? (
          <div className="field-hint">No job cards are waiting for Phase A review.</div>
        ) : (
          <div role="list">
            {cards.map(c => {
              const col = statusColors(c.status);
              const active = c.id === selectedId;
              return (
                <button key={c.id} type="button" role="listitem" onClick={() => setSelectedId(c.id)}
                  aria-current={active}
                  style={{
                    display: "flex", width: "100%", gap: 12, alignItems: "center", textAlign: "left",
                    padding: "8px 12px", marginBottom: 6, borderRadius: 8, cursor: "pointer",
                    border: active ? "2px solid var(--clay)" : "1px solid var(--line)", background: "#fff",
                  }}>
                  <b style={{ minWidth: 110 }}>{c.lot_no}</b>
                  <span style={{ flex: 1 }}>{c.products?.name}</span>
                  <span style={{ fontSize: 12 }}>Phase A {fmtKg(c.collected_slurry_phase_a_kg)} kg</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: col.bg, color: col.fg }}>
                    {statusLabel(c.status)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {apiError && (
        <div className="card" role="alert" style={{ borderLeft: "4px solid #b71c1c", color: "#7f0000" }}>{apiError}</div>
      )}

      {/* ---- review ------------------------------------------------------- */}
      {preview && snap && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>
              {preview.productName} · Lot {preview.lot}
              <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                background: statusColors(preview.status).bg, color: statusColors(preview.status).fg }}>
                {statusLabel(preview.status)}
              </span>
            </h3>

            <div className="row2">
              <div>
                <label>Phase A weight (kg), from the operator</label>
                <input type="text" readOnly value={fmtKg(snap.inputs.phaseAKg)}
                  style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
              </div>
              <div>
                <label htmlFor="target-pct">Target active content (%)</label>
                <NumericInput id="target-pct" allowDecimal value={target}
                  onChange={e => setTarget(e.target.value)} />
                <div className="field-hint">
                  Default {fmtPct(preview.config.default_target_pct)} % for this product. Only the chemist can change it.
                </div>
              </div>
            </div>

            {/* Phase A concentration */}
            <div style={{ marginTop: 12 }}>
              <label>{ing} content in Phase A (%)</label>
              {qcHasValue ? (
                <div className="field-hint" style={{ color: "var(--ok)", marginBottom: 6 }}>
                  Phase A QC result found for this lot: <b>{fmtPct(qc!.concPct, 4)} %</b>
                  {qc!.batchNo ? ` · batch ${qc!.batchNo}` : ""}{qc!.testDate ? ` · tested ${qc!.testDate}` : ""}
                </div>
              ) : (
                <div className="field-hint" style={{ color: "var(--warn)", marginBottom: 6 }}>
                  {qc
                    ? `A Phase A QC record exists for this lot but has no ${preview.config.qc_phase_a_test_key} value.`
                    : "No Phase A QC record was found for this lot."}{" "}
                  Type the measured concentration below.
                </div>
              )}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                {qcHasValue && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" name="conc-src" checked={concSource === "qc_record"}
                      onChange={() => setConcSource("qc_record")} /> Use QC value
                  </label>
                )}
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="radio" name="conc-src" checked={concSource === "manual" || !qcHasValue}
                    onChange={() => setConcSource("manual")} /> {qcHasValue ? "Type a value" : "Measured value"}
                </label>
                {(concSource === "manual" || !qcHasValue) && (
                  <NumericInput allowDecimal aria-label={`${ing} content in Phase A, percent`}
                    value={manualConc} placeholder="e.g. 65"
                    onChange={e => { setConcSource("manual"); setManualConc(e.target.value); }}
                    style={{ width: 140 }} />
                )}
              </div>
            </div>
          </div>

          {/* Next-lot compensation */}
          {comp && (
            <div className="card" style={{ borderLeft: "4px solid #1565c0" }}>
              <h3 style={{ marginTop: 0 }}>Compensation for previous lot</h3>
              <div className="field-hint" style={{ marginBottom: 6 }}>
                The previous lot of this product was rejected (limit exceeded):{" "}
                <Link href={`/lab-qc/phase-a-review?card=${comp.previousCardId}`}
                  onClick={() => setSelectedId(comp.previousCardId)}
                  style={{ fontWeight: 700 }}>
                  {comp.previousLot}
                </Link>{" "}
                (produced {fmtKg(comp.previousProducedKg)} kg at {fmtPct(comp.previousAchievedPct)} %).
                Setting this lot&apos;s target higher lets the two lots blend to the desired {fmtPct(snap.inputs.targetPctBase)} %.
                Applies to this lot only.
              </div>
              {comp.result.suggestedTargetPct != null ? (
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  Suggested target: <b>{fmtPct(comp.result.suggestedTargetPct)} %</b>{" "}
                  · lot weight {fmtKg(comp.result.lot2WeightKg)} kg · blend total {fmtKg(comp.result.blendTotalKg)} kg ·
                  max achievable {fmtPct(comp.result.maxAchievablePct)} %
                </div>
              ) : null}
              {!comp.result.feasible && (
                <div role="alert" style={{ color: "#b71c1c", fontWeight: 700, marginBottom: 6 }}>
                  Cannot be compensated in one lot. {comp.result.message}
                </div>
              )}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                {([
                  ["suggested", "Accept suggested target"],
                  ["override", "Override target"],
                  ["none", "Don't compensate"],
                ] as [CompMode, string][]).map(([v, label]) => (
                  <label key={v} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" name="comp-mode" checked={compMode === v} onChange={() => setCompMode(v)} /> {label}
                  </label>
                ))}
                {compMode === "override" && (
                  <NumericInput allowDecimal aria-label="Override target percent" value={overrideTarget}
                    onChange={e => setOverrideTarget(e.target.value)} style={{ width: 120 }} placeholder="%" />
                )}
              </div>
            </div>
          )}

          {/* Result */}
          <div className="card">
            <h3 style={{ marginTop: 0 }}>
              Phase B calculation {previewing && <span className="field-hint">updating...</span>}
            </h3>

            {preview.blockers.length > 0 && (
              <ul style={{ color: "var(--warn)", fontSize: 13, paddingLeft: 18 }}>
                {preview.blockers.map(b => <li key={b}>{b}</li>)}
              </ul>
            )}

            {out && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 6, fontSize: 13 }}>
                  <div>Applied target: <b>{fmtPct(snap.inputs.appliedTargetPct)} %</b></div>
                  <div>{ing} (active): <b>{fmtKg(out.activeKg)} kg</b></div>
                  <div>Target batch weight: <b>{fmtKg(out.targetWeight)} kg</b></div>
                  <div>Phase B total: <b>{fmtKg(out.phaseBTotal)} kg</b></div>
                  {out.achievedActivePct != null && <div>Achieved active: <b>{fmtPct(out.achievedActivePct)} %</b></div>}
                </div>

                {snap.limit && (
                  <div role="alert" style={{ marginTop: 10, padding: "10px 14px", borderRadius: 8, background: "#fdecea",
                    border: "1px solid #e57373", color: "#7f0000", fontSize: 13 }}>
                    <b>LIMIT EXCEEDED (Case {snap.limit.case})</b>
                    <div>{snap.limit.message}</div>
                    {snap.limit.case === 2 && (
                      <div>
                        Needed {fmtKg(out.neededKg)} kg, available {fmtKg(out.availableKg)} kg.
                        Achieved active content {fmtPct(out.achievedActivePct)} %.
                      </div>
                    )}
                    <div>Saving will mark this lot as rejected and email management.</div>
                  </div>
                )}

                {snap.limit?.case !== 1 && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--line)", textAlign: "left" }}>
                        <th style={{ padding: "6px 8px" }}>Phase B ingredient</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>% of final batch</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Quantity (kg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {out.ingredients.map(r => (
                        <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                          <td style={{ padding: "5px 8px" }}>{r.name}{r.isWater ? " (balance)" : ""}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right" }}>
                            {r.isWater ? "—" : fmtPct(r.formulationPct, 3)}
                          </td>
                          <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>{fmtKg(r.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" onClick={save}
                disabled={saving || previewing || !preview.canSave || !user}>
                {saving ? "Saving..." : "Save Phase A review"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setSelectedId(null)}>Close</button>
            </div>
            <div className="field-hint" style={{ marginTop: 6 }}>
              Saving sends the card back to the operator. You can save again to recalculate until the operator starts Phase B.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

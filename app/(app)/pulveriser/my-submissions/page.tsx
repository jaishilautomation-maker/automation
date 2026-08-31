"use client";

// =============================================================================
// Production — My Submissions
//
// One page, a source dropdown across the three things Production files at
// A-20/1:
//   • Job Card    → pulveriser_job_cards (+ review trail)
//   • Breakdown   → breakdown_register
//   • Preventive  → pm_completions (joined to pm_schedule_items)
//
// Factory-scoped via useModule().activeFactory (same pattern as the other
// production pages). RLS still enforces access server-side.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import type {
  PulveriserJobCard,
  PulveriserJobCardReview,
  PulveriserStatus,
} from "@/lib/types";

type Source = "job_card" | "breakdown" | "preventive";

const SOURCE_LABEL: Record<Source, string> = {
  job_card: "Pulveriser Job Card",
  breakdown: "Breakdown Register",
  preventive: "Preventive Maintenance",
};

const JC_STATUS_LABEL: Record<PulveriserStatus, string> = {
  pending_stores: "Awaiting Stores (oil issue)",
  pending: "Pending",
  submitted_for_qc: "Submitted for QC",
  finalized: "Finalized",
};
const JC_STATUS_BADGE: Record<PulveriserStatus, string> = {
  pending_stores: "warn",
  pending: "warn",
  submitted_for_qc: "warn",
  finalized: "ok",
};

interface BreakdownRow {
  id: string;
  sr_no: number | null;
  machine_name: string;
  start_at: string;
  finish_at: string | null;
  nature_of_breakdown: string | null;
  created_at: string;
}

interface PmCompletionRow {
  id: string;
  completed_at: string;
  notes: string | null;
  pm_schedule_items: { machine: string; component: string; task: string } | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default function MySubmissionsPage() {
  const { activeFactory } = useModule();
  const { showToast } = useToast();
  const supabase = createClient();

  const [source, setSource] = useState<Source>("job_card");
  const [loading, setLoading] = useState(true);

  const [jobCards, setJobCards] = useState<PulveriserJobCard[]>([]);
  const [jcReviews, setJcReviews] = useState<Record<string, PulveriserJobCardReview[]>>({});
  const [breakdowns, setBreakdowns] = useState<BreakdownRow[]>([]);
  const [pmDone, setPmDone] = useState<PmCompletionRow[]>([]);

  const load = useCallback(async () => {
    if (!activeFactory) return;
    setLoading(true);
    try {
      if (source === "job_card") {
        const { data, error } = await supabase
          .from("pulveriser_job_cards")
          .select("*")
          .eq("factory_id", activeFactory.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const list = (data ?? []) as PulveriserJobCard[];
        setJobCards(list);
        if (list.length) {
          const { data: rev } = await supabase
            .from("pulveriser_job_card_reviews")
            .select("*")
            .in("job_card_id", list.map(c => c.id))
            .order("reviewed_at", { ascending: false });
          const grouped: Record<string, PulveriserJobCardReview[]> = {};
          for (const r of (rev ?? []) as PulveriserJobCardReview[]) {
            (grouped[r.job_card_id] ??= []).push(r);
          }
          setJcReviews(grouped);
        } else {
          setJcReviews({});
        }
      } else if (source === "breakdown") {
        const { data, error } = await supabase
          .from("breakdown_register")
          .select("id, sr_no, machine_name, start_at, finish_at, nature_of_breakdown, created_at")
          .eq("factory_id", activeFactory.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        setBreakdowns((data ?? []) as BreakdownRow[]);
      } else {
        // preventive — completions joined to their schedule item for context
        const { data, error } = await supabase
          .from("pm_completions")
          .select("id, completed_at, notes, pm_schedule_items(machine, component, task)")
          .order("completed_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        setPmDone((data ?? []) as unknown as PmCompletionRow[]);
      }
    } catch (e: unknown) {
      showToast("Could not load: " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setLoading(false);
    }
  }, [source, activeFactory, supabase, showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>My Submissions</h3>
            <div className="field-hint">{activeFactory?.name ?? "—"}</div>
          </div>
          <select
            value={source}
            onChange={e => setSource(e.target.value as Source)}
            style={{ fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--line)" }}
          >
            {(Object.keys(SOURCE_LABEL) as Source[]).map(s => (
              <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>{SOURCE_LABEL[source]}</h3>
          <span className="count">
            {source === "job_card" ? jobCards.length : source === "breakdown" ? breakdowns.length : pmDone.length}
          </span>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : source === "job_card" ? (
          jobCards.length === 0 ? (
            <div className="empty">No job cards yet.</div>
          ) : (
            jobCards.map(jc => {
              const trail = jcReviews[jc.id] ?? [];
              return (
                <div className="batch-block" key={jc.id}>
                  <span className="batch-label">
                    {jc.job_date ?? "—"} · {jc.machine_number} · {jc.shift ?? "—"}
                  </span>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    Material: <b>{jc.material_code ?? "—"}</b> · Party/CODE: {jc.party_code ?? "—"} · Job: {jc.job_number ?? "—"}
                    <br />
                    Status:{" "}
                    <span className={`badge ${JC_STATUS_BADGE[jc.status]}`}>
                      {JC_STATUS_LABEL[jc.status]}
                    </span>
                  </div>
                  {trail.length > 0 && (
                    <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid var(--line)" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                        Review trail ({trail.length})
                      </div>
                      {trail.map(r => (
                        <div key={r.id} style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 4 }}>
                          <span className={`badge ${r.result === "ok" ? "ok" : "warn"}`}>
                            {r.result === "ok" ? "OK" : "NOT OK"}
                          </span>{" "}
                          {fmtDate(r.reviewed_at)}
                          {r.rejected_stage && ` · reopened: ${r.rejected_stage}`}
                          {r.remark && <div style={{ marginLeft: 4 }}>&ldquo;{r.remark}&rdquo;</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : source === "breakdown" ? (
          breakdowns.length === 0 ? (
            <div className="empty">No breakdown entries yet.</div>
          ) : (
            breakdowns.map(b => (
              <div className="batch-block" key={b.id}>
                <span className="batch-label">
                  SR {b.sr_no ?? "—"} · {b.machine_name} · {fmtDate(b.start_at)}
                </span>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  {b.nature_of_breakdown ?? "—"}
                  <br />
                  Status:{" "}
                  <span className={`badge ${b.finish_at ? "ok" : "warn"}`}>
                    {b.finish_at ? "Resolved" : "Ongoing"}
                  </span>
                </div>
              </div>
            ))
          )
        ) : pmDone.length === 0 ? (
          <div className="empty">No maintenance completions yet.</div>
        ) : (
          pmDone.map(c => (
            <div className="batch-block" key={c.id}>
              <span className="batch-label">
                {fmtDate(c.completed_at)} · {c.pm_schedule_items?.machine ?? "—"}
              </span>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <b>{c.pm_schedule_items?.component ?? "—"}</b> — {c.pm_schedule_items?.task ?? "—"}
                {c.notes && <div style={{ color: "var(--ink-soft)" }}>{c.notes}</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

"use client";

// =============================================================================
// Pulveriser Job Card — Records / history (Form JSCI/PROD/02)
//
// Shows every job card at the current factory with its current status and the
// full review trail (every OK / NOT OK round, not just the latest).
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import {
  groupByJobNumber,
  type PulveriserJobCard,
  type PulveriserJobCardReview,
  type PulveriserStatus,
} from "@/lib/types";

// A card filled by an operator in the last 24h, enriched for the handover view.
interface RecentReadingLite {
  machine: string | null;
  start_time: string | null;
  stop_time: string | null;
  total_hours: number | null;
}
interface RecentFilledCard {
  card: PulveriserJobCard;
  operatorName: string | null;
  readings: RecentReadingLite[];
}

const STATUS_BADGE: Record<PulveriserStatus, string> = {
  pending_stores: "warn",
  pending_production: "warn",
  pending: "warn",
  submitted_for_qc: "warn",
  finalized: "ok",
};

// English / Hindi label sets. Operators see Hindi; everyone else English.
const STATUS_LABEL_EN: Record<PulveriserStatus, string> = {
  pending_stores: "Awaiting Stores (oil issue)",
  pending_production: "Rejected — Production triage",
  pending: "Pending",
  submitted_for_qc: "Submitted for QC",
  finalized: "Finalized",
};
const STATUS_LABEL_HI: Record<PulveriserStatus, string> = {
  pending_stores: "स्टोर्स की प्रतीक्षा (तेल जारी)",
  pending_production: "अस्वीकृत — प्रोडक्शन निर्णय",
  pending: "लंबित",
  submitted_for_qc: "QC के लिए भेजा गया",
  finalized: "अंतिम रूप दिया गया",
};

export default function PulveriserRecordsPage() {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const supabase = createClient();

  const hi = profile?.role === "operator";
  const t = {
    heading:   hi ? "पल्वराइज़र जॉब कार्ड रिकॉर्ड्स" : "Pulveriser job card records",
    loading:   hi ? "लोड हो रहा है…" : "Loading…",
    empty:     hi ? "अभी कोई जॉब कार्ड नहीं है।" : "No job cards yet.",
    material:  hi ? "बैच नंबर" : "Batch",
    job:       hi ? "जॉब" : "Job",
    status:    hi ? "स्थिति" : "Status",
    trail:     hi ? "समीक्षा इतिहास" : "Review trail",
    ok:        hi ? "ठीक है" : "OK",
    notOk:     hi ? "ठीक नहीं" : "NOT OK",
    reopened:  hi ? "फिर से खोला" : "reopened",
  };
  const STATUS_LABEL = hi ? STATUS_LABEL_HI : STATUS_LABEL_EN;

  const [cards, setCards]   = useState<PulveriserJobCard[]>([]);
  const [reviews, setReviews] = useState<Record<string, PulveriserJobCardReview[]>>({});
  const [loading, setLoading] = useState(true);

  // ── Shift-handover: cards an operator filled/submitted in the last 24h ──────
  // Lets the next (e.g. night) shift see how much the previous operator
  // produced on each job, plus who filled it and their Taas readings.
  const [recent, setRecent] = useState<RecentFilledCard[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: cardData, error } = await supabase
      .from("pulveriser_job_cards")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { showToast((hi ? "लोड नहीं हो सका: " : "Could not load: ") + error.message, true); setLoading(false); return; }

    const list = (cardData ?? []) as PulveriserJobCard[];
    setCards(list);

    if (list.length) {
      const { data: revData } = await supabase
        .from("pulveriser_job_card_reviews")
        .select("*")
        .in("job_card_id", list.map(c => c.id))
        .order("reviewed_at", { ascending: false });
      const grouped: Record<string, PulveriserJobCardReview[]> = {};
      for (const r of (revData ?? []) as PulveriserJobCardReview[]) {
        (grouped[r.job_card_id] ??= []).push(r);
      }
      setReviews(grouped);
    } else {
      setReviews({});
    }

    // Build the last-24h handover list from the cards already loaded.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentCards = list.filter(
      c => c.operator_submitted_at != null && new Date(c.operator_submitted_at).getTime() >= cutoff,
    );
    if (recentCards.length) {
      // Resolve operator names (RPC scoped server-side to the caller's factory).
      const operatorIds = Array.from(
        new Set(recentCards.map(c => c.operator_by).filter((v): v is string => !!v)),
      );
      const nameMap: Record<string, string> = {};
      if (operatorIds.length) {
        const { data: names } = await supabase.rpc("fn_operator_names", { p_ids: operatorIds });
        for (const n of (names ?? []) as { id: string; full_name: string | null }[]) {
          if (n.full_name) nameMap[n.id] = n.full_name;
        }
      }
      // Readings for these cards, grouped by card id.
      const { data: readingRows } = await supabase
        .from("pulveriser_hourly_readings")
        .select("job_card_id, machine, start_time, stop_time, total_hours")
        .in("job_card_id", recentCards.map(c => c.id))
        .order("created_at");
      const readingsByCard: Record<string, RecentReadingLite[]> = {};
      for (const r of (readingRows ?? []) as (RecentReadingLite & { job_card_id: string })[]) {
        (readingsByCard[r.job_card_id] ??= []).push({
          machine: r.machine, start_time: r.start_time, stop_time: r.stop_time, total_hours: r.total_hours,
        });
      }
      setRecent(recentCards.map(c => ({
        card: c,
        operatorName: c.operator_by ? (nameMap[c.operator_by] ?? null) : null,
        readings: readingsByCard[c.id] ?? [],
      })));
    } else {
      setRecent([]);
    }
    setLoading(false);
  }, [supabase, showToast, hi]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
    {/* Shift handover — cards filled by an operator in the last 24 hours */}
    {recent.length > 0 && (
      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>
            {hi ? "पिछले 24 घंटे में भरा गया" : "Filled in the last 24 hours"}
          </h3>
          <span className="count">{recent.length}</span>
        </div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          {hi
            ? "पिछली शिफ्ट के ऑपरेटर ने क्या भरा — कितना उत्पादन हुआ — यहाँ देखें।"
            : "What the previous shift's operator filled — how much was produced — for handover."}
        </div>
        {recent.map(({ card: c, operatorName, readings }) => {
          const actualKgVal = c.actual_production_mt != null ? Math.round(c.actual_production_mt * 1000) : null;
          const plannedKgVal = c.planned_production_mt != null ? Math.round(c.planned_production_mt * 1000) : null;
          return (
            <div key={c.id} style={{
              border: "1px solid var(--line)", borderRadius: 8,
              padding: 12, marginBottom: 10, background: "var(--surface, #fff)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>
                  {t.job}: {c.job_number ?? "—"} · {t.material} {c.material_code ?? "—"}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  {c.shift ?? "—"} {hi ? "शिफ्ट" : "shift"}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <b>{hi ? "उत्पादन" : "Production"}:</b>{" "}
                <span style={{ fontWeight: 700, color: "var(--clay)" }}>
                  {actualKgVal != null ? `${actualKgVal} kg` : "—"}
                </span>
                {plannedKgVal != null && <> / {hi ? "नियोजित" : "planned"} {plannedKgVal} kg</>}
                {" · "}<b>{hi ? "बैग" : "Bags"}:</b> {c.finished_goods_bag ?? "—"}
                {c.packing_size ? ` × ${c.packing_size}kg` : ""}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                <b>{hi ? "ऑपरेटर" : "Operator"}:</b> {operatorName ?? "—"}
                {c.operator_submitted_at && (
                  <> · {new Date(c.operator_submitted_at).toLocaleString("en-IN", {
                    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                  })}</>
                )}
              </div>
              {readings.length > 0 && (
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4, lineHeight: 1.6 }}>
                  <b>{hi ? "तास रीडिंग" : "Readings"}:</b>{" "}
                  {readings.map((r, i) =>
                    `${r.machine ?? c.machine_number ?? "—"} ${r.start_time ?? "—"}→${r.stop_time ?? "—"}${r.total_hours != null ? ` (${r.total_hours}h)` : ""}`
                    + (i < readings.length - 1 ? "  ·  " : "")
                  )}
                </div>
              )}
              {c.work_details && (
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4 }}>
                  <b>{hi ? "कार्य" : "Work"}:</b> {c.work_details}
                </div>
              )}
            </div>
          );
        })}
      </div>
    )}

    <div className="card">
      <h3>{t.heading}</h3>
      {loading ? (
        <div className="empty">{t.loading}</div>
      ) : cards.length === 0 ? (
        <div className="empty">{t.empty}</div>
      ) : (
        groupByJobNumber(cards).map(group => (
          <div key={group.jobNumber ?? group.entries[0].id}
            style={{ marginBottom: 16, paddingBottom: 4, borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", margin: "2px 0 6px" }}>
              {t.job}: {group.jobNumber ?? "—"}
              {group.entries.length > 1 && ` · ${group.entries.length} entries`}
            </div>
            {group.entries.map((jc, idx) => {
              const trail = reviews[jc.id] ?? [];
              return (
                <div className="batch-block" key={jc.id}>
                  <span className="batch-label">
                    {group.entries.length > 1 ? `Entry ${idx + 1} · ` : ""}
                    {jc.job_date ?? "—"} · {jc.machine_number} · {jc.shift ?? "—"}
                  </span>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    {t.material}: <b>{jc.material_code ?? "—"}</b> · Party/CODE: {jc.party_code ?? "—"}
                    <br />
                    {t.status}:{" "}
                    <span className={`badge ${STATUS_BADGE[jc.status]}`}>
                      {STATUS_LABEL[jc.status]}
                    </span>
                  </div>

                  {/* Timeline — show all "sent at" timestamps for this card */}
                  {(jc.production_at || jc.oil_issued_at || jc.operator_submitted_at) && (
                    <div style={{
                      marginTop: 6, fontSize: 11, color: "var(--ink-soft)",
                      lineHeight: 1.8, paddingLeft: 2,
                    }}>
                      {jc.production_at && (
                        <div>📋 Production → Stores:{" "}
                          <b>{new Date(jc.production_at).toLocaleString("en-IN", {
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}</b>
                        </div>
                      )}
                      {jc.oil_issued_at && (
                        <div>🛢 Stores → Operator:{" "}
                          <b>{new Date(jc.oil_issued_at).toLocaleString("en-IN", {
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}</b>
                        </div>
                      )}
                      {jc.operator_submitted_at && (
                        <div>✅ Operator → Lab:{" "}
                          <b>{new Date(jc.operator_submitted_at).toLocaleString("en-IN", {
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}</b>
                        </div>
                      )}
                    </div>
                  )}

                  {trail.length > 0 && (
                    <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid var(--line)" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                        {t.trail} ({trail.length})
                      </div>
                      {trail.map(r => (
                        <div key={r.id} style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 4 }}>
                          <span className={`badge ${r.result === "ok" ? "ok" : "warn"}`}>
                            {r.result === "ok" ? t.ok : t.notOk}
                          </span>{" "}
                          {new Date(r.reviewed_at).toLocaleString()}
                          {r.rejected_stage && ` · ${t.reopened}: ${r.rejected_stage}`}
                          {r.remark && <div style={{ marginLeft: 4 }}>&ldquo;{r.remark}&rdquo;</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
    </>
  );
}

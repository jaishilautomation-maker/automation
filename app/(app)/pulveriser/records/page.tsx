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

const STATUS_BADGE: Record<PulveriserStatus, string> = {
  pending_stores: "warn",
  pending: "warn",
  submitted_for_qc: "warn",
  finalized: "ok",
};

// English / Hindi label sets. Operators see Hindi; everyone else English.
const STATUS_LABEL_EN: Record<PulveriserStatus, string> = {
  pending_stores: "Awaiting Stores (oil issue)",
  pending: "Pending",
  submitted_for_qc: "Submitted for QC",
  finalized: "Finalized",
};
const STATUS_LABEL_HI: Record<PulveriserStatus, string> = {
  pending_stores: "स्टोर्स की प्रतीक्षा (तेल जारी)",
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
    setLoading(false);
  }, [supabase, showToast, hi]);

  useEffect(() => { load(); }, [load]);

  return (
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
  );
}

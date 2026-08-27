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
import type {
  PulveriserJobCard,
  PulveriserJobCardReview,
  PulveriserStatus,
} from "@/lib/types";

const STATUS_LABEL: Record<PulveriserStatus, string> = {
  pending: "Pending",
  submitted_for_qc: "Submitted for QC",
  finalized: "Finalized",
};

const STATUS_BADGE: Record<PulveriserStatus, string> = {
  pending: "warn",
  submitted_for_qc: "warn",
  finalized: "ok",
};

export default function PulveriserRecordsPage() {
  const { showToast } = useToast();
  const supabase = createClient();

  const [cards, setCards]   = useState<PulveriserJobCard[]>([]);
  const [reviews, setReviews] = useState<Record<string, PulveriserJobCardReview[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: cardData, error } = await supabase
      .from("pulveriser_job_cards")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { showToast("Could not load: " + error.message, true); setLoading(false); return; }

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
  }, [supabase, showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="card">
      <h3>Pulveriser job card records</h3>
      {loading ? (
        <div className="empty">Loading…</div>
      ) : cards.length === 0 ? (
        <div className="empty">No job cards yet.</div>
      ) : (
        cards.map(jc => {
          const trail = reviews[jc.id] ?? [];
          return (
            <div className="batch-block" key={jc.id}>
              <span className="batch-label">
                {jc.job_date ?? "—"} · {jc.machine_number} · {jc.shift ?? "—"}
              </span>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                Material: <b>{jc.material_code ?? "—"}</b> · Job: {jc.job_number ?? "—"}
                <br />
                Status:{" "}
                <span className={`badge ${STATUS_BADGE[jc.status]}`}>
                  {STATUS_LABEL[jc.status]}
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
                      {new Date(r.reviewed_at).toLocaleString()}
                      {r.rejected_stage && ` · reopened: ${r.rejected_stage}`}
                      {r.remark && <div style={{ marginLeft: 4 }}>“{r.remark}”</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

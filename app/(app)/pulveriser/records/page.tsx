"use client";

// =============================================================================
// Pulveriser Job Card — Records / history (Form JSCI/PROD/02)
//
// Clean list of every job card at the current factory (grouped by job number),
// each a compact clickable row. Clicking opens a full-detail PREVIEW modal with
// the whole card: production + stores + operator-filled values + timeline +
// Taas readings + the full Lab review trail. A "last 24 hours" handover strip
// sits at the top for cross-shift visibility.
// =============================================================================

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { isoToDisplay } from "@/components/DateField";
import {
  groupByJobNumber,
  type PulveriserJobCard,
  type PulveriserJobCardReview,
  type PulveriserStatus,
} from "@/lib/types";

interface ReadingLite {
  machine: string | null;
  reading_date: string | null;
  start_time: string | null;
  stop_time: string | null;
  total_hours: number | null;
  planned_production: number | null;
  batch_no: string | null;
  bags: number | null;
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

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function kg(mt: number | null | undefined): string {
  return mt != null ? `${Math.round(mt * 1000)} kg` : "—";
}

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
    view:      hi ? "देखें" : "View",
    close:     hi ? "बंद करें" : "Close",
    recent:    hi ? "पिछले 24 घंटे में भरा गया" : "Filled in the last 24 hours",
  };
  const STATUS_LABEL = hi ? STATUS_LABEL_HI : STATUS_LABEL_EN;

  const [cards, setCards]   = useState<PulveriserJobCard[]>([]);
  const [reviews, setReviews] = useState<Record<string, PulveriserJobCardReview[]>>({});
  const [loading, setLoading] = useState(true);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  // Preview modal state: the selected card + its (lazily loaded) readings.
  const [selected, setSelected] = useState<PulveriserJobCard | null>(null);
  const [selReadings, setSelReadings] = useState<ReadingLite[]>([]);
  const [selLoading, setSelLoading] = useState(false);

  // Cards an operator submitted within the last 24h (computed in load()).
  const [recentCards, setRecentCards] = useState<PulveriserJobCard[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: cardData, error } = await supabase
      .from("pulveriser_job_cards")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { showToast((hi ? "लोड नहीं हो सका: " : "Could not load: ") + error.message, true); setLoading(false); return; }

    const list = (cardData ?? []) as PulveriserJobCard[];
    setCards(list);

    // Last-24h handover subset (compute time here, not during render).
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    setRecentCards(list.filter(
      c => c.operator_submitted_at != null && new Date(c.operator_submitted_at).getTime() >= cutoff,
    ));

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

      // Resolve operator names for everything shown (RPC scoped to the factory).
      const ids = Array.from(new Set(list.map(c => c.operator_by).filter((v): v is string => !!v)));
      if (ids.length) {
        const { data: names } = await supabase.rpc("fn_operator_names", { p_ids: ids });
        const map: Record<string, string> = {};
        for (const n of (names ?? []) as { id: string; full_name: string | null }[]) {
          if (n.full_name) map[n.id] = n.full_name;
        }
        setNameMap(map);
      } else {
        setNameMap({});
      }
    } else {
      setReviews({});
      setNameMap({});
    }
    setLoading(false);
  }, [supabase, showToast, hi]);

  useEffect(() => { load(); }, [load]);

  // Open the preview and lazily load that card's hourly readings.
  const openPreview = useCallback(async (jc: PulveriserJobCard) => {
    setSelected(jc);
    setSelReadings([]);
    setSelLoading(true);
    const { data } = await supabase
      .from("pulveriser_hourly_readings")
      .select("machine, reading_date, start_time, stop_time, total_hours, planned_production, batch_no, bags")
      .eq("job_card_id", jc.id)
      .order("created_at");
    setSelReadings((data ?? []) as ReadingLite[]);
    setSelLoading(false);
  }, [supabase]);

  return (
    <>
    {/* ── Last 24h shift-handover strip ──────────────────────────────────── */}
    {recentCards.length > 0 && (
      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>{t.recent}</h3>
          <span className="count">{recentCards.length}</span>
        </div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          {hi
            ? "पिछली शिफ्ट के ऑपरेटर ने क्या भरा — कितना उत्पादन हुआ। विवरण देखने के लिए टैप करें।"
            : "What the previous shift's operator produced. Tap a card for full details."}
        </div>
        {recentCards.map(c => (
          <div key={c.id} className="pending-item" onClick={() => openPreview(c)}>
            <div className="pi-top">
              <span style={{ fontWeight: 700 }}>
                {t.job}: {c.job_number ?? "—"} · {t.material} {c.material_code ?? "—"}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                {c.shift ?? "—"} {hi ? "शिफ्ट" : "shift"}
              </span>
            </div>
            <div className="pi-sub">
              <b>{hi ? "उत्पादन" : "Production"}:</b>{" "}
              <span style={{ fontWeight: 700, color: "var(--clay)" }}>{kg(c.actual_production_mt)}</span>
              {c.planned_production_mt != null && <> / {hi ? "नियोजित" : "planned"} {kg(c.planned_production_mt)}</>}
              {" · "}<b>{hi ? "ऑपरेटर" : "Operator"}:</b> {c.operator_by ? (nameMap[c.operator_by] ?? "—") : "—"}
              {" · "}{fmtTs(c.operator_submitted_at)}
            </div>
          </div>
        ))}
      </div>
    )}

    {/* ── Full records list — compact rows, click to preview ─────────────── */}
    <div className="card">
      <h3>{t.heading}</h3>
      {loading ? (
        <div className="empty">{t.loading}</div>
      ) : cards.length === 0 ? (
        <div className="empty">{t.empty}</div>
      ) : (
        groupByJobNumber(cards).map(group => (
          <div key={group.jobNumber ?? group.entries[0].id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", margin: "2px 0 6px" }}>
              {t.job}: {group.jobNumber ?? "—"}
              {group.entries.length > 1 && ` · ${group.entries.length} entries`}
            </div>
            {group.entries.map((jc, idx) => {
              const trail = reviews[jc.id] ?? [];
              return (
                <div key={jc.id} className="pending-item" onClick={() => openPreview(jc)}>
                  <div className="pi-top">
                    <span style={{ fontWeight: 700 }}>
                      {group.entries.length > 1 ? `Entry ${idx + 1} · ` : ""}
                      {t.material} {jc.material_code ?? "—"}
                    </span>
                    <span className={`badge ${STATUS_BADGE[jc.status]}`}>{STATUS_LABEL[jc.status]}</span>
                  </div>
                  <div className="pi-sub">
                    {jc.job_date ?? "—"} · {jc.machine_number ?? "—"} · {jc.shift ?? "—"}
                    {" · "}Party/CODE: {jc.party_code ?? "—"}
                    {trail.length > 0 && ` · ${t.trail}: ${trail.length}`}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>

    {/* ── Full-detail preview modal ──────────────────────────────────────── */}
    {selected && (
      <div
        onClick={() => setSelected(null)}
        style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.45)", display: "flex",
          alignItems: "flex-start", justifyContent: "center",
          padding: "24px 12px", overflowY: "auto",
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          className="card"
          style={{ maxWidth: 560, width: "100%", margin: 0 }}
        >
          {(() => {
            const jc = selected;
            const trail = reviews[jc.id] ?? [];
            const Row = ({ label, value }: { label: string; value: ReactNode }) => (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
                <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>{label}</span>
                <span style={{ fontWeight: 600, fontSize: 13, textAlign: "right" }}>{value}</span>
              </div>
            );
            const Section = ({ title, children }: { title: string; children: ReactNode }) => (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.5px", color: "var(--clay)", marginBottom: 4,
                  borderBottom: "1px solid var(--line)", paddingBottom: 3,
                }}>{title}</div>
                {children}
              </div>
            );
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{t.job}: {jc.job_number ?? "—"}</h3>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>
                      {t.material} {jc.material_code ?? "—"} · {jc.party_code ?? "—"}
                    </div>
                  </div>
                  <span className={`badge ${STATUS_BADGE[jc.status]}`}>{STATUS_LABEL[jc.status]}</span>
                </div>

                <Section title={hi ? "प्रोडक्शन" : "Production"}>
                  <Row label={hi ? "मशीन" : "Machine"} value={jc.machine_number ?? "—"} />
                  <Row label={hi ? "तारीख" : "Date"} value={jc.job_date ?? "—"} />
                  <Row label={hi ? "शिफ्ट" : "Shift"} value={jc.shift ?? "—"} />
                  <Row label={hi ? "नियोजित उत्पादन" : "Planned production"} value={kg(jc.planned_production_mt)} />
                  <Row label={hi ? "सल्फर सप्लायर" : "Sulphur supplier"} value={jc.sulphur_supplier ?? "—"} />
                  <Row label={hi ? "सल्फर लॉट" : "Sulphur lot"} value={jc.sulphur_lot_number ?? "—"} />
                  <Row label={hi ? "तेल सप्लायर" : "Oil supplier"} value={jc.oil_supplier ?? "—"} />
                  <Row label={hi ? "तेल प्राप्ति तारीख" : "Oil received date"}
                    value={jc.oil_batch_number ? (isoToDisplay(jc.oil_batch_number) || jc.oil_batch_number) : "—"} />
                </Section>

                <Section title={hi ? "स्टोर्स (तेल)" : "Stores (oil)"}>
                  <Row label={hi ? "आवश्यक तेल" : "Oil required"} value={jc.oil_required_kg != null ? `${jc.oil_required_kg} kg` : "—"} />
                  <Row label={hi ? "जारी तेल" : "Oil issued"} value={jc.oil_issued_kg != null ? `${jc.oil_issued_kg} kg` : "—"} />
                </Section>

                <Section title={hi ? "ऑपरेटर" : "Operator"}>
                  <Row label={hi ? "वास्तविक उत्पादन" : "Actual production"} value={kg(jc.actual_production_mt)} />
                  <Row label={hi ? "तैयार माल बैग" : "FG bags"} value={jc.finished_goods_bag ?? "—"} />
                  <Row label={hi ? "पैकिंग साइज़" : "Packing size"} value={jc.packing_size ? `${jc.packing_size} kg` : "—"} />
                  <Row label={hi ? "क्लासिफायर VFD" : "Classifier VFD"} value={jc.classifier_vfd ?? "—"} />
                  <Row label={hi ? "ब्लोअर इनलेट" : "Blower inlet"} value={jc.blower_inlet_valve ?? "—"} />
                  <Row label={hi ? "ब्लोअर आउटलेट" : "Blower outlet"} value={jc.blower_outlet_valve ?? "—"} />
                  <Row label={hi ? "जाँच बिंदु" : "Checkpoints"}
                    value={[
                      jc.checkpoint_machine_cleaning ? (hi ? "सफाई" : "Cleaning") : null,
                      jc.checkpoint_roller_check ? (hi ? "रोलर" : "Roller") : null,
                      jc.checkpoint_mesh_cloth_check ? (hi ? "जाली" : "Mesh") : null,
                    ].filter(Boolean).join(", ") || "—"} />
                  <Row label={hi ? "ऑपरेटर" : "Operator"} value={jc.operator_by ? (nameMap[jc.operator_by] ?? "—") : "—"} />
                  {jc.work_details && <Row label={hi ? "कार्य विवरण" : "Work details"} value={jc.work_details} />}
                  {jc.qc_incharge_note && <Row label={hi ? "QC नोट" : "QC note"} value={jc.qc_incharge_note} />}
                  {jc.stores_incharge_note && <Row label={hi ? "स्टोर्स नोट" : "Stores note"} value={jc.stores_incharge_note} />}
                </Section>

                <Section title={hi ? "तास रीडिंग" : "Taas readings"}>
                  {selLoading ? (
                    <div className="field-hint">{t.loading}</div>
                  ) : selReadings.length === 0 ? (
                    <div className="field-hint">—</div>
                  ) : (
                    selReadings.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, lineHeight: 1.7 }}>
                        {r.machine ?? jc.machine_number ?? "—"} · {r.start_time ?? "—"}→{r.stop_time ?? "—"}
                        {r.total_hours != null ? ` (${r.total_hours}h)` : ""}
                        {r.bags != null ? ` · ${r.bags} ${hi ? "बैग" : "bags"}` : ""}
                      </div>
                    ))
                  )}
                </Section>

                <Section title={hi ? "समय-रेखा" : "Timeline"}>
                  <Row label={hi ? "Production → Stores" : "Production → Stores"} value={fmtTs(jc.production_at)} />
                  <Row label={hi ? "Stores → Operator" : "Stores → Operator"} value={fmtTs(jc.oil_issued_at)} />
                  <Row label={hi ? "Operator → Lab" : "Operator → Lab"} value={fmtTs(jc.operator_submitted_at)} />
                </Section>

                {trail.length > 0 && (
                  <Section title={`${t.trail} (${trail.length})`}>
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
                  </Section>
                )}

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: 16 }}
                  onClick={() => setSelected(null)}
                >
                  {t.close}
                </button>
              </>
            );
          })()}
        </div>
      </div>
    )}
    </>
  );
}

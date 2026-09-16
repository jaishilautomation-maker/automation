"use client";

// =============================================================================
// Pulveriser Job Card — Operator (Form JSCI/PROD/02)
//
// Operator sees 'pending' cards that Production has filled (material_code set),
// reads material_code as reference, and fills everything else:
//   classifier_vfd, blower_inlet_valve, blower_outlet_valve,
//   finished_goods_bag, packing_size, qc_incharge_note, stores_incharge_note,
//   work_details, checkpoints (3), + repeatable hourly readings.
//
// "Submit for QC" sets status='submitted_for_qc', operator_submitted_at=now().
// The button is disabled until required fields are present.
//
// After a Lab NOT-OK the card returns to 'pending', so it reappears here for
// correction and resubmission (rework loop).
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import {
  PULVERISER_LOW_PROD_REASONS,
  parseVfdRange,
  groupByJobNumber,
  type PulveriserJobCard,
  type PulveriserShutdownLog,
  type VfdParameter,
} from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { buildOperatorEmail } from "@/lib/notifications/pulveriser-emails";

interface HourlyRow {
  id: string;            // local row id (uuid from DB after save, or temp key)
  persistedId: string | null;
  machine: string;
  start_time: string;
  stop_time: string;
  planned_production: string;
  low_production_reasons: string[];   // multi-select
  batch_no: string;
  bags: string;
  reading_date: string;
}

// ---------------------------------------------------------------------------
// Shutdown log row (local state — mirrors pulveriser_shutdown_logs table)
// ---------------------------------------------------------------------------
interface ShutdownRow {
  id: string;           // local key (tmp-... or DB uuid)
  persistedId: string | null;
  start_time: string;   // coded meter reading, e.g. "1000"
  end_time: string;     // coded meter reading, e.g. "1200"
  reason: string;
}

// The pulveriser hour meter is a CODED reading, not a wall clock.
// Operator enters plain numbers, e.g. start 780, stop 930.
//   raw diff      = stop - start                     (930 - 780 = 250)
//   hours         = whole part of (diff / 100)        (2)
//   minutes       = (last two digits / 100) * 60       (50/100*60 = 30)
// Real decimal running hours = diff / 100  (2.50), which equals hours+min/60.
function codedDiff(start: string, stop: string): number | null {
  const s = start.trim();
  const e = stop.trim();
  if (s === "" || e === "") return null;
  const sn = Number(s);
  const en = Number(e);
  if (!Number.isFinite(sn) || !Number.isFinite(en)) return null;
  const diff = en - sn;
  if (diff <= 0) return null;
  return diff;
}

/** Convert a coded diff (e.g. 250) to decimal running hours (2.50). */
function codedToHours(diff: number): number {
  return diff / 100;
}

/** Format a coded diff (e.g. 250) as "H घं M मि" (2 घं 30 मि). */
function formatCodedHM(diff: number): string {
  const hours = Math.trunc(diff / 100);
  const lastTwo = diff % 100;                 // hundredths of an hour
  const minutes = Math.round((lastTwo / 100) * 60);
  return `${hours} घं ${minutes} मि`;
}

function blankRow(): HourlyRow {
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    persistedId: null,
    machine: "", start_time: "", stop_time: "",
    planned_production: "", low_production_reasons: [],
    batch_no: "", bags: "", reading_date: new Date().toISOString().slice(0, 10),
  };
}

function blankShutdown(): ShutdownRow {
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    persistedId: null,
    start_time: "",
    end_time: "",
    reason: "",
  };
}

/**
 * Compute shutdown hours for a single row. Returns null if values are invalid.
 * Reuses the coded meter system: diff / 100 = decimal running hours.
 */
function shutdownHours(row: ShutdownRow): number | null {
  const s = row.start_time.trim();
  const e = row.end_time.trim();
  if (!s || !e) return null;
  const sn = Number(s);
  const en = Number(e);
  if (!Number.isFinite(sn) || !Number.isFinite(en)) return null;
  const diff = en - sn;
  return diff > 0 ? diff / 100 : null;
}

/**
 * Shift-time reconciliation:
 *   actual_running = sum(hourly_readings.total_hours)
 *   accounted_time = shift_duration_hours - sum(shutdown_hours)
 *
 * Returns { ok: true } when the two sides reconcile within TOLERANCE, or
 * { ok: false, runningHours, accountedHours, diffHours } with the discrepancy.
 *
 * shift_duration_hours: total coded span of the shift (start to end meter reading),
 *   computed from the first start_time and last stop_time across all hourly rows.
 *   If that information isn't available, reconciliation is skipped (returns null).
 *
 * TOLERANCE: ±0.05 decimal hours (3 minutes) to absorb rounding in coded readings.
 */
const RECONCILE_TOLERANCE = 0.05;

interface ReconcileResult {
  canCheck: boolean;
  ok: boolean;
  runningHours: number;
  accountedHours: number;
  diffHours: number;
  shutdownTotal: number;
  shiftDuration: number;
}

function reconcileShiftTime(
  hourlyRows: HourlyRow[],
  shutdownRows: ShutdownRow[],
): ReconcileResult | null {
  // Sum of total_hours from hourly readings (as already computed by codedToHours).
  const runningHours = hourlyRows.reduce<number>((sum, r) => {
    const d = codedDiff(r.start_time, r.stop_time);
    return sum + (d !== null ? codedToHours(d) : 0);
  }, 0);

  // Derive shift span from the min start and max stop across all hourly rows.
  const starts = hourlyRows
    .map(r => r.start_time.trim())
    .filter(s => s !== "" && Number.isFinite(Number(s)))
    .map(Number);
  const stops = hourlyRows
    .map(r => r.stop_time.trim())
    .filter(s => s !== "" && Number.isFinite(Number(s)))
    .map(Number);

  if (starts.length === 0 || stops.length === 0) {
    // Not enough data to derive shift duration — skip check.
    return null;
  }

  const shiftStart = Math.min(...starts);
  const shiftStop  = Math.max(...stops);
  if (shiftStop <= shiftStart) return null;

  const shiftDuration = (shiftStop - shiftStart) / 100;

  // Sum of logged shutdown durations.
  const shutdownTotal = shutdownRows.reduce<number>(
    (sum, r) => sum + (shutdownHours(r) ?? 0),
    0,
  );

  const accountedHours = shiftDuration - shutdownTotal;
  const diffHours      = Math.abs(runningHours - accountedHours);
  const ok             = diffHours <= RECONCILE_TOLERANCE;

  return { canCheck: true, ok, runningHours, accountedHours, diffHours, shutdownTotal, shiftDuration };
}

/** Format a YYYY-MM-DD string as DD/MM/YYYY for display. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function PulveriserOperatorPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [pending, setPending]         = useState<PulveriserJobCard[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive]           = useState<PulveriserJobCard | null>(null);
  const [submitting, setSubmitting]   = useState(false);

  // Operator-owned fields
  const [actualMt, setActualMt]           = useState("");
  const [classifierVfd, setClassifierVfd] = useState("");
  const [blowerIn, setBlowerIn]           = useState("");
  const [blowerOut, setBlowerOut]         = useState("");
  const [fgBag, setFgBag]                 = useState("");
  const [packingSize, setPackingSize]     = useState("");
  const [qcNote, setQcNote]               = useState("");
  const [storesNote, setStoresNote]       = useState("");
  const [workDetails, setWorkDetails]     = useState("");
  const [chkClean, setChkClean]           = useState(false);
  const [chkRoller, setChkRoller]         = useState(false);
  const [chkMesh, setChkMesh]             = useState(false);
  const [rows, setRows]                   = useState<HourlyRow[]>([blankRow()]);

  // Shutdown log rows (Sept 16 meeting item 4)
  const [shutdowns, setShutdowns]         = useState<ShutdownRow[]>([]);

  // Mill VFD standard for the active card's material_code — reference only.
  const [vfdParam, setVfdParam]           = useState<VfdParameter | null>(null);

  const loadPending = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await supabase
      .from("pulveriser_job_cards")
      .select("*")
      .eq("status", "pending")
      .not("material_code", "is", null)
      .order("created_at", { ascending: false });
    if (error) showToast("लोड नहीं हो सका: " + error.message, true);
    else setPending((data ?? []) as PulveriserJobCard[]);
    setLoadingList(false);
  }, [supabase, showToast]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const openCard = async (jc: PulveriserJobCard) => {
    setActive(jc);
    // Pre-fill operator fields (may already hold values from a prior rework)
    setActualMt(jc.actual_production_mt?.toString() ?? "");
    setClassifierVfd(jc.classifier_vfd ?? "");
    setBlowerIn(jc.blower_inlet_valve ?? "");
    setBlowerOut(jc.blower_outlet_valve ?? "");
    setFgBag(jc.finished_goods_bag ?? "");
    setPackingSize(jc.packing_size ?? "");
    setQcNote(jc.qc_incharge_note ?? "");
    setStoresNote(jc.stores_incharge_note ?? "");
    setWorkDetails(jc.work_details ?? "");
    setChkClean(jc.checkpoint_machine_cleaning);
    setChkRoller(jc.checkpoint_roller_check);
    setChkMesh(jc.checkpoint_mesh_cloth_check);

    // Load the mill VFD standard for this card's Party/CODE (reference values).
    setVfdParam(null);
    if (jc.party_code) {
      const { data: vp } = await supabase
        .from("vfd_parameters")
        .select("*")
        .eq("machine_type", "mill")
        .eq("party_code", jc.party_code)
        .maybeSingle();
      setVfdParam((vp as VfdParameter | null) ?? null);
    }

    // Load any existing hourly readings (rework case)
    const { data } = await supabase
      .from("pulveriser_hourly_readings")
      .select("*")
      .eq("job_card_id", jc.id)
      .order("created_at");
    const existing = (data ?? []).map(r => ({
      id: r.id,
      persistedId: r.id as string,
      machine: r.machine ?? "",
      start_time: r.start_time ?? "",
      stop_time: r.stop_time ?? "",
      planned_production: r.planned_production?.toString() ?? "",
      low_production_reasons: r.low_production_reason
        ? r.low_production_reason.split(", ").filter(Boolean)
        : [],
      batch_no: r.batch_no ?? "",
      bags: r.bags?.toString() ?? "",
      reading_date: r.reading_date ?? new Date().toISOString().slice(0, 10),
    })) as HourlyRow[];
    setRows(existing.length ? existing : [blankRow()]);

    // Load any existing shutdown logs (rework case)
    const { data: sdData } = await supabase
      .from("pulveriser_shutdown_logs")
      .select("*")
      .eq("job_card_id", jc.id)
      .order("created_at");
    const existingShutdowns: ShutdownRow[] = (sdData ?? []).map((s: PulveriserShutdownLog) => ({
      id: s.id,
      persistedId: s.id,
      start_time: s.start_time,
      end_time: s.end_time,
      reason: s.reason ?? "",
    }));
    setShutdowns(existingShutdowns);
  };

  const goBack = () => { setActive(null); setRows([blankRow()]); setVfdParam(null); setActualMt(""); setShutdowns([]); };

  // Classifier VFD mismatch flag — reference only, never blocks submission.
  const classifierRange = useMemo(
    () => parseVfdRange(vfdParam?.classifier_vfd),
    [vfdParam],
  );
  const classifierReadingNum = classifierVfd.trim() === "" ? null : Number(classifierVfd);
  const classifierMismatch =
    classifierRange !== null &&
    classifierReadingNum !== null &&
    Number.isFinite(classifierReadingNum) &&
    (classifierReadingNum < classifierRange[0] || classifierReadingNum > classifierRange[1]);

  const updateRow = (id: string, field: keyof HourlyRow, val: string | string[]) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));
  };
  const addRow = () => setRows(prev => [...prev, blankRow()]);
  const removeRow = async (row: HourlyRow) => {
    if (rows.length === 1) { showToast("कम से कम एक रीडिंग पंक्ति ज़रूरी है।", true); return; }
    if (row.persistedId) {
      const { error } = await supabase
        .from("pulveriser_hourly_readings")
        .delete()
        .eq("id", row.persistedId);
      if (error) { showToast("पंक्ति नहीं हटा सके: " + error.message, true); return; }
    }
    setRows(prev => prev.filter(r => r.id !== row.id));
  };

  // ── Shutdown log helpers ─────────────────────────────────────────────────
  const updateShutdown = (id: string, field: keyof ShutdownRow, val: string) => {
    setShutdowns(prev => prev.map(s => s.id === id ? { ...s, [field]: val } : s));
  };

  const addShutdown = () => setShutdowns(prev => [...prev, blankShutdown()]);

  const removeShutdown = async (row: ShutdownRow) => {
    if (row.persistedId) {
      const { error } = await supabase
        .from("pulveriser_shutdown_logs")
        .delete()
        .eq("id", row.persistedId);
      if (error) { showToast("शटडाउन पंक्ति नहीं हटा सके: " + error.message, true); return; }
    }
    setShutdowns(prev => prev.filter(s => s.id !== row.id));
  };

  // Submit is allowed once the core operator fields are present.
  const canSubmit =
    classifierVfd.trim() !== "" &&
    blowerIn.trim() !== "" &&
    blowerOut.trim() !== "" &&
    workDetails.trim() !== "";

  const persistOperatorFields = async (jcId: string, submit: boolean) => {
    const payload: Record<string, unknown> = {
      actual_production_mt: actualMt.trim() === "" ? null : Number(actualMt),
      classifier_vfd:      classifierVfd.trim() || null,
      blower_inlet_valve:  blowerIn.trim() || null,
      blower_outlet_valve: blowerOut.trim() || null,
      finished_goods_bag:  fgBag.trim() || null,
      packing_size:        packingSize.trim() || null,
      qc_incharge_note:    qcNote.trim() || null,
      stores_incharge_note: storesNote.trim() || null,
      work_details:        workDetails.trim() || null,
      checkpoint_machine_cleaning: chkClean,
      checkpoint_roller_check:     chkRoller,
      checkpoint_mesh_cloth_check: chkMesh,
      operator_by:         user?.id ?? null,
    };
    if (submit) {
      payload.status = "submitted_for_qc";
      payload.operator_submitted_at = new Date().toISOString();
    }
    // .select() so an RLS-blocked / zero-row update surfaces instead of a
    // silent success (PostgREST returns 204 with no error otherwise).
    return supabase
      .from("pulveriser_job_cards")
      .update(payload)
      .eq("id", jcId)
      .select("id");
  };

  const syncHourlyRows = async (jc: PulveriserJobCard) => {
    for (const r of rows) {
      const diff = codedDiff(r.start_time, r.stop_time);
      const hours = diff !== null ? codedToHours(diff) : null;
      const body = {
        job_card_id:           jc.id,
        factory_id:            jc.factory_id,
        machine:               r.machine.trim() || jc.machine_number,
        start_time:            r.start_time.trim() || null,
        stop_time:             r.stop_time.trim() || null,
        total_hours:           hours,
        planned_production:    r.planned_production.trim() === "" ? null : Number(r.planned_production),
        low_production_reason: r.low_production_reasons.length > 0 ? r.low_production_reasons.join(", ") : null,
        batch_no:              r.batch_no.trim() || null,
        bags:                  r.bags.trim() === "" ? null : Number(r.bags),
        reading_date:          r.reading_date || null,
      };
      if (r.persistedId) {
        const { error } = await supabase
          .from("pulveriser_hourly_readings")
          .update(body)
          .eq("id", r.persistedId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("pulveriser_hourly_readings")
          .insert(body);
        if (error) throw error;
      }
    }
  };

  // Persist new shutdown log rows (updates are not supported — user deletes and re-adds).
  const syncShutdownRows = async (jc: PulveriserJobCard) => {
    if (!user) return;
    for (const s of shutdowns) {
      if (s.persistedId) continue; // already in DB, no update path
      if (!s.start_time.trim() || !s.end_time.trim()) continue; // skip blank rows
      const body = {
        job_card_id: jc.id,
        factory_id:  jc.factory_id,
        start_time:  s.start_time.trim(),
        end_time:    s.end_time.trim(),
        reason:      s.reason.trim() || null,
        logged_by:   user.id,
      };
      const { error } = await supabase
        .from("pulveriser_shutdown_logs")
        .insert(body);
      if (error) throw error;
    }
  };

  const handleSave = async (submit: boolean) => {
    if (!active || !user) return;
    if (submit && !canSubmit) {
      showToast("भेजने से पहले क्लासिफायर VFD, दोनों ब्लोअर वाल्व और कार्य विवरण भरें।", true);
      return;
    }
    setSubmitting(true);
    try {
      // Save hourly rows first (they require the card to still be 'pending').
      await syncHourlyRows(active);
      // Save new shutdown log rows (also while card is still 'pending').
      await syncShutdownRows(active);
      const { data, error } = await persistOperatorFields(active.id, submit);
      if (error) { showToast("सहेजा नहीं जा सका: " + error.message, true); return; }
      if (!data || data.length === 0) {
        showToast("सहेजना रोका गया — अपनी फ़ैक्टरी पहुँच या कार्ड की स्थिति जाँचें।", true);
        return;
      }

      // Fire-and-forget email only on full submit (not on "save progress")
      if (submit) {
        const nowISO = new Date().toISOString();
        // Re-read the updated card fields for oil consumption values
        const { data: updatedCard } = await supabase
          .from("pulveriser_job_cards")
          .select("actual_production_mt,expected_oil_kg,actual_oil_consumption_kg,oil_variance_kg,oil_extra_leftover_balance_kg")
          .eq("id", active.id)
          .single();
        const { subject, html } = buildOperatorEmail({
          jobNumber:                 active.job_number,
          materialCode:              active.material_code,
          actualProductionMt:        updatedCard?.actual_production_mt ?? (actualMt.trim() === "" ? null : Number(actualMt)),
          expectedOilKg:             updatedCard?.expected_oil_kg ?? null,
          actualOilConsumptionKg:    updatedCard?.actual_oil_consumption_kg ?? null,
          oilVarianceKg:             updatedCard?.oil_variance_kg ?? null,
          oilExtraLeftoverBalanceKg: updatedCard?.oil_extra_leftover_balance_kg ?? null,
          checkpointMachineCleaning: chkClean,
          checkpointRollerCheck:     chkRoller,
          checkpointMeshClothCheck:  chkMesh,
          hourlyReadings: rows.map(r => ({
            machine:     r.machine     || null,
            start_time:  r.start_time  || null,
            stop_time:   r.stop_time   || null,
            total_hours: (() => { const d = (Number(r.stop_time) - Number(r.start_time)); return d > 0 ? d / 100 : null; })(),
            batch_no:    r.batch_no    || null,
            bags:        r.bags.trim() === "" ? null : Number(r.bags),
          })),
          submittedByName: profile?.full_name ?? "—",
          submittedAt:     nowISO,
        });
        void notifyEvent({
          eventType:   "pulveriser_operator",
          subject,
          html,
          factoryId:   active.factory_id,
          referenceId: active.id,
        });
      }

      showToast(submit ? "QC के लिए भेजा गया ✓" : "प्रगति सहेजी गई ✓");
      goBack();
      loadPending();
    } catch (e: unknown) {
      showToast("सहेजा नहीं जा सका: " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── List view ───────────────────────────────────────────────────────────
  if (!active) {
    return (
      <div className="card">
        <h3>भरने के लिए जॉब कार्ड</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          प्रोडक्शन ने ये बनाए हैं। अपनी जानकारी भरें और QC के लिए भेजें।
        </div>
        {loadingList ? (
          <div className="empty">लोड हो रहा है…</div>
        ) : pending.length === 0 ? (
          <div className="empty">कोई लंबित जॉब कार्ड नहीं है।</div>
        ) : (
          groupByJobNumber(pending).map(group => (
            <div key={group.jobNumber ?? group.entries[0].id} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", margin: "4px 2px" }}>
                जॉब: {group.jobNumber ?? "—"}
                {group.entries.length > 1 && ` · ${group.entries.length} entries`}
              </div>
              {group.entries.map((jc, i) => (
                <div className="pending-item" key={jc.id} onClick={() => openCard(jc)}>
                  <div className="pi-top">
                    <span>Entry {i + 1} · {jc.machine_number} · {fmtDate(jc.job_date)}</span>
                    <span>{jc.shift ?? "—"}</span>
                  </div>
                  <div className="pi-sub">
                    बैच नंबर: {jc.material_code} · Party/CODE: {jc.party_code ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    );
  }

  // ── Fill view ─────────────────────────────────────────────────────────────
  return (
    <>
      <button className="back-link" type="button" onClick={goBack}>← सूची पर वापस जाएँ</button>

      {/* Read-only production + stores reference */}
      <div className="readonly-block">
        <b>{active.machine_number}</b> · {fmtDate(active.job_date)} · {active.shift ?? "—"} शिफ्ट<br />
        <b>बैच नंबर:</b> {active.material_code} · <b>Party/CODE:</b> {active.party_code ?? "—"} · जॉब: {active.job_number ?? "—"}<br />
        <b>सल्फर:</b> {active.sulphur_supplier ?? "—"} / {active.sulphur_lot_number ?? "—"} / {active.sulphur_empty_date ?? "—"}<br />
        <b>तेल:</b> {active.oil_supplier ?? "—"} / {active.oil_batch_number ?? "—"} / {active.oil_quantity ?? "—"}<br />
        <b>नियोजित उत्पादन:</b> {active.planned_production_mt ?? "—"} MT ·{" "}
        <b>तेल जारी (Stores):</b> {active.oil_issued_kg != null ? `${active.oil_issued_kg} kg` : "—"}
        {vfdParam && (
          <>
            <br />
            <b>VFD मानक ({active.party_code}):</b>{" "}
            Classifier {vfdParam.classifier_vfd ?? "—"} · Feeder {vfdParam.feeder_vfd ?? "—"}
          </>
        )}
      </div>

      {/* Actual production — drives all oil-consumption calculations (DB trigger) */}
      <div className="card">
        <h3>वास्तविक उत्पादन</h3>
        <label>वास्तविक उत्पादन (MT)</label>
        <input type="number" min="0" step="0.001" placeholder="0"
          value={actualMt} onChange={e => setActualMt(e.target.value)} />
        <div className="field-hint" style={{ marginTop: 6 }}>
          तेल की खपत के आँकड़े इसी से अपने-आप गणना होते हैं (सहेजने पर)।
        </div>
      </div>

      {/* Operator machine settings */}
      <div className="card">
        <h3>मशीन सेटिंग्स</h3>
        <div className="row2">
          <div>
            <label>क्लासिफायर VFD *</label>
            <input type="text" value={classifierVfd} onChange={e => setClassifierVfd(e.target.value)} />
            {vfdParam?.classifier_vfd && (
              <div className="field-hint" style={{ marginTop: 4 }}>
                अपेक्षित (VFD मानक): {vfdParam.classifier_vfd}
              </div>
            )}
            {classifierMismatch && (
              <div className="field-hint" style={{ marginTop: 4, color: "var(--warn)" }}>
                ⚠ आपका मान अपेक्षित सीमा ({vfdParam?.classifier_vfd}) से बाहर है — जाँच लें।
              </div>
            )}
          </div>
          <div>
            <label>ब्लोअर इनलेट वाल्व *</label>
            <input type="text" value={blowerIn} onChange={e => setBlowerIn(e.target.value)} />
          </div>
        </div>
        <label>ब्लोअर आउटलेट वाल्व *</label>
        <input type="text" value={blowerOut} onChange={e => setBlowerOut(e.target.value)} />
      </div>

      {/* Packing / notes */}
      <div className="card">
        <h3>पैकिंग और नोट्स</h3>
        <div className="row2">
          <div>
            <label>तैयार माल बैग</label>
            <input type="text" value={fgBag} onChange={e => setFgBag(e.target.value)} />
          </div>
          <div>
            <label>पैकिंग साइज़</label>
            <input type="text" value={packingSize} onChange={e => setPackingSize(e.target.value)} />
          </div>
        </div>
        <div className="row2">
          <div>
            <label>QC इंचार्ज नोट</label>
            <input type="text" value={qcNote} onChange={e => setQcNote(e.target.value)} />
          </div>
          <div>
            <label>स्टोर्स इंचार्ज नोट</label>
            <input type="text" value={storesNote} onChange={e => setStoresNote(e.target.value)} />
          </div>
        </div>
        <label>कार्य विवरण *</label>
        <textarea rows={2} value={workDetails} onChange={e => setWorkDetails(e.target.value)} />
      </div>

      {/* Hourly readings (repeatable) */}
      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>प्रति घंटा रीडिंग</h3>
          <span className="count">{rows.length}</span>
        </div>
        {rows.map((r, i) => {
          const diff = codedDiff(r.start_time, r.stop_time);
          return (
            <div key={r.id} style={{
              border: "1px solid var(--line)", borderRadius: 8,
              padding: 14, marginBottom: 10, background: "var(--surface)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>रीडिंग {i + 1}</span>
                {rows.length > 1 && (
                  <button type="button" className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "3px 10px", color: "var(--warn)" }}
                    onClick={() => removeRow(r)}>
                    हटाएँ
                  </button>
                )}
              </div>

              <div className="row2">
                <div>
                  <label>मशीन</label>
                  <input type="text" placeholder={active.machine_number ?? ""} value={r.machine}
                    onChange={e => updateRow(r.id, "machine", e.target.value)} />
                </div>
                <div>
                  <label>रीडिंग तारीख</label>
                  <input type="date" value={r.reading_date}
                    onChange={e => updateRow(r.id, "reading_date", e.target.value)} />
                </div>
              </div>
              <div className="row3">
                <div>
                  <label>शुरू रीडिंग</label>
                  <input type="number" inputMode="numeric" placeholder="जैसे 780" value={r.start_time}
                    onChange={e => updateRow(r.id, "start_time", e.target.value)} />
                </div>
                <div>
                  <label>बंद रीडिंग</label>
                  <input type="number" inputMode="numeric" placeholder="जैसे 930" value={r.stop_time}
                    onChange={e => updateRow(r.id, "stop_time", e.target.value)} />
                </div>
                <div>
                  <label>कुल घंटे</label>
                  <input type="text" disabled
                    value={diff !== null ? formatCodedHM(diff) : ""} placeholder="0 घं 0 मि" />
                </div>
              </div>
              <div className="row3">
                <div>
                  <label>नियोजित उत्पादन</label>
                  <input type="number" min="0" step="0.001" value={r.planned_production}
                    onChange={e => updateRow(r.id, "planned_production", e.target.value)} />
                </div>
                <div>
                  <label>बैच नं.</label>
                  <input type="text" value={r.batch_no}
                    onChange={e => updateRow(r.id, "batch_no", e.target.value)} />
                </div>
                <div>
                  <label>बैग</label>
                  <input type="number" min="0" value={r.bags}
                    onChange={e => updateRow(r.id, "bags", e.target.value)} />
                </div>
              </div>
              <label>कम उत्पादन का कारण (यदि कोई हो — एक से अधिक चुन सकते हैं)</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {PULVERISER_LOW_PROD_REASONS.map(reason => (
                  <label key={reason} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 400, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={r.low_production_reasons.includes(reason)}
                      onChange={e => {
                        const next = e.target.checked
                          ? [...r.low_production_reasons, reason]
                          : r.low_production_reasons.filter(x => x !== reason);
                        updateRow(r.id, "low_production_reasons", next);
                      }}
                    />
                    {reason}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-ghost" onClick={addRow}>
          + प्रति घंटा रीडिंग जोड़ें
        </button>
      </div>

      {/* Checkpoints */}
      <div className="card">
        <h3>जाँच बिंदु</h3>
        <div className="checkline">
          <input type="checkbox" checked={chkClean} onChange={e => setChkClean(e.target.checked)} />
          <span>मशीन की सफाई</span>
        </div>
        <div className="checkline">
          <input type="checkbox" checked={chkRoller} onChange={e => setChkRoller(e.target.checked)} />
          <span>रोलर की जाँच</span>
        </div>
        <div className="checkline">
          <input type="checkbox" checked={chkMesh} onChange={e => setChkMesh(e.target.checked)} />
          <span>जाली के कपड़े की जाँच</span>
        </div>
      </div>

      {/* ── Shutdown Log (Sept 16 meeting item 4) ─────────────────────────────
          Operator logs one row per shutdown period in the shift.
          start_time / end_time use the same coded meter scale as hourly readings.
          ─────────────────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>शटडाउन लॉग (यदि कोई हो)</h3>
          <span className="count">{shutdowns.length}</span>
        </div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          इस शिफ्ट में जितनी बार मशीन बंद रही, हर बार की रीडिंग यहाँ दर्ज करें।
          खाली छोड़ना ठीक है अगर कोई शटडाउन नहीं था।
        </div>

        {shutdowns.map((s, i) => {
          const hrs = shutdownHours(s);
          return (
            <div key={s.id} style={{
              border: "1px solid var(--line)", borderRadius: 8,
              padding: 14, marginBottom: 10, background: "var(--surface)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>शटडाउन {i + 1}</span>
                <button type="button" className="btn btn-ghost"
                  style={{ fontSize: 11, padding: "3px 10px", color: "var(--warn)" }}
                  onClick={() => removeShutdown(s)}
                  disabled={!!s.persistedId && false /* always deletable while pending */}>
                  हटाएँ
                </button>
              </div>

              <div className="row3">
                <div>
                  <label>बंद रीडिंग (शुरू)</label>
                  <input type="number" inputMode="numeric" placeholder="जैसे 1000"
                    value={s.start_time}
                    onChange={e => updateShutdown(s.id, "start_time", e.target.value)} />
                </div>
                <div>
                  <label>चालू रीडिंग (खत्म)</label>
                  <input type="number" inputMode="numeric" placeholder="जैसे 1200"
                    value={s.end_time}
                    onChange={e => updateShutdown(s.id, "end_time", e.target.value)} />
                </div>
                <div>
                  <label>बंद समय</label>
                  <input type="text" disabled
                    value={hrs !== null ? formatCodedHM(Math.round(hrs * 100)) : ""}
                    placeholder="0 घं 0 मि" />
                </div>
              </div>

              <label>कारण (वैकल्पिक)</label>
              <input type="text" placeholder="जैसे मशीन खराबी, बिजली कटौती…"
                value={s.reason}
                onChange={e => updateShutdown(s.id, "reason", e.target.value)} />
            </div>
          );
        })}

        <button type="button" className="btn btn-ghost" onClick={addShutdown}>
          + शटडाउन जोड़ें
        </button>
      </div>

      {/* ── Shift-time reconciliation warning ──────────────────────────────
          Computes: (shift_duration) - (total_shutdown) vs sum(hourly_total_hours).
          Does NOT block submission — surfaces a discrepancy for Lab to see.
          ─────────────────────────────────────────────────────────────────── */}
      {(() => {
        const result = reconcileShiftTime(rows, shutdowns);
        if (!result) return null;   // not enough data to check
        if (result.ok) {
          // Reconciled — show a quiet confirmation.
          return (
            <div style={{
              padding: "10px 14px", borderRadius: 8,
              background: "color-mix(in srgb, var(--ok) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--ok) 35%, transparent)",
              fontSize: 13, color: "var(--ink-soft)",
            }}>
              ✓ शिफ्ट समय मेल खाता है —{" "}
              चालू घंटे {result.runningHours.toFixed(2)} घं ≈{" "}
              शिफ्ट {result.shiftDuration.toFixed(2)} घं − शटडाउन {result.shutdownTotal.toFixed(2)} घं
            </div>
          );
        }
        return (
          <div style={{
            padding: "10px 14px", borderRadius: 8,
            background: "color-mix(in srgb, var(--warn) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--warn) 40%, transparent)",
            fontSize: 13,
          }}>
            <div style={{ fontWeight: 700, color: "var(--warn)", marginBottom: 4 }}>
              ⚠ शिफ्ट समय मेल नहीं खाता
            </div>
            <div>
              <b>चालू घंटे (रीडिंग से):</b> {result.runningHours.toFixed(2)} घं
            </div>
            <div>
              <b>अनुमानित चालू घंटे:</b> शिफ्ट {result.shiftDuration.toFixed(2)} − शटडाउन {result.shutdownTotal.toFixed(2)} = {result.accountedHours.toFixed(2)} घं
            </div>
            <div style={{ marginTop: 4, color: "var(--warn)" }}>
              अंतर: {result.diffHours.toFixed(2)} घं — कृपया रीडिंग या शटडाउन जाँचें।
              सबमिट करने पर Lab को यह चेतावनी दिखेगी।
            </div>
          </div>
        );
      })()}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-ghost" type="button"
          disabled={submitting} onClick={() => handleSave(false)}>
          {submitting ? "सहेजा जा रहा है…" : "प्रगति सहेजें"}
        </button>
        <button className="btn btn-primary" type="button"
          disabled={submitting || !canSubmit} onClick={() => handleSave(true)}>
          {submitting ? "भेजा जा रहा है…" : "QC के लिए भेजें"}
        </button>
      </div>
    </>
  );
}

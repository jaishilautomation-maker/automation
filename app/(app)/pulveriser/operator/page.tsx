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
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import DateField, { isoToDisplay } from "@/components/DateField";
import { useFormDraft, draftKey, peekDraft } from "@/lib/use-form-draft";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import {
  PULVERISER_LOW_PROD_REASONS,
  parseVfdRange,
  groupByJobNumber,
  type PulveriserJobCard,
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
// Machine Close (Band) Time — multiple entries per job card, any time during
// the shift. Operator can save and continue later.
// ---------------------------------------------------------------------------
interface MachineCloseEntry {
  id: string;              // local key (temp-xxx or DB uuid)
  persistedId: string | null;
  close_date: string;      // YYYY-MM-DD
  close_time: string;      // HH:MM
  restart_time: string;    // HH:MM — optional, empty string = not yet restarted
  reason: string;
}

// Packing size options (kg) for the finished-goods bags. Stored as text in
// packing_size; used with तैयार माल बैग to auto-compute वास्तविक उत्पादन (kg).
const PACKING_SIZE_OPTIONS = ["25", "50"] as const;

function blankCloseEntry(): MachineCloseEntry {
  return {
    id: `tmp-close-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    persistedId: null,
    close_date: new Date().toISOString().slice(0, 10),
    close_time: "",
    restart_time: "",
    reason: "",
  };
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
  // activeGroup = the opened job-number group (1+ entries sharing one job_number).
  // active      = the entry currently selected in the dropdown (one of the group's entries).
  const [activeGroup, setActiveGroup] = useState<PulveriserJobCard[] | null>(null);
  const [active, setActive]           = useState<PulveriserJobCard | null>(null);
  const [submitting, setSubmitting]   = useState(false);

  // Hourly readings are UNIVERSAL for the whole job number, not per entry. They
  // are anchored to the group's PRIMARY entry id (first entry) so a single set
  // of readings covers every entry of that job card.
  const primaryJobId = activeGroup && activeGroup.length > 0 ? activeGroup[0].id : null;

  // Operator-owned fields
  // actualKg holds KG (as entered). DB column actual_production_mt stays in MT,
  // so we convert KG → MT (÷1000) on save and MT → KG (×1000) when pre-filling.
  const [actualKg, setActualKg]           = useState("");
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
  const [closeEntries, setCloseEntries]   = useState<MachineCloseEntry[]>([blankCloseEntry()]);

  // ── Draft autosave ────────────────────────────────────────────────────────
  // Persist the operator's in-progress entry for the OPEN job card locally so a
  // closed tab/browser never loses typed data. Keyed by the active card id.
  const pathname = usePathname();
  // Per-ENTRY draft: operator fields + machine-close for one entry (keyed by entry id).
  interface OperatorDraft {
    actualKg: string; classifierVfd: string; blowerIn: string; blowerOut: string;
    fgBag: string; packingSize: string; qcNote: string; storesNote: string;
    workDetails: string; chkClean: boolean; chkRoller: boolean; chkMesh: boolean;
    closeEntries: MachineCloseEntry[];
  }
  // Job-LEVEL draft: the shared hourly readings (keyed by the primary job id).
  interface JobDraft { rows: HourlyRow[]; }

  const draft = useFormDraft<OperatorDraft>(
    draftKey(pathname, user?.id, active?.id),
  );
  const draftSave = draft.save;

  const jobDraft = useFormDraft<JobDraft>(
    draftKey(pathname, user?.id, "job", primaryJobId),
  );
  const jobDraftSave = jobDraft.save;

  // Autosave the per-entry fields whenever they change, only while an entry is open.
  useEffect(() => {
    if (!active) return;
    draftSave({
      actualKg, classifierVfd, blowerIn, blowerOut, fgBag, packingSize,
      qcNote, storesNote, workDetails, chkClean, chkRoller, chkMesh,
      closeEntries,
    });
  }, [active, actualKg, classifierVfd, blowerIn, blowerOut, fgBag, packingSize,
      qcNote, storesNote, workDetails, chkClean, chkRoller, chkMesh,
      closeEntries, draftSave]);

  // Autosave the job-level hourly readings whenever they change.
  useEffect(() => {
    if (!primaryJobId) return;
    jobDraftSave({ rows });
  }, [primaryJobId, rows, jobDraftSave]);

  // Auto-fill वास्तविक उत्पादन (kg) = तैयार माल बैग × पैकिंग साइज़.
  // Called from the bags and packing-size handlers. If either value is missing
  // or non-numeric, the actual production field is left untouched so a manual
  // entry is never wiped out.
  const recomputeActualKg = useCallback((bagsStr: string, sizeStr: string) => {
    const bags = parseFloat(bagsStr);
    const size = parseFloat(sizeStr);
    if (!isNaN(bags) && !isNaN(size) && bags >= 0 && size > 0) {
      setActualKg(String(bags * size));
    }
  }, []);

  // Mill VFD standard for the active card's material_code — reference only.
  const [vfdParam, setVfdParam]           = useState<VfdParameter | null>(null);

  // Rejection history for rework banner
  const [rejectionHistory, setRejectionHistory] = useState<{
    result: string; remark: string | null; reviewed_at: string; rejected_stage: string | null;
  }[]>([]);

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

  // ── Load per-ENTRY fields (operator fields, machine-close, rejection banner)
  //    into the form. Hourly readings are NOT loaded here — they are job-level.
  const loadEntryFields = async (jc: PulveriserJobCard) => {
    // Pre-fill operator fields (may already hold values from a prior rework)
    setActualKg(jc.actual_production_mt != null ? (jc.actual_production_mt * 1000).toString() : "");
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

    // Restore any locally saved per-entry draft (unsaved edits). Overrides the
    // DB pre-fill so the operator resumes exactly where they left off.
    const saved = peekDraft<OperatorDraft>(draftKey(pathname, user?.id, jc.id));
    if (saved) {
      setActualKg(saved.actualKg);
      setClassifierVfd(saved.classifierVfd);
      setBlowerIn(saved.blowerIn);
      setBlowerOut(saved.blowerOut);
      setFgBag(saved.fgBag);
      setPackingSize(saved.packingSize);
      setQcNote(saved.qcNote);
      setStoresNote(saved.storesNote);
      setWorkDetails(saved.workDetails);
      setChkClean(saved.chkClean);
      setChkRoller(saved.chkRoller);
      setChkMesh(saved.chkMesh);
      if (saved.closeEntries?.length) setCloseEntries(saved.closeEntries);
    }

    // Load the mill VFD standard for this entry's Party/CODE (reference values).
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

    // Load this entry's machine close time entries (per entry)
    const { data: closeData } = await supabase
      .from("pulveriser_machine_close_times")
      .select("*")
      .eq("job_card_id", jc.id)
      .order("created_at");
    const existingClose = (closeData ?? []).map(r => ({
      id:           r.id,
      persistedId:  r.id as string,
      close_date:   r.close_date  ?? new Date().toISOString().slice(0, 10),
      close_time:   r.close_time  ?? "",
      restart_time: r.restart_time ?? "",
      reason:       r.reason      ?? "",
    })) as MachineCloseEntry[];
    if (!saved?.closeEntries?.length) {
      setCloseEntries(existingClose.length ? existingClose : [blankCloseEntry()]);
    }

    // Load rejection history to show rework banner if this entry was rejected
    setRejectionHistory([]);
    const { data: reviews } = await supabase
      .from("pulveriser_job_card_reviews")
      .select("result, remark, reviewed_at, rejected_stage")
      .eq("job_card_id", jc.id)
      .order("reviewed_at", { ascending: false });
    if (reviews && reviews.length > 0) {
      setRejectionHistory(reviews as {
        result: string; remark: string | null; reviewed_at: string; rejected_stage: string | null;
      }[]);
    }
  };

  // ── Load JOB-LEVEL hourly readings once (anchored to the primary entry id).
  const loadJobHourlyReadings = async (primaryId: string) => {
    const { data } = await supabase
      .from("pulveriser_hourly_readings")
      .select("*")
      .eq("job_card_id", primaryId)
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
    // A locally saved draft for the job's readings wins over the DB copy.
    const jobDraft = peekDraft<JobDraft>(draftKey(pathname, user?.id, "job", primaryId));
    if (jobDraft?.rows?.length) setRows(jobDraft.rows);
    else setRows(existing.length ? existing : [blankRow()]);
  };

  // Open a whole job-number group: load its shared hourly readings once, then
  // select the first entry for the per-entry fields.
  const openGroup = async (entries: PulveriserJobCard[]) => {
    if (entries.length === 0) return;
    setActiveGroup(entries);
    await loadJobHourlyReadings(entries[0].id);
    setActive(entries[0]);
    await loadEntryFields(entries[0]);
  };

  // Switch which entry's per-entry fields are being filled (dropdown). Hourly
  // readings stay as-is (they are job-level).
  const selectEntry = async (jc: PulveriserJobCard) => {
    setActive(jc);
    await loadEntryFields(jc);
  };

  const goBack = () => {
    setActiveGroup(null); setActive(null);
    setRows([blankRow()]); setCloseEntries([blankCloseEntry()]);
    setVfdParam(null); setActualKg(""); setRejectionHistory([]);
  };

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

  // ── Machine Close Time helpers ────────────────────────────────────────────
  const updateCloseEntry = (id: string, field: keyof MachineCloseEntry, val: string) => {
    setCloseEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: val } : e));
  };
  const addCloseEntry = () => setCloseEntries(prev => [...prev, blankCloseEntry()]);
  const removeCloseEntry = async (entry: MachineCloseEntry) => {
    if (entry.persistedId) {
      const { error } = await supabase
        .from("pulveriser_machine_close_times")
        .delete()
        .eq("id", entry.persistedId);
      if (error) { showToast("प्रविष्टि नहीं हटा सके: " + error.message, true); return; }
    }
    setCloseEntries(prev => prev.filter(e => e.id !== entry.id));
  };

  /** Upsert all close-time entries — called on both "save progress" and "submit". */
  const syncCloseEntries = async (jc: PulveriserJobCard) => {
    for (const e of closeEntries) {
      // Skip blank rows (no close_time entered yet)
      if (!e.close_time.trim()) continue;

      const body = {
        job_card_id:  jc.id,
        factory_id:   jc.factory_id,
        close_date:   e.close_date  || new Date().toISOString().slice(0, 10),
        close_time:   e.close_time,
        restart_time: e.restart_time.trim() || null,
        reason:       e.reason.trim()       || null,
        recorded_by:  user?.id              ?? null,
      };

      if (e.persistedId) {
        const { error } = await supabase
          .from("pulveriser_machine_close_times")
          .update(body)
          .eq("id", e.persistedId);
        if (error) throw new Error(error.message ?? JSON.stringify(error));
      } else {
        const { data: inserted, error } = await supabase
          .from("pulveriser_machine_close_times")
          .insert(body)
          .select("id")
          .single();
        if (error) throw new Error(error.message ?? JSON.stringify(error));
        // Promote temp id → real DB id so subsequent saves are UPDATEs
        if (inserted) {
          setCloseEntries(prev =>
            prev.map(x => x.id === e.id
              ? { ...x, persistedId: inserted.id, id: inserted.id }
              : x
            )
          );
        }
      }
    }
  };

  // Submit is allowed once the core operator fields are present.
  const canSubmit =
    classifierVfd.trim() !== "" &&
    blowerIn.trim() !== "" &&
    blowerOut.trim() !== "" &&
    workDetails.trim() !== "";

  const persistOperatorFields = async (jcId: string, submit: boolean) => {
    // Operator enters KG; store MT (÷1000). Reused for the email/sheet payloads.
    const actualMtValue = actualKg.trim() === "" ? null : Number(actualKg) / 1000;
    const payload: Record<string, unknown> = {
      actual_production_mt: actualMtValue,
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

  // Hourly readings are job-level: always anchored to the group's PRIMARY entry
  // id so one set of readings covers every entry of the job number.
  const syncHourlyRows = async (jc: PulveriserJobCard) => {
    const anchorId = primaryJobId ?? jc.id;
    const anchorFactory = (activeGroup && activeGroup[0]?.factory_id) || jc.factory_id;
    for (const r of rows) {
      const diff = codedDiff(r.start_time, r.stop_time);
      const hours = diff !== null ? codedToHours(diff) : null;
      const body = {
        job_card_id:           anchorId,
        factory_id:            anchorFactory,
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
      // Save machine close time entries (independent of submission status)
      await syncCloseEntries(active);
      const { data, error } = await persistOperatorFields(active.id, submit);
      if (error) { showToast("सहेजा नहीं जा सका: " + error.message, true); return; }
      if (!data || data.length === 0) {
        showToast("सहेजना रोका गया — अपनी फ़ैक्टरी पहुँच या कार्ड की स्थिति जाँचें।", true);
        return;
      }

      // Fire-and-forget email only on full submit (not on "save progress")
      if (submit) {
        const nowISO = new Date().toISOString();
        // Fallback MT value (operator enters KG → store MT) if the re-read fails.
        const actualMtValue = actualKg.trim() === "" ? null : Number(actualKg) / 1000;
        // Re-read the updated card fields for oil consumption values
        const { data: updatedCard } = await supabase
          .from("pulveriser_job_cards")
          .select("actual_production_mt,expected_oil_kg,actual_oil_consumption_kg,oil_variance_kg,oil_extra_leftover_balance_kg")
          .eq("id", active.id)
          .single();
        const { subject, html } = buildOperatorEmail({
          jobNumber:                 active.job_number,
          materialCode:              active.material_code,
          actualProductionMt:        updatedCard?.actual_production_mt ?? actualMtValue,
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
          sheetData: {
            type: "job_card",
            row: {
              job_number:                   active.job_number ?? active.id,
              party_code:                   active.party_code ?? null,
              status:                       "submitted_for_qc",
              actual_production_kg:         updatedCard?.actual_production_mt != null
                ? updatedCard.actual_production_mt * 1000
                : (actualMtValue != null ? actualMtValue * 1000 : null),
              expected_oil_kg:              updatedCard?.expected_oil_kg ?? null,
              actual_oil_consumption_kg:    updatedCard?.actual_oil_consumption_kg ?? null,
              oil_variance_kg:              updatedCard?.oil_variance_kg ?? null,
              oil_extra_leftover_balance_kg: updatedCard?.oil_extra_leftover_balance_kg ?? null,
              classifier_vfd:               classifierVfd.trim() || null,
              blower_inlet_valve:           blowerIn.trim() || null,
              blower_outlet_valve:          blowerOut.trim() || null,
              finished_goods_bag:           fgBag.trim() || null,
              packing_size:                 packingSize.trim() || null,
              qc_incharge_note:             qcNote.trim() || null,
              stores_incharge_note:         storesNote.trim() || null,
              work_details:                 workDetails.trim() || null,
              checkpoint_machine_cleaning:  chkClean ? "Yes" : "No",
              checkpoint_roller_check:      chkRoller ? "Yes" : "No",
              checkpoint_mesh_cloth_check:  chkMesh ? "Yes" : "No",
              operator_by:                  profile?.full_name ?? null,
              operator_submitted_at:        nowISO,
            },
          },
        });

        // One sheet row per hourly reading (sheet-only, no email) → the
        // "Hourly Readings" tab of the Job Card sheet, tagged with job_number
        // + party_code so each reading traces back to its parent card.
        for (const r of rows) {
          const diff = Number(r.stop_time) - Number(r.start_time);
          const totalHours = diff > 0 ? diff / 100 : null;
          const hasData =
            r.start_time.trim() !== "" || r.stop_time.trim() !== "" ||
            r.batch_no.trim() !== "" || r.bags.trim() !== "";
          if (!hasData) continue;
          void notifyEvent({
            eventType: "pulveriser_hourly_reading",
            factoryId: active.factory_id,
            referenceId: active.id,
            sheetData: {
              type: "append",
              target: "jobcard",
              tab: "Hourly Readings",
              values: [
                active.job_number ?? active.id,
                active.party_code ?? null,
                r.reading_date || null,
                r.machine || active.machine_number || null,
                r.start_time || null,
                r.stop_time || null,
                totalHours,
                r.planned_production.trim() === "" ? null : Number(r.planned_production),
                r.batch_no || null,
                r.bags.trim() === "" ? null : Number(r.bags),
                r.low_production_reasons.length > 0 ? r.low_production_reasons.join(", ") : null,
                profile?.full_name ?? null,
                nowISO,
              ],
            },
          });
        }
      }

      // Saved to the DB — the local drafts (per-entry + job-level readings) are
      // now redundant.
      draft.clear();
      jobDraft.clear();
      showToast(submit ? "QC के लिए भेजा गया ✓" : "प्रगति सहेजी गई ✓");
      goBack();
      loadPending();
    } catch (e: unknown) {
      showToast("सहेजा नहीं जा सका: " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── List view — one clickable item per JOB NUMBER ────────────────────────
  if (!activeGroup) {
    return (
      <div className="card">
        <h3>भरने के लिए जॉब नंबर</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          प्रोडक्शन ने ये बनाए हैं। जॉब नंबर चुनें, फिर एंट्री चुनकर जानकारी भरें और QC के लिए भेजें।
        </div>
        {loadingList ? (
          <div className="empty">लोड हो रहा है…</div>
        ) : pending.length === 0 ? (
          <div className="empty">कोई लंबित जॉब कार्ड नहीं है।</div>
        ) : (
          groupByJobNumber(pending).map(group => {
            const first = group.entries[0];
            return (
              <div
                className="pending-item"
                key={group.jobNumber ?? first.id}
                onClick={() => openGroup(group.entries)}
                style={{ marginBottom: 10 }}
              >
                <div className="pi-top">
                  <span style={{ fontWeight: 700 }}>जॉब: {group.jobNumber ?? "—"}</span>
                  <span>
                    {group.entries.length > 1
                      ? `${group.entries.length} एंट्री`
                      : "1 एंट्री"}
                  </span>
                </div>
                <div className="pi-sub">
                  {first.machine_number} · {fmtDate(first.job_date)} · {first.shift ?? "—"} शिफ्ट
                </div>
                <div className="pi-sub" style={{ marginTop: 2 }}>
                  {group.entries.map((e, i) => `E${i + 1}: ${e.material_code ?? "—"}`).join("  ·  ")}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4, lineHeight: 1.6 }}>
                  {first.production_at && (
                    <span>📋 Production ने भेजा: {new Date(first.production_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  )}
                  {first.oil_issued_at && (
                    <span style={{ marginLeft: first.production_at ? 12 : 0 }}>
                      🛢 Stores ने तेल दिया: {new Date(first.oil_issued_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  // Guard: group open but no entry selected yet (should not happen).
  if (!active) return null;

  // ── Fill view ─────────────────────────────────────────────────────────────
  return (
    <>
      <button className="back-link" type="button" onClick={goBack}>← सूची पर वापस जाएँ</button>

      {/* Entry selector — which entry of this job number to fill */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>जॉब: {active.job_number ?? "—"}</h3>
        <label>एंट्री चुनें</label>
        <select
          value={active.id}
          onChange={e => {
            const next = activeGroup.find(x => x.id === e.target.value);
            if (next) selectEntry(next);
          }}
        >
          {activeGroup.map((e, i) => (
            <option key={e.id} value={e.id}>
              एंट्री {i + 1} — बैच {e.material_code ?? "—"} · {e.party_code ?? "—"}
            </option>
          ))}
        </select>
        <div className="field-hint" style={{ marginTop: 6 }}>
          इस जॉब नंबर में {activeGroup.length} एंट्री है{activeGroup.length > 1 ? "ं" : ""}।
          हर एंट्री की वास्तविक उत्पादन/मशीन सेटिंग अलग भरें। प्रति घंटा रीडिंग पूरे जॉब के लिए एक ही है (नीचे)।
        </div>
      </div>

      {/* REWORK banner — shown when this card has prior NOT OK reviews */}
      {rejectionHistory.some(r => r.result === "not_ok") && (() => {
        const lastReject = rejectionHistory.find(r => r.result === "not_ok");
        return (
          <div style={{
            padding: "12px 16px", borderRadius: 8, marginBottom: 14,
            background: "var(--warn-soft)",
            border: "2px solid color-mix(in srgb, var(--warn) 50%, transparent)",
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--warn)", marginBottom: 6 }}>
              ! REWORK BATCH -- Lab QC ने पहले REJECT किया था
            </div>
            {lastReject?.remark && (
              <div style={{
                padding: "8px 12px", borderRadius: 6, background: "#fff",
                border: "1px solid color-mix(in srgb, var(--warn) 30%, transparent)",
                marginBottom: 6,
              }}>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 2 }}>
                  Lab की टिप्पणी ({new Date(lastReject.reviewed_at).toLocaleString("en-IN")}):
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--warn)" }}>
                  {lastReject.remark}
                </div>
              </div>
            )}
            {active.stores_incharge_note && (
              <div style={{
                padding: "8px 12px", borderRadius: 6, background: "#fff",
                border: "1px solid color-mix(in srgb, var(--ok) 30%, transparent)",
              }}>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 2 }}>
                  Stores का नोट:
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ok)" }}>
                  {active.stores_incharge_note}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 6 }}>
              यह batch पहले reject हुई थी। Stores ने तेल दोबारा जारी किया है।
              अपने काम में सुधार करें और QC के लिए फिर से submit करें।
              कुल review cycles: {rejectionHistory.length}
            </div>
          </div>
        );
      })()}

      {/* Read-only production + stores reference */}
      <div className="readonly-block">
        <b>{active.machine_number}</b> · {fmtDate(active.job_date)} · {active.shift ?? "—"} शिफ्ट<br />
        <b>बैच नंबर:</b> {active.material_code} · <b>Party/CODE:</b> {active.party_code ?? "—"} · जॉब: {active.job_number ?? "—"}<br />
        <b>सल्फर:</b> {active.sulphur_supplier ?? "—"} / {active.sulphur_lot_number ?? "—"} / {active.sulphur_empty_date ?? "—"}<br />
        <b>तेल:</b> {active.oil_supplier ?? "—"} / {active.oil_batch_number ? (isoToDisplay(active.oil_batch_number) || active.oil_batch_number) : "—"} / {active.oil_quantity ?? "—"}<br />
        <b>नियोजित उत्पादन:</b> {active.planned_production_mt ?? "—"} MT ·{" "}
        <b>तेल जारी (Stores):</b> {active.oil_issued_kg != null ? `${active.oil_issued_kg} kg` : "—"}
        {vfdParam && (
          <>
            <br />
            <b>VFD मानक ({active.party_code}):</b>{" "}
            Classifier {vfdParam.classifier_vfd ?? "—"} · Feeder {vfdParam.feeder_vfd ?? "—"}
          </>
        )}
        {(active.production_at || active.oil_issued_at) && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)",
            fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.8 }}>
            {active.production_at && (
              <div>📋 <b>Production ने भेजा:</b>{" "}
                {new Date(active.production_at).toLocaleString("en-IN", {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
            )}
            {active.oil_issued_at && (
              <div>🛢 <b>Stores ने तेल दिया:</b>{" "}
                {new Date(active.oil_issued_at).toLocaleString("en-IN", {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Checkpoints — at the top */}
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

      {/* 1. Operator machine settings */}
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

      {/* 2. Packing & notes — वास्तविक उत्पादन sits right below bags/packing size */}
      <div className="card">
        <h3>पैकिंग और नोट्स</h3>
        <div className="row2">
          <div>
            <label>तैयार माल बैग</label>
            <input type="number" min="0" step="1" placeholder="0" value={fgBag}
              onChange={e => { setFgBag(e.target.value); recomputeActualKg(e.target.value, packingSize); }} />
          </div>
          <div>
            <label>पैकिंग साइज़</label>
            <select value={packingSize}
              onChange={e => { setPackingSize(e.target.value); recomputeActualKg(fgBag, e.target.value); }}>
              <option value="">-- चुनें --</option>
              {PACKING_SIZE_OPTIONS.map(sz => (
                <option key={sz} value={sz}>{sz} kg</option>
              ))}
            </select>
          </div>
        </div>

        {/* वास्तविक उत्पादन — auto-filled from bags × packing size; drives oil calcs */}
        <label>वास्तविक उत्पादन (kg)</label>
        <input type="number" min="0" step="1" placeholder="0"
          value={actualKg} onChange={e => setActualKg(e.target.value)} />
        <div className="field-hint" style={{ marginTop: 2 }}>
          बैग × पैकिंग साइज़ से अपने-आप भर जाता है। ज़रूरत पर यहाँ बदल सकते हैं।
          तेल की खपत के आँकड़े इसी से गणना होते हैं (सहेजने पर)।
        </div>

        <div className="row2" style={{ marginTop: 12 }}>
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

      {/* Machine Close (Band) Times — ABOVE hourly readings */}
      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>मशीन बंद समय</h3>
          <span className="count">{closeEntries.length}</span>
        </div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          शिफ्ट के दौरान जितनी बार मशीन बंद हो, हर बार एक नई प्रविष्टि जोड़ें।
          नीचे <b>मशीन बंद समय सहेजें</b> दबाएँ — बाद में वापस आकर और प्रविष्टियाँ जोड़ सकते हैं।
        </div>

        {closeEntries.map((e, i) => (
          <div key={e.id} style={{
            border: "1px solid var(--line)", borderRadius: 8,
            padding: 14, marginBottom: 10, background: "var(--surface)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>बंद #{i + 1}</span>
              {closeEntries.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: "3px 10px", color: "var(--warn)" }}
                  onClick={() => removeCloseEntry(e)}
                >
                  हटाएँ
                </button>
              )}
            </div>

            <div className="row3">
              <div>
                <label>तारीख</label>
                <DateField
                  value={e.close_date}
                  onChange={v => updateCloseEntry(e.id, "close_date", v)}
                />
              </div>
              <div>
                <label>बंद समय *</label>
                <input
                  type="time"
                  value={e.close_time}
                  onChange={ev => updateCloseEntry(e.id, "close_time", ev.target.value)}
                />
              </div>
              <div>
                <label>पुनः शुरू समय</label>
                <input
                  type="time"
                  value={e.restart_time}
                  onChange={ev => updateCloseEntry(e.id, "restart_time", ev.target.value)}
                />
              </div>
            </div>

            <label>कारण / टिप्पणी</label>
            <input
              type="text"
              placeholder="जैसे: मेंटेनेन्स, ब्रेक, माल खत्म…"
              value={e.reason}
              onChange={ev => updateCloseEntry(e.id, "reason", ev.target.value)}
            />
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" className="btn btn-ghost" onClick={addCloseEntry}>
            + बंद समय जोड़ें
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitting}
            onClick={async () => {
              if (!active || !user) return;
              setSubmitting(true);
              try {
                await syncCloseEntries(active);
                showToast("मशीन बंद समय सहेजा गया ✓");
              } catch (e: unknown) {
                showToast("सहेजा नहीं जा सका: " + (e instanceof Error ? e.message : String(e)), true);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "सहेजा जा रहा है…" : "मशीन बंद समय सहेजें"}
          </button>
        </div>
      </div>

      {/* तास रीडिंग — JOB-LEVEL, single reading for the whole job number */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>तास रीडिंग</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          यह रीडिंग पूरे जॉब नंबर के लिए एक ही है।
        </div>
        {(() => {
          const r = rows[0];
          if (!r) return null;
          const diff = codedDiff(r.start_time, r.stop_time);
          return (
            <>
              <div className="row2">
                <div>
                  <label>मशीन</label>
                  <input type="text" placeholder={active.machine_number ?? ""} value={r.machine}
                    onChange={e => updateRow(r.id, "machine", e.target.value)} />
                </div>
                <div>
                  <label>रीडिंग तारीख</label>
                  <DateField value={r.reading_date}
                    onChange={v => updateRow(r.id, "reading_date", v)} />
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
            </>
          );
        })()}
      </div>

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

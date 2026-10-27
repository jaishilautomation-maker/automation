"use client";

// =============================================================================
// NutrizinJobCardForm
//   "PROCESS JOB CARD FOR ZINC OXIDE 39.5% SC (NUTRIZIN)"
//
// Template: A20 JOB CARDS FOR AUTOMATION.xlsx — "NUTRIZIN" sheet
//
// The workbook provides two distinct batch variants (843 kg and 808 kg).
// They are NOT proportionally scaled — they carry different quantities.
// The operator selects the batch size and sees the correct Phase A + Phase B
// ingredient tables for that batch.
//
// DB phase keys in product_formula_items.phase (TEXT):
//   'A_843', 'B_843'  — 843 kg batch
//   'A_808', 'B_808'  — 808 kg batch
//
// Template-stated totals:
//   843 kg Phase A: 592.25 kg  ⚠ ingredient sum = 608.48 (discrepancy flagged)
//   843 kg Phase B: 235.33 kg  ✓
//   808 kg Phase A: 567.03 kg  ✓
//   808 kg Phase B: 225.31 kg  ⚠ ingredient sum = 225.32 (discrepancy flagged)
//
// Columns match Excel: Order | Components | Batch no. | Instructions (kgs) |
//                      Added (kgs) | DRUM / BAG NO.
// Water row: DRUM/BAG column shows TDS input.
// ZNO row:   Added (kgs) is editable + auto-filled from bag-weight grid below.
//
// Edit mode: editCardId → UPDATE existing record, no duplicate.
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import DateField from "@/components/DateField";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/lib/toast-context";
import { useFormDraft, draftKey } from "@/lib/use-form-draft";
import type { Product, ProductFormulaItem, ProductionJobCard } from "@/lib/types";
import { useJobCardLang } from "@/lib/job-card-lang-context";
import { makeJcT } from "@/lib/job-card-translations";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type BatchVariant = 843 | 808;

const BATCH_OPTIONS: BatchVariant[] = [843, 808];

// Template-stated totals — may differ from sum of ingredient values (flagged)
const STATED_TOTALS: Record<string, number> = {
  A_843: 592.25,
  B_843: 235.33,
  A_808: 567.03,
  B_808: 225.31,
};

const DISCREPANCY_THRESHOLD = 0.005;
const ACCENT    = "#1565c0";
const BAG_COUNT = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormulaRow {
  formulaItemId: string;
  orderNo: number;
  phaseKey: string;
  componentName: string;
  jscCode: string | null;
  instructedQty: number;    // stored at exact template value
  addedQty: string;
  rmBatchNo: string;
  drumBagNo: string;
  tds: string;
}

type RowInputMap = Record<string, { addedQty: string; rmBatchNo: string; drumBagNo: string; tds: string }>;

interface DraftShape {
  batchVariant: number;
  operatorName: string;
  lotNo: string;
  jobDate: string;
  rowInputs: RowInputMap;
  znoBags843: string[];
  znoAdded843: string;
  znoBags808: string[];
  znoAdded808: string;
  premixStart: string;
  premixEnd: string;
  beadMillStart: string;
  flowRate: string;
  beadMillEnd: string;
  slurryA: string;
  slurryB: string;
  totalScKg: string;
  totalScL: string;
  cpCoolingTower: string;
  cpMechSeal: string;
  cpPipes: string;
  qcZincContent: string;
  qcSuspensibility: string;
  qcDensity: string;
  qcPh: string;
  qcViscosity: string;
  signOperator: string;
  signChemist: string;
  signManager: string;
}

type ExtCard = ProductionJobCard & {
  operator_name: string | null;
  sulphur_bag_weights: { bag_no: number; weight_kg: number | null }[] | null;
  sulphur_added_kg: number | null;
  total_sc_collected_kg: number | null;
  total_sc_collected_l: number | null;
  checkpoint_cooling_tower: string | null;
  checkpoint_mech_seal: string | null;
  checkpoint_pipes: string | null;
  qc_sulphur_content: string | null;
  qc_suspensibility: string | null;
  qc_density: string | null;
  qc_ph: string | null;
  qc_viscosity_sec: string | null;
  sign_operator: string | null;
  sign_chemist: string | null;
  sign_manager: string | null;
  // Stores extra NUTRIZIN fields as JSON
  water_tds_phase_a: string | null;
};

type ItemRow = {
  formula_item_id: string;
  added_qty_kg: number | null;
  rm_batch_no: string | null;
  drum_bag_no: string | null;
  remark: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** Return draftDate only when it equals today; otherwise return today's date.
 *  Prevents a stale localStorage draft from showing yesterday's date. */
function freshDate(draftDate: string | undefined | null): string {
  const t = todayISO();
  return draftDate === t ? t : t;
}
function num(s: string) { const n = parseFloat(s); return isNaN(n) ? 0 : n; }
function blankBags() { return Array.from({ length: BAG_COUNT }, () => ""); }

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      background: ACCENT + "12", borderLeft: `4px solid ${ACCENT}`,
      padding: "8px 14px", fontWeight: 700, fontSize: 13,
      color: ACCENT, marginBottom: 12, borderRadius: "0 6px 6px 0",
    }}>
      {title}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  product: Product;
  factoryId: string;
  userId: string;
  editCardId?: string | null;
  onDone: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NutrizinJobCardForm({ product, factoryId, userId, editCardId, onDone }: Props) {
  const { showToast } = useToast();
  const lang = useJobCardLang();
  const t = makeJcT(lang);
  const supabase = createClient();
  const pathname = usePathname();
  const isEdit = !!editCardId;

  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, factoryId, userId, "NUTRIZIN", editCardId ?? "new"),
  );
  const d0 = draft.restored;

  // ── Header ────────────────────────────────────────────────────────────────
  const [batchVariant, setBatchVariant] = useState<BatchVariant>(
    (d0?.batchVariant as BatchVariant) ?? 843,
  );
  const [operatorName, setOperatorName] = useState(d0?.operatorName ?? "");
  const [lotNo, setLotNo]               = useState(d0?.lotNo ?? "");
  const [jobDate, setJobDate]           = useState(freshDate(d0?.jobDate));

  // ── All formula rows (all 4 phase keys) ───────────────────────────────────
  const [rows, setRows]                   = useState<FormulaRow[]>([]);
  const [loadingFormula, setLoadingFormula] = useState(true);

  // ── ZNO bags per batch ────────────────────────────────────────────────────
  const [znoBags843, setZnoBags843]     = useState<string[]>(d0?.znoBags843 ?? blankBags());
  const [znoAdded843, setZnoAdded843]   = useState(d0?.znoAdded843 ?? "");
  const [bagMismatch843, setBagMismatch843] = useState(false);

  const [znoBags808, setZnoBags808]     = useState<string[]>(d0?.znoBags808 ?? blankBags());
  const [znoAdded808, setZnoAdded808]   = useState(d0?.znoAdded808 ?? "");
  const [bagMismatch808, setBagMismatch808] = useState(false);

  // ── Observations ──────────────────────────────────────────────────────────
  const [premixStart, setPremixStart]     = useState(d0?.premixStart ?? "");
  const [premixEnd, setPremixEnd]         = useState(d0?.premixEnd ?? "");
  const [beadMillStart, setBeadMillStart] = useState(d0?.beadMillStart ?? "");
  const [flowRate, setFlowRate]           = useState(d0?.flowRate ?? "");
  const [beadMillEnd, setBeadMillEnd]     = useState(d0?.beadMillEnd ?? "");
  const [slurryA, setSlurryA]             = useState(d0?.slurryA ?? "");
  const [slurryB, setSlurryB]             = useState(d0?.slurryB ?? "");

  // ── Final / QC / sign-offs ─────────────────────────────────────────────
  const [totalScKg, setTotalScKg] = useState(d0?.totalScKg ?? "");
  const [totalScL, setTotalScL]   = useState(d0?.totalScL ?? "");
  const [cpCoolingTower, setCpCoolingTower] = useState(d0?.cpCoolingTower ?? "");
  const [cpMechSeal, setCpMechSeal]         = useState(d0?.cpMechSeal ?? "");
  const [cpPipes, setCpPipes]               = useState(d0?.cpPipes ?? "");
  const [qcZincContent, setQcZincContent]   = useState(d0?.qcZincContent ?? "");
  const [qcSuspensibility, setQcSuspensibility] = useState(d0?.qcSuspensibility ?? "");
  const [qcDensity, setQcDensity]           = useState(d0?.qcDensity ?? "");
  const [qcPh, setQcPh]                     = useState(d0?.qcPh ?? "");
  const [qcViscosity, setQcViscosity]       = useState(d0?.qcViscosity ?? "");
  const [signOperator, setSignOperator] = useState(d0?.signOperator ?? "");
  const [signChemist, setSignChemist]   = useState(d0?.signChemist ?? "");
  const [signManager, setSignManager]   = useState(d0?.signManager ?? "");

  const [submitting, setSubmitting] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const rowsOf = (pk: string) => rows.filter(r => r.phaseKey === pk);
  const bagTotal843 = znoBags843.reduce((s, w) => s + num(w), 0);
  const bagTotal808 = znoBags808.reduce((s, w) => s + num(w), 0);

  function sumIngredients(pk: string): number {
    return Math.round(rowsOf(pk).reduce((s, r) => s + r.instructedQty, 0) * 100) / 100;
  }
  function discrepancy(pk: string): number {
    return Math.round((sumIngredients(pk) - (STATED_TOTALS[pk] ?? 0)) * 100) / 100;
  }
  function addedTotal(pk: string): number {
    const sum = rowsOf(pk).reduce((s, r) => {
      // ZNO row uses the dedicated bag total field
      if (r.componentName.toUpperCase() === "ZNO") {
        const added = pk.includes("843") ? znoAdded843 : znoAdded808;
        return s + num(added);
      }
      return s + num(r.addedQty);
    }, 0);
    return Math.round(sum * 100) / 100;
  }

  // ── Load formula ──────────────────────────────────────────────────────────
  const loadFormula = useCallback(async (savedInputs?: RowInputMap) => {
    setLoadingFormula(true);
    const { data } = await supabase
      .from("product_formula_items")
      .select("*")
      .eq("product_id", product.id)
      .order("phase").order("order_no");

    const defs = (data ?? []) as ProductFormulaItem[];
    setRows(defs.map(d => {
      const saved = savedInputs?.[d.id];
      return {
        formulaItemId: d.id,
        orderNo:       d.order_no,
        phaseKey:      d.phase ?? "",
        componentName: d.component_name,
        jscCode:       d.jsc_code,
        instructedQty: d.instructed_qty_kg,   // stored at exact 2dp template value
        addedQty:      saved?.addedQty  ?? "",
        rmBatchNo:     saved?.rmBatchNo ?? "",
        drumBagNo:     saved?.drumBagNo ?? "",
        tds:           saved?.tds       ?? "",
      };
    }));
    setLoadingFormula(false);
  }, [supabase, product.id]);

  // Initial load
  useEffect(() => {
    if (isEdit && editCardId) {
      (async () => {
        setLoadingFormula(true);
        const [{ data: rawCard }, { data: items }, { data: formulaDefs }] = await Promise.all([
          supabase.from("production_job_cards").select("*").eq("id", editCardId).single(),
          supabase.from("production_job_card_items")
            .select("formula_item_id, added_qty_kg, rm_batch_no, drum_bag_no, remark")
            .eq("job_card_id", editCardId),
          supabase.from("product_formula_items").select("*")
            .eq("product_id", product.id).order("phase").order("order_no"),
        ]);
        if (!rawCard) { showToast(t("toastLoadFailed"), true); onDone(); return; }
        const card = rawCard as unknown as ExtCard;

        setBatchVariant((card.batch_size_kg === 808 ? 808 : 843) as BatchVariant);
        setOperatorName(card.operator_name ?? "");
        setLotNo(card.lot_no ?? "");
        setJobDate(card.job_date ?? todayISO());
        setPremixStart(card.premix_start ?? "");
        setPremixEnd(card.premix_end ?? "");
        setBeadMillStart(card.bead_mill_start ?? "");
        setFlowRate(card.flow_rate != null ? String(card.flow_rate) : "");
        setBeadMillEnd(card.bead_mill_end ?? "");
        setSlurryA(card.collected_slurry_phase_a_kg != null ? String(card.collected_slurry_phase_a_kg) : "");
        setSlurryB(card.collected_slurry_phase_b_kg != null ? String(card.collected_slurry_phase_b_kg) : "");

        // Extra fields from JSON in water_tds_phase_a
        try {
          const extra = card.water_tds_phase_a ? JSON.parse(card.water_tds_phase_a) : {};
          if (Array.isArray(extra.znoBags843)) setZnoBags843(extra.znoBags843);
          setZnoAdded843(extra.znoAdded843 ?? "");
          if (Array.isArray(extra.znoBags808)) setZnoBags808(extra.znoBags808);
          setZnoAdded808(extra.znoAdded808 ?? "");
        } catch { /* ignore */ }

        setTotalScKg(card.total_sc_collected_kg != null ? String(card.total_sc_collected_kg) : "");
        setTotalScL(card.total_sc_collected_l  != null ? String(card.total_sc_collected_l)  : "");
        setCpCoolingTower(card.checkpoint_cooling_tower ?? "");
        setCpMechSeal(card.checkpoint_mech_seal ?? "");
        setCpPipes(card.checkpoint_pipes ?? "");
        setQcZincContent(card.qc_sulphur_content ?? "");
        setQcSuspensibility(card.qc_suspensibility ?? "");
        setQcDensity(card.qc_density ?? "");
        setQcPh(card.qc_ph ?? "");
        setQcViscosity(card.qc_viscosity_sec ?? "");
        setSignOperator(card.sign_operator ?? "");
        setSignChemist(card.sign_chemist ?? "");
        setSignManager(card.sign_manager ?? "");

        const itemMap: Record<string, ItemRow> = {};
        for (const it of (items ?? []) as ItemRow[]) itemMap[it.formula_item_id] = it;

        setRows(((formulaDefs ?? []) as ProductFormulaItem[]).map(d => {
          const it = itemMap[d.id];
          return {
            formulaItemId: d.id,
            orderNo:       d.order_no,
            phaseKey:      d.phase ?? "",
            componentName: d.component_name,
            jscCode:       d.jsc_code,
            instructedQty: d.instructed_qty_kg,
            addedQty:      it?.added_qty_kg != null ? String(it.added_qty_kg) : "",
            rmBatchNo:     it?.rm_batch_no  ?? "",
            drumBagNo:     it?.drum_bag_no  ?? "",
            tds:           it?.remark       ?? "",
          };
        }));
        setLoadingFormula(false);
      })();
    } else {
      loadFormula(d0?.rowInputs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draft autosave
  const draftSave = draft.save;
  useEffect(() => {
    if (isEdit) return;
    const rowInputs: RowInputMap = {};
    rows.forEach(r => { rowInputs[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, drumBagNo: r.drumBagNo, tds: r.tds }; });
    draftSave({
      batchVariant, operatorName, lotNo, jobDate, rowInputs,
      znoBags843, znoAdded843, znoBags808, znoAdded808,
      premixStart, premixEnd, beadMillStart, flowRate, beadMillEnd,
      slurryA, slurryB, totalScKg, totalScL,
      cpCoolingTower, cpMechSeal, cpPipes,
      qcZincContent, qcSuspensibility, qcDensity, qcPh, qcViscosity,
      signOperator, signChemist, signManager,
    });
  }, [batchVariant, operatorName, lotNo, jobDate, rows,
      znoBags843, znoAdded843, znoBags808, znoAdded808,
      premixStart, premixEnd, beadMillStart, flowRate, beadMillEnd,
      slurryA, slurryB, totalScKg, totalScL,
      cpCoolingTower, cpMechSeal, cpPipes,
      qcZincContent, qcSuspensibility, qcDensity, qcPh, qcViscosity,
      signOperator, signChemist, signManager, draftSave, isEdit]);

  // ── Row updater ───────────────────────────────────────────────────────────
  type RowField = "addedQty" | "rmBatchNo" | "drumBagNo" | "tds";
  const updateRow = (id: string, field: RowField, val: string) =>
    setRows(prev => prev.map(r => r.formulaItemId === id ? { ...r, [field]: val } : r));

  // ── Bag helpers ───────────────────────────────────────────────────────────
  function updateBag843(idx: number, val: string) {
    setZnoBags843(prev => {
      const next = [...prev]; next[idx] = val;
      const total = next.reduce((s, w) => s + num(w), 0);
      setZnoAdded843(prev2 => (!prev2 || Math.abs(num(prev2) - prev.reduce((s, w) => s + num(w), 0)) < 0.001)
        ? (total > 0 ? total.toFixed(2) : "") : prev2);
      setBagMismatch843(false); return next;
    });
  }
  function updateBag808(idx: number, val: string) {
    setZnoBags808(prev => {
      const next = [...prev]; next[idx] = val;
      const total = next.reduce((s, w) => s + num(w), 0);
      setZnoAdded808(prev2 => (!prev2 || Math.abs(num(prev2) - prev.reduce((s, w) => s + num(w), 0)) < 0.001)
        ? (total > 0 ? total.toFixed(2) : "") : prev2);
      setBagMismatch808(false); return next;
    });
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!lotNo.trim()) return t("valLotRequired");
    if (batchVariant === 843 && bagMismatch843) return t("valZno843Mismatch");
    if (batchVariant === 808 && bagMismatch808) return t("valZno808Mismatch");
    return null;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (statusVal: "draft" | "submitted") => {
    const err = validate();
    if (err) { showToast(err, true); return; }
    setSubmitting(true);
    try {
      // ZNO bags for the active variant go into sulphur_bag_weights
      const activeBags = batchVariant === 843 ? znoBags843 : znoBags808;
      const znoBagJson = activeBags.map((w, i) => ({
        bag_no: i + 1, weight_kg: w !== "" ? parseFloat(w) : null,
      }));
      const activeZnoAdded = batchVariant === 843 ? znoAdded843 : znoAdded808;

      // All bag data serialised into water_tds_phase_a for completeness
      const extraJson = JSON.stringify({
        znoBags843, znoAdded843, znoBags808, znoAdded808,
      });

      const cardPayload = {
        factory_id:                  factoryId,
        product_id:                  product.id,
        lot_no:                      lotNo.trim(),
        job_date:                    jobDate,
        operator_id:                 userId,
        batch_size_kg:               batchVariant,
        operator_name:               operatorName.trim() || null,
        premix_start:                premixStart   || null,
        premix_end:                  premixEnd     || null,
        bead_mill_start:             beadMillStart || null,
        bead_mill_end:               beadMillEnd   || null,
        flow_rate:                   flowRate ? parseFloat(flowRate) : null,
        collected_slurry_phase_a_kg: slurryA ? parseFloat(slurryA) : null,
        collected_slurry_phase_b_kg: slurryB ? parseFloat(slurryB) : null,
        sulphur_bag_weights:         znoBagJson,
        sulphur_added_kg:            activeZnoAdded ? parseFloat(activeZnoAdded) : null,
        water_tds_phase_a:           extraJson,
        total_sc_collected_kg:       totalScKg ? parseFloat(totalScKg) : null,
        total_sc_collected_l:        totalScL  ? parseFloat(totalScL)  : null,
        checkpoint_cooling_tower:    cpCoolingTower || null,
        checkpoint_mech_seal:        cpMechSeal     || null,
        checkpoint_pipes:            cpPipes        || null,
        qc_sulphur_content:          qcZincContent  || null,
        qc_suspensibility:           qcSuspensibility || null,
        qc_density:                  qcDensity      || null,
        qc_ph:                       qcPh           || null,
        qc_viscosity_sec:            qcViscosity    || null,
        sign_operator:               signOperator   || null,
        sign_chemist:                signChemist    || null,
        sign_manager:                signManager    || null,
        status:                      statusVal,
      };

      // Only save formula rows for the active batch variant
      const pk_a = `A_${batchVariant}`;
      const pk_b = `B_${batchVariant}`;
      const activeRows = rows.filter(r => r.phaseKey === pk_a || r.phaseKey === pk_b);

      let cardId: string;

      if (isEdit && editCardId) {
        const { data, error } = await supabase
          .from("production_job_cards").update(cardPayload)
          .eq("id", editCardId).select("id").single();
        if (error || !data) { showToast(t("toastUpdateFailed") + (error?.message ?? t("toastUnknown")), true); return; }
        cardId = editCardId;
        for (const r of activeRows) {
          await supabase.from("production_job_card_items").upsert({
            job_card_id: cardId, formula_item_id: r.formulaItemId,
            instructed_qty_kg: r.instructedQty,
            added_qty_kg: r.addedQty ? parseFloat(r.addedQty) : null,
            rm_batch_no: r.rmBatchNo || null,
            drum_bag_no: r.drumBagNo || null,
            remark: r.tds || null,
          }, { onConflict: "job_card_id,formula_item_id" });
        }
      } else {
        const { data, error } = await supabase
          .from("production_job_cards").insert(cardPayload).select("id").single();
        if (error || !data) { showToast(t("toastSaveFailed") + (error?.message ?? t("toastUnknown")), true); return; }
        cardId = data.id;
        if (activeRows.length > 0) {
          const { error: itemErr } = await supabase.from("production_job_card_items").insert(
            activeRows.map(r => ({
              job_card_id: cardId, formula_item_id: r.formulaItemId,
              instructed_qty_kg: r.instructedQty,
              added_qty_kg: r.addedQty ? parseFloat(r.addedQty) : null,
              rm_batch_no: r.rmBatchNo || null,
              drum_bag_no: r.drumBagNo || null,
              remark: r.tds || null,
            }))
          );
          if (itemErr) { showToast(t("toastItemsFailed") + itemErr.message, true); return; }
        }
        draft.clear();
      }

      showToast(isEdit ? t("toastUpdated") : statusVal === "submitted" ? t("toastSubmitted") : t("toastDraftSaved"));
      onDone();
    } catch (e: unknown) {
      showToast(t("toastNetworkError") + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  // ---------------------------------------------------------------------------
  // Phase table renderer
  // ---------------------------------------------------------------------------
  const thS: React.CSSProperties = {
    padding: "6px 10px", textAlign: "left", fontWeight: 600,
    color: "var(--ink-soft)", whiteSpace: "nowrap", background: ACCENT + "10",
  };
  const tdS: React.CSSProperties = { padding: "5px 10px" };

  function renderPhaseTable(phaseKey: string, znoAdded: string, setZnoAdded: React.Dispatch<React.SetStateAction<string>>, mismatch: boolean, setMismatch: React.Dispatch<React.SetStateAction<boolean>>) {
    const groupRows = rowsOf(phaseKey);
    const stated = STATED_TOTALS[phaseKey] ?? 0;
    const sumIngr = sumIngredients(phaseKey);
    const diff = Math.round((sumIngr - stated) * 100) / 100;
    const hasMismatch = Math.abs(diff) >= DISCREPANCY_THRESHOLD;
    const addedTotalVal = addedTotal(phaseKey);
    const isPhaseA = phaseKey.startsWith("A");

    if (loadingFormula) return <div className="empty">{t("loading")}</div>;
    if (groupRows.length === 0) return (
      <div className="field-hint" style={{ color: "var(--warn)" }}>
        No formula items found for {phaseKey}. Run migration 014.
      </div>
    );

    return (
      <>
        {hasMismatch && (
          <div style={{
            marginBottom: 10, padding: "10px 14px", borderRadius: 8,
            background: "#fff8e1", border: "1px solid #f9a825",
            fontSize: 13, color: "#e65100",
          }}>
            ⚠ <b>{t("discrepancyLabel")}</b> {t("discrepancyText")} {sumIngr.toFixed(2)} kg,
            {t("discrepancyStated")} {stated.toFixed(2)} kg
            ({diff > 0 ? "+" : ""}{diff.toFixed(2)} kg).
            {t("discrepancyNote")}
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${ACCENT}40` }}>
                <th style={thS}>Order</th>
                <th style={thS}>Components</th>
                <th style={thS}>Batch no.</th>
                <th style={{ ...thS, textAlign: "right" }}>Instructions (kgs)</th>
                <th style={{ ...thS, textAlign: "right" }}>Added (kgs)</th>
                <th style={thS}>DRUM / BAG NO.</th>
              </tr>
            </thead>
            <tbody>
              {groupRows.map(r => {
                const isZno   = r.componentName.toUpperCase() === "ZNO";
                const isWater = r.componentName.toLowerCase() === "water";
                return (
                  <tr key={r.formulaItemId}
                    style={{ borderBottom: "1px solid var(--line)", background: isZno ? "#e3f2fd" : undefined }}>
                    <td style={tdS}>{r.orderNo}</td>
                    <td style={{ ...tdS, fontWeight: 600 }}>{r.componentName}</td>
                    <td style={{ ...tdS, padding: "4px 6px" }}>
                      <input type="text" placeholder=t("colBatchNoLower") value={r.rmBatchNo}
                        onChange={e => updateRow(r.formulaItemId, "rmBatchNo", e.target.value)}
                        style={{ width: 90 }} />
                    </td>
                    <td style={{ ...tdS, textAlign: "right", fontWeight: 700, color: ACCENT }}>
                      {r.instructedQty.toFixed(2)}
                    </td>
                    <td style={{ ...tdS, padding: "4px 6px", textAlign: "right" }}>
                      {isZno ? (
                        <input type="number" step="any"
                          placeholder={r.instructedQty.toFixed(2)}
                          value={znoAdded}
                          onChange={e => {
                            setZnoAdded(e.target.value);
                            const bagT = phaseKey.includes("843") ? bagTotal843 : bagTotal808;
                            setMismatch(e.target.value !== "" && Math.abs(num(e.target.value) - bagT) > 0.01 && bagT > 0);
                          }}
                          style={{ width: 90, textAlign: "right",
                            borderColor: mismatch ? "var(--warn)" : undefined }} />
                      ) : (
                        <input type="number" step="any"
                          placeholder={r.instructedQty.toFixed(2)}
                          value={r.addedQty}
                          onChange={e => updateRow(r.formulaItemId, "addedQty", e.target.value)}
                          style={{ width: 90, textAlign: "right" }} />
                      )}
                    </td>
                    <td style={{ ...tdS, padding: "4px 6px" }}>
                      {isZno ? (
                        <input type="text" placeholder={t("placeholderDrumBag")} value={r.drumBagNo}
                          onChange={e => updateRow(r.formulaItemId, "drumBagNo", e.target.value)}
                          style={{ width: 90 }} />
                      ) : isWater ? (
                        <input type="text" placeholder={t("placeholderTds")} value={r.tds}
                          onChange={e => updateRow(r.formulaItemId, "tds", e.target.value)}
                          style={{ width: 80 }} />
                      ) : (
                        <input type="text" placeholder={t("placeholderDrumBag")} value={r.drumBagNo}
                          onChange={e => updateRow(r.formulaItemId, "drumBagNo", e.target.value)}
                          style={{ width: 90 }} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: ACCENT + "08", fontWeight: 700, fontSize: 13 }}>
                <td colSpan={2} style={{ padding: "6px 10px" }}>
                  {isPhaseA ? t("totalPHASEA") : t("totalPHASEB")}
                  {hasMismatch && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: "#e65100" }}>
                      ⚠ ingredient sum = {sumIngr.toFixed(2)}
                    </span>
                  )}
                </td>
                <td style={{ padding: "6px 10px" }} />
                <td style={{ padding: "6px 10px", textAlign: "right", color: ACCENT }}>
                  {stated.toFixed(2)}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>
                  {addedTotalVal > 0 ? addedTotalVal.toFixed(2) : "—"}
                </td>
                <td style={{ padding: "6px 10px" }} />
              </tr>
            </tfoot>
          </table>
        </div>
      </>
    );
  }

  // ── ZNO bag grid renderer ─────────────────────────────────────────────────
  function renderBagGrid(
    bags: string[],
    updateFn: (idx: number, val: string) => void,
    znoAdded: string,
    bagTotal: number,
    mismatch: boolean,
  ) {
    return (
      <div className="card">
        <SectionHeader title={t("secZnoBagDetails")} />
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Enter weight per bag. Total auto-fills the Added (kgs) field in the ZNO row above.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[0, 10].map(offset => (
            <table key={offset} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: ACCENT + "10" }}>
                  <th style={thS}>Bag No.</th>
                  <th style={{ ...thS, textAlign: "right" }}>Weight (kg)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }, (_, i) => offset + i).map(i => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={tdS}>{i + 1}</td>
                    <td style={{ ...tdS, padding: "3px 6px" }}>
                      <input type="number" step="any" placeholder="—" value={bags[i]}
                        onChange={e => updateFn(i, e.target.value)}
                        style={{ width: "100%", textAlign: "right" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <div style={{
          marginTop: 14, padding: "10px 14px", background: ACCENT + "08",
          borderRadius: 8, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center",
        }}>
          <div style={{ fontSize: 13 }}>
            <span style={{ color: "var(--ink-soft)" }}>Bag weight total:</span>{" "}
            <b style={{ color: ACCENT }}>{bagTotal.toFixed(2)} kg</b>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            ↑ Auto-fills ZNO Added (kgs) in the table above
          </div>
        </div>
        {mismatch && (
          <div style={{
            marginTop: 10, padding: "10px 14px", borderRadius: 8,
            background: "var(--warn-soft)", border: "1px solid var(--warn)",
            fontSize: 13, color: "var(--warn)", fontWeight: 600,
          }}>
            ⚠ ZNO Added ({znoAdded} kg) differs from bag weight total ({bagTotal.toFixed(2)} kg).
            Reconcile before saving.
          </div>
        )}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const pk_a = `A_${batchVariant}` as const;
  const pk_b = `B_${batchVariant}` as const;
  const is843 = batchVariant === 843;
  const znoBagsActive   = is843 ? znoBags843   : znoBags808;
  const znoAddedActive  = is843 ? znoAdded843  : znoAdded808;
  const updateBagActive = is843 ? updateBag843 : updateBag808;
  const bagTotalActive  = is843 ? bagTotal843  : bagTotal808;
  const bagMismatchActive = is843 ? bagMismatch843 : bagMismatch808;

  return (
    <>
      <button type="button" className="back-link" onClick={onDone}>{t("backLink")}</button>

      {/* Banner */}
      <div style={{ background: ACCENT, color: "#fff", padding: "16px 20px", borderRadius: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.8px", opacity: 0.8, marginBottom: 2 }}>
          {t("companyName")}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.3 }}>
          PROCESS JOB CARD FOR ZINC OXIDE 39.5% SC (NUTRIZIN)
        </div>
        {isEdit && <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>{t("editingBanner")}</div>}
      </div>

      {/* ── 1. HEADER ─────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secJobCardHeader")} />
        <div className="row2">
          <div>
            <label>{t("operatorName")}</label>
            <input type="text" placeholder={t("placeholderName")} value={operatorName}
              onChange={e => setOperatorName(e.target.value)} />
          </div>
          <div>
            <label>{t("batchSizeKg")}</label>
            <div className="chip-group" style={{ marginTop: 6 }}>
              {BATCH_OPTIONS.map(size => (
                <div key={size}
                  className={`chip${batchVariant === size ? " selected" : ""}`}
                  onClick={() => !isEdit && setBatchVariant(size)}
                  style={{ cursor: isEdit ? "not-allowed" : "pointer" }}
                >
                  {size} kg
                </div>
              ))}
            </div>
            {isEdit && (
              <div className="field-hint" style={{ marginTop: 4 }}>
                Batch size cannot be changed when editing.
              </div>
            )}
          </div>
        </div>
        <div className="row2">
          <div>
            <label>{t("lotNo")}</label>
            <input type="text" placeholder={t("placeholderLotNo")} value={lotNo}
              onChange={e => setLotNo(e.target.value)} />
          </div>
          <div>
            <label>{t("date")}</label>
            <DateField value={jobDate} onChange={setJobDate} />
          </div>
        </div>
      </div>

      {/* ── 2. PHASE A ────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={`${lang === "hi" ? "फेज़ A" : "PHASE A"} — ${batchVariant} kg`} />
        {renderPhaseTable(pk_a, znoAddedActive, is843 ? setZnoAdded843 : setZnoAdded808, bagMismatchActive, is843 ? setBagMismatch843 : setBagMismatch808)}
      </div>

      {/* ── 3. ZNO BAG DETAILS ───────────────────────────────────────────── */}
      {renderBagGrid(znoBagsActive, updateBagActive, znoAddedActive, bagTotalActive, bagMismatchActive)}

      {/* ── 4. OBSERVATIONS ──────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secObservations")} />
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t("preMix")}</div>
        <div className="row2">
          <div><label>{t("startTime")}</label>
            <input type="time" value={premixStart} onChange={e => setPremixStart(e.target.value)} /></div>
          <div><label>{t("endTime")}</label>
            <input type="time" value={premixEnd} onChange={e => setPremixEnd(e.target.value)} /></div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, marginTop: 14, marginBottom: 8 }}>{t("beadMill")}</div>
        <div className="row2">
          <div><label>{t("startTime")}</label>
            <input type="time" value={beadMillStart} onChange={e => setBeadMillStart(e.target.value)} /></div>
          <div><label>{t("flowRateSL")}</label>
            <input type="number" step="any" placeholder="0" value={flowRate}
              onChange={e => setFlowRate(e.target.value)} /></div>
        </div>
        <div className="row2" style={{ marginTop: 8 }}>
          <div><label>{t("endTime")}</label>
            <input type="time" value={beadMillEnd} onChange={e => setBeadMillEnd(e.target.value)} /></div>
          <div>
            <label>{t("totalPhaseAAddedCalc")}</label>
            <input type="number" readOnly value={addedTotal(pk_a) > 0 ? addedTotal(pk_a).toFixed(2) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
        </div>
        <div className="row2" style={{ marginTop: 8 }}>
          <div>
            <label>{t("collectedSlurryA")}</label>
            <input type="number" step="any" placeholder="0" value={slurryA}
              onChange={e => setSlurryA(e.target.value)} />
          </div>
          <div />
        </div>
      </div>

      {/* ── 5. PHASE B ────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={`${lang === "hi" ? "फेज़ B" : "PHASE B"} — ${batchVariant} kg`} />
        {renderPhaseTable(pk_b, znoAddedActive, is843 ? setZnoAdded843 : setZnoAdded808, bagMismatchActive, is843 ? setBagMismatch843 : setBagMismatch808)}
        <div className="row2" style={{ marginTop: 14 }}>
          <div>
            <label>{t("totalPhaseBAddedCalc")}</label>
            <input type="number" readOnly value={addedTotal(pk_b) > 0 ? addedTotal(pk_b).toFixed(2) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
          <div>
            <label>{t("collectedSlurryB")}</label>
            <input type="number" step="any" placeholder="0" value={slurryB}
              onChange={e => setSlurryB(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── 6. FINAL COLLECTION ──────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secFinalCollection")} />
        <div className="row2">
          <div><label>{t("totalScCollectedKg")}</label>
            <input type="number" step="any" placeholder="0" value={totalScKg}
              onChange={e => setTotalScKg(e.target.value)} /></div>
          <div><label>{t("totalScCollectedL")}</label>
            <input type="number" step="any" placeholder="0" value={totalScL}
              onChange={e => setTotalScL(e.target.value)} /></div>
        </div>
      </div>

      {/* ── 7. CHECK POINTS ──────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secCheckPoints")} />
        {([
          [t("cpCoolingTower"), cpCoolingTower, setCpCoolingTower],
          [t("cpMechSeal"),        cpMechSeal,     setCpMechSeal],
          [t("cpPipes"), cpPipes, setCpPipes],
        ] as [string, string, React.Dispatch<React.SetStateAction<string>>][]).map(([label, val, setter]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
            <span style={{ minWidth: 240, fontSize: 13, fontWeight: 500 }}>{label}</span>
            <input type="text" placeholder={t("cpObsPlaceholder")} value={val}
              onChange={e => setter(e.target.value)} style={{ flex: 1 }} />
          </div>
        ))}
      </div>

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <button className="btn btn-primary" type="button" disabled={submitting}
          onClick={() => handleSave("submitted")}>
          {submitting ? t("saving") : isEdit ? t("saveChanges") : t("submitJobCard")}
        </button>
        {!isEdit && (
          <button className="btn btn-secondary" type="button" disabled={submitting}
            onClick={() => handleSave("draft")}>
            {t("saveAsDraft")}
          </button>
        )}
        <button className="btn btn-ghost" type="button" disabled={submitting} onClick={onDone}>
          {t(t("cancel"))}
        </button>
      </div>
    </>
  );
}


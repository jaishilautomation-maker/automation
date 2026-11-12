"use client";

// =============================================================================
// SulphurScJobCardForm
//   "PROCESS JOB CARD FOR SULPHUR SC (55.16%) (GAIN / INSTASUL)"
//
// Template source: A20 JOB CARDS FOR AUTOMATION.xlsx — "SULPHUR SC" sheet
// Reference batch size: 630 kg
//
// Sections:
//   1. Job Card Header  (operator name, batch size default 630, lot no, date)
//   2. Phase A — ingredients (8 rows; order 3 has JSC57/JSC07 dropdown)
//   3. Sulphur Bag Details (bags 1–20)
//   4. Phase A — Observations
//   5. Phase B — ingredients (4 rows)
//   6. Final Collection
//   7. Check Points
//   8. Remarks / QC Observations
//   9. Sign-offs
//
// Instruction quantities stored at 2dp (matching Excel display values):
//   Phase A: 144.18 + 4.15 + 15.66 + 4.15 + 29.48 + 1.38 + 2.76 + 350.07 = 551.83
//   Phase B: 1.84 + 20.00 + 57.00 + 0.18 = 79.02
//
// DB: same columns added by migration 012.
// Edit mode: pass editCardId to load + UPDATE (no duplicate).
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import DateField from "@/components/DateField";
import NumericInput from '@/components/NumericInput';
import TimeField from "@/components/TimeField";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/lib/toast-context";
import { useFormDraft, draftKey } from "@/lib/use-form-draft";
import type { Product, ProductFormulaItem, ProductionJobCard } from "@/lib/types";
import { useJobCardLang } from "@/lib/job-card-lang-context";
import { makeJcT } from "@/lib/job-card-translations";
import DynamicIngredientRows, { type ExtraRow } from "@/components/DynamicIngredientRows";
import { parseExtraRows, serialiseExtraRows, extraInstructedTotal, extraAddedTotal } from "@/lib/extra-ingredient-rows";
import { normalizeLot } from "@/lib/job-card/phase-b-calc";
import PhaseWorkflowPanel from "@/components/PhaseWorkflowPanel";
import PhaseWorkflowActions from "@/components/PhaseWorkflowActions";
import type { PhaseBSnapshot } from "@/lib/job-card/phase-b-review";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REF_BATCH_KG   = 630;
/** Displayed Phase A instruction total (sum of 2dp stored values). */
const PHASE_A_DISPLAY_TOTAL = 551.83;
/** Displayed Phase B instruction total. */
const PHASE_B_DISPLAY_TOTAL = 79.02;
const ACCENT    = "#b5451b";
const BAG_COUNT = 20;
const JSC3_OPTIONS = ["JSC57", "JSC07"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormulaRow {
  formulaItemId: string;
  orderNo: number;
  phase: "A" | "B";
  componentName: string;
  jscCode: string | null;
  instructedQty: number;   // 2dp stored value, displayed as-is
  addedQty: string;
  rmBatchNo: string;
  drumBagNo: string;
  tds: string;
}

interface DraftShape {
  operatorName: string;
  batchSize: string;
  lotNo: string;
  jobDate: string;
  jsc3Selection: string;
  rowInputsA: Record<string, { addedQty: string; rmBatchNo: string; drumBagNo: string; tds: string }>;
  sulphurBags: string[];
  sulphurAddedKg: string;
  premixStart: string;
  premixEnd: string;
  beadMillStart: string;
  flowRate: string;
  beadMillEnd: string;
  slurryA: string;
  meterInitial: string;
  meterFinal: string;
  rowInputsB: Record<string, { addedQty: string; rmBatchNo: string; drumBagNo: string; tds: string }>;
  slurryB: string;
  extraRows: ExtraRow[];
  totalScKg: string;
  totalScL: string;
  cpCoolingTower: string;
  cpMechSeal: string;
  cpPipes: string;
  qcSulphurContent: string;
  qcSuspensibility: string;
  qcDensity: string;
  qcPh: string;
  qcViscosity: string;
  signOperator: string;
  signChemist: string;
  signManager: string;
}

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
function num(s: string): number { const n = parseFloat(s); return isNaN(n) ? 0 : n; }
function blankBags(): string[] { return Array.from({ length: BAG_COUNT }, () => ""); }

/**
 * Scale a stored 2dp instructed qty proportionally when batch size changes.
 * We keep 2dp precision throughout so displayed values stay clean.
 */
function scaleQty(instructed: number, ref: number, actual: number): number {
  if (!ref || !actual || actual === ref) return instructed;
  return Math.round((instructed / ref) * actual * 100) / 100;
}

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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 13, padding: "3px 0" }}>
      <span style={{ color: "var(--ink-soft)", minWidth: 200 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// Extended card type — includes migration 012 columns
type ExtCard = ProductionJobCard & {
  operator_name: string | null;
  jsc3_code_selection: string | null;
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
  // migration 039 (Phase A -> chemist -> Phase B workflow)
  phase_b_calc: PhaseBSnapshot | null;
  limit_exceeded_case: number | null;
  limit_remark: string | null;
};

type ItemRow = {
  formula_item_id: string;
  instructed_qty_kg: number | null;
  added_qty_kg: number | null;
  rm_batch_no: string | null;
  drum_bag_no: string | null;
  remark: string | null;
};

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

export default function SulphurScJobCardForm({ product, factoryId, userId, editCardId, onDone }: Props) {
  const { showToast } = useToast();
  const lang = useJobCardLang();
  const t = makeJcT(lang);
  const supabase = createClient();
  const pathname = usePathname();
  const isEdit = !!editCardId;

  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, factoryId, userId, "SULPHUR_SC", editCardId ?? "new"),
  );
  const d0 = draft.restored;

  // ── Header ────────────────────────────────────────────────────────────────
  const [operatorName, setOperatorName]   = useState(d0?.operatorName ?? "");
  const [batchSize, setBatchSize]         = useState(d0?.batchSize ?? String(REF_BATCH_KG));
  const [lotNo, setLotNo]                 = useState(d0?.lotNo ?? "");
  const [jobDate, setJobDate]             = useState(freshDate(d0?.jobDate));
  const [jsc3Selection, setJsc3Selection] = useState(d0?.jsc3Selection ?? "");

  // ── Formula rows ──────────────────────────────────────────────────────────
  const [rowsA, setRowsA]                 = useState<FormulaRow[]>([]);
  const [rowsB, setRowsB]                 = useState<FormulaRow[]>([]);
  const [loadingFormula, setLoadingFormula] = useState(true);

  // ── Sulphur bags ──────────────────────────────────────────────────────────
  const [sulphurBags, setSulphurBags]       = useState<string[]>(d0?.sulphurBags ?? blankBags());
  // sulphurAddedKg is always derived from the bag total — never entered manually.
  const [sulphurAddedKg, setSulphurAddedKg] = useState(d0?.sulphurAddedKg ?? "");

  // ── Phase A observations ──────────────────────────────────────────────────
  const [premixStart, setPremixStart]       = useState(d0?.premixStart ?? "");
  const [premixEnd, setPremixEnd]           = useState(d0?.premixEnd ?? "");
  const [beadMillStart, setBeadMillStart]   = useState(d0?.beadMillStart ?? "");
  const [flowRate, setFlowRate]             = useState(d0?.flowRate ?? "");
  const [beadMillEnd, setBeadMillEnd]       = useState(d0?.beadMillEnd ?? "");
  const [slurryA, setSlurryA]               = useState(d0?.slurryA ?? "");

  // ── Meter readings ────────────────────────────────────────────────────────
  const [meterInitial, setMeterInitial] = useState(d0?.meterInitial ?? "");
  const [meterFinal, setMeterFinal]     = useState(d0?.meterFinal ?? "");

  // ── Dynamic extra ingredient rows ─────────────────────────────────────────
  const [extraRows, setExtraRows] = useState<ExtraRow[]>(d0?.extraRows ?? []);

  // ── Final ─────────────────────────────────────────────────────────────────
  const [slurryB, setSlurryB]     = useState(d0?.slurryB ?? "");
  const [totalScKg, setTotalScKg] = useState(d0?.totalScKg ?? "");
  const [totalScL, setTotalScL]   = useState(d0?.totalScL ?? "");

  // ── Checkpoints ───────────────────────────────────────────────────────────
  const [cpCoolingTower, setCpCoolingTower] = useState(d0?.cpCoolingTower ?? "");
  const [cpMechSeal, setCpMechSeal]         = useState(d0?.cpMechSeal ?? "");
  const [cpPipes, setCpPipes]               = useState(d0?.cpPipes ?? "");

  // ── QC / remarks ──────────────────────────────────────────────────────────
  const [qcSulphurContent, setQcSulphurContent] = useState(d0?.qcSulphurContent ?? "");
  const [qcSuspensibility, setQcSuspensibility] = useState(d0?.qcSuspensibility ?? "");
  const [qcDensity, setQcDensity]               = useState(d0?.qcDensity ?? "");
  const [qcPh, setQcPh]                         = useState(d0?.qcPh ?? "");
  const [qcViscosity, setQcViscosity]           = useState(d0?.qcViscosity ?? "");

  // ── Sign-offs ─────────────────────────────────────────────────────────────
  const [signOperator, setSignOperator] = useState(d0?.signOperator ?? "");
  const [signChemist, setSignChemist]   = useState(d0?.signChemist ?? "");
  const [signManager, setSignManager]   = useState(d0?.signManager ?? "");

  const [submitting, setSubmitting] = useState(false);

  // ── Phase A -> chemist -> Phase B workflow state (loaded from the card) ───
  // "draft" for a new card. Legacy cards (saved "submitted" before the workflow,
  // no chemist calculation) keep the old, fully editable behaviour.
  const [wfStatus, setWfStatus]         = useState<string>("draft");
  const [snapshot, setSnapshot]         = useState<PhaseBSnapshot | null>(null);
  const [limitCase, setLimitCase]       = useState<number | null>(null);
  const [limitRemark, setLimitRemark]   = useState("");
  const isLegacy        = wfStatus === "submitted" && !snapshot;
  const phaseBHasQty    = !!snapshot?.outputs && wfStatus !== "draft" && wfStatus !== "phase_a_submitted";
  // Phase B appears once the chemist has calculated it (Case 1 has no quantities).
  const showPhaseB      = isLegacy || (phaseBHasQty && limitCase !== 1);
  // Phase B actuals can only be entered once the operator has started Phase B.
  const phaseBEditable  = wfStatus === "phase_b_started" || isLegacy;

  // ── Derived ───────────────────────────────────────────────────────────────
  const bsKg           = parseFloat(batchSize) || REF_BATCH_KG;
  const bagWeightTotal = sulphurBags.reduce((s, w) => s + num(w), 0);
  const phaseATotalAdded = rowsA.reduce((s, r) => s + num(r.addedQty), 0);
  const phaseBTotalAdded = rowsB.reduce((s, r) => s + num(r.addedQty), 0);

  // Displayed instruction totals — scale proportionally from 2dp stored values
  const phaseAInstructed = bsKg === REF_BATCH_KG
    ? PHASE_A_DISPLAY_TOTAL
    : Math.round(rowsA.reduce((s, r) => s + r.instructedQty, 0) * 100) / 100;
  // Legacy cards: the template total. Workflow cards: the chemist's total (unrounded sum).
  const phaseBInstructed = (phaseBHasQty && !isLegacy)
    ? rowsB.reduce((s, r) => s + r.instructedQty, 0)
    : bsKg === REF_BATCH_KG
      ? PHASE_B_DISPLAY_TOTAL
      : Math.round(rowsB.reduce((s, r) => s + r.instructedQty, 0) * 100) / 100;

  // Extra row contributions
  const extraAInstr  = extraInstructedTotal(extraRows, "A");
  const extraBInstr  = extraInstructedTotal(extraRows, "B");
  const extraAAdded  = extraAddedTotal(extraRows, "A");
  const extraBAdded  = extraAddedTotal(extraRows, "B");

  // ── Meter reading calculation ─────────────────────────────────────────────
  const meterRunningTime: { hours: number; minutes: number } | null = (() => {
    const ini = parseFloat(meterInitial);
    const fin = parseFloat(meterFinal);
    if (isNaN(ini) || isNaN(fin) || meterInitial === "" || meterFinal === "") return null;
    if (fin < ini) return null;
    const diff = fin - ini;
    const hours   = Math.floor(diff / 100);
    const minutes = Math.round(((diff % 100) / 100) * 60);
    return { hours, minutes };
  })();
  const meterNegative =
    meterInitial !== "" && meterFinal !== "" &&
    !isNaN(parseFloat(meterInitial)) && !isNaN(parseFloat(meterFinal)) &&
    parseFloat(meterFinal) < parseFloat(meterInitial);

  // ── Load formula ──────────────────────────────────────────────────────────
  const loadFormula = useCallback(async (
    batchKg: number,
    savedA?: DraftShape["rowInputsA"],
    savedB?: DraftShape["rowInputsB"],
  ) => {
    setLoadingFormula(true);
    const { data } = await supabase
      .from("product_formula_items")
      .select("*")
      .eq("product_id", product.id)
      .order("phase")
      .order("order_no");

    const defs = (data ?? []) as ProductFormulaItem[];

    const makeRow = (d: ProductFormulaItem, inputs?: DraftShape["rowInputsA"]): FormulaRow => {
      const saved = inputs?.[d.id];
      const scaledQty = scaleQty(d.instructed_qty_kg, d.reference_batch_size_kg, batchKg || d.reference_batch_size_kg);
      return {
        formulaItemId: d.id,
        orderNo:       d.order_no,
        phase:         d.phase as "A" | "B",
        componentName: d.component_name,
        jscCode:       d.jsc_code,
        instructedQty: scaledQty,
        addedQty:      saved?.addedQty  ?? "",
        rmBatchNo:     saved?.rmBatchNo ?? "",
        drumBagNo:     saved?.drumBagNo ?? "",
        tds:           saved?.tds       ?? "",
      };
    };

    setRowsA(defs.filter(d => d.phase === "A").map(d => makeRow(d, savedA)));
    setRowsB(defs.filter(d => d.phase === "B").map(d => makeRow(d, savedB)));
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
            .select("formula_item_id, instructed_qty_kg, added_qty_kg, rm_batch_no, drum_bag_no, remark")
            .eq("job_card_id", editCardId),
          supabase.from("product_formula_items").select("*")
            .eq("product_id", product.id).order("phase").order("order_no"),
        ]);
        if (!rawCard) { showToast(t("toastLoadFailed"), true); onDone(); return; }
        const card = rawCard as unknown as ExtCard;

        setOperatorName(card.operator_name ?? "");
        setBatchSize(String(card.batch_size_kg ?? REF_BATCH_KG));
        setLotNo(card.lot_no ?? "");
        setJobDate(card.job_date ?? todayISO());
        setJsc3Selection(card.jsc3_code_selection ?? "");
        setPremixStart(card.premix_start ?? "");
        setPremixEnd(card.premix_end ?? "");
        setBeadMillStart(card.bead_mill_start ?? "");
        setFlowRate(card.flow_rate != null ? String(card.flow_rate) : "");
        setBeadMillEnd(card.bead_mill_end ?? "");
        setSlurryA(card.collected_slurry_phase_a_kg != null ? String(card.collected_slurry_phase_a_kg) : "");
        setSlurryB(card.collected_slurry_phase_b_kg != null ? String(card.collected_slurry_phase_b_kg) : "");

        // Meter readings
        type ExtCardExtra = typeof card & { meter_reading_initial: number | null; meter_reading_final: number | null };
        const cardEx = card as unknown as ExtCardExtra;
        setMeterInitial(cardEx.meter_reading_initial != null ? String(cardEx.meter_reading_initial) : "");
        setMeterFinal(cardEx.meter_reading_final   != null ? String(cardEx.meter_reading_final)   : "");

        // Extra dynamic rows
        type ExtCardFull = typeof cardEx & { extra_ingredient_rows: unknown };
        setExtraRows(parseExtraRows((card as unknown as ExtCardFull).extra_ingredient_rows));

        const bags = card.sulphur_bag_weights;
        if (Array.isArray(bags) && bags.length === BAG_COUNT) {
          const loaded = bags.map(b => b.weight_kg != null ? String(b.weight_kg) : "");
          setSulphurBags(loaded);
          const total = loaded.reduce((s, w) => s + num(w), 0);
          setSulphurAddedKg(total > 0 ? total.toFixed(2) : "");
        } else {
          setSulphurAddedKg("");
        }
        setTotalScKg(card.total_sc_collected_kg != null ? String(card.total_sc_collected_kg) : "");
        setTotalScL(card.total_sc_collected_l  != null ? String(card.total_sc_collected_l)  : "");
        setCpCoolingTower(card.checkpoint_cooling_tower ?? "");
        setCpMechSeal(card.checkpoint_mech_seal ?? "");
        setCpPipes(card.checkpoint_pipes ?? "");
        setQcSulphurContent(card.qc_sulphur_content ?? "");
        setQcSuspensibility(card.qc_suspensibility ?? "");
        setQcDensity(card.qc_density ?? "");
        setQcPh(card.qc_ph ?? "");
        setQcViscosity(card.qc_viscosity_sec ?? "");
        setSignOperator(card.sign_operator ?? "");
        setSignChemist(card.sign_chemist ?? "");
        setSignManager(card.sign_manager ?? "");

        // Workflow state
        setWfStatus(card.status);
        setSnapshot(card.phase_b_calc ?? null);
        setLimitCase(card.limit_exceeded_case ?? null);
        setLimitRemark(card.limit_remark ?? "");

        const itemMap: Record<string, ItemRow> = {};
        for (const it of (items ?? []) as ItemRow[]) itemMap[it.formula_item_id] = it;

        const defs = (formulaDefs ?? []) as ProductFormulaItem[];
        const makeEditRow = (d: ProductFormulaItem): FormulaRow => {
          const it = itemMap[d.id];
          return {
            formulaItemId: d.id,
            orderNo:       d.order_no,
            phase:         d.phase as "A" | "B",
            componentName: d.component_name,
            jscCode:       d.jsc_code,
            // Phase B: the chemist's stored quantity (full precision, shown at 2 dp).
            // Phase A / legacy: the formula value, as before.
            instructedQty: d.phase === "B" && card.phase_b_calc && it?.instructed_qty_kg != null
              ? Number(it.instructed_qty_kg)
              : d.instructed_qty_kg,
            addedQty:      it?.added_qty_kg != null ? String(it.added_qty_kg) : "",
            rmBatchNo:     it?.rm_batch_no  ?? "",
            drumBagNo:     it?.drum_bag_no  ?? "",
            tds:           it?.remark       ?? "",
          };
        };
        setRowsA(defs.filter(d => d.phase === "A").map(makeEditRow));
        setRowsB(defs.filter(d => d.phase === "B").map(makeEditRow));
        setLoadingFormula(false);
      })();
    } else {
      loadFormula(bsKg, d0?.rowInputsA, d0?.rowInputsB);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-scale on batch size change (new mode only)
  const batchSizeForEffect = batchSize;
  useEffect(() => {
    if (isEdit || loadingFormula) return;
    const batchKg = parseFloat(batchSizeForEffect) || REF_BATCH_KG;
    const savedA: DraftShape["rowInputsA"] = {};
    const savedB: DraftShape["rowInputsB"] = {};
    rowsA.forEach(r => { savedA[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, drumBagNo: r.drumBagNo, tds: r.tds }; });
    rowsB.forEach(r => { savedB[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, drumBagNo: r.drumBagNo, tds: r.tds }; });
    loadFormula(batchKg, savedA, savedB);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchSizeForEffect]);

  // Draft autosave
  const draftSave = draft.save;
  useEffect(() => {
    if (isEdit) return;
    const rowInputsA: DraftShape["rowInputsA"] = {};
    const rowInputsB: DraftShape["rowInputsB"] = {};
    rowsA.forEach(r => { rowInputsA[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, drumBagNo: r.drumBagNo, tds: r.tds }; });
    rowsB.forEach(r => { rowInputsB[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, drumBagNo: r.drumBagNo, tds: r.tds }; });
    draftSave({
      operatorName, batchSize, lotNo, jobDate, jsc3Selection,
      rowInputsA, sulphurBags, sulphurAddedKg,
      premixStart, premixEnd, beadMillStart, flowRate, beadMillEnd, slurryA,
      meterInitial, meterFinal,
      rowInputsB, slurryB, totalScKg, totalScL,
      cpCoolingTower, cpMechSeal, cpPipes,
      qcSulphurContent, qcSuspensibility, qcDensity, qcPh, qcViscosity,
      signOperator, signChemist, signManager, extraRows,
    });
  }, [operatorName, batchSize, lotNo, jobDate, jsc3Selection,
      rowsA, sulphurBags, sulphurAddedKg,
      premixStart, premixEnd, beadMillStart, flowRate, beadMillEnd, slurryA,
      meterInitial, meterFinal,
      rowsB, slurryB, totalScKg, totalScL,
      cpCoolingTower, cpMechSeal, cpPipes,
      qcSulphurContent, qcSuspensibility, qcDensity, qcPh, qcViscosity,
      signOperator, signChemist, signManager, draftSave, isEdit, extraRows]);

  // ── Row updaters ──────────────────────────────────────────────────────────
  type RowField = keyof Pick<FormulaRow, "addedQty" | "rmBatchNo" | "drumBagNo" | "tds">;
  const updateRowA = (idx: number, field: RowField, val: string) =>
    setRowsA(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  const updateRowB = (idx: number, field: RowField, val: string) =>
    setRowsB(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  // Bag weight change — always recompute sulphurAddedKg from the full bag total.
  // The bag total is the single source of truth; manual entry is not allowed.
  function updateBag(idx: number, val: string) {
    setSulphurBags(prev => {
      const next = [...prev];
      next[idx] = val;
      const total = next.reduce((s, w) => s + num(w), 0);
      setSulphurAddedKg(total > 0 ? total.toFixed(2) : "");
      return next;
    });
  }

  function handleSulphurAddedChange(_val: string) {
    // No-op: sulphurAddedKg is read-only — controlled by the bag total only.
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!normalizeLot(lotNo)) return t("valLotRequired");
    if (!batchSize || isNaN(parseFloat(batchSize))) return t("valBatchKgRequired");
    if (!jsc3Selection) return t("valJsc3Required");
    return null;
  }

  /** Extra checks before Phase A goes to the chemist. */
  function validateForChemist(): string | null {
    const base = validate();
    if (base) return base;
    if (!(parseFloat(slurryA) > 0)) {
      return lang === "hi"
        ? "केमिस्ट को भेजने से पहले 'Collected slurry Phase A (kg)' भरें।"
        : "Enter the collected Phase A slurry (kg) before submitting to the chemist.";
    }
    return null;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  // statusVal: the status to move to, or null to keep the card's current status.
  //   new card : "draft" | "phase_a_submitted" (submit Phase A to the chemist)
  //   edit     : null (save) | "phase_b_started" | "submitted" (rules: DB trigger)
  const handleSave = async (statusVal: string | null) => {
    const nextStatus = isEdit ? (statusVal ?? wfStatus) : (statusVal ?? "draft");
    const err = nextStatus === "phase_a_submitted" ? validateForChemist() : validate();
    if (err) { showToast(err, true); return; }
    setSubmitting(true);
    try {
      const batchKg = parseFloat(batchSize);
      const sulphurBagJson = sulphurBags.map((w, i) => ({
        bag_no: i + 1,
        weight_kg: w !== "" ? parseFloat(w) : null,
      }));

      const cardPayload = {
        factory_id:                  factoryId,
        product_id:                  product.id,
        lot_no:                      normalizeLot(lotNo),
        job_date:                    jobDate,
        operator_id:                 userId,
        batch_size_kg:               batchKg,
        operator_name:               operatorName.trim() || null,
        jsc3_code_selection:         jsc3Selection,
        premix_start:                premixStart   || null,
        premix_end:                  premixEnd     || null,
        bead_mill_start:             beadMillStart || null,
        bead_mill_end:               beadMillEnd   || null,
        flow_rate:                   flowRate  ? parseFloat(flowRate)  : null,
        collected_slurry_phase_a_kg: slurryA   ? parseFloat(slurryA)  : null,
        collected_slurry_phase_b_kg: slurryB   ? parseFloat(slurryB)  : null,
        sulphur_bag_weights:         sulphurBagJson,
        sulphur_added_kg:            sulphurAddedKg ? parseFloat(sulphurAddedKg) : null,
        total_sc_collected_kg:       totalScKg ? parseFloat(totalScKg) : null,
        total_sc_collected_l:        totalScL  ? parseFloat(totalScL)  : null,
        checkpoint_cooling_tower:    cpCoolingTower || null,
        checkpoint_mech_seal:        cpMechSeal     || null,
        checkpoint_pipes:            cpPipes        || null,
        qc_sulphur_content:          qcSulphurContent || null,
        qc_suspensibility:           qcSuspensibility || null,
        qc_density:                  qcDensity        || null,
        qc_ph:                       qcPh             || null,
        qc_viscosity_sec:            qcViscosity      || null,
        sign_operator:               signOperator || null,
        sign_chemist:                signChemist  || null,
        sign_manager:                signManager  || null,
        meter_reading_initial:       meterInitial ? parseFloat(meterInitial) : null,
        meter_reading_final:         meterFinal   ? parseFloat(meterFinal)   : null,
        extra_ingredient_rows:       serialiseExtraRows(extraRows),
        status:                      nextStatus,
      };

      let cardId: string;

      if (isEdit && editCardId) {
        const { data, error } = await supabase
          .from("production_job_cards")
          .update(cardPayload)
          .eq("id", editCardId)
          .select("id")
          .single();
        if (error || !data) { showToast(t("toastUpdateFailed") + (error?.message ?? t("toastUnknown")), true); return; }
        cardId = editCardId;

        for (const r of rowsA) {
          await supabase.from("production_job_card_items").upsert({
            job_card_id:       cardId,
            formula_item_id:   r.formulaItemId,
            instructed_qty_kg: r.instructedQty,
            added_qty_kg:      r.addedQty ? parseFloat(r.addedQty) : null,
            rm_batch_no:       r.rmBatchNo || null,
            drum_bag_no:       r.drumBagNo || null,
            remark:            r.tds       || null,
          }, { onConflict: "job_card_id,formula_item_id" });
        }
        // Phase B: the instructed quantity belongs to the chemist, so the operator's
        // save never writes it (it would also be rejected by the DB once calculated).
        for (const r of rowsB) {
          const actuals = {
            added_qty_kg: r.addedQty ? parseFloat(r.addedQty) : null,
            rm_batch_no:  r.rmBatchNo || null,
            drum_bag_no:  r.drumBagNo || null,
            remark:       r.tds       || null,
          };
          const { data: upd } = await supabase.from("production_job_card_items")
            .update(actuals).eq("job_card_id", cardId).eq("formula_item_id", r.formulaItemId)
            .select("formula_item_id");
          if (!upd || upd.length === 0) {
            await supabase.from("production_job_card_items").insert({
              job_card_id: cardId, formula_item_id: r.formulaItemId,
              instructed_qty_kg: r.instructedQty, ...actuals,
            });
          }
        }
      } else {
        const { data, error } = await supabase
          .from("production_job_cards")
          .insert(cardPayload)
          .select("id")
          .single();
        if (error || !data) { showToast(t("toastSaveFailed") + (error?.message ?? t("toastUnknown")), true); return; }
        cardId = data.id;

        const allRows = [...rowsA, ...rowsB];
        if (allRows.length > 0) {
          const { error: itemErr } = await supabase.from("production_job_card_items").insert(
            allRows.map(r => ({
              job_card_id:       cardId,
              formula_item_id:   r.formulaItemId,
              instructed_qty_kg: r.instructedQty,
              added_qty_kg:      r.addedQty ? parseFloat(r.addedQty) : null,
              rm_batch_no:       r.rmBatchNo || null,
              drum_bag_no:       r.drumBagNo || null,
              remark:            r.tds       || null,
            }))
          );
          if (itemErr) { showToast(t("toastItemsFailed") + itemErr.message, true); return; }
        }
        draft.clear();
      }

      const workflowToast = () => {
        if (nextStatus === "draft") return lang === "hi" ? "ड्राफ्ट सेव हुआ ✓" : "Draft saved ✓";
        if (nextStatus === "phase_a_submitted" && (!isEdit || wfStatus !== "phase_a_submitted"))
          return lang === "hi" ? "फेज़ A केमिस्ट को भेज दिया गया ✓" : "Phase A sent to the chemist ✓";
        if (nextStatus === "phase_b_started" && wfStatus !== "phase_b_started")
          return lang === "hi" ? "फेज़ B शुरू हुआ ✓" : "Phase B started ✓";
        if (nextStatus === "submitted") return t("toastJobSubmitted");
        return t("toastUpdated");
      };
      showToast(workflowToast());
      onDone();
    } catch (e: unknown) {
      showToast(t("toastNetworkError") + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Table renderer ────────────────────────────────────────────────────────
  const thStyle: React.CSSProperties = { padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)", whiteSpace: "nowrap" };
  const tdStyle: React.CSSProperties = { padding: "5px 10px" };

  function renderTable(rows: FormulaRow[], updater: (idx: number, field: RowField, val: string) => void, phase: "A" | "B") {
    const instrTotal = Math.round(rows.reduce((s, r) => s + r.instructedQty, 0) * 100) / 100;
    const addedTotal = rows.reduce((s, r) => s + num(r.addedQty), 0);
    const extraInstr = phase === "A" ? extraAInstr : extraBInstr;
    const extraAdded = phase === "A" ? extraAAdded : extraBAdded;
    return (
      <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ACCENT + "10", borderBottom: `2px solid ${ACCENT}40` }}>
              <th style={thStyle}>{t("colOrder")}</th>
              <th style={thStyle}>{t("colComponents")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("colInstructedKg")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("colAddedKg")}</th>
              <th style={thStyle}>{t("colRmBatchNo")}</th>
              <th style={thStyle}>{t("colDrumBagNo")}</th>
              {phase === "A" && <th style={thStyle}>{t("colTdsNote")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isSulphur = r.componentName.toLowerCase() === "sulphur" && phase === "A";
              const isJsc3    = r.orderNo === 3 && phase === "A";
              const isWater   = r.componentName.toLowerCase() === "water";
              return (
                <tr key={r.formulaItemId}
                  style={{ borderBottom: "1px solid var(--line)", background: isSulphur ? "#fff8f3" : undefined }}>
                  <td style={tdStyle}>{r.orderNo}</td>
                  {/* Components column — shows material code (jscCode) when available,
                      falls back to component name for rows with no code (e.g. Water, Sulphur).
                      Row 3 (Unitop FL / SOPROPHORFLR) is a selectable code — shown inline. */}
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {isJsc3 ? (
                      <select value={jsc3Selection} onChange={e => setJsc3Selection(e.target.value)}
                        style={{ fontSize: 13, padding: "3px 6px", borderRadius: 4,
                          border: !jsc3Selection ? "2px solid var(--warn)" : "1px solid var(--line)" }}>
                        <option value="">{t("selectOption")}</option>
                        {JSC3_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      r.jscCode ?? r.componentName
                    )}
                  </td>
                  {/* Display at 2dp — stored values are already 2dp */}
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: ACCENT }}>
                    {r.instructedQty.toFixed(2)}
                  </td>
                  <td style={{ ...tdStyle, padding: "4px 6px" }}>
                    <NumericInput allowDecimal={true} placeholder={r.instructedQty.toFixed(2)}
                      value={isSulphur ? sulphurAddedKg : r.addedQty}
                      onChange={e => isSulphur ? handleSulphurAddedChange(e.target.value) : updater(idx, "addedQty", e.target.value)}
                      style={{ width: 90, textAlign: "right",
                        borderColor: isSulphur && false ? "var(--warn)" : undefined }} />
                  </td>
                  <td style={{ ...tdStyle, padding: "4px 6px" }}>
                    <input type="text" placeholder={t("placeholderBatchNo")} value={r.rmBatchNo}
                      onChange={e => updater(idx, "rmBatchNo", e.target.value)} style={{ width: 100 }} />
                  </td>
                  <td style={{ ...tdStyle, padding: "4px 6px" }}>
                    <input type="text" placeholder={t("placeholderDrumBag")} value={r.drumBagNo}
                      onChange={e => updater(idx, "drumBagNo", e.target.value)} style={{ width: 90 }} />
                  </td>
                  {phase === "A" && (
                    <td style={{ ...tdStyle, padding: "4px 6px" }}>
                      {isWater ? (
                        <input type="text" placeholder={t("placeholderTds")} value={r.tds}
                          onChange={e => updater(idx, "tds", e.target.value)} style={{ width: 80 }} />
                      ) : <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: ACCENT + "08", fontWeight: 700, fontSize: 13 }}>
              <td colSpan={2} style={{ padding: "6px 10px" }}>{phase === "A" ? t("totalPhaseA") : t("totalPhaseB")}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", color: ACCENT }}>
                {(instrTotal + extraInstr).toFixed(2)} kg
              </td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>
                {(addedTotal + extraAdded) > 0 ? (addedTotal + extraAdded).toFixed(2) : "—"} kg
              </td>
              <td colSpan={phase === "A" ? 3 : 2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <DynamicIngredientRows
        rows={extraRows.filter(r => r.phase === phase)}
        onChange={updated => setExtraRows([
          ...extraRows.filter(r => r.phase !== phase),
          ...updated,
        ])}
        phase={phase}
        accent={ACCENT}
        lang={lang}
      />
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <button type="button" className="back-link" onClick={onDone}>{t("backLink")}</button>

      {/* Banner */}
      <div style={{ background: ACCENT, color: "#fff", padding: "16px 20px", borderRadius: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.8px", opacity: 0.8, marginBottom: 2 }}>
          {t("companyName")}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.3 }}>
          PROCESS JOB CARD FOR SULPHUR SC (55.16%) (GAIN / INSTASUL)
        </div>
        {isEdit && <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>{t("editingBanner")}</div>}
      </div>

      {/* ── 0. WORKFLOW STATUS (Phase A -> chemist -> Phase B) ─────────────── */}
      {!isLegacy && (
        <PhaseWorkflowPanel
          jobCardId={editCardId ?? null}
          status={wfStatus}
          snapshot={snapshot}
          limitCase={limitCase}
          limitRemark={limitRemark}
          onRemarkSaved={r => setLimitRemark(r)}
          activeIngredient="Sulphur"
          accent={ACCENT}
        />
      )}

      {/* ── 1. HEADER ─────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secJobCardHeader")} />
        <div className="row2">
          <div>
            <label>{t("operatorName")}</label>
            <input type="text" placeholder={t("placeholderName")} value={operatorName} onChange={e => setOperatorName(e.target.value)} />
          </div>
          <div>
            <label>{t("batchSizeKg")}</label>
            <NumericInput allowDecimal={true} value={batchSize} onChange={e => setBatchSize(e.target.value)} />
            {parseFloat(batchSize) !== REF_BATCH_KG && (
              <div className="field-hint" style={{ color: "#1565c0" }}>
                {lang === "hi"
                  ? `टेम्पलेट बैच: ${REF_BATCH_KG} kg · मात्राएँ अनुपात में बदली गई हैं`
                  : `Template batch: ${REF_BATCH_KG} kg · quantities scaled proportionally`}
              </div>
            )}
          </div>
        </div>
        <div className="row2">
          <div>
            <label>{t("lotNo")}</label>
            <input type="text" placeholder={t("placeholderLotNo")} value={lotNo}
              disabled={wfStatus === "phase_b_started"}
              onChange={e => setLotNo(e.target.value)}
              onBlur={() => setLotNo(v => normalizeLot(v))} />
            <div className="field-hint">
              {lang === "hi"
                ? "इसी लॉट नंबर से केमिस्ट Product QC का फेज़ A रिज़ल्ट खोजता है।"
                : "The chemist uses this lot number to find the Phase A QC result (spaces and case are ignored)."}
            </div>
          </div>
          <div>
            <label>{t("date")}</label>
            <DateField value={jobDate} onChange={setJobDate} />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <InfoRow label={t("phaseAInstrTotal2")}
            value={<b style={{ color: ACCENT }}>{phaseAInstructed.toFixed(2)} kg</b>} />
          <InfoRow label={t("phaseBInstrTotal2")}
            value={<b style={{ color: ACCENT }}>{phaseBInstructed.toFixed(2)} kg</b>} />
        </div>
      </div>

      {/* ── 2. PHASE A ────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseARawMat")} />
        {loadingFormula ? (
          <div className="empty">{t("loadingFormula")}</div>
        ) : rowsA.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            {lang === "hi" ? "फेज़ A के लिए कोई फॉर्मूला आइटम नहीं मिला।" : "No Phase A formula items found. Run migration 013 on the A-20 Supabase project."}
          </div>
        ) : renderTable(rowsA, updateRowA, "A")}
      </div>

      {/* ── 3. SULPHUR BAG DETAILS ────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secSulphurBagDetails")} />
        <div className="field-hint" style={{ marginBottom: 12 }}>
          {lang === "hi"
            ? "प्रत्येक सल्फर बैग का वज़न दर्ज करें। कुल स्वचालित रूप से गणना होगी।"
            : "Enter weight of each Sulphur bag. Total is calculated automatically."}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[0, 10].map(offset => (
            <table key={offset} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: ACCENT + "10" }}>
                  <th style={thStyle}>{t("colBagNo")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("colWeightKg")}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }, (_, i) => offset + i).map(i => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={{ ...tdStyle, padding: "3px 6px" }}>
                      <NumericInput allowDecimal={true} placeholder="—" value={sulphurBags[i]}
                        onChange={e => updateBag(i, e.target.value)}
                        style={{ width: "100%", textAlign: "right" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <div style={{ marginTop: 14, padding: "10px 14px", background: ACCENT + "08", borderRadius: 8,
          display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 13 }}>
            <span style={{ color: "var(--ink-soft)" }}>{t("bagWeightTotal")}</span>{" "}
            <b style={{ color: ACCENT }}>{bagWeightTotal.toFixed(2)} kg</b>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ fontSize: 12 }}>{t("sulphurAddedConfirmed")}</label>
            <NumericInput allowDecimal={true} value={sulphurAddedKg}
              onChange={e => handleSulphurAddedChange(e.target.value)} style={{ width: 140 }} />
          </div>
        </div>
      </div>

      {/* ── 4. PHASE A OBSERVATIONS ───────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseAObs")} />
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t("preMix")}</div>
        <div className="row2">
          <div><label>{t("startTime")}</label><TimeField value={premixStart} onChange={setPremixStart} /></div>
          <div><label>{t("endTime")}</label><TimeField value={premixEnd} onChange={setPremixEnd} /></div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, marginTop: 14, marginBottom: 8 }}>{t("beadMill")}</div>
        <div className="row2">
          <div><label>{t("startTime")}</label><TimeField value={beadMillStart} onChange={setBeadMillStart} /></div>
          <div><label>{t("flowRateSL")}</label><NumericInput allowDecimal={true} placeholder="0" value={flowRate} onChange={e => setFlowRate(e.target.value)} /></div>
        </div>
        <div className="row2" style={{ marginTop: 8 }}>
          <div><label>{t("endTime")}</label><TimeField value={beadMillEnd} onChange={setBeadMillEnd} /></div>
          <div>
            <label>{t("totalPhaseAAddedCalc")}</label>
            <input type="number" readOnly value={phaseATotalAdded > 0 ? phaseATotalAdded.toFixed(2) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
        </div>
        <div className="row2" style={{ marginTop: 8 }}>
          <div><label>{t("collectedSlurryA")}</label>
            <NumericInput allowDecimal={true} placeholder="0" value={slurryA} onChange={e => setSlurryA(e.target.value)} /></div>
          <div />
        </div>
      </div>

      {/* ── 4b. MACHINE METER READING ────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secMeterReading")} />
        <div className="row2">
          <div>
            <label>{t("meterInitial")}</label>
            <NumericInput allowDecimal={false} placeholder={t("meterPlaceholder")}
              value={meterInitial} onChange={e => setMeterInitial(e.target.value)} />
          </div>
          <div>
            <label>{t("meterFinal")}</label>
            <NumericInput allowDecimal={false} placeholder={t("meterPlaceholder")}
              value={meterFinal} onChange={e => setMeterFinal(e.target.value)} />
          </div>
        </div>
        {meterNegative && (
          <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 8,
            background: "#fff3e0", border: "1px solid #fb8c00",
            fontSize: 13, color: "#e65100", fontWeight: 600 }}>
            {t("meterNegative")}
          </div>
        )}
        {meterRunningTime !== null && !meterNegative && (
          <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 8,
            background: ACCENT + "10", border: `1px solid ${ACCENT}40`,
            fontSize: 14, fontWeight: 700, color: ACCENT }}>
            {t("meterRunningTime")}:{" "}
            {meterRunningTime.hours} {t("meterHours")} {meterRunningTime.minutes} {t("meterMinutes")}
          </div>
        )}
      </div>

      {/* ── PHASE B (gated by chemist approval of Phase A) ──────────────── */}
      {showPhaseB ? (
      /* Phase B quantities are the chemist's calculation (read-only); actuals unlock on "Start Phase B". */
      <fieldset disabled={!phaseBEditable} style={{ border: "none", padding: 0, margin: 0 }}>

      {/* ── 5. PHASE B ────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseBRawMat")} />
        {loadingFormula ? (
          <div className="empty">{t("loadingFormula")}</div>
        ) : rowsB.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            {lang === "hi" ? "फेज़ B के लिए कोई फॉर्मूला आइटम नहीं मिला।" : "No Phase B formula items found."}
          </div>
        ) : renderTable(rowsB, updateRowB, "B")}
        <div className="row2" style={{ marginTop: 14 }}>
          <div>
            <label>{t("totalPhaseBAddedCalc")}</label>
            <input type="number" readOnly value={phaseBTotalAdded > 0 ? phaseBTotalAdded.toFixed(2) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
          <div><label>{t("collectedSlurryB")}</label>
            <NumericInput allowDecimal={true} placeholder="0" value={slurryB} onChange={e => setSlurryB(e.target.value)} /></div>
        </div>
      </div>

      {/* ── 6. FINAL COLLECTION ──────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secFinalCollection")} />
        <div className="row2">
          <div><label>{t("totalScCollectedKg")}</label>
            <NumericInput allowDecimal={true} placeholder="0" value={totalScKg} onChange={e => setTotalScKg(e.target.value)} /></div>
          <div><label>{t("totalScCollectedL")}</label>
            <NumericInput allowDecimal={true} placeholder="0" value={totalScL} onChange={e => setTotalScL(e.target.value)} /></div>
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

      </fieldset>
      ) : (
        <div style={{
          padding: "16px 20px", marginBottom: 16,
          background: "#f5f5f5", borderRadius: 10,
          border: "1px dashed #bbb",
          textAlign: "center", color: "var(--ink-soft)", fontSize: 13,
        }}>
          {limitCase === 1
            ? (lang === "hi"
                ? "🔒 सीमा पार: फेज़ B की कोई मात्रा जारी नहीं की गई"
                : "🔒 Limit exceeded: no Phase B quantities were issued for this lot")
            : (lang === "hi"
                ? "🔒 फेज़ B की मात्रा केमिस्ट की गणना के बाद दिखेगी"
                : "🔒 Phase B quantities appear after the chemist reviews Phase A")}
        </div>
      )}

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <PhaseWorkflowActions
        isEdit={isEdit} isLegacy={isLegacy} status={wfStatus}
        limitCase={limitCase} limitRemark={limitRemark}
        submitting={submitting} hindi={lang === "hi"}
        labels={{
          saving: t("saving"), saveChanges: t("saveChanges"), saveAsDraft: t("saveAsDraft"),
          submitJobCard: t("submitJobCard"), cancel: t("cancel"),
        }}
        onSave={handleSave} onCancel={onDone}
      />
    </>
  );
}


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
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/lib/toast-context";
import { useFormDraft, draftKey } from "@/lib/use-form-draft";
import type { Product, ProductFormulaItem, ProductionJobCard } from "@/lib/types";
import { useJobCardLang } from "@/lib/job-card-lang-context";
import { makeJcT } from "@/lib/job-card-translations";

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
  rowInputsB: Record<string, { addedQty: string; rmBatchNo: string; drumBagNo: string; tds: string }>;
  slurryB: string;
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
};

type ItemRow = {
  formula_item_id: string;
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
  const [sulphurAddedKg, setSulphurAddedKg] = useState(d0?.sulphurAddedKg ?? "");
  const [bagMismatch, setBagMismatch]       = useState(false);

  // ── Phase A observations ──────────────────────────────────────────────────
  const [premixStart, setPremixStart]       = useState(d0?.premixStart ?? "");
  const [premixEnd, setPremixEnd]           = useState(d0?.premixEnd ?? "");
  const [beadMillStart, setBeadMillStart]   = useState(d0?.beadMillStart ?? "");
  const [flowRate, setFlowRate]             = useState(d0?.flowRate ?? "");
  const [beadMillEnd, setBeadMillEnd]       = useState(d0?.beadMillEnd ?? "");
  const [slurryA, setSlurryA]               = useState(d0?.slurryA ?? "");

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

  // ── Derived ───────────────────────────────────────────────────────────────
  const bsKg           = parseFloat(batchSize) || REF_BATCH_KG;
  const bagWeightTotal = sulphurBags.reduce((s, w) => s + num(w), 0);
  const phaseATotalAdded = rowsA.reduce((s, r) => s + num(r.addedQty), 0);
  const phaseBTotalAdded = rowsB.reduce((s, r) => s + num(r.addedQty), 0);

  // Displayed instruction totals — scale proportionally from 2dp stored values
  const phaseAInstructed = bsKg === REF_BATCH_KG
    ? PHASE_A_DISPLAY_TOTAL
    : Math.round(rowsA.reduce((s, r) => s + r.instructedQty, 0) * 100) / 100;
  const phaseBInstructed = bsKg === REF_BATCH_KG
    ? PHASE_B_DISPLAY_TOTAL
    : Math.round(rowsB.reduce((s, r) => s + r.instructedQty, 0) * 100) / 100;

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
            .select("formula_item_id, added_qty_kg, rm_batch_no, drum_bag_no, remark")
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

        const bags = card.sulphur_bag_weights;
        if (Array.isArray(bags) && bags.length === BAG_COUNT) {
          setSulphurBags(bags.map(b => b.weight_kg != null ? String(b.weight_kg) : ""));
        }
        setSulphurAddedKg(card.sulphur_added_kg != null ? String(card.sulphur_added_kg) : "");
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
            instructedQty: d.instructed_qty_kg,   // stored at 2dp; display as-is
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
      rowInputsB, slurryB, totalScKg, totalScL,
      cpCoolingTower, cpMechSeal, cpPipes,
      qcSulphurContent, qcSuspensibility, qcDensity, qcPh, qcViscosity,
      signOperator, signChemist, signManager,
    });
  }, [operatorName, batchSize, lotNo, jobDate, jsc3Selection,
      rowsA, sulphurBags, sulphurAddedKg,
      premixStart, premixEnd, beadMillStart, flowRate, beadMillEnd, slurryA,
      rowsB, slurryB, totalScKg, totalScL,
      cpCoolingTower, cpMechSeal, cpPipes,
      qcSulphurContent, qcSuspensibility, qcDensity, qcPh, qcViscosity,
      signOperator, signChemist, signManager, draftSave, isEdit]);

  // ── Row updaters ──────────────────────────────────────────────────────────
  type RowField = keyof Pick<FormulaRow, "addedQty" | "rmBatchNo" | "drumBagNo" | "tds">;
  const updateRowA = (idx: number, field: RowField, val: string) =>
    setRowsA(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  const updateRowB = (idx: number, field: RowField, val: string) =>
    setRowsB(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  function updateBag(idx: number, val: string) {
    setSulphurBags(prev => {
      const next = [...prev];
      next[idx] = val;
      const total = next.reduce((s, w) => s + num(w), 0);
      setSulphurAddedKg(prev2 => {
        const prevTotal = prev.reduce((s, w) => s + num(w), 0);
        if (!prev2 || Math.abs(num(prev2) - prevTotal) < 0.001) {
          return total > 0 ? total.toFixed(2) : "";
        }
        return prev2;
      });
      setBagMismatch(false);
      return next;
    });
  }

  function handleSulphurAddedChange(val: string) {
    setSulphurAddedKg(val);
    setBagMismatch(val !== "" && Math.abs(num(val) - bagWeightTotal) > 0.01 && bagWeightTotal > 0);
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!lotNo.trim()) return t("valLotRequired");
    if (!batchSize || isNaN(parseFloat(batchSize))) return t("valBatchKgRequired");
    if (!jsc3Selection) return t("valJsc3Required");
    if (bagMismatch) return t("valSulphurMismatch");
    return null;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (statusVal: "draft" | "submitted") => {
    const err = validate();
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
        lot_no:                      lotNo.trim(),
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
        status:                      statusVal,
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

        for (const r of [...rowsA, ...rowsB]) {
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

      showToast(isEdit ? t("toastUpdated") : statusVal === "submitted" ? t("toastJobSubmitted") : t("toastDraftSaved"));
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
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ACCENT + "10", borderBottom: `2px solid ${ACCENT}40` }}>
              <th style={thStyle}>Order</th>
              <th style={thStyle}>Component</th>
              <th style={thStyle}>Material Code</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Instructed (kg)</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Added (kg)</th>
              <th style={thStyle}>RM Batch No</th>
              <th style={thStyle}>Drum / Bag No</th>
              {phase === "A" && <th style={thStyle}>TDS / Note</th>}
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
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.componentName}</td>
                  <td style={tdStyle}>
                    {isJsc3 ? (
                      <select value={jsc3Selection} onChange={e => setJsc3Selection(e.target.value)}
                        style={{ fontSize: 13, padding: "3px 6px", borderRadius: 4,
                          border: !jsc3Selection ? "2px solid var(--warn)" : "1px solid var(--line)" }}>
                        <option value="">— select —</option>
                        {JSC3_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: "var(--ink-soft)" }}>{r.jscCode ?? "—"}</span>
                    )}
                  </td>
                  {/* Display at 2dp — stored values are already 2dp */}
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: ACCENT }}>
                    {r.instructedQty.toFixed(2)}
                  </td>
                  <td style={{ ...tdStyle, padding: "4px 6px" }}>
                    <input type="number" step="any" placeholder={r.instructedQty.toFixed(2)}
                      value={isSulphur ? sulphurAddedKg : r.addedQty}
                      onChange={e => isSulphur ? handleSulphurAddedChange(e.target.value) : updater(idx, "addedQty", e.target.value)}
                      style={{ width: 90, textAlign: "right",
                        borderColor: isSulphur && bagMismatch ? "var(--warn)" : undefined }} />
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
              <td colSpan={3} style={{ padding: "6px 10px" }}>{phase === "A" ? t("totalPhaseA") : t("totalPhaseB")}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", color: ACCENT }}>
                {instrTotal.toFixed(2)} kg
              </td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>
                {addedTotal > 0 ? addedTotal.toFixed(2) : "—"} kg
              </td>
              <td colSpan={phase === "A" ? 3 : 2} />
            </tr>
          </tfoot>
        </table>
      </div>
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
            <input type="number" step="any" value={batchSize} onChange={e => setBatchSize(e.target.value)} />
            {parseFloat(batchSize) !== REF_BATCH_KG && (
              <div className="field-hint" style={{ color: "#1565c0" }}>
                Template batch: {REF_BATCH_KG} kg · quantities scaled proportionally
              </div>
            )}
          </div>
        </div>
        <div className="row2">
          <div>
            <label>{t("lotNo")}</label>
            <input type="text" placeholder={t("placeholderLotNo")} value={lotNo} onChange={e => setLotNo(e.target.value)} />
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
            No Phase A formula items found. Run migration 013 on the A-20 Supabase project.
          </div>
        ) : renderTable(rowsA, updateRowA, "A")}
      </div>

      {/* ── 3. SULPHUR BAG DETAILS ────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secSulphurBagDetails")} />
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Enter weight of each Sulphur bag. Total is calculated automatically.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[0, 10].map(offset => (
            <table key={offset} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: ACCENT + "10" }}>
                  <th style={thStyle}>Bag No.</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Weight (kg)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }, (_, i) => offset + i).map(i => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={{ ...tdStyle, padding: "3px 6px" }}>
                      <input type="number" step="any" placeholder="—" value={sulphurBags[i]}
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
            <span style={{ color: "var(--ink-soft)" }}>Bag weight total:</span>{" "}
            <b style={{ color: ACCENT }}>{bagWeightTotal.toFixed(2)} kg</b>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ fontSize: 12 }}>{t("sulphurAddedConfirmed")}</label>
            <input type="number" step="any" value={sulphurAddedKg}
              onChange={e => handleSulphurAddedChange(e.target.value)} style={{ width: 140 }} />
          </div>
        </div>
        {bagMismatch && (
          <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 8,
            background: "var(--warn-soft)", border: "1px solid var(--warn)",
            fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>
            ⚠ Sulphur Added ({sulphurAddedKg} kg) differs from bag weight total ({bagWeightTotal.toFixed(2)} kg).
            Reconcile before saving.
          </div>
        )}
      </div>

      {/* ── 4. PHASE A OBSERVATIONS ───────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseAObs")} />
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t("preMix")}</div>
        <div className="row2">
          <div><label>{t("startTime")}</label><input type="time" value={premixStart} onChange={e => setPremixStart(e.target.value)} /></div>
          <div><label>{t("endTime")}</label><input type="time" value={premixEnd} onChange={e => setPremixEnd(e.target.value)} /></div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, marginTop: 14, marginBottom: 8 }}>{t("beadMill")}</div>
        <div className="row2">
          <div><label>{t("startTime")}</label><input type="time" value={beadMillStart} onChange={e => setBeadMillStart(e.target.value)} /></div>
          <div><label>{t("flowRateSL")}</label><input type="number" step="any" placeholder="0" value={flowRate} onChange={e => setFlowRate(e.target.value)} /></div>
        </div>
        <div className="row2" style={{ marginTop: 8 }}>
          <div><label>{t("endTime")}</label><input type="time" value={beadMillEnd} onChange={e => setBeadMillEnd(e.target.value)} /></div>
          <div>
            <label>{t("totalPhaseAAddedCalc")}</label>
            <input type="number" readOnly value={phaseATotalAdded > 0 ? phaseATotalAdded.toFixed(2) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
        </div>
        <div className="row2" style={{ marginTop: 8 }}>
          <div><label>{t("collectedSlurryA")}</label>
            <input type="number" step="any" placeholder="0" value={slurryA} onChange={e => setSlurryA(e.target.value)} /></div>
          <div />
        </div>
      </div>

      {/* ── 5. PHASE B ────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseBRawMat")} />
        {loadingFormula ? (
          <div className="empty">{t("loadingFormula")}</div>
        ) : rowsB.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>No Phase B formula items found.</div>
        ) : renderTable(rowsB, updateRowB, "B")}
        <div className="row2" style={{ marginTop: 14 }}>
          <div>
            <label>{t("totalPhaseBAddedCalc")}</label>
            <input type="number" readOnly value={phaseBTotalAdded > 0 ? phaseBTotalAdded.toFixed(2) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
          <div><label>{t("collectedSlurryB")}</label>
            <input type="number" step="any" placeholder="0" value={slurryB} onChange={e => setSlurryB(e.target.value)} /></div>
        </div>
      </div>

      {/* ── 6. FINAL COLLECTION ──────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secFinalCollection")} />
        <div className="row2">
          <div><label>{t("totalScCollectedKg")}</label>
            <input type="number" step="any" placeholder="0" value={totalScKg} onChange={e => setTotalScKg(e.target.value)} /></div>
          <div><label>{t("totalScCollectedL")}</label>
            <input type="number" step="any" placeholder="0" value={totalScL} onChange={e => setTotalScL(e.target.value)} /></div>
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
        <button className="btn btn-primary" type="button" disabled={submitting} onClick={() => handleSave("submitted")}>
          {submitting ? t("saving") : isEdit ? t("saveChanges") : t("submitJobCard")}
        </button>
        {!isEdit && (
          <button className="btn btn-secondary" type="button" disabled={submitting} onClick={() => handleSave("draft")}>
            {t("saveAsDraft")}
          </button>
        )}
        <button className="btn btn-ghost" type="button" disabled={submitting} onClick={onDone}>{t(t("cancel"))}</button>
      </div>
    </>
  );
}


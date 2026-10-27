"use client";

// =============================================================================
// UplJobCardForm — full digital implementation of the JSCI paper form:
//   "PROCESS JOB CARD FOR SULPHUR SC UPL GRADE"
//
// Template source: A20 JOB CARDS FOR AUTOMATION.xlsx — "upl" sheet
// Reference batch size: 677 kg
//
// Sections:
//   1. Job Card Header  (operator name, batch size default 677, lot no, date)
//   2. Phase A — ingredients table  (8 rows; order 3 has JSC57/JSC07 dropdown)
//   3. Phase A — Sulphur Bag Details (bags 1–20, weight per bag, running total)
//   4. Phase A — Observations (Pre-Mix start/end, Bead Mill start/flow/end)
//   5. Phase B — ingredients table  (4 rows)
//   6. Final Collection (Total SC kg + litres, Collected Slurry A + B)
//   7. Check Points (Cooling Tower Pressure, Mechanical Seal, Pipes/Fittings)
//   8. Remarks / QC Observations (Sulphur Content, Suspensibility, Density, pH, Viscosity)
//   9. Sign-offs (Operator, Chemist, Manager)
//
// DB:
//   production_job_cards      — one header row (migration 012 adds new columns)
//   production_job_card_items — one row per formula item (8 Phase A + 4 Phase B)
//
// Edit mode: pass an existing cardId to load + update (no duplicate created).
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

const REF_BATCH_KG = 677;
const PHASE_A_TOTAL = 599.19;
const PHASE_B_TOTAL = 76.67;
const ACCENT = "#b5451b";
const BAG_COUNT = 20; // bags 1–20

// JSC code options for order 3 (Unitop FL / SOPROPHORFLR)
const JSC3_OPTIONS = ["JSC57", "JSC07"] as const;
type Jsc3Option = (typeof JSC3_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface FormulaRow {
  formulaItemId: string;
  orderNo: number;
  phase: "A" | "B";
  componentName: string;
  jscCode: string | null;       // from DB; 'JSC57/JSC07' for order 3 placeholder
  instructedQty: number;        // already scaled to current batchSize
  // operator-filled
  addedQty: string;
  rmBatchNo: string;
  drumBagNo: string;
  tds: string;                  // only for Water rows
}

interface SulphurBag { weight: string; }

// Persisted draft shape (everything except formulaItemId keys from DB)
interface DraftShape {
  operatorName: string;
  batchSize: string;
  lotNo: string;
  jobDate: string;
  jsc3Selection: string;
  // Phase A rows: keyed by formulaItemId
  rowInputsA: Record<string, { addedQty: string; rmBatchNo: string; drumBagNo: string; tds: string }>;
  sulphurBags: string[];        // length 20, weights as strings
  sulphurAddedKg: string;
  premixStart: string;
  premixEnd: string;
  beadMillStart: string;
  flowRate: string;
  beadMillEnd: string;
  slurryA: string;
  // Phase B rows
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

function scaleQty(instructed: number, ref: number, actual: number): number {
  if (!ref || !actual) return instructed;
  return Math.round((instructed / ref) * actual * 1000) / 1000;
}

function num(s: string): number { const n = parseFloat(s); return isNaN(n) ? 0 : n; }

function blankBags(): string[] { return Array.from({ length: BAG_COUNT }, () => ""); }

/** Section header styled after the physical form */
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

/** Read-only label value pair */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 13, padding: "3px 0" }}>
      <span style={{ color: "var(--ink-soft)", minWidth: 180 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface UplJobCardFormProps {
  product: Product;
  factoryId: string;
  userId: string;
  editCardId?: string | null;   // if set → edit mode
  onDone: () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UplJobCardForm({
  product, factoryId, userId, editCardId, onDone,
}: UplJobCardFormProps) {
  const { showToast } = useToast();
  const lang = useJobCardLang();
  const t = makeJcT(lang);
  const supabase = createClient();
  const pathname = usePathname();
  const isEdit = !!editCardId;

  // Draft autosave (new mode only — edit loads from DB)
  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, factoryId, userId, "UPL", editCardId ?? "new"),
  );
  const d0 = draft.restored;

  // ── Header ──────────────────────────────────────────────────────────────
  const [operatorName, setOperatorName] = useState(d0?.operatorName ?? "");
  const [batchSize, setBatchSize]       = useState(d0?.batchSize ?? String(REF_BATCH_KG));
  const [lotNo, setLotNo]               = useState(d0?.lotNo ?? "");
  const [jobDate, setJobDate]           = useState(freshDate(d0?.jobDate));
  const [jsc3Selection, setJsc3Selection] = useState<string>(d0?.jsc3Selection ?? "");

  // ── Phase A formula rows ─────────────────────────────────────────────────
  const [rowsA, setRowsA] = useState<FormulaRow[]>([]);
  const [loadingFormula, setLoadingFormula] = useState(true);

  // ── Sulphur bags ─────────────────────────────────────────────────────────
  const [sulphurBags, setSulphurBags]     = useState<string[]>(d0?.sulphurBags ?? blankBags());
  const [sulphurAddedKg, setSulphurAddedKg] = useState(d0?.sulphurAddedKg ?? "");
  const [bagMismatchWarning, setBagMismatchWarning] = useState(false);

  // ── Phase A observations ─────────────────────────────────────────────────
  const [premixStart, setPremixStart]   = useState(d0?.premixStart ?? "");
  const [premixEnd, setPremixEnd]       = useState(d0?.premixEnd ?? "");
  const [beadMillStart, setBeadMillStart] = useState(d0?.beadMillStart ?? "");
  const [flowRate, setFlowRate]         = useState(d0?.flowRate ?? "");
  const [beadMillEnd, setBeadMillEnd]   = useState(d0?.beadMillEnd ?? "");
  const [slurryA, setSlurryA]           = useState(d0?.slurryA ?? "");

  // ── Phase B formula rows ─────────────────────────────────────────────────
  const [rowsB, setRowsB] = useState<FormulaRow[]>([]);

  // ── Final collection ─────────────────────────────────────────────────────
  const [slurryB, setSlurryB]     = useState(d0?.slurryB ?? "");
  const [totalScKg, setTotalScKg] = useState(d0?.totalScKg ?? "");
  const [totalScL, setTotalScL]   = useState(d0?.totalScL ?? "");

  // ── Checkpoints ──────────────────────────────────────────────────────────
  const [cpCoolingTower, setCpCoolingTower] = useState(d0?.cpCoolingTower ?? "");
  const [cpMechSeal, setCpMechSeal]         = useState(d0?.cpMechSeal ?? "");
  const [cpPipes, setCpPipes]               = useState(d0?.cpPipes ?? "");

  // ── QC / Remarks ─────────────────────────────────────────────────────────
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

  // ── Derived calculations ──────────────────────────────────────────────────
  const bsKg = parseFloat(batchSize) || REF_BATCH_KG;

  const bagWeightTotal = sulphurBags.reduce((s, w) => s + num(w), 0);

  const phaseATotalAdded = rowsA.reduce((s, r) => s + num(r.addedQty), 0);
  const phaseBTotalAdded = rowsB.reduce((s, r) => s + num(r.addedQty), 0);

  // Scaled instruction totals (for display)
  const phaseAInstructed = scaleQty(PHASE_A_TOTAL, REF_BATCH_KG, bsKg);
  const phaseBInstructed = scaleQty(PHASE_B_TOTAL, REF_BATCH_KG, bsKg);

  // ── Load formula items from DB ────────────────────────────────────────────
  const loadFormula = useCallback(async (batchKg: number, savedInputsA?: DraftShape["rowInputsA"], savedInputsB?: DraftShape["rowInputsB"]) => {
    setLoadingFormula(true);
    const { data } = await supabase
      .from("product_formula_items")
      .select("*")
      .eq("product_id", product.id)
      .order("phase")
      .order("order_no");

    const defs = (data ?? []) as ProductFormulaItem[];

    const makeRow = (d: ProductFormulaItem, savedInputs?: DraftShape["rowInputsA"]): FormulaRow => {
      const saved = savedInputs?.[d.id];
      return {
        formulaItemId: d.id,
        orderNo:       d.order_no,
        phase:         d.phase as "A" | "B",
        componentName: d.component_name,
        jscCode:       d.jsc_code,
        instructedQty: scaleQty(d.instructed_qty_kg, d.reference_batch_size_kg, batchKg || d.reference_batch_size_kg),
        addedQty:      saved?.addedQty  ?? "",
        rmBatchNo:     saved?.rmBatchNo ?? "",
        drumBagNo:     saved?.drumBagNo ?? "",
        tds:           saved?.tds       ?? "",
      };
    };

    setRowsA(defs.filter(d => d.phase === "A").map(d => makeRow(d, savedInputsA)));
    setRowsB(defs.filter(d => d.phase === "B").map(d => makeRow(d, savedInputsB)));
    setLoadingFormula(false);
  }, [supabase, product.id]);

  // Initial load — also loads edit card data
  useEffect(() => {
    if (isEdit && editCardId) {
      // Load existing card into form
      (async () => {
        setLoadingFormula(true);
        const [{ data: rawCard }, { data: items }, { data: formulaDefs }] = await Promise.all([
          supabase.from("production_job_cards").select("*").eq("id", editCardId).single(),
          supabase.from("production_job_card_items").select("*, product_formula_items(phase, order_no)")
            .eq("job_card_id", editCardId),
          supabase.from("product_formula_items").select("*").eq("product_id", product.id)
            .order("phase").order("order_no"),
        ]);

        if (!rawCard) { showToast(t("toastLoadFailedEdit"), true); onDone(); return; }

        // Cast to a wide type that includes the migration 012 columns
        type UplCard = ProductionJobCard & {
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
        const card = rawCard as unknown as UplCard;

        // Header
        setOperatorName(card.operator_name ?? "");
        setBatchSize(String(card.batch_size_kg ?? REF_BATCH_KG));
        setLotNo(card.lot_no ?? "");
        setJobDate(card.job_date ?? todayISO());
        setJsc3Selection(card.jsc3_code_selection ?? "");

        // Observations
        setPremixStart(card.premix_start ?? "");
        setPremixEnd(card.premix_end ?? "");
        setBeadMillStart(card.bead_mill_start ?? "");
        setFlowRate(card.flow_rate != null ? String(card.flow_rate) : "");
        setBeadMillEnd(card.bead_mill_end ?? "");
        setSlurryA(card.collected_slurry_phase_a_kg != null ? String(card.collected_slurry_phase_a_kg) : "");
        setSlurryB(card.collected_slurry_phase_b_kg != null ? String(card.collected_slurry_phase_b_kg) : "");

        // Sulphur bags
        const bags = card.sulphur_bag_weights;
        if (Array.isArray(bags) && bags.length === BAG_COUNT) {
          setSulphurBags(bags.map(b => b.weight_kg != null ? String(b.weight_kg) : ""));
        }
        setSulphurAddedKg(card.sulphur_added_kg != null ? String(card.sulphur_added_kg) : "");

        // Final
        setTotalScKg(card.total_sc_collected_kg != null ? String(card.total_sc_collected_kg) : "");
        setTotalScL(card.total_sc_collected_l  != null ? String(card.total_sc_collected_l)  : "");

        // Checkpoints
        setCpCoolingTower(card.checkpoint_cooling_tower ?? "");
        setCpMechSeal(card.checkpoint_mech_seal ?? "");
        setCpPipes(card.checkpoint_pipes ?? "");

        // QC
        setQcSulphurContent(card.qc_sulphur_content ?? "");
        setQcSuspensibility(card.qc_suspensibility ?? "");
        setQcDensity(card.qc_density ?? "");
        setQcPh(card.qc_ph ?? "");
        setQcViscosity(card.qc_viscosity_sec ?? "");

        // Sign-offs
        setSignOperator(card.sign_operator ?? "");
        setSignChemist(card.sign_chemist ?? "");
        setSignManager(card.sign_manager ?? "");

        // Build item lookup keyed by formula_item_id
        type ItemRow = { formula_item_id: string; added_qty_kg: number | null; rm_batch_no: string | null; drum_bag_no: string | null; remark: string | null };
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
            instructedQty: scaleQty(d.instructed_qty_kg, d.reference_batch_size_kg, card.batch_size_kg ?? d.reference_batch_size_kg),
            addedQty:      it?.added_qty_kg  != null ? String(it.added_qty_kg)  : "",
            rmBatchNo:     it?.rm_batch_no   ?? "",
            drumBagNo:     it?.drum_bag_no   ?? "",
            tds:           it?.remark        ?? "",
          };
        };
        setRowsA(defs.filter(d => d.phase === "A").map(makeEditRow));
        setRowsB(defs.filter(d => d.phase === "B").map(makeEditRow));
        setLoadingFormula(false);
      })();
    } else {
      // New mode: load formula with draft inputs
      loadFormula(bsKg, d0?.rowInputsA, d0?.rowInputsB);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch formula from DB when batch size changes (new mode only).
  // Always use the DB reference_batch_size_kg for scaling — never chain from
  // the current displayed value, which accumulates rounding errors.
  const batchSizeForEffect = batchSize;
  useEffect(() => {
    if (isEdit || loadingFormula) return;
    const batchKg = parseFloat(batchSizeForEffect) || REF_BATCH_KG;
    // Preserve user-typed inputs, only re-scale instructedQty from DB
    const inputsA: DraftShape["rowInputsA"] = {};
    const inputsB: DraftShape["rowInputsB"] = {};
    rowsA.forEach(r => { inputsA[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, drumBagNo: r.drumBagNo, tds: r.tds }; });
    rowsB.forEach(r => { inputsB[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, drumBagNo: r.drumBagNo, tds: r.tds }; });
    loadFormula(batchKg, inputsA, inputsB);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchSizeForEffect]);

  // Autosave draft
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

  // ── Row update helpers ────────────────────────────────────────────────────
  function updateRowA(idx: number, field: keyof Pick<FormulaRow, "addedQty" | "rmBatchNo" | "drumBagNo" | "tds">, val: string) {
    setRowsA(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  }
  function updateRowB(idx: number, field: keyof Pick<FormulaRow, "addedQty" | "rmBatchNo" | "drumBagNo" | "tds">, val: string) {
    setRowsB(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  }

  // Bag weight change — auto-fill sulphurAddedKg if not manually overridden
  function updateBag(idx: number, val: string) {
    setSulphurBags(prev => {
      const next = [...prev];
      next[idx] = val;
      const total = next.reduce((s, w) => s + num(w), 0);
      // Auto-fill sulphurAddedKg only if it's empty or equals the previous total
      setSulphurAddedKg(prev2 => {
        const prevTotal = prev.reduce((s, w) => s + num(w), 0);
        if (!prev2 || Math.abs(num(prev2) - prevTotal) < 0.001) {
          return total > 0 ? total.toFixed(3) : "";
        }
        return prev2;
      });
      setBagMismatchWarning(false);
      return next;
    });
  }

  // When operator manually changes sulphurAddedKg — check against bag total
  function handleSulphurAddedChange(val: string) {
    setSulphurAddedKg(val);
    const manual = num(val);
    if (val !== "" && Math.abs(manual - bagWeightTotal) > 0.01 && bagWeightTotal > 0) {
      setBagMismatchWarning(true);
    } else {
      setBagMismatchWarning(false);
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!lotNo.trim()) return t("valLotRequired");
    if (!batchSize || isNaN(parseFloat(batchSize))) return t("valBatchRequired");
    if (!jsc3Selection) return t("valJsc3Required");
    if (bagMismatchWarning) return t("valSulphurMismatchUpl");
    return null;
  }

  // ── Save / submit ─────────────────────────────────────────────────────────
  const handleSave = async (statusVal: "draft" | "submitted") => {
    const err = validate();
    if (err) { showToast(err, true); return; }
    setSubmitting(true);

    try {
      const batchKg = parseFloat(batchSize);

      // Build sulphur_bag_weights JSON array
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
        premix_start:                premixStart    || null,
        premix_end:                  premixEnd      || null,
        bead_mill_start:             beadMillStart  || null,
        bead_mill_end:               beadMillEnd    || null,
        flow_rate:                   flowRate ? parseFloat(flowRate) : null,
        collected_slurry_phase_a_kg: slurryA  ? parseFloat(slurryA)  : null,
        collected_slurry_phase_b_kg: slurryB  ? parseFloat(slurryB)  : null,
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
        // UPDATE existing record — no duplicate
        const { data, error } = await supabase
          .from("production_job_cards")
          .update(cardPayload)
          .eq("id", editCardId)
          .select("id")
          .single();
        if (error || !data) {
          showToast(t("toastUpdateFailed") + (error?.message ?? t("toastUnknown")), true);
          return;
        }
        cardId = editCardId;

        // Upsert line items
        const allRows = [...rowsA, ...rowsB];
        for (const r of allRows) {
          await supabase
            .from("production_job_card_items")
            .upsert({
              job_card_id:       cardId,
              formula_item_id:   r.formulaItemId,
              instructed_qty_kg: r.instructedQty,
              added_qty_kg:      r.addedQty ? parseFloat(r.addedQty) : null,
              rm_batch_no:       r.rmBatchNo  || null,
              drum_bag_no:       r.drumBagNo  || null,
              remark:            r.tds        || null,  // TDS in remark field
            }, { onConflict: "job_card_id,formula_item_id" });
        }
      } else {
        // INSERT new record
        const { data, error } = await supabase
          .from("production_job_cards")
          .insert(cardPayload)
          .select("id")
          .single();
        if (error || !data) {
          showToast(t("toastSaveFailed") + (error?.message ?? t("toastUnknown")), true);
          return;
        }
        cardId = data.id;

        // Insert line items
        const allRows = [...rowsA, ...rowsB];
        if (allRows.length > 0) {
          const rows = allRows.map(r => ({
            job_card_id:       cardId,
            formula_item_id:   r.formulaItemId,
            instructed_qty_kg: r.instructedQty,
            added_qty_kg:      r.addedQty ? parseFloat(r.addedQty) : null,
            rm_batch_no:       r.rmBatchNo  || null,
            drum_bag_no:       r.drumBagNo  || null,
            remark:            r.tds        || null,
          }));
          const { error: itemErr } = await supabase
            .from("production_job_card_items")
            .insert(rows);
          if (itemErr) {
            showToast(t("toastItemsFailed") + itemErr.message, true);
            return;
          }
        }
        draft.clear();
      }

      showToast(isEdit
        ? t("toastUpdated")
        : statusVal === "submitted" ? t("toastJobSubmitted") : t("toastDraftSaved")
      );
      onDone();
    } catch (e: unknown) {
      showToast(t("toastNetworkError") + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Ingredient table renderer ─────────────────────────────────────────────
  function renderTable(
    rows: FormulaRow[],
    updater: (idx: number, field: keyof Pick<FormulaRow, "addedQty" | "rmBatchNo" | "drumBagNo" | "tds">, val: string) => void,
    phase: "A" | "B",
  ) {
    const instructedTotal = rows.reduce((s, r) => s + r.instructedQty, 0);
    const addedTotal = rows.reduce((s, r) => s + num(r.addedQty), 0);
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ACCENT + "10", borderBottom: `2px solid ${ACCENT}40` }}>
              <th style={th}>{t("colOrder")}</th>
              <th style={th}>{t("colComponent")}</th>
              <th style={th}>{t("colMaterialCode")}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("colInstructedKg")}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("colAddedKg")}</th>
              <th style={th}>{t("colRmBatchNo")}</th>
              <th style={th}>{t("colDrumBagNo")}</th>
              {phase === "A" && <th style={th}>{t("colTdsNote")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isSulphur = r.componentName.toLowerCase() === "sulphur" && phase === "A";
              const isJsc3    = r.orderNo === 3 && phase === "A";
              const isWater   = r.componentName.toLowerCase() === "water";

              return (
                <tr key={r.formulaItemId}
                  style={{
                    borderBottom: "1px solid var(--line)",
                    background: isSulphur ? "#fff8f3" : undefined,
                  }}
                >
                  <td style={td}>{r.orderNo}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.componentName}</td>
                  <td style={td}>
                    {isJsc3 ? (
                      <select
                        value={jsc3Selection}
                        onChange={e => setJsc3Selection(e.target.value)}
                        style={{ fontSize: 13, padding: "3px 6px", borderRadius: 4,
                          border: !jsc3Selection ? "2px solid var(--warn)" : "1px solid var(--line)" }}
                      >
                        <option value="">{t("selectOption")}</option>
                        {JSC3_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: "var(--ink-soft)" }}>{r.jscCode ?? "—"}</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, color: ACCENT }}>
                    {r.instructedQty.toFixed(3)}
                  </td>
                  <td style={{ ...td, padding: "4px 6px" }}>
                    {isSulphur ? (
                      // Sulphur Added: editable input that auto-fills from bag grid below
                      <input type="number" step="any"
                        placeholder={r.instructedQty.toFixed(3)}
                        value={sulphurAddedKg}
                        onChange={e => handleSulphurAddedChange(e.target.value)}
                        style={{ width: 90, textAlign: "right",
                          borderColor: bagMismatchWarning ? "var(--warn)" : undefined }} />
                    ) : (
                      <input type="number" step="any"
                        placeholder={r.instructedQty.toFixed(3)}
                        value={r.addedQty}
                        onChange={e => updater(idx, "addedQty", e.target.value)}
                        style={{ width: 90, textAlign: "right" }} />
                    )}
                  </td>
                  <td style={{ ...td, padding: "4px 6px" }}>
                    <input type="text" placeholder={t("placeholderBatchNo")} value={r.rmBatchNo}
                      onChange={e => updater(idx, "rmBatchNo", e.target.value)}
                      style={{ width: 100 }} />
                  </td>
                  <td style={{ ...td, padding: "4px 6px" }}>
                    <input type="text" placeholder={t("placeholderDrumBag")} value={r.drumBagNo}
                      onChange={e => updater(idx, "drumBagNo", e.target.value)}
                      style={{ width: 90 }} />
                  </td>
                  {phase === "A" && (
                    <td style={{ ...td, padding: "4px 6px" }}>
                      {isWater ? (
                        <input type="text" placeholder={t("placeholderTds")} value={r.tds}
                          onChange={e => updater(idx, "tds", e.target.value)}
                          style={{ width: 80 }} />
                      ) : (
                        <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: ACCENT + "08", fontWeight: 700, fontSize: 13 }}>
              <td colSpan={phase === "A" ? 3 : 3} style={{ padding: "6px 10px" }}>
                {phase === "A" ? t("totalPhaseA") : t("totalPhaseB")}
              </td>
              <td style={{ padding: "6px 10px", textAlign: "right", color: ACCENT }}>
                {instructedTotal.toFixed(3)} kg
              </td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>
                {addedTotal > 0 ? addedTotal.toFixed(3) : "—"} kg
              </td>
              <td colSpan={phase === "A" ? 3 : 2} />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  // ── Cell styles ───────────────────────────────────────────────────────────
  const th: React.CSSProperties = { padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "5px 10px" };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Back */}
      <button type="button" className="back-link" onClick={onDone}>
        {t("backLink")}
      </button>

      {/* Form header banner */}
      <div style={{
        background: ACCENT, color: "#fff",
        padding: "16px 20px", borderRadius: 10, marginBottom: 16,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.8px", opacity: 0.8, marginBottom: 2 }}>
          {t("companyName")}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.3 }}>
          PROCESS JOB CARD FOR SULPHUR SC UPL GRADE
        </div>
        {isEdit && (
          <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>
            {t("editingBanner")}
          </div>
        )}
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
            <input type="number" step="any" value={batchSize}
              onChange={e => setBatchSize(e.target.value)} />
            {parseFloat(batchSize) !== REF_BATCH_KG && (
              <div className="field-hint" style={{ color: "#1565c0" }}>
                {lang === "hi"
                  ? `संदर्भ बैच: ${REF_BATCH_KG} kg · मात्राएँ अनुपात में बदली गई हैं`
                  : `Reference batch: ${REF_BATCH_KG} kg · quantities scaled proportionally`}
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
        <div style={{ marginTop: 8 }}>
          <InfoRow label={t("phaseAInstrTotal")} value={<b style={{ color: ACCENT }}>{phaseAInstructed.toFixed(3)} kg</b>} />
          <InfoRow label={t("phaseBInstrTotal")} value={<b style={{ color: ACCENT }}>{phaseBInstructed.toFixed(3)} kg</b>} />
        </div>
      </div>

      {/* ── 2. PHASE A — INGREDIENTS ─────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseARawMat")} />
        {loadingFormula ? (
          <div className="empty">{t("loadingFormula")}</div>
        ) : rowsA.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            {lang === "hi" ? "फेज़ A के लिए कोई फॉर्मूला आइटम नहीं मिला।" : "No Phase A formula items found. Run migration 012 on the A-20 Supabase project."}
          </div>
        ) : (
          renderTable(rowsA, updateRowA, "A")
        )}
      </div>

      {/* ── 3. PHASE A — SULPHUR BAG DETAILS ─────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secSulphurBagDetails")} />
        <div className="field-hint" style={{ marginBottom: 12 }}>
          {lang === "hi"
            ? <>प्रत्येक सल्फर बैग (1–20) का वज़न दर्ज करें। कुल स्वचालित रूप से <b>Sulphur Added (kg)</b> फेज़ A तालिका में भर जाएगा।</>
            : <>Enter the weight of each Sulphur bag (1–20). The total auto-fills the <b>Sulphur Added (kg)</b> field in the Phase A table above.</>
          }
        </div>

        {/* Two-column bag grid: bags 1–10 left, 11–20 right */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[0, 10].map(offset => (
            <table key={offset} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: ACCENT + "10" }}>
                  <th style={th}>{t("colBagNo")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("colWeightKg")}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }, (_, i) => offset + i).map(i => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={td}>{i + 1}</td>
                    <td style={{ ...td, padding: "3px 6px" }}>
                      <input
                        type="number" step="any" placeholder="—"
                        value={sulphurBags[i]}
                        onChange={e => updateBag(i, e.target.value)}
                        style={{ width: "100%", textAlign: "right" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>

        {/* Totals row */}
        <div style={{
          marginTop: 14, padding: "10px 14px",
          background: ACCENT + "08", borderRadius: 8,
          display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center",
        }}>
          <div style={{ fontSize: 13 }}>
            <span style={{ color: "var(--ink-soft)" }}>{t("bagWeightTotal")}</span>{" "}
            <b style={{ color: ACCENT }}>{bagWeightTotal.toFixed(3)} kg</b>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 12 }}>{t("sulphurAddedConfirmed")}</label>
            <input
              type="number" step="any"
              value={sulphurAddedKg}
              onChange={e => handleSulphurAddedChange(e.target.value)}
              style={{ width: 140 }}
            />
          </div>
        </div>

        {bagMismatchWarning && (
          <div style={{
            marginTop: 10, padding: "10px 14px", borderRadius: 8,
            background: "var(--warn-soft)", border: "1px solid var(--warn)",
            fontSize: 13, color: "var(--warn)", fontWeight: 600,
          }}>
            {t("valSulphurMismatchUpl")}
          </div>
        )}
      </div>

      {/* ── 4. PHASE A — OBSERVATIONS ────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseAObs")} />
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t("preMix")}</div>
        <div className="row2">
          <div>
            <label>{t("startTime")}</label>
            <input type="time" value={premixStart} onChange={e => setPremixStart(e.target.value)} />
          </div>
          <div>
            <label>{t("endTime")}</label>
            <input type="time" value={premixEnd} onChange={e => setPremixEnd(e.target.value)} />
          </div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, marginTop: 14, marginBottom: 8 }}>{t("beadMill")}</div>
        <div className="row2">
          <div>
            <label>{t("startTime")}</label>
            <input type="time" value={beadMillStart} onChange={e => setBeadMillStart(e.target.value)} />
          </div>
          <div>
            <label>{t("flowRateSL")}</label>
            <input type="number" step="any" placeholder="0" value={flowRate}
              onChange={e => setFlowRate(e.target.value)} />
          </div>
        </div>
        <div className="row2" style={{ marginTop: 8 }}>
          <div>
            <label>{t("endTime")}</label>
            <input type="time" value={beadMillEnd} onChange={e => setBeadMillEnd(e.target.value)} />
          </div>
          <div>
            <label>{t("totalPhaseAAddedCalc")}</label>
            <input type="number" readOnly value={phaseATotalAdded > 0 ? phaseATotalAdded.toFixed(3) : ""}
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

      {/* ── 5. PHASE B — INGREDIENTS ─────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseBRawMat")} />
        {loadingFormula ? (
          <div className="empty">{t("loadingFormula")}</div>
        ) : rowsB.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            {lang === "hi" ? "फेज़ B के लिए कोई फॉर्मूला आइटम नहीं मिला।" : "No Phase B formula items found."}
          </div>
        ) : (
          renderTable(rowsB, updateRowB, "B")
        )}
        <div className="row2" style={{ marginTop: 14 }}>
          <div>
            <label>{t("totalPhaseBAddedCalc")}</label>
            <input type="number" readOnly value={phaseBTotalAdded > 0 ? phaseBTotalAdded.toFixed(3) : ""}
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
          <div>
            <label>{t("totalScCollectedKg")}</label>
            <input type="number" step="any" placeholder="0" value={totalScKg}
              onChange={e => setTotalScKg(e.target.value)} />
          </div>
          <div>
            <label>{t("totalScCollectedL")}</label>
            <input type="number" step="any" placeholder="0" value={totalScL}
              onChange={e => setTotalScL(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── 7. CHECK POINTS ──────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secCheckPoints")} />
        {[
          [t("cpCoolingTower"), cpCoolingTower, setCpCoolingTower],
          [t("cpMechSeal"),        cpMechSeal,     setCpMechSeal],
          [t("cpPipes"), cpPipes, setCpPipes],
        ].map(([label, val, setter]) => (
          <div key={label as string} style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
            <span style={{ minWidth: 220, fontSize: 13, fontWeight: 500 }}>{label as string}</span>
            <input type="text" placeholder={t("cpObsPlaceholder")} value={val as string}
              onChange={e => (setter as React.Dispatch<React.SetStateAction<string>>)(e.target.value)}
              style={{ flex: 1 }} />
          </div>
        ))}
      </div>

      {/* ── Action buttons ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <button className="btn btn-primary" type="button"
          disabled={submitting} onClick={() => handleSave("submitted")}>
          {submitting ? t("saving") : isEdit ? t("saveChanges") : t("submitJobCard")}
        </button>
        {!isEdit && (
          <button className="btn btn-secondary" type="button"
            disabled={submitting} onClick={() => handleSave("draft")}>
            {t("saveAsDraft")}
          </button>
        )}
        <button className="btn btn-ghost" type="button"
          disabled={submitting} onClick={onDone}>
          {t("cancel")}
        </button>
      </div>
    </>
  );
}


"use client";

// =============================================================================
// InstaborJobCardForm — "InstaBor 150 Job Card"
//
// Template: A20 JOB CARDS FOR AUTOMATION.xlsx — "INSTABORE" sheet
//           (sheet title says "revised" — app section is "InstaBor 150 Job Card")
//
// Default batch size: 555 kg
//
// Phase A (5 rows, ref 555 kg):
//   1 Water           65.83666... kg
//   2 JSC72            0.58333... kg
//   3 JSC73          128.99666... kg
//   4 Water (rinse)    4.66666... kg
//   5 BORIC ACID     349.91666... kg
//   Total Phase A ≈ 550.00 kg
//
// Phase B (2 rows, ref 555 kg):
//   1 JSC67    0.00147408 kg
//   2 JSC71    5.58333333 kg
//   Total Phase B ≈ 5.584807 kg
//
// BORIC ACID (Phase A row 5) has 20-bag grid — auto-fills Added, mismatch warns.
//
// Extra fields vs other job cards:
//   Heating Start / Heating Stop  (Phase A) — stored in migration 017 columns
//   Boron Content, Appearance (Clear/Not Clear), pH, Specific Gravity
//   TOTAL LOT WT, REMARKS / NOTES
//
// DB column mapping:
//   premix_start / premix_end        → Phase A Mixing Start/End
//   heating_start / heating_stop     → Phase A Heating Start/Stop (migration 017)
//   bead_mill_start / bead_mill_end  → Phase B Mixing Start/End
//   sulphur_bag_weights (jsonb)      → Boric Acid bags 1–20
//   sulphur_added_kg                 → Boric Acid Added (kg)
//   total_sc_collected_kg            → Total Lot Weight
//   qc_sulphur_content               → Boron Content
//   qc_density                       → Appearance
//   qc_ph                            → pH
//   qc_specific_gravity              → Specific Gravity (migration 017)
//   water_tds_phase_a (text, JSON)   → remarks + phaseAObs + phaseBObs
//   sign_operator/chemist/manager
//
// Edit mode: editCardId → UPDATE, no duplicate.
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

const REF_BATCH_KG      = 555;
const PHASE_A_TOTAL     = 550.00;    // Template-stated total Phase A
const ACCENT            = "#0277bd"; // Blue for InstaBor (Boron product)
const BAG_COUNT         = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormulaRow {
  formulaItemId: string;
  orderNo: number;
  phase: "A" | "B";
  componentName: string;
  jscCode: string | null;
  instructedQty: number;
  addedQty: string;
  rmBatchNo: string;
  drumBagNo: string;
}

type RowInputMap = Record<string, { addedQty: string; rmBatchNo: string; drumBagNo: string }>;

interface DraftShape {
  operatorName: string;
  batchSize: string;
  lotNo: string;
  jobDate: string;
  rowInputs: RowInputMap;
  boricAcidBags: string[];
  boricAcidAdded: string;
  phaseAMixStart: string;
  phaseAMixEnd: string;
  heatingStart: string;
  heatingStop: string;
  phaseAObs: string;
  phaseBMixStart: string;
  phaseBMixEnd: string;
  phaseBObs: string;
  totalLotKg: string;
  remarks: string;
  qcBoronContent: string;
  qcAppearance: string;
  qcPh: string;
  qcSpGravity: string;
  signOperator: string;
  signChemist: string;
  signManager: string;
}

type ExtCard = ProductionJobCard & {
  operator_name: string | null;
  premix_start: string | null;
  premix_end: string | null;
  heating_start: string | null;      // migration 017
  heating_stop: string | null;       // migration 017
  bead_mill_start: string | null;
  bead_mill_end: string | null;
  sulphur_bag_weights: { bag_no: number; weight_kg: number | null }[] | null;
  sulphur_added_kg: number | null;
  total_sc_collected_kg: number | null;
  qc_sulphur_content: string | null;
  qc_density: string | null;
  qc_ph: string | null;
  qc_specific_gravity: string | null; // migration 017
  sign_operator: string | null;
  sign_chemist: string | null;
  sign_manager: string | null;
  water_tds_phase_a: string | null;   // JSON: { remarks, phaseAObs, phaseBObs }
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

function scaleQty(instructed: number, ref: number, actual: number): number {
  if (!ref || !actual || actual === ref) return instructed;
  return instructed / ref * actual;
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

export default function InstaborJobCardForm({ product, factoryId, userId, editCardId, onDone }: Props) {
  const { showToast } = useToast();
  const lang = useJobCardLang();
  const t = makeJcT(lang);
  const supabase = createClient();
  const pathname = usePathname();
  const isEdit = !!editCardId;

  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, factoryId, userId, "INSTABORE", editCardId ?? "new"),
  );
  const d0 = draft.restored;

  // ── Header ────────────────────────────────────────────────────────────────
  const [operatorName, setOperatorName] = useState(d0?.operatorName ?? "");
  const [batchSize, setBatchSize]       = useState(d0?.batchSize ?? String(REF_BATCH_KG));
  const [lotNo, setLotNo]               = useState(d0?.lotNo ?? "");
  const [jobDate, setJobDate]           = useState(freshDate(d0?.jobDate));

  // ── Formula rows ──────────────────────────────────────────────────────────
  const [rowsA, setRowsA]                   = useState<FormulaRow[]>([]);
  const [rowsB, setRowsB]                   = useState<FormulaRow[]>([]);
  const [loadingFormula, setLoadingFormula] = useState(true);

  // ── Boric Acid bags ───────────────────────────────────────────────────────
  const [boricAcidBags, setBoricAcidBags]     = useState<string[]>(d0?.boricAcidBags ?? blankBags());
  const [boricAcidAdded, setBoricAcidAdded]   = useState(d0?.boricAcidAdded ?? "");
  const [bagMismatch, setBagMismatch]         = useState(false);

  // ── Phase A mixing + heating ──────────────────────────────────────────────
  const [phaseAMixStart, setPhaseAMixStart] = useState(d0?.phaseAMixStart ?? "");
  const [phaseAMixEnd, setPhaseAMixEnd]     = useState(d0?.phaseAMixEnd ?? "");
  const [heatingStart, setHeatingStart]     = useState(d0?.heatingStart ?? "");
  const [heatingStop, setHeatingStop]       = useState(d0?.heatingStop ?? "");
  const [phaseAObs, setPhaseAObs]           = useState(d0?.phaseAObs ?? "");

  // ── Phase B mixing ────────────────────────────────────────────────────────
  const [phaseBMixStart, setPhaseBMixStart] = useState(d0?.phaseBMixStart ?? "");
  const [phaseBMixEnd, setPhaseBMixEnd]     = useState(d0?.phaseBMixEnd ?? "");
  const [phaseBObs, setPhaseBObs]           = useState(d0?.phaseBObs ?? "");

  // ── Final / QC ────────────────────────────────────────────────────────────
  const [totalLotKg, setTotalLotKg]         = useState(d0?.totalLotKg ?? "");
  const [remarks, setRemarks]               = useState(d0?.remarks ?? "");
  const [qcBoronContent, setQcBoronContent] = useState(d0?.qcBoronContent ?? "");
  const [qcAppearance, setQcAppearance]     = useState(d0?.qcAppearance ?? "");
  const [qcPh, setQcPh]                     = useState(d0?.qcPh ?? "");
  const [qcSpGravity, setQcSpGravity]       = useState(d0?.qcSpGravity ?? "");

  // ── Sign-offs ─────────────────────────────────────────────────────────────
  const [signOperator, setSignOperator] = useState(d0?.signOperator ?? "");
  const [signChemist, setSignChemist]   = useState(d0?.signChemist ?? "");
  const [signManager, setSignManager]   = useState(d0?.signManager ?? "");

  const [submitting, setSubmitting] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const bsKg = parseFloat(batchSize) || REF_BATCH_KG;

  const bagTotal = boricAcidBags.reduce((s, w) => s + num(w), 0);

  function phaseAddedTotal(rws: FormulaRow[], isBoric = false): number {
    return rws.reduce((s, r) => {
      if (r.componentName === "BORIC ACID") return s + num(isBoric ? boricAcidAdded : r.addedQty);
      return s + num(r.addedQty);
    }, 0);
  }

  const phaseAAdded = phaseAddedTotal(rowsA, true);
  const phaseBAdded = rowsB.reduce((s, r) => s + num(r.addedQty), 0);

  // Scaled instruction totals
  const phaseAInstrTotal = bsKg === REF_BATCH_KG
    ? PHASE_A_TOTAL
    : Math.round(rowsA.reduce((s, r) => s + scaleQty(r.instructedQty, REF_BATCH_KG, bsKg), 0) * 1000) / 1000;
  const phaseBInstrTotal = Math.round(rowsB.reduce((s, r) => {
    const q = bsKg === REF_BATCH_KG ? r.instructedQty : scaleQty(r.instructedQty, REF_BATCH_KG, bsKg);
    return s + q;
  }, 0) * 1000000) / 1000000;

  const calcLotWt = Math.round((phaseAInstrTotal + phaseBInstrTotal) * 1000) / 1000;

  // ── Load formula ──────────────────────────────────────────────────────────
  const loadFormula = useCallback(async (batchKg: number, savedInputs?: RowInputMap) => {
    setLoadingFormula(true);
    const { data } = await supabase
      .from("product_formula_items")
      .select("*")
      .eq("product_id", product.id)
      .order("phase").order("order_no");

    const defs = (data ?? []) as ProductFormulaItem[];
    const makeRow = (d: ProductFormulaItem): FormulaRow => {
      const saved = savedInputs?.[d.id];
      return {
        formulaItemId: d.id,
        orderNo:       d.order_no,
        phase:         d.phase as "A" | "B",
        componentName: d.component_name,
        jscCode:       d.jsc_code,
        instructedQty: bsKg === REF_BATCH_KG
          ? d.instructed_qty_kg
          : scaleQty(d.instructed_qty_kg, d.reference_batch_size_kg, batchKg),
        addedQty:  saved?.addedQty  ?? "",
        rmBatchNo: saved?.rmBatchNo ?? "",
        drumBagNo: saved?.drumBagNo ?? "",
      };
    };
    setRowsA(defs.filter(d => d.phase === "A").map(makeRow));
    setRowsB(defs.filter(d => d.phase === "B").map(makeRow));
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
            .select("formula_item_id, added_qty_kg, rm_batch_no, drum_bag_no")
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
        setPhaseAMixStart(card.premix_start ?? "");
        setPhaseAMixEnd(card.premix_end ?? "");
        setHeatingStart(card.heating_start ?? "");
        setHeatingStop(card.heating_stop ?? "");
        setPhaseBMixStart(card.bead_mill_start ?? "");
        setPhaseBMixEnd(card.bead_mill_end ?? "");
        setTotalLotKg(card.total_sc_collected_kg != null ? String(card.total_sc_collected_kg) : "");
        setQcBoronContent(card.qc_sulphur_content ?? "");
        setQcAppearance(card.qc_density ?? "");
        setQcPh(card.qc_ph ?? "");
        setQcSpGravity(card.qc_specific_gravity ?? "");
        setSignOperator(card.sign_operator ?? "");
        setSignChemist(card.sign_chemist ?? "");
        setSignManager(card.sign_manager ?? "");

        // Extra JSON fields
        try {
          const extra = card.water_tds_phase_a ? JSON.parse(card.water_tds_phase_a) : {};
          setRemarks(extra.remarks ?? "");
          setPhaseAObs(extra.phaseAObs ?? "");
          setPhaseBObs(extra.phaseBObs ?? "");
        } catch { /* ignore */ }

        // Boric Acid bags
        const bags = card.sulphur_bag_weights;
        if (Array.isArray(bags) && bags.length === BAG_COUNT) {
          setBoricAcidBags(bags.map(b => b.weight_kg != null ? String(b.weight_kg) : ""));
        }
        setBoricAcidAdded(card.sulphur_added_kg != null ? String(card.sulphur_added_kg) : "");

        const itemMap: Record<string, ItemRow> = {};
        for (const it of (items ?? []) as ItemRow[]) itemMap[it.formula_item_id] = it;

        const defs = (formulaDefs ?? []) as ProductFormulaItem[];
        setRowsA(defs.filter(d => d.phase === "A").map(d => {
          const it = itemMap[d.id];
          return { formulaItemId: d.id, orderNo: d.order_no, phase: "A" as const,
            componentName: d.component_name, jscCode: d.jsc_code,
            instructedQty: d.instructed_qty_kg,
            addedQty: it?.added_qty_kg != null ? String(it.added_qty_kg) : "",
            rmBatchNo: it?.rm_batch_no ?? "", drumBagNo: it?.drum_bag_no ?? "" };
        }));
        setRowsB(defs.filter(d => d.phase === "B").map(d => {
          const it = itemMap[d.id];
          return { formulaItemId: d.id, orderNo: d.order_no, phase: "B" as const,
            componentName: d.component_name, jscCode: d.jsc_code,
            instructedQty: d.instructed_qty_kg,
            addedQty: it?.added_qty_kg != null ? String(it.added_qty_kg) : "",
            rmBatchNo: it?.rm_batch_no ?? "", drumBagNo: it?.drum_bag_no ?? "" };
        }));
        setLoadingFormula(false);
      })();
    } else {
      loadFormula(bsKg, d0?.rowInputs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-scale on batch size change (new mode only)
  const batchSizeForEffect = batchSize;
  useEffect(() => {
    if (isEdit || loadingFormula) return;
    const batchKg = parseFloat(batchSizeForEffect) || REF_BATCH_KG;
    const saved: RowInputMap = {};
    [...rowsA, ...rowsB].forEach(r => { saved[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, drumBagNo: r.drumBagNo }; });
    loadFormula(batchKg, saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchSizeForEffect]);

  // Draft autosave
  const draftSave = draft.save;
  useEffect(() => {
    if (isEdit) return;
    const rowInputs: RowInputMap = {};
    [...rowsA, ...rowsB].forEach(r => { rowInputs[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, drumBagNo: r.drumBagNo }; });
    draftSave({
      operatorName, batchSize, lotNo, jobDate, rowInputs,
      boricAcidBags, boricAcidAdded,
      phaseAMixStart, phaseAMixEnd, heatingStart, heatingStop, phaseAObs,
      phaseBMixStart, phaseBMixEnd, phaseBObs,
      totalLotKg, remarks,
      qcBoronContent, qcAppearance, qcPh, qcSpGravity,
      signOperator, signChemist, signManager,
    });
  }, [operatorName, batchSize, lotNo, jobDate, rowsA, rowsB,
      boricAcidBags, boricAcidAdded,
      phaseAMixStart, phaseAMixEnd, heatingStart, heatingStop, phaseAObs,
      phaseBMixStart, phaseBMixEnd, phaseBObs,
      totalLotKg, remarks,
      qcBoronContent, qcAppearance, qcPh, qcSpGravity,
      signOperator, signChemist, signManager, draftSave, isEdit]);

  // ── Row updater ───────────────────────────────────────────────────────────
  type RowField = "addedQty" | "rmBatchNo" | "drumBagNo";
  const updateRowA = (id: string, field: RowField, val: string) =>
    setRowsA(prev => prev.map(r => r.formulaItemId === id ? { ...r, [field]: val } : r));
  const updateRowB = (id: string, field: RowField, val: string) =>
    setRowsB(prev => prev.map(r => r.formulaItemId === id ? { ...r, [field]: val } : r));

  // ── Boric Acid bag helpers ────────────────────────────────────────────────
  function updateBag(idx: number, val: string) {
    setBoricAcidBags(prev => {
      const next = [...prev]; next[idx] = val;
      const total = next.reduce((s, w) => s + num(w), 0);
      setBoricAcidAdded(prev2 => {
        const prevTotal = prev.reduce((s, w) => s + num(w), 0);
        if (!prev2 || Math.abs(num(prev2) - prevTotal) < 0.001) {
          return total > 0 ? total.toFixed(3) : "";
        }
        return prev2;
      });
      setBagMismatch(false);
      return next;
    });
  }

  function handleBoricAddedChange(val: string) {
    setBoricAcidAdded(val);
    setBagMismatch(val !== "" && Math.abs(num(val) - bagTotal) > 0.001 && bagTotal > 0);
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!lotNo.trim()) return t("valLotRequired");
    if (!batchSize || isNaN(parseFloat(batchSize))) return t("valBatchRequired");
    if (bagMismatch) return t("valBoricMismatch");
    return null;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (statusVal: "draft" | "submitted") => {
    const err = validate();
    if (err) { showToast(err, true); return; }
    setSubmitting(true);
    try {
      const batchKg = parseFloat(batchSize);
      const boricBagJson = boricAcidBags.map((w, i) => ({
        bag_no: i + 1, weight_kg: w !== "" ? parseFloat(w) : null,
      }));
      const extraJson = JSON.stringify({ remarks, phaseAObs, phaseBObs });

      const cardPayload = {
        factory_id:           factoryId,
        product_id:           product.id,
        lot_no:               lotNo.trim(),
        job_date:             jobDate,
        operator_id:          userId,
        batch_size_kg:        batchKg,
        operator_name:        operatorName.trim() || null,
        premix_start:         phaseAMixStart || null,
        premix_end:           phaseAMixEnd   || null,
        heating_start:        heatingStart   || null,
        heating_stop:         heatingStop    || null,
        bead_mill_start:      phaseBMixStart || null,
        bead_mill_end:        phaseBMixEnd   || null,
        sulphur_bag_weights:  boricBagJson,
        sulphur_added_kg:     boricAcidAdded ? parseFloat(boricAcidAdded) : null,
        total_sc_collected_kg: totalLotKg ? parseFloat(totalLotKg) : (calcLotWt || null),
        qc_sulphur_content:   qcBoronContent || null,
        qc_density:           qcAppearance   || null,
        qc_ph:                qcPh           || null,
        qc_specific_gravity:  qcSpGravity    || null,
        sign_operator:        signOperator   || null,
        sign_chemist:         signChemist    || null,
        sign_manager:         signManager    || null,
        water_tds_phase_a:    extraJson,
        status:               statusVal,
      };

      const allRows = [...rowsA, ...rowsB];
      let cardId: string;

      if (isEdit && editCardId) {
        const { data, error } = await supabase
          .from("production_job_cards").update(cardPayload)
          .eq("id", editCardId).select("id").single();
        if (error || !data) { showToast(t("toastUpdateFailed") + (error?.message ?? t("toastUnknown")), true); return; }
        cardId = editCardId;
        for (const r of allRows) {
          await supabase.from("production_job_card_items").upsert({
            job_card_id:       cardId,
            formula_item_id:   r.formulaItemId,
            instructed_qty_kg: r.instructedQty,
            added_qty_kg:      r.componentName === "BORIC ACID"
              ? (boricAcidAdded ? parseFloat(boricAcidAdded) : null)
              : (r.addedQty ? parseFloat(r.addedQty) : null),
            rm_batch_no: r.rmBatchNo || null,
            drum_bag_no: r.drumBagNo || null,
          }, { onConflict: "job_card_id,formula_item_id" });
        }
      } else {
        const { data, error } = await supabase
          .from("production_job_cards").insert(cardPayload).select("id").single();
        if (error || !data) { showToast(t("toastSaveFailed") + (error?.message ?? t("toastUnknown")), true); return; }
        cardId = data.id;
        if (allRows.length > 0) {
          const { error: itemErr } = await supabase.from("production_job_card_items").insert(
            allRows.map(r => ({
              job_card_id:       cardId,
              formula_item_id:   r.formulaItemId,
              instructed_qty_kg: r.instructedQty,
              added_qty_kg:      r.componentName === "BORIC ACID"
                ? (boricAcidAdded ? parseFloat(boricAcidAdded) : null)
                : (r.addedQty ? parseFloat(r.addedQty) : null),
              rm_batch_no: r.rmBatchNo || null,
              drum_bag_no: r.drumBagNo || null,
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

  // ── Table renderer ────────────────────────────────────────────────────────
  const thS: React.CSSProperties = {
    padding: "6px 10px", textAlign: "left", fontWeight: 600,
    color: "var(--ink-soft)", whiteSpace: "nowrap", background: ACCENT + "10",
  };
  const tdS: React.CSSProperties = { padding: "5px 10px" };

  function renderTable(rws: FormulaRow[], updater: (id: string, f: RowField, v: string) => void) {
    const instrTotal = rws === rowsA ? phaseAInstrTotal : phaseBInstrTotal;
    const addedTot   = rws === rowsA ? phaseAAdded : phaseBAdded;
    const isA = rws === rowsA;

    if (loadingFormula) return <div className="empty">{t("loadingFormula")}</div>;
    if (rws.length === 0) return (
      <div className="field-hint" style={{ color: "var(--warn)" }}>
        No formula items found. Run migration 017 on the A-20 Supabase project.
      </div>
    );

    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${ACCENT}40` }}>
              <th style={thS}>Order</th>
              <th style={thS}>Components</th>
              <th style={thS}>Batch No.</th>
              <th style={{ ...thS, textAlign: "right" }}>Instructions (kgs)</th>
              <th style={{ ...thS, textAlign: "right" }}>Added (kgs)</th>
              <th style={thS}>Drum / Bag No.</th>
            </tr>
          </thead>
          <tbody>
            {rws.map(r => {
              const isBoric = r.componentName === "BORIC ACID";
              return (
                <tr key={r.formulaItemId}
                  style={{ borderBottom: "1px solid var(--line)", background: isBoric ? "#e1f5fe" : undefined }}>
                  <td style={tdS}>{r.orderNo}</td>
                  <td style={{ ...tdS, fontWeight: 600 }}>{r.componentName}</td>
                  <td style={{ ...tdS, padding: "4px 6px" }}>
                    <input type="text" placeholder={t("colBatchNo")} value={r.rmBatchNo}
                      onChange={e => updater(r.formulaItemId, "rmBatchNo", e.target.value)}
                      style={{ width: 90 }} />
                  </td>
                  <td style={{ ...tdS, textAlign: "right", fontWeight: 700, color: ACCENT }}>
                    {/* Use enough dp to show small quantities without losing precision */}
                    {r.componentName === "JSC67" ? r.instructedQty.toFixed(8)
                     : r.instructedQty < 1 ? r.instructedQty.toFixed(8)
                     : r.instructedQty.toFixed(3)}
                  </td>
                  <td style={{ ...tdS, padding: "4px 6px", textAlign: "right" }}>
                    {isBoric ? (
                      <input type="number" step="any"
                        placeholder={r.instructedQty.toFixed(3)}
                        value={boricAcidAdded}
                        onChange={e => handleBoricAddedChange(e.target.value)}
                        style={{ width: 90, textAlign: "right",
                          borderColor: bagMismatch ? "var(--warn)" : undefined }} />
                    ) : (
                      <input type="number" step="any"
                        placeholder={r.instructedQty < 1 ? r.instructedQty.toFixed(8) : r.instructedQty.toFixed(3)}
                        value={r.addedQty}
                        onChange={e => updater(r.formulaItemId, "addedQty", e.target.value)}
                        style={{ width: 90, textAlign: "right" }} />
                    )}
                  </td>
                  <td style={{ ...tdS, padding: "4px 6px" }}>
                    <input type="text" placeholder={t("placeholderDrumBag")} value={r.drumBagNo}
                      onChange={e => updater(r.formulaItemId, "drumBagNo", e.target.value)}
                      style={{ width: 90 }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: ACCENT + "08", fontWeight: 700, fontSize: 13 }}>
              <td colSpan={2} style={{ padding: "6px 10px" }}>
                {isA ? t("totalPhaseA") : t("totalPhaseB")}
              </td>
              <td style={{ padding: "6px 10px" }} />
              <td style={{ padding: "6px 10px", textAlign: "right", color: ACCENT }}>
                {isA
                  ? instrTotal.toFixed(3)
                  : instrTotal.toFixed(6)} kg
              </td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>
                {addedTot > 0 ? addedTot.toFixed(3) : "—"} kg
              </td>
              <td style={{ padding: "6px 10px" }} />
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
          InstaBor 150 Job Card
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
            <input type="number" step="any" value={batchSize}
              onChange={e => !isEdit && setBatchSize(e.target.value)} />
            {isEdit && <div className="field-hint" style={{ marginTop: 4 }}>Batch size cannot be changed when editing.</div>}
            {parseFloat(batchSize) !== REF_BATCH_KG && !isEdit && (
              <div className="field-hint" style={{ color: ACCENT }}>
                Template batch: {REF_BATCH_KG} kg · quantities scaled proportionally
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

      {/* ── 2. PHASE A — RAW MATERIALS ───────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseARawMat")} />
        {renderTable(rowsA, updateRowA)}
      </div>

      {/* ── 3. BORIC ACID BAG DETAILS ────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secBoricBagDetails")} />
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Enter weight of each bag. Total auto-fills the BORIC ACID Added (kgs) field above.
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
                      <input type="number" step="any" placeholder="—"
                        value={boricAcidBags[i]}
                        onChange={e => updateBag(i, e.target.value)}
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
            <b style={{ color: ACCENT }}>{bagTotal.toFixed(3)} kg</b>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>↑ Auto-fills BORIC ACID Added (kgs) above</div>
        </div>
        {bagMismatch && (
          <div style={{
            marginTop: 10, padding: "10px 14px", borderRadius: 8,
            background: "var(--warn-soft)", border: "1px solid var(--warn)",
            fontSize: 13, color: "var(--warn)", fontWeight: 600,
          }}>
            ⚠ BORIC ACID Added ({boricAcidAdded} kg) differs from bag total ({bagTotal.toFixed(3)} kg).
            Reconcile before saving.
          </div>
        )}
      </div>

      {/* ── 4. PHASE A MIXING & HEATING ──────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseAMixHeat")} />
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t("phaseAMixingSubhead")}</div>
        <div className="row2">
          <div><label>{t("startTime")}</label>
            <input type="time" value={phaseAMixStart} onChange={e => setPhaseAMixStart(e.target.value)} /></div>
          <div><label>{t("endTime")}</label>
            <input type="time" value={phaseAMixEnd} onChange={e => setPhaseAMixEnd(e.target.value)} /></div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, marginTop: 14, marginBottom: 8 }}>{t("heatingSubhead")}</div>
        <div className="row2">
          <div><label>{t("heatingStartTime")}</label>
            <input type="time" value={heatingStart} onChange={e => setHeatingStart(e.target.value)} /></div>
          <div><label>{t("heatingStopTime")}</label>
            <input type="time" value={heatingStop} onChange={e => setHeatingStop(e.target.value)} /></div>
        </div>
      </div>

      {/* ── 5. PHASE A OBSERVATIONS ──────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseAObsInstacal")} />
        <div className="row2">
          <div>
            <label>{t("totalPhaseAAddedKgs")}</label>
            <input type="number" readOnly
              value={phaseAAdded > 0 ? phaseAAdded.toFixed(3) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
          <div />
        </div>
        <label style={{ marginTop: 12 }}>Phase A Observations</label>
        <textarea rows={3} placeholder={t("phaseAObsPlaceholder2")}
          value={phaseAObs} onChange={e => setPhaseAObs(e.target.value)}
          style={{ width: "100%", resize: "vertical" }} />
      </div>

      {/* ── 6. PHASE B — RAW MATERIALS ───────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseBRawMat")} />
        {renderTable(rowsB, updateRowB)}
      </div>

      {/* ── 7. PHASE B MIXING ─────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseBMixing")} />
        <div className="row2">
          <div><label>{t("startTime")}</label>
            <input type="time" value={phaseBMixStart} onChange={e => setPhaseBMixStart(e.target.value)} /></div>
          <div><label>{t("endTime")}</label>
            <input type="time" value={phaseBMixEnd} onChange={e => setPhaseBMixEnd(e.target.value)} /></div>
        </div>
      </div>

      {/* ── 8. PHASE B OBSERVATIONS ──────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseBObsInstacal")} />
        <div className="row2">
          <div>
            <label>{t("totalPhaseBAddedKgs")}</label>
            <input type="number" readOnly
              value={phaseBAdded > 0 ? phaseBAdded.toFixed(6) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
          <div />
        </div>
        <label style={{ marginTop: 12 }}>Phase B Observations</label>
        <textarea rows={3} placeholder={t("phaseBObsPlaceholder2")}
          value={phaseBObs} onChange={e => setPhaseBObs(e.target.value)}
          style={{ width: "100%", resize: "vertical" }} />
      </div>

      {/* ── 9. TOTAL LOT WEIGHT ──────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secTotalLotWeight")} />
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Phase A ({phaseAInstrTotal.toFixed(3)} kg) + Phase B ({phaseBInstrTotal.toFixed(6)} kg)
          = <b style={{ color: ACCENT }}>{calcLotWt.toFixed(3)} kg</b> (calculated from instruction totals)
        </div>
        <div className="row2">
          <div>
            <label>TOTAL LOT WT (kg) — confirmed actual</label>
            <input type="number" step="any"
              placeholder={calcLotWt.toFixed(3)}
              value={totalLotKg}
              onChange={e => setTotalLotKg(e.target.value)} />
          </div>
          <div />
        </div>
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
          {t("cancel")}
        </button>
      </div>
    </>
  );
}


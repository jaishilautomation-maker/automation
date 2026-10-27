"use client";

// =============================================================================
// InstacalJobCardForm — "InstaCal 160 Job Card"
//
// Template: A20 JOB CARDS FOR AUTOMATION.xlsx — "INSTACAL" sheet
//
// Four batch-size variants, each with Phase A (6 rows) + Phase B (1–2 rows).
// Phase keys in product_formula_items.phase:
//   A_600 / B_600   A_573 / B_573   A_450 / B_450   A_335 / B_335
//
// Ingredient differences between variants:
//   600 kg:          JSC63 in row 5, Phase B has only JSC71
//   573/450/335 kg:  JSC64 in row 5, Phase B has JSC71 (+ RETURN INSTACAL for 573)
//
// JSC45 (Phase A row 6): 20-bag detail grid — auto-fills Added, mismatch warns.
// Water (Phase A row 1): TDS field in DRUM/BAG column.
//
// Columns: Order | Components | Batch No. | Instructions (kg) | Added (kg) | Drum/Bag No.
//
// DB: migration 012 columns already exist; migration 015 seeds formula items.
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

type BatchVariant = 600 | 573 | 450 | 335;
const BATCH_OPTIONS: BatchVariant[] = [600, 573, 450, 335];

const ACCENT    = "#2e7d32";   // Green for InstaCal (calcium product)
const BAG_COUNT = 20;

// Display precision for ingredients:
//   600 kg: round values → 3 dp
//   573/450/335: many significant figures → 6 dp
function fmtQty(v: number, variant: BatchVariant): string {
  return variant === 600 ? v.toFixed(3) : v.toFixed(6);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormulaRow {
  formulaItemId: string;
  orderNo: number;
  phaseKey: string;
  componentName: string;
  jscCode: string | null;
  instructedQty: number;
  addedQty: string;
  rmBatchNo: string;
  drumBagNo: string;
  tds: string;              // Water row only
}

type RowInputMap = Record<string, { addedQty: string; rmBatchNo: string; drumBagNo: string; tds: string }>;

interface DraftShape {
  batchVariant: number;
  operatorName: string;
  lotNo: string;
  jobDate: string;
  rowInputs: RowInputMap;
  // JSC45 bags per variant (keyed by variant)
  jsc45Bags: Record<string, string[]>;
  jsc45Added: Record<string, string>;
  // Phase A mixing & observations per variant
  phaseAStart: string;
  phaseAEnd: string;
  phaseAObs: string;
  phaseATotalAdded: string;   // display field, not authoritative
  // Phase B mixing & observations per variant
  phaseBStart: string;
  phaseBEnd: string;
  phaseBObs: string;
  // Final
  totalLotKg: string;
  // QC / Remarks
  qcCalciumContent: string;
  qcClear: string;
  qcPh: string;
  signOperator: string;
  signChemist: string;
  signManager: string;
}

type ExtCard = ProductionJobCard & {
  operator_name: string | null;
  // Phase A mixing stored in premix_start/end
  // Phase B mixing stored in bead_mill_start/end
  // JSC45 bags stored in sulphur_bag_weights
  sulphur_bag_weights: { bag_no: number; weight_kg: number | null }[] | null;
  sulphur_added_kg: number | null;
  total_sc_collected_kg: number | null;   // Total Lot Weight
  qc_sulphur_content: string | null;      // Calcium Content
  qc_density: string | null;             // Clear
  qc_ph: string | null;
  sign_operator: string | null;
  sign_chemist: string | null;
  sign_manager: string | null;
  // Extra fields as JSON in water_tds_phase_a
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

export default function InstacalJobCardForm({ product, factoryId, userId, editCardId, onDone }: Props) {
  const { showToast } = useToast();
  const lang = useJobCardLang();
  const t = makeJcT(lang);
  const supabase = createClient();
  const pathname = usePathname();
  const isEdit = !!editCardId;

  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, factoryId, userId, "INSTACAL", editCardId ?? "new"),
  );
  const d0 = draft.restored;

  // ── Header ────────────────────────────────────────────────────────────────
  const [batchVariant, setBatchVariant] = useState<BatchVariant>(
    (d0?.batchVariant as BatchVariant) ?? 600,
  );
  const [operatorName, setOperatorName] = useState(d0?.operatorName ?? "");
  const [lotNo, setLotNo]               = useState(d0?.lotNo ?? "");
  const [jobDate, setJobDate]           = useState(freshDate(d0?.jobDate));

  // ── Formula rows ──────────────────────────────────────────────────────────
  const [rows, setRows]                   = useState<FormulaRow[]>([]);
  const [loadingFormula, setLoadingFormula] = useState(true);

  // ── JSC45 bags — one set per variant, stored as a map ────────────────────
  const initBags = (): Record<string, string[]> => {
    const m: Record<string, string[]> = {};
    BATCH_OPTIONS.forEach(v => { m[String(v)] = d0?.jsc45Bags?.[String(v)] ?? blankBags(); });
    return m;
  };
  const initAdded = (): Record<string, string> => {
    const m: Record<string, string> = {};
    BATCH_OPTIONS.forEach(v => { m[String(v)] = d0?.jsc45Added?.[String(v)] ?? ""; });
    return m;
  };
  const [jsc45Bags, setJsc45Bags]   = useState<Record<string, string[]>>(initBags);
  const [jsc45Added, setJsc45Added] = useState<Record<string, string>>(initAdded);
  const [bagMismatch, setBagMismatch] = useState(false);

  // ── Phase A mixing / observations ─────────────────────────────────────────
  const [phaseAStart, setPhaseAStart] = useState(d0?.phaseAStart ?? "");
  const [phaseAEnd, setPhaseAEnd]     = useState(d0?.phaseAEnd ?? "");
  const [phaseAObs, setPhaseAObs]     = useState(d0?.phaseAObs ?? "");

  // ── Phase B mixing / observations ─────────────────────────────────────────
  const [phaseBStart, setPhaseBStart] = useState(d0?.phaseBStart ?? "");
  const [phaseBEnd, setPhaseBEnd]     = useState(d0?.phaseBEnd ?? "");
  const [phaseBObs, setPhaseBObs]     = useState(d0?.phaseBObs ?? "");

  // ── Final / QC ────────────────────────────────────────────────────────────
  const [totalLotKg, setTotalLotKg]         = useState(d0?.totalLotKg ?? "");
  const [qcCalciumContent, setQcCalciumContent] = useState(d0?.qcCalciumContent ?? "");
  const [qcClear, setQcClear]               = useState(d0?.qcClear ?? "");
  const [qcPh, setQcPh]                     = useState(d0?.qcPh ?? "");
  const [signOperator, setSignOperator]     = useState(d0?.signOperator ?? "");
  const [signChemist, setSignChemist]       = useState(d0?.signChemist ?? "");
  const [signManager, setSignManager]       = useState(d0?.signManager ?? "");

  const [submitting, setSubmitting] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const vStr = String(batchVariant);
  const pk_a = `A_${batchVariant}`;
  const pk_b = `B_${batchVariant}`;

  const rowsOf    = (pk: string) => rows.filter(r => r.phaseKey === pk);
  const bagTotal  = (jsc45Bags[vStr] ?? blankBags()).reduce((s, w) => s + num(w), 0);

  function phaseAddedTotal(pk: string): number {
    return Math.round(rowsOf(pk).reduce((s, r) => {
      if (r.componentName === "JSC45") {
        return s + num(jsc45Added[vStr] ?? "");
      }
      return s + num(r.addedQty);
    }, 0) * 1000) / 1000;
  }

  function phaseInstrTotal(pk: string): number {
    return rowsOf(pk).reduce((s, r) => s + r.instructedQty, 0);
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
        instructedQty: d.instructed_qty_kg,   // stored at full precision
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

        const savedVariant = [600, 573, 450, 335].includes(Number(card.batch_size_kg))
          ? (Number(card.batch_size_kg) as BatchVariant) : 600;
        setBatchVariant(savedVariant);
        setOperatorName(card.operator_name ?? "");
        setLotNo(card.lot_no ?? "");
        setJobDate(card.job_date ?? todayISO());
        setPhaseAStart(card.premix_start ?? "");
        setPhaseAEnd(card.premix_end ?? "");
        setPhaseBStart(card.bead_mill_start ?? "");
        setPhaseBEnd(card.bead_mill_end ?? "");
        setTotalLotKg(card.total_sc_collected_kg != null ? String(card.total_sc_collected_kg) : "");
        setQcCalciumContent(card.qc_sulphur_content ?? "");
        setQcClear(card.qc_density ?? "");
        setQcPh(card.qc_ph ?? "");
        setSignOperator(card.sign_operator ?? "");
        setSignChemist(card.sign_chemist ?? "");
        setSignManager(card.sign_manager ?? "");

        // Extra fields from JSON
        try {
          const extra = card.water_tds_phase_a ? JSON.parse(card.water_tds_phase_a) : {};
          setPhaseAObs(extra.phaseAObs ?? "");
          setPhaseBObs(extra.phaseBObs ?? "");
          // JSC45 bags stored per variant
          if (extra.jsc45Bags) setJsc45Bags(prev => ({ ...prev, ...extra.jsc45Bags }));
          if (extra.jsc45Added) setJsc45Added(prev => ({ ...prev, ...extra.jsc45Added }));
        } catch { /* ignore */ }

        // JSC45 bags for active variant also in sulphur_bag_weights
        const bags = card.sulphur_bag_weights;
        if (Array.isArray(bags) && bags.length === BAG_COUNT) {
          const bagArr = bags.map(b => b.weight_kg != null ? String(b.weight_kg) : "");
          setJsc45Bags(prev => ({ ...prev, [String(savedVariant)]: bagArr }));
        }
        if (card.sulphur_added_kg != null) {
          setJsc45Added(prev => ({ ...prev, [String(savedVariant)]: String(card.sulphur_added_kg) }));
        }

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
      jsc45Bags, jsc45Added,
      phaseAStart, phaseAEnd, phaseAObs,
      phaseATotalAdded: String(phaseAddedTotal(pk_a)),
      phaseBStart, phaseBEnd, phaseBObs,
      totalLotKg,
      qcCalciumContent, qcClear, qcPh,
      signOperator, signChemist, signManager,
    });
  }, [batchVariant, operatorName, lotNo, jobDate, rows,
      jsc45Bags, jsc45Added,
      phaseAStart, phaseAEnd, phaseAObs,
      phaseBStart, phaseBEnd, phaseBObs,
      totalLotKg, qcCalciumContent, qcClear, qcPh,
      signOperator, signChemist, signManager, draftSave, isEdit,
      pk_a]);

  // ── Row updater ───────────────────────────────────────────────────────────
  type RowField = "addedQty" | "rmBatchNo" | "drumBagNo" | "tds";
  const updateRow = (id: string, field: RowField, val: string) =>
    setRows(prev => prev.map(r => r.formulaItemId === id ? { ...r, [field]: val } : r));

  // ── JSC45 bag helpers ─────────────────────────────────────────────────────
  function updateBag(variantStr: string, idx: number, val: string) {
    setJsc45Bags(prev => {
      const curr = prev[variantStr] ?? blankBags();
      const next = [...curr]; next[idx] = val;
      const total = next.reduce((s, w) => s + num(w), 0);
      setJsc45Added(prev2 => {
        const prevTotal = curr.reduce((s, w) => s + num(w), 0);
        if (!prev2[variantStr] || Math.abs(num(prev2[variantStr]) - prevTotal) < 0.001) {
          return { ...prev2, [variantStr]: total > 0 ? total.toFixed(6) : "" };
        }
        return prev2;
      });
      setBagMismatch(false);
      return { ...prev, [variantStr]: next };
    });
  }

  function handleJsc45AddedChange(val: string) {
    setJsc45Added(prev => ({ ...prev, [vStr]: val }));
    setBagMismatch(val !== "" && Math.abs(num(val) - bagTotal) > 0.001 && bagTotal > 0);
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!lotNo.trim()) return t("valLotRequired");
    if (bagMismatch) return t("valJsc45Mismatch");
    return null;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (statusVal: "draft" | "submitted") => {
    const err = validate();
    if (err) { showToast(err, true); return; }
    setSubmitting(true);
    try {
      const activeBags = jsc45Bags[vStr] ?? blankBags();
      const jsc45BagJson = activeBags.map((w, i) => ({
        bag_no: i + 1, weight_kg: w !== "" ? parseFloat(w) : null,
      }));

      const extraJson = JSON.stringify({
        phaseAObs, phaseBObs,
        jsc45Bags, jsc45Added,
      });

      const instrTotalA = phaseInstrTotal(pk_a);
      const instrTotalB = phaseInstrTotal(pk_b);
      const lotWeight = instrTotalA + instrTotalB;

      const cardPayload = {
        factory_id:         factoryId,
        product_id:         product.id,
        lot_no:             lotNo.trim(),
        job_date:           jobDate,
        operator_id:        userId,
        batch_size_kg:      batchVariant,
        operator_name:      operatorName.trim() || null,
        // Phase A mixing → premix_start/end
        premix_start:       phaseAStart || null,
        premix_end:         phaseAEnd   || null,
        // Phase B mixing → bead_mill_start/end
        bead_mill_start:    phaseBStart || null,
        bead_mill_end:      phaseBEnd   || null,
        // JSC45 bags → sulphur_bag_weights
        sulphur_bag_weights: jsc45BagJson,
        sulphur_added_kg:   jsc45Added[vStr] ? parseFloat(jsc45Added[vStr]) : null,
        // Total Lot Weight → total_sc_collected_kg
        total_sc_collected_kg: totalLotKg ? parseFloat(totalLotKg) : lotWeight || null,
        // QC
        qc_sulphur_content: qcCalciumContent || null,
        qc_density:         qcClear          || null,
        qc_ph:              qcPh             || null,
        sign_operator:      signOperator     || null,
        sign_chemist:       signChemist      || null,
        sign_manager:       signManager      || null,
        // Extra fields as JSON
        water_tds_phase_a:  extraJson,
        status:             statusVal,
      };

      // Only save rows for the active variant
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

  // ── Table renderer ────────────────────────────────────────────────────────
  const thS: React.CSSProperties = {
    padding: "6px 10px", textAlign: "left", fontWeight: 600,
    color: "var(--ink-soft)", whiteSpace: "nowrap", background: ACCENT + "10",
  };
  const tdS: React.CSSProperties = { padding: "5px 10px" };

  function renderPhaseTable(phaseKey: string) {
    const groupRows = rowsOf(phaseKey);
    const instrTotal = phaseInstrTotal(phaseKey);
    const addedTotalVal = phaseAddedTotal(phaseKey);
    const isPhaseA = phaseKey.startsWith("A");

    if (loadingFormula) return <div className="empty">{t("loadingFormula")}</div>;
    if (groupRows.length === 0) return (
      <div className="field-hint" style={{ color: "var(--warn)" }}>
        No formula items found for {phaseKey}. Run migration 015 on the A-20 Supabase project.
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
              <th style={{ ...thS, textAlign: "right" }}>Instructions (kg)</th>
              <th style={{ ...thS, textAlign: "right" }}>Added (kg)</th>
              <th style={thS}>Drum / Bag No.</th>
            </tr>
          </thead>
          <tbody>
            {groupRows.map(r => {
              const isJsc45 = r.componentName === "JSC45" && isPhaseA;
              const isWater = r.componentName.toLowerCase() === "water" && isPhaseA;
              const isReturn = r.componentName === "RETURN INSTACAL";
              return (
                <tr key={r.formulaItemId}
                  style={{ borderBottom: "1px solid var(--line)", background: isJsc45 ? "#f1f8e9" : isReturn ? "#fff8e1" : undefined }}>
                  <td style={tdS}>{r.orderNo}</td>
                  <td style={{ ...tdS, fontWeight: 600 }}>{r.componentName}
                    {isReturn && <span style={{ marginLeft: 6, fontSize: 11, color: "#e65100", fontWeight: 700 }}>← 573 kg only</span>}
                  </td>
                  <td style={{ ...tdS, padding: "4px 6px" }}>
                    <input type="text" placeholder={t("colBatchNo")} value={r.rmBatchNo}
                      onChange={e => updateRow(r.formulaItemId, "rmBatchNo", e.target.value)}
                      style={{ width: 90 }} />
                  </td>
                  <td style={{ ...tdS, textAlign: "right", fontWeight: 700, color: ACCENT }}>
                    {fmtQty(r.instructedQty, batchVariant)}
                  </td>
                  <td style={{ ...tdS, padding: "4px 6px", textAlign: "right" }}>
                    {isJsc45 ? (
                      <input type="number" step="any"
                        placeholder={fmtQty(r.instructedQty, batchVariant)}
                        value={jsc45Added[vStr] ?? ""}
                        onChange={e => handleJsc45AddedChange(e.target.value)}
                        style={{ width: 90, textAlign: "right",
                          borderColor: bagMismatch ? "var(--warn)" : undefined }} />
                    ) : (
                      <input type="number" step="any"
                        placeholder={fmtQty(r.instructedQty, batchVariant)}
                        value={r.addedQty}
                        onChange={e => updateRow(r.formulaItemId, "addedQty", e.target.value)}
                        style={{ width: 90, textAlign: "right" }} />
                    )}
                  </td>
                  <td style={{ ...tdS, padding: "4px 6px" }}>
                    {isJsc45 ? (
                      <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>see bag grid ↓</span>
                    ) : isWater ? (
                      <input type="text" placeholder={t("placeholderTds")} value={r.tds}
                        onChange={e => updateRow(r.formulaItemId, "tds", e.target.value)}
                        style={{ width: 70 }} />
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
                {isPhaseA ? t("totalPhaseA") : t("totalPhaseB")}
              </td>
              <td style={{ padding: "6px 10px" }} />
              <td style={{ padding: "6px 10px", textAlign: "right", color: ACCENT }}>
                {instrTotal.toFixed(3)} kg
              </td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>
                {addedTotalVal > 0 ? addedTotalVal.toFixed(3) : "—"} kg
              </td>
              <td style={{ padding: "6px 10px" }} />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  // ── JSC45 bag grid ────────────────────────────────────────────────────────
  function renderJsc45Bags() {
    const bags = jsc45Bags[vStr] ?? blankBags();
    return (
      <div className="card">
        <SectionHeader title={t("secJsc45BagDetails")} />
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Enter weight of each JSC45 bag. Total auto-fills the JSC45 Added (kg) field above.
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
                        onChange={e => updateBag(vStr, i, e.target.value)}
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
            <b style={{ color: ACCENT }}>{bagTotal.toFixed(6)} kg</b>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            ↑ Auto-fills JSC45 Added (kg) above
          </div>
        </div>
        {bagMismatch && (
          <div style={{
            marginTop: 10, padding: "10px 14px", borderRadius: 8,
            background: "var(--warn-soft)", border: "1px solid var(--warn)",
            fontSize: 13, color: "var(--warn)", fontWeight: 600,
          }}>
            ⚠ JSC45 Added ({jsc45Added[vStr]} kg) differs from bag weight total ({bagTotal.toFixed(6)} kg).
            Reconcile before saving.
          </div>
        )}
      </div>
    );
  }

  // ── Computed lot weight ───────────────────────────────────────────────────
  const calcLotWeight = Math.round(
    (phaseInstrTotal(pk_a) + phaseInstrTotal(pk_b)) * 1000
  ) / 1000;

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
          InstaCal 160 Job Card
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
            <div className="chip-group" style={{ marginTop: 6, flexWrap: "wrap" }}>
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
                Batch variant cannot be changed when editing.
              </div>
            )}
            {batchVariant === 600 && (
              <div className="field-hint" style={{ color: ACCENT, marginTop: 4, fontWeight: 600 }}>
                Uses JSC63 (row 5)
              </div>
            )}
            {batchVariant !== 600 && (
              <div className="field-hint" style={{ color: ACCENT, marginTop: 4, fontWeight: 600 }}>
                Uses JSC64 (row 5){batchVariant === 573 ? " · includes RETURN INSTACAL" : ""}
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
        <SectionHeader title={`${lang === "hi" ? "फेज़ A" : "Phase A"} — ${batchVariant} kg`} />
        {renderPhaseTable(pk_a)}
      </div>

      {/* ── 3. JSC45 BAG DETAILS ─────────────────────────────────────────── */}
      {renderJsc45Bags()}

      {/* ── 4. PHASE A MIXING ─────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseAMixing")} />
        <div className="row2">
          <div>
            <label>{t("startTime")}</label>
            <input type="time" value={phaseAStart} onChange={e => setPhaseAStart(e.target.value)} />
          </div>
          <div>
            <label>{t("endTime")}</label>
            <input type="time" value={phaseAEnd} onChange={e => setPhaseAEnd(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── 5. PHASE A OBSERVATIONS ──────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseAObsInstacal")} />
        <div className="row2">
          <div>
            <label>{t("totalPhaseAAddedCalc")}</label>
            <input type="number" readOnly
              value={phaseAddedTotal(pk_a) > 0 ? phaseAddedTotal(pk_a).toFixed(3) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
          <div />
        </div>
        <label style={{ marginTop: 12 }}>Phase A Observations</label>
        <textarea
          rows={3}
          placeholder={t("phaseAObsPlaceholder")}
          value={phaseAObs}
          onChange={e => setPhaseAObs(e.target.value)}
          style={{ width: "100%", resize: "vertical" }}
        />
      </div>

      {/* ── 6. PHASE B ────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={`${lang === "hi" ? "फेज़ B" : "Phase B"} — ${batchVariant} kg`} />
        {renderPhaseTable(pk_b)}
      </div>

      {/* ── 7. PHASE B MIXING ─────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseBMixing")} />
        <div className="row2">
          <div>
            <label>{t("startTime")}</label>
            <input type="time" value={phaseBStart} onChange={e => setPhaseBStart(e.target.value)} />
          </div>
          <div>
            <label>{t("endTime")}</label>
            <input type="time" value={phaseBEnd} onChange={e => setPhaseBEnd(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── 8. PHASE B OBSERVATIONS ──────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPhaseBObsInstacal")} />
        <div className="row2">
          <div>
            <label>{t("totalPhaseBAddedCalc")}</label>
            <input type="number" readOnly
              value={phaseAddedTotal(pk_b) > 0 ? phaseAddedTotal(pk_b).toFixed(3) : ""}
              style={{ background: "var(--surface)", color: "var(--ink-soft)" }} />
          </div>
          <div />
        </div>
        <label style={{ marginTop: 12 }}>Phase B Observations</label>
        <textarea
          rows={3}
          placeholder={t("phaseBObsPlaceholder")}
          value={phaseBObs}
          onChange={e => setPhaseBObs(e.target.value)}
          style={{ width: "100%", resize: "vertical" }}
        />
      </div>

      {/* ── 9. TOTAL LOT WEIGHT ──────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secTotalLotWeight")} />
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Calculated from Phase A + Phase B instruction totals:
          <b style={{ color: ACCENT }}> {calcLotWeight.toFixed(3)} kg</b>
          {" "}(template value — override below if actual differs)
        </div>
        <div className="row2">
          <div>
            <label>{t("totalLotWeightConfirmed")}</label>
            <input type="number" step="any"
              placeholder={calcLotWeight.toFixed(3)}
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
          {t(t("cancel"))}
        </button>
      </div>
    </>
  );
}


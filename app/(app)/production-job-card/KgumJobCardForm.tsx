"use client";

// =============================================================================
// KgumJobCardForm
//   "PROCESS JOB CARD FOR KELZAN PLUS 1.4% SOLUTION"
//
// Template: A20 JOB CARDS FOR AUTOMATION.xlsx — "K GUM" sheet
//
// Single-phase product — no Phase A / B, no batch variants, no bag grid.
// 4 ingredient rows:
//   1  WATER   277.826 kg  (+ TDS field)
//   2  JSC52    14.987 kg
//   3  JSC53     1.200 kg
//   4  JSC51     4.200 kg
//   Total: 298.213 kg  (=SUM(C8:C11))
//
// Columns: Order | Components | Instructions (kgs) | Batch No. | Added (kgs) | Remark
//
// Additional fields from the K GUM sheet:
//   Water TDS — stored in production_job_card_items.remark for the WATER row
//   pH        — stored in production_job_cards.qc_ph (migration 012)
//
// DB: standard production_job_cards + production_job_card_items.
//     migration 012 columns already cover all extra fields needed.
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

const ACCENT         = "#6a1b9a";   // Purple for K GUM
const INSTRUCT_TOTAL = 298.213;     // SUM(C8:C11) from the Excel template

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormulaRow {
  formulaItemId: string;
  orderNo: number;
  componentName: string;
  jscCode: string | null;
  instructedQty: number;
  addedQty: string;
  rmBatchNo: string;
  remark: string;    // general remark per row; also used for Water TDS
}

interface DraftShape {
  operatorName: string;
  lotNo: string;
  jobDate: string;
  rowInputs: Record<string, { addedQty: string; rmBatchNo: string; remark: string }>;
  waterTds: string;
  ph: string;
  signOperator: string;
  signChemist: string;
  signManager: string;
}

type ExtCard = ProductionJobCard & {
  operator_name: string | null;
  qc_ph: string | null;
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

export default function KgumJobCardForm({ product, factoryId, userId, editCardId, onDone }: Props) {
  const { showToast } = useToast();
  const lang = useJobCardLang();
  const t = makeJcT(lang);
  const supabase = createClient();
  const pathname = usePathname();
  const isEdit = !!editCardId;

  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, factoryId, userId, "K_GUM", editCardId ?? "new"),
  );
  const d0 = draft.restored;

  // ── Header ────────────────────────────────────────────────────────────────
  const [operatorName, setOperatorName] = useState(d0?.operatorName ?? "");
  const [lotNo, setLotNo]               = useState(d0?.lotNo ?? "");
  const [jobDate, setJobDate]           = useState(freshDate(d0?.jobDate));

  // ── Formula rows ──────────────────────────────────────────────────────────
  const [rows, setRows]                     = useState<FormulaRow[]>([]);
  const [loadingFormula, setLoadingFormula] = useState(true);

  // ── Additional fields ─────────────────────────────────────────────────────
  const [waterTds, setWaterTds] = useState(d0?.waterTds ?? "");
  const [ph, setPh]             = useState(d0?.ph ?? "");

  // ── Sign-offs ─────────────────────────────────────────────────────────────
  const [signOperator, setSignOperator] = useState(d0?.signOperator ?? "");
  const [signChemist, setSignChemist]   = useState(d0?.signChemist ?? "");
  const [signManager, setSignManager]   = useState(d0?.signManager ?? "");

  const [submitting, setSubmitting] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalAdded = Math.round(rows.reduce((s, r) => s + num(r.addedQty), 0) * 1000) / 1000;

  // ── Load formula ──────────────────────────────────────────────────────────
  const loadFormula = useCallback(async (
    savedInputs?: DraftShape["rowInputs"],
  ) => {
    setLoadingFormula(true);
    const { data } = await supabase
      .from("product_formula_items")
      .select("*")
      .eq("product_id", product.id)
      .order("order_no");

    const defs = (data ?? []) as ProductFormulaItem[];
    setRows(defs.map(d => {
      const saved = savedInputs?.[d.id];
      return {
        formulaItemId: d.id,
        orderNo:       d.order_no,
        componentName: d.component_name,
        jscCode:       d.jsc_code,
        instructedQty: d.instructed_qty_kg,
        addedQty:      saved?.addedQty  ?? "",
        rmBatchNo:     saved?.rmBatchNo ?? "",
        remark:        saved?.remark    ?? "",
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
            .select("formula_item_id, added_qty_kg, rm_batch_no, remark")
            .eq("job_card_id", editCardId),
          supabase.from("product_formula_items").select("*")
            .eq("product_id", product.id).order("order_no"),
        ]);
        if (!rawCard) { showToast(t("toastLoadFailed"), true); onDone(); return; }
        const card = rawCard as unknown as ExtCard;

        setOperatorName(card.operator_name ?? "");
        setLotNo(card.lot_no ?? "");
        setJobDate(card.job_date ?? todayISO());
        setPh(card.qc_ph ?? "");
        setSignOperator(card.sign_operator ?? "");
        setSignChemist(card.sign_chemist ?? "");
        setSignManager(card.sign_manager ?? "");

        const itemMap: Record<string, ItemRow> = {};
        for (const it of (items ?? []) as ItemRow[]) itemMap[it.formula_item_id] = it;

        const defs = (formulaDefs ?? []) as ProductFormulaItem[];
        const builtRows = defs.map(d => {
          const it = itemMap[d.id];
          return {
            formulaItemId: d.id,
            orderNo:       d.order_no,
            componentName: d.component_name,
            jscCode:       d.jsc_code,
            instructedQty: d.instructed_qty_kg,
            addedQty:      it?.added_qty_kg != null ? String(it.added_qty_kg) : "",
            rmBatchNo:     it?.rm_batch_no  ?? "",
            remark:        it?.remark       ?? "",
          };
        });
        setRows(builtRows);

        // Water TDS is stored in the WATER row's remark field
        const waterRow = builtRows.find(r => r.componentName === "WATER");
        setWaterTds(waterRow?.remark ?? "");

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
    const rowInputs: DraftShape["rowInputs"] = {};
    rows.forEach(r => { rowInputs[r.formulaItemId] = { addedQty: r.addedQty, rmBatchNo: r.rmBatchNo, remark: r.remark }; });
    draftSave({ operatorName, lotNo, jobDate, rowInputs, waterTds, ph, signOperator, signChemist, signManager });
  }, [operatorName, lotNo, jobDate, rows, waterTds, ph,
      signOperator, signChemist, signManager, draftSave, isEdit]);

  // ── Row updater ───────────────────────────────────────────────────────────
  type RowField = "addedQty" | "rmBatchNo" | "remark";
  const updateRow = (id: string, field: RowField, val: string) =>
    setRows(prev => prev.map(r => r.formulaItemId === id ? { ...r, [field]: val } : r));

  // Water TDS: keep in sync with the WATER row's remark field
  function handleWaterTds(val: string) {
    setWaterTds(val);
    setRows(prev => prev.map(r =>
      r.componentName === "WATER" ? { ...r, remark: val } : r
    ));
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!lotNo.trim()) return t("valLotRequired");
    if (ph && isNaN(parseFloat(ph))) return t("valPhNotNumeric");
    return null;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (statusVal: "draft" | "submitted") => {
    const err = validate();
    if (err) { showToast(err, true); return; }
    setSubmitting(true);
    try {
      const cardPayload = {
        factory_id:   factoryId,
        product_id:   product.id,
        lot_no:       lotNo.trim(),
        job_date:     jobDate,
        operator_id:  userId,
        batch_size_kg: INSTRUCT_TOTAL,   // use instruction total as batch size
        operator_name: operatorName.trim() || null,
        qc_ph:         ph || null,
        sign_operator: signOperator || null,
        sign_chemist:  signChemist  || null,
        sign_manager:  signManager  || null,
        status:        statusVal,
      };

      let cardId: string;

      if (isEdit && editCardId) {
        const { data, error } = await supabase
          .from("production_job_cards").update(cardPayload)
          .eq("id", editCardId).select("id").single();
        if (error || !data) { showToast(t("toastUpdateFailed") + (error?.message ?? t("toastUnknown")), true); return; }
        cardId = editCardId;
        for (const r of rows) {
          await supabase.from("production_job_card_items").upsert({
            job_card_id:       cardId,
            formula_item_id:   r.formulaItemId,
            instructed_qty_kg: r.instructedQty,
            added_qty_kg:      r.addedQty ? parseFloat(r.addedQty) : null,
            rm_batch_no:       r.rmBatchNo || null,
            remark:            r.remark    || null,
          }, { onConflict: "job_card_id,formula_item_id" });
        }
      } else {
        const { data, error } = await supabase
          .from("production_job_cards").insert(cardPayload).select("id").single();
        if (error || !data) { showToast(t("toastSaveFailed") + (error?.message ?? t("toastUnknown")), true); return; }
        cardId = data.id;
        if (rows.length > 0) {
          const { error: itemErr } = await supabase.from("production_job_card_items").insert(
            rows.map(r => ({
              job_card_id:       cardId,
              formula_item_id:   r.formulaItemId,
              instructed_qty_kg: r.instructedQty,
              added_qty_kg:      r.addedQty ? parseFloat(r.addedQty) : null,
              rm_batch_no:       r.rmBatchNo || null,
              remark:            r.remark    || null,
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

  // ── Cell styles ───────────────────────────────────────────────────────────
  const thS: React.CSSProperties = {
    padding: "6px 10px", textAlign: "left", fontWeight: 600,
    color: "var(--ink-soft)", whiteSpace: "nowrap", background: ACCENT + "10",
  };
  const tdS: React.CSSProperties = { padding: "5px 10px" };

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
          PROCESS JOB CARD FOR KELZAN PLUS 1.4% SOLUTION
        </div>
        {isEdit && <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>{t("editingBanner")}</div>}
      </div>

      {/* ── 1. HEADER ─────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secJobCardHeader")} />
        <div className="row2">
          <div>
            <label>{t("date")}</label>
            <DateField value={jobDate} onChange={setJobDate} />
          </div>
          <div>
            <label>{t("lotNo")}</label>
            <input type="text" placeholder={t("placeholderLotNo")} value={lotNo}
              onChange={e => setLotNo(e.target.value)} />
          </div>
        </div>
        <div className="row2">
          <div>
            <label>{t("operatorName")}</label>
            <input type="text" placeholder={t("placeholderName")} value={operatorName}
              onChange={e => setOperatorName(e.target.value)} />
          </div>
          <div />
        </div>
      </div>

      {/* ── 2. RAW MATERIALS & INGREDIENTS ───────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secRawMat")} />

        {loadingFormula ? (
          <div className="empty">{t("loadingFormula")}</div>
        ) : rows.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            No formula items found. Run migration 016 on the A-20 Supabase project.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${ACCENT}40` }}>
                  <th style={thS}>Order</th>
                  <th style={thS}>Components</th>
                  <th style={{ ...thS, textAlign: "right" }}>Instructions (kgs)</th>
                  <th style={thS}>Batch No.</th>
                  <th style={{ ...thS, textAlign: "right" }}>Added (kgs)</th>
                  <th style={thS}>Remark</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isWater = r.componentName === "WATER";
                  return (
                    <tr key={r.formulaItemId} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={tdS}>{r.orderNo}</td>
                      <td style={{ ...tdS, fontWeight: 600 }}>{r.componentName}</td>
                      <td style={{ ...tdS, textAlign: "right", fontWeight: 700, color: ACCENT }}>
                        {r.instructedQty.toFixed(3)}
                      </td>
                      <td style={{ ...tdS, padding: "4px 6px" }}>
                        <input type="text" placeholder={t("placeholderBatchNo")} value={r.rmBatchNo}
                          onChange={e => updateRow(r.formulaItemId, "rmBatchNo", e.target.value)}
                          style={{ width: 100 }} />
                      </td>
                      <td style={{ ...tdS, padding: "4px 6px", textAlign: "right" }}>
                        <input type="number" step="any"
                          placeholder={r.instructedQty.toFixed(3)}
                          value={r.addedQty}
                          onChange={e => updateRow(r.formulaItemId, "addedQty", e.target.value)}
                          style={{ width: 90, textAlign: "right" }} />
                      </td>
                      <td style={{ ...tdS, padding: "4px 6px" }}>
                        {isWater ? (
                          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>TDS ↓</span>
                        ) : (
                          <input type="text" placeholder={t("placeholderRemark")} value={r.remark}
                            onChange={e => updateRow(r.formulaItemId, "remark", e.target.value)}
                            style={{ width: 110 }} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: ACCENT + "08", fontWeight: 700, fontSize: 13 }}>
                  <td colSpan={2} style={{ padding: "6px 10px" }}>Total Instructions</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", color: ACCENT }}>
                    {INSTRUCT_TOTAL.toFixed(3)} kg
                  </td>
                  <td style={{ padding: "6px 10px" }} />
                  <td style={{ padding: "6px 10px", textAlign: "right" }}>
                    {totalAdded > 0 ? (
                      <span title={t("totalAddedTooltip")}>
                        {totalAdded.toFixed(3)} kg
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "6px 10px" }} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Total instruction confirmation */}
        <div style={{
          marginTop: 12, padding: "8px 14px", borderRadius: 8,
          background: ACCENT + "08", fontSize: 13,
          display: "flex", gap: 24, flexWrap: "wrap",
        }}>
          <div>
            <span style={{ color: "var(--ink-soft)" }}>Total Instructions:</span>{" "}
            <b style={{ color: ACCENT }}>{INSTRUCT_TOTAL.toFixed(3)} kg</b>
          </div>
          {totalAdded > 0 && (
            <div>
              <span style={{ color: "var(--ink-soft)" }}>Total Added:</span>{" "}
              <b>{totalAdded.toFixed(3)} kg</b>
            </div>
          )}
        </div>
      </div>

      {/* ── 3. WATER TDS ─────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secWaterTds")} />
        <div className="row2">
          <div>
            <label>{t("waterTdsLabel")}</label>
            <input type="text" placeholder={t("waterTdsPlaceholder")} value={waterTds}
              onChange={e => handleWaterTds(e.target.value)} />
            <div className="field-hint" style={{ marginTop: 4 }}>
              Recorded for the WATER ingredient (row 1).
            </div>
          </div>
          <div />
        </div>
      </div>

      {/* ── 4. pH ─────────────────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title={t("secPh")} />
        <div className="row2">
          <div>
            <label>{t("phLabel")}</label>
            <input type="number" step="0.01" placeholder="0.00" value={ph}
              onChange={e => setPh(e.target.value)} />
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


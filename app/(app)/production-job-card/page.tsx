"use client";

// =============================================================================
// Production Job Card — Module A (A-20 only)
//
// Landing page shows 6 product tiles, one per A-20 production product.
// Clicking a tile opens that product's job card form.
//
// SULPHUR_SC_UPL → UplJobCardForm  (full Excel template, migration 012 fields)
// All other 5 products → generic JobCardForm (formula-driven)
//
// DB tables:
//   products, product_formula_items,
//   production_job_cards, production_job_card_items
//
// Access: operator, factory_admin, company_admin — enforced by RLS
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import DateField from "@/components/DateField";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import { useFormDraft, draftKey } from "@/lib/use-form-draft";
import type { Product, ProductFormulaItem, ProductionJobCard } from "@/lib/types";
import { LanguageContext } from "@/lib/job-card-lang-context";
import UplJobCardForm from "./UplJobCardForm";
import SulphurScJobCardForm from "./SulphurScJobCardForm";
import NutrizinJobCardForm from "./NutrizinJobCardForm";
import InstacalJobCardForm from "./InstacalJobCardForm";
import KgumJobCardForm from "./KgumJobCardForm";
import InstaborJobCardForm from "./InstaborJobCardForm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const A20_PROD_CODES = [
  "SULPHUR_SC_UPL",
  "SULPHUR_SC",
  "NUTRIZIN",
  "INSTACAL",
  "K_GUM",
  "INSTABORE",
] as const;

const PRODUCT_SECTION_TITLE: Record<string, string> = {
  SULPHUR_SC_UPL: "PROCESS JOB CARD FOR SULPHUR SC UPL GRADE",
  SULPHUR_SC:     "PROCESS JOB CARD FOR SULPHUR SC (55.16%) (GAIN / INSTASUL)",
  NUTRIZIN:       "PROCESS JOB CARD FOR ZINC OXIDE 39.5% SC (NUTRIZIN)",
  INSTACAL:       "InstaCal 160 Job Card",
  K_GUM:          "PROCESS JOB CARD FOR KELZAN PLUS 1.4% SOLUTION",
  INSTABORE:      "InstaBor 150 Job Card",
};

const PHASE_AWARE_CODES = new Set(["SULPHUR_SC", "NUTRIZIN", "INSTACAL", "INSTABORE"]);

// Hindi titles for the six job cards
const PRODUCT_SECTION_TITLE_HI: Record<string, string> = {
  SULPHUR_SC_UPL: "सल्फर SC UPL ग्रेड प्रोसेस जॉब कार्ड",
  SULPHUR_SC:     "सल्फर SC (55.16%) (GAIN / INSTASUL) प्रोसेस जॉब कार्ड",
  NUTRIZIN:       "जिंक ऑक्साइड 39.5% SC (NUTRIZIN) प्रोसेस जॉब कार्ड",
  INSTACAL:       "InstaCal 160 जॉब कार्ड",
  K_GUM:          "केल्ज़न प्लस 1.4% सोल्यूशन प्रोसेस जॉब कार्ड",
  INSTABORE:      "InstaBor 150 जॉब कार्ड",
};

// Page-level UI translations
function makeT(hi: boolean) {
  return {
    pageTitle:        hi ? "प्रोडक्शन जॉब कार्ड" : "Production Job Card",
    pageHint:         hi ? "कोई उत्पाद चुनें और जॉब कार्ड फॉर्म खोलें।" : "Select a product to open its job card form.",
    tabJobCards:      hi ? "जॉब कार्ड" : "Production Job Card",
    tabDashboard:     hi ? "डैशबोर्ड" : "Dashboard",
    dashTitle:        hi ? "डैशबोर्ड" : "Dashboard",
    dashHint:         hi ? "सभी सेव किए गए जॉब कार्ड। किसी भी रिकॉर्ड को सुधारने के लिए ✏️ Edit करें।" : "All saved job cards. Click ✏️ Edit to open and correct any record.",
    loadingProducts:  hi ? "उत्पाद लोड हो रहे हैं…" : "Loading products…",
    noProducts:       hi ? "कोई सक्रिय उत्पाद नहीं मिला।" : "No active production products found. Check the products table in Supabase.",
    newJobCard:       hi ? "+ नया जॉब कार्ड" : "+ New Job Card",
    phaseAB:          hi ? "फेज़ A + B" : "Phase A + B",
    records:          hi ? "रिकॉर्ड" : "record",
    recordsPlural:    hi ? "रिकॉर्ड" : "records",
    loadingDash:      hi ? "लोड हो रहा है…" : "Loading…",
    langLabel:        hi ? "EN" : "हिन्दी",
    langAriaLabel:    hi ? "Switch to English" : "हिन्दी में बदलें",
  };
}

const PRODUCT_COLOR: Record<string, string> = {
  SULPHUR_SC_UPL: "#b5451b",
  SULPHUR_SC:     "#b5451b",
  NUTRIZIN:       "#1565c0",
  INSTACAL:       "#2e7d32",
  K_GUM:          "#6a1b9a",
  INSTABORE:      "#0277bd",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LineItem {
  formulaItemId: string;
  orderNo: number;
  phase: string | null;
  componentName: string;
  jscCode: string | null;
  instructedQty: number;
  addedQty: string;
  rmBatchNo: string;
  drumBagNo: string;
  remark: string;
}

type LineInput = Pick<LineItem, "addedQty" | "rmBatchNo" | "drumBagNo" | "remark">;

interface GenericDraftShape {
  lotNo: string;
  jobDate: string;
  batchSize: string;
  premixStart: string;
  premixEnd: string;
  beadMillStart: string;
  beadMillEnd: string;
  flowRate: string;
  slurryA: string;
  slurryB: string;
  ph: string;
  lineInputs: Record<string, LineInput>;
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

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// GenericJobCardForm — formula-driven form for products 2–6
// ---------------------------------------------------------------------------

interface GenericJobCardFormProps {
  product: Product;
  factoryId: string;
  userId: string;
  onDone: () => void;
}

function GenericJobCardForm({ product, factoryId, userId, onDone }: GenericJobCardFormProps) {
  const { showToast } = useToast();
  const supabase = createClient();
  const pathname = usePathname();

  const isPhaseAware = PHASE_AWARE_CODES.has(product.code);
  const accentColor = PRODUCT_COLOR[product.code] ?? "var(--clay)";

  const draft = useFormDraft<GenericDraftShape>(
    draftKey(pathname, factoryId, userId, product.code),
  );
  const d0 = draft.restored;

  const [lotNo, setLotNo]         = useState(d0?.lotNo ?? "");
  const [jobDate, setJobDate]     = useState(freshDate(d0?.jobDate));
  const [batchSize, setBatchSize] = useState(d0?.batchSize ?? "");
  const [premixStart, setPremixStart]     = useState(d0?.premixStart ?? "");
  const [premixEnd, setPremixEnd]         = useState(d0?.premixEnd ?? "");
  const [beadMillStart, setBeadMillStart] = useState(d0?.beadMillStart ?? "");
  const [beadMillEnd, setBeadMillEnd]     = useState(d0?.beadMillEnd ?? "");
  const [flowRate, setFlowRate]           = useState(d0?.flowRate ?? "");
  const [slurryA, setSlurryA]             = useState(d0?.slurryA ?? "");
  const [slurryB, setSlurryB]             = useState(d0?.slurryB ?? "");
  const [ph, setPh]                       = useState(d0?.ph ?? "");
  const [lineItems, setLineItems]         = useState<LineItem[]>([]);
  const [loadingFormula, setLoadingFormula] = useState(false);
  const [submitting, setSubmitting]       = useState(false);

  const draftSave = draft.save;
  useEffect(() => {
    const lineInputs: Record<string, LineInput> = {};
    for (const li of lineItems) {
      lineInputs[li.formulaItemId] = { addedQty: li.addedQty, rmBatchNo: li.rmBatchNo, drumBagNo: li.drumBagNo, remark: li.remark };
    }
    draftSave({ lotNo, jobDate, batchSize, premixStart, premixEnd, beadMillStart, beadMillEnd, flowRate, slurryA, slurryB, ph, lineInputs });
  }, [lotNo, jobDate, batchSize, premixStart, premixEnd, beadMillStart, beadMillEnd, flowRate, slurryA, slurryB, ph, lineItems, draftSave]);

  useEffect(() => {
    setLoadingFormula(true);
    supabase.from("product_formula_items").select("*").eq("product_id", product.id)
      .order("phase").order("order_no")
      .then(({ data }) => {
        const defs = (data ?? []) as ProductFormulaItem[];
        const bsKg = parseFloat(batchSize) || 0;
        setLineItems(defs.map(d => {
          const saved = d0?.lineInputs?.[d.id];
          return {
            formulaItemId: d.id, orderNo: d.order_no, phase: d.phase,
            componentName: d.component_name, jscCode: d.jsc_code,
            instructedQty: scaleQty(d.instructed_qty_kg, d.reference_batch_size_kg, bsKg || d.reference_batch_size_kg),
            addedQty: saved?.addedQty ?? "", rmBatchNo: saved?.rmBatchNo ?? "",
            drumBagNo: saved?.drumBagNo ?? "", remark: saved?.remark ?? "",
          };
        }));
        setLoadingFormula(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, batchSize]);

  function updateLine(idx: number, field: keyof LineInput, val: string) {
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, [field]: val } : li));
  }

  const handleSubmit = async (statusVal: "draft" | "submitted") => {
    if (!lotNo.trim()) { showToast("Lot number is required.", true); return; }
    if (!batchSize || isNaN(parseFloat(batchSize))) { showToast("Enter a valid batch size (kg).", true); return; }
    setSubmitting(true);
    try {
      const bsKg = parseFloat(batchSize);
      const { data: card, error: cardErr } = await supabase
        .from("production_job_cards")
        .insert({
          factory_id: factoryId, product_id: product.id, lot_no: lotNo.trim(),
          job_date: jobDate, operator_id: userId, batch_size_kg: bsKg,
          premix_start: premixStart || null, premix_end: premixEnd || null,
          bead_mill_start: beadMillStart || null, bead_mill_end: beadMillEnd || null,
          flow_rate: flowRate ? parseFloat(flowRate) : null,
          collected_slurry_phase_a_kg: slurryA ? parseFloat(slurryA) : null,
          collected_slurry_phase_b_kg: slurryB ? parseFloat(slurryB) : null,
          ph: ph ? parseFloat(ph) : null, status: statusVal,
        })
        .select("id").single();

      if (cardErr || !card) { showToast("Could not save: " + (cardErr?.message ?? "unknown"), true); return; }

      if (lineItems.length > 0) {
        const { error: itemErr } = await supabase.from("production_job_card_items").insert(
          lineItems.map(li => ({
            job_card_id: card.id, formula_item_id: li.formulaItemId,
            instructed_qty_kg: li.instructedQty, added_qty_kg: li.addedQty ? parseFloat(li.addedQty) : null,
            rm_batch_no: li.rmBatchNo || null, drum_bag_no: li.drumBagNo || null, remark: li.remark || null,
          }))
        );
        if (itemErr) { showToast("Card saved but items failed: " + itemErr.message, true); return; }
      }
      showToast(statusVal === "submitted" ? "Job card submitted ✓" : "Draft saved ✓");
      draft.clear();
      onDone();
    } catch { showToast("Network error — try again.", true); }
    finally { setSubmitting(false); }
  };

  const phases = Array.from(new Set(lineItems.map(li => li.phase)));
  const hasPhaseGroups = phases.some(p => p !== null);
  const accentHex = accentColor;

  return (
    <>
      <button type="button" className="back-link" onClick={onDone}>← All Job Card Types</button>

      <div style={{ padding: "14px 18px", borderRadius: 10, marginBottom: 16, background: accentHex, color: "#fff" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.8px", opacity: 0.85, marginBottom: 2 }}>
          JSCI · PRODUCTION JOB CARD
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>
          {PRODUCT_SECTION_TITLE[product.code] ?? product.name}
        </div>
      </div>

      <div className="card">
        <h3>Job Card Header</h3>
        <div className="row2">
          <div>
            <label>Lot No *</label>
            <input type="text" placeholder="e.g. LOT-2024-001" value={lotNo} onChange={e => setLotNo(e.target.value)} />
          </div>
          <div>
            <label>Job Date *</label>
            <DateField value={jobDate} onChange={setJobDate} />
          </div>
        </div>
        <div className="row2">
          <div>
            <label>Batch Size (kg) *</label>
            <input type="number" step="any" placeholder="e.g. 500" value={batchSize} onChange={e => setBatchSize(e.target.value)} />
          </div>
          <div>
            {isPhaseAware && (
              <div className="field-hint" style={{ color: accentHex, fontWeight: 600, marginTop: 28 }}>
                This product has Phase A and Phase B.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Process Timing</h3>
        <div className="row2">
          <div><label>Premix Start</label><input type="time" value={premixStart} onChange={e => setPremixStart(e.target.value)} /></div>
          <div><label>Premix End</label><input type="time" value={premixEnd} onChange={e => setPremixEnd(e.target.value)} /></div>
        </div>
        <div className="row2">
          <div><label>Bead Mill Start</label><input type="time" value={beadMillStart} onChange={e => setBeadMillStart(e.target.value)} /></div>
          <div><label>Bead Mill End</label><input type="time" value={beadMillEnd} onChange={e => setBeadMillEnd(e.target.value)} /></div>
        </div>
        <div className="row2">
          <div><label>Flow Rate</label><input type="number" step="any" placeholder="0" value={flowRate} onChange={e => setFlowRate(e.target.value)} /></div>
          <div><label>pH</label><input type="number" step="0.01" placeholder="0.00" value={ph} onChange={e => setPh(e.target.value)} /></div>
        </div>
        {isPhaseAware && (
          <div className="row2">
            <div><label>Collected Slurry Phase A (kg)</label><input type="number" step="any" placeholder="0" value={slurryA} onChange={e => setSlurryA(e.target.value)} /></div>
            <div><label>Collected Slurry Phase B (kg)</label><input type="number" step="any" placeholder="0" value={slurryB} onChange={e => setSlurryB(e.target.value)} /></div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>Formula — Ingredients</h3>
          {batchSize && <span className="field-hint">Scaled to {batchSize} kg</span>}
        </div>
        {loadingFormula ? (
          <div className="empty">Loading formula…</div>
        ) : lineItems.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)", padding: "12px 0" }}>
            No formula items found. An admin needs to seed <code>product_formula_items</code>.
          </div>
        ) : (
          phases.map(phaseKey => {
            const rows = lineItems.filter(li => li.phase === phaseKey);
            if (!rows.length) return null;
            return (
              <div key={phaseKey ?? "main"} style={{ marginBottom: 20 }}>
                {hasPhaseGroups && (
                  <div style={{ padding: "5px 12px", borderRadius: 6, fontWeight: 700, fontSize: 12, marginBottom: 8,
                    background: accentHex + "18", color: accentHex, border: `1px solid ${accentHex}40` }}>
                    Phase {phaseKey ?? "—"}
                  </div>
                )}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--line)", background: "var(--surface)" }}>
                        {["#","JSC","Ingredient","Instructed (kg)","Added (kg) *","RM Batch No","Drum/Bag No","Remark"].map(h => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: h === "Instructed (kg)" || h === "Added (kg) *" ? "right" : "left", color: "var(--ink-soft)", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(li => {
                        const globalIdx = lineItems.findIndex(x => x.formulaItemId === li.formulaItemId);
                        return (
                          <tr key={li.formulaItemId} style={{ borderBottom: "1px solid var(--line)" }}>
                            <td style={{ padding: "5px 10px", color: "var(--ink-soft)" }}>{li.orderNo}</td>
                            <td style={{ padding: "5px 10px", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{li.jscCode ?? "—"}</td>
                            <td style={{ padding: "5px 10px", fontWeight: 500 }}>{li.componentName}</td>
                            <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 600 }}>{li.instructedQty.toFixed(3)}</td>
                            <td style={{ padding: "5px 6px" }}>
                              <input type="number" step="any" placeholder={li.instructedQty.toFixed(3)} value={li.addedQty}
                                onChange={e => updateLine(globalIdx, "addedQty", e.target.value)} style={{ width: 90, textAlign: "right" }} />
                            </td>
                            <td style={{ padding: "5px 6px" }}>
                              <input type="text" placeholder="Batch no." value={li.rmBatchNo}
                                onChange={e => updateLine(globalIdx, "rmBatchNo", e.target.value)} style={{ width: 100 }} />
                            </td>
                            <td style={{ padding: "5px 6px" }}>
                              <input type="text" placeholder="Drum/Bag" value={li.drumBagNo}
                                onChange={e => updateLine(globalIdx, "drumBagNo", e.target.value)} style={{ width: 90 }} />
                            </td>
                            <td style={{ padding: "5px 6px" }}>
                              <input type="text" placeholder="Remark" value={li.remark}
                                onChange={e => updateLine(globalIdx, "remark", e.target.value)} style={{ width: 110 }} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <button className="btn btn-primary" type="button" disabled={submitting} onClick={() => handleSubmit("submitted")}>
          {submitting ? "Saving…" : "Submit Job Card"}
        </button>
        <button className="btn btn-secondary" type="button" disabled={submitting} onClick={() => handleSubmit("draft")}>
          Save as Draft
        </button>
        <button className="btn btn-ghost" type="button" disabled={submitting} onClick={onDone}>Cancel</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// RecentCards — saved job cards for one product with Edit support
// ---------------------------------------------------------------------------

interface RecentCardsProps {
  product: Product;
  factoryId: string;
  refreshKey: number;
  onEdit?: (cardId: string) => void;
}

function RecentCards({ product, factoryId, refreshKey, onEdit }: RecentCardsProps) {
  const supabase = createClient();
  const [cards, setCards] = useState<ProductionJobCard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("production_job_cards")
      .select("*")
      .eq("factory_id", factoryId)
      .eq("product_id", product.id)
      .order("created_at", { ascending: false })
      .limit(15);
    setCards((data ?? []) as ProductionJobCard[]);
    setLoading(false);
  }, [supabase, factoryId, product.id]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading) return <div className="field-hint">Loading records…</div>;
  if (cards.length === 0) return <div className="field-hint">No job cards yet.</div>;

  return (
    <>
      {cards.map(c => (
        <div key={c.id} className="pending-item">
          <div className="pi-top">
            <span style={{ fontWeight: 700 }}>{c.lot_no}</span>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
              background: c.status === "submitted" ? "var(--ok-soft)" : "#fff3e0",
              color: c.status === "submitted" ? "var(--ok)" : "var(--warn)",
            }}>
              {c.status}
            </span>
          </div>
          <div className="pi-sub" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              {c.batch_size_kg} kg · {fmtDate(c.job_date)}
              {(c as unknown as { operator_name?: string }).operator_name ? ` · ${(c as unknown as { operator_name?: string }).operator_name}` : ""}
            </span>
            {onEdit && (c.status === "draft" || c.status === "submitted") && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onEdit(c.id); }}
                style={{
                  fontSize: 12, padding: "3px 10px", borderRadius: 6,
                  border: "1px solid var(--clay)", background: "var(--clay-soft, #fff8f3)",
                  color: "var(--clay)", cursor: "pointer", fontWeight: 600,
                }}
              >
                ✏️ Edit
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// ProductTile
// ---------------------------------------------------------------------------

interface ProductTileProps {
  product: Product;
  recentCount: number;
  onOpen: () => void;
  lang: "en" | "hi";
}

function ProductTile({ product, recentCount, onOpen, lang }: ProductTileProps) {
  const color = PRODUCT_COLOR[product.code] ?? "var(--clay)";
  const title = lang === "hi"
    ? (PRODUCT_SECTION_TITLE_HI[product.code] ?? product.name)
    : (PRODUCT_SECTION_TITLE[product.code] ?? product.name);
  const isPhaseAware = PHASE_AWARE_CODES.has(product.code);
  const t = makeT(lang === "hi");

  return (
    <div
      onClick={onOpen}
      style={{ border: `2px solid ${color}`, borderRadius: 12, padding: "16px 18px",
        cursor: "pointer", background: "#fff", transition: "box-shadow 0.15s", position: "relative" }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 4px 18px ${color}30`)}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, borderRadius: "10px 10px 0 0", background: color }} />
      <div style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1.35, marginTop: 6 }}>{title}</div>
      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {isPhaseAware && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: color + "18", color }}>
            {t.phaseAB}
          </span>
        )}
        {recentCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-soft)" }}>
            {recentCount} {recentCount > 1 ? t.recordsPlural : t.records}
          </span>
        )}
      </div>
      <button type="button" style={{
        marginTop: 12, padding: "7px 14px", background: color, color: "#fff",
        border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700,
        cursor: "pointer", pointerEvents: "none",
      }}>
        {t.newJobCard}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard — unified table of all job cards across all products
// ---------------------------------------------------------------------------

interface DashboardProps {
  products: Product[];
  factoryId: string;
  refreshKey: number;
  onEdit: (product: Product, cardId: string) => void;
  onNew:  (product: Product) => void;
}

interface DashboardRow extends ProductionJobCard {
  productCode: string;
  productTitle: string;
  operator_name?: string;
}

function Dashboard({ products, factoryId, refreshKey, onEdit, onNew }: DashboardProps) {
  const supabase = createClient();
  const [rows, setRows]       = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [filterProduct, setFilterProduct] = useState<string>("all");

  const productMap = Object.fromEntries(products.map(p => [p.id, p]));

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("production_job_cards")
      .select("*")
      .eq("factory_id", factoryId)
      .in("product_id", products.map(p => p.id))
      .order("created_at", { ascending: false });

    const built: DashboardRow[] = ((data ?? []) as Array<ProductionJobCard & { operator_name?: string }>).map(card => {
      const prod = productMap[card.product_id];
      return {
        ...card,
        productCode:  prod?.code  ?? "",
        productTitle: prod ? (PRODUCT_SECTION_TITLE[prod.code] ?? prod.name) : "",
      };
    });
    setRows(built);
    setLoading(false);
  }, [supabase, factoryId, products]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load, refreshKey]);

  const filtered = rows.filter(r => {
    if (filterProduct !== "all" && r.product_id !== filterProduct) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (r.lot_no ?? "").toLowerCase().includes(q) ||
        r.productTitle.toLowerCase().includes(q) ||
        (r.operator_name ?? "").toLowerCase().includes(q) ||
        (r.job_date ?? "").includes(q)
      );
    }
    return true;
  });

  const thS: React.CSSProperties = {
    padding: "8px 12px", textAlign: "left", fontWeight: 700, fontSize: 12,
    color: "var(--ink-soft)", borderBottom: "2px solid var(--line)",
    whiteSpace: "nowrap",
  };
  const tdS: React.CSSProperties = {
    padding: "9px 12px", fontSize: 13, borderBottom: "1px solid var(--line)",
    verticalAlign: "middle",
  };

  return (
    <div className="card">
      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Dashboard</h3>
        <div style={{ flex: 1 }} />

        {/* Product dropdown */}
        <select
          value={filterProduct}
          onChange={e => setFilterProduct(e.target.value)}
          style={{
            fontSize: 13, padding: "5px 10px", borderRadius: 7,
            border: "1px solid var(--line)", background: "#fff",
            color: "var(--ink)", cursor: "pointer", outline: "none",
            maxWidth: 320,
          }}
        >
          <option value="all">All Job Cards</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>
              {PRODUCT_SECTION_TITLE[p.code] ?? p.name}
            </option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Search lot, operator…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ fontSize: 13, padding: "5px 10px", borderRadius: 7,
            border: "1px solid var(--line)", outline: "none", width: 200 }}
        />
      </div>

      {loading ? (
        <div className="field-hint">Loading job cards…</div>
      ) : filtered.length === 0 ? (
        <div className="field-hint" style={{ padding: "16px 0" }}>
          {rows.length === 0 ? "No job cards created yet." : "No results match your filter."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thS}>#</th>
                <th style={thS}>Product</th>
                <th style={thS}>Lot No</th>
                <th style={thS}>Date</th>
                <th style={thS}>Batch (kg)</th>
                <th style={thS}>Operator</th>
                <th style={thS}>Status</th>
                <th style={{ ...thS, textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const color = PRODUCT_COLOR[r.productCode] ?? "var(--clay)";
                const prod  = productMap[r.product_id];
                return (
                  <tr key={r.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}>
                    <td style={{ ...tdS, color: "var(--ink-soft)", width: 36 }}>{i + 1}</td>
                    <td style={tdS}>
                      <span style={{ fontSize: 11, fontWeight: 700, color }}>
                        {r.productTitle}
                      </span>
                    </td>
                    <td style={{ ...tdS, fontWeight: 700 }}>{r.lot_no ?? "—"}</td>
                    <td style={{ ...tdS, whiteSpace: "nowrap" }}>{fmtDate(r.job_date)}</td>
                    <td style={{ ...tdS, textAlign: "right" }}>
                      {r.batch_size_kg != null ? `${r.batch_size_kg}` : "—"}
                    </td>
                    <td style={tdS}>{r.operator_name ?? "—"}</td>
                    <td style={tdS}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                        background: r.status === "submitted" ? "var(--ok-soft)" : "#fff3e0",
                        color: r.status === "submitted" ? "var(--ok)" : "var(--warn)",
                        whiteSpace: "nowrap",
                      }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                      {prod && (
                        <button type="button"
                          onClick={() => onEdit(prod, r.id)}
                          style={{
                            fontSize: 12, padding: "3px 10px", borderRadius: 6,
                            border: `1px solid ${color}`, background: color + "12",
                            color, cursor: "pointer", fontWeight: 600,
                          }}>
                          ✏️ Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProductionJobCardPage() {
  const { user, profile }  = useAuth();
  const { activeFactory }  = useModule();
  const supabase           = createClient();

  const [products, setProducts]             = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Navigation state:
  //   null              → landing tiles + dashboard
  //   { product }       → new job card form
  //   { product, editCardId } → edit existing card
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [editCardId, setEditCardId]       = useState<string | null>(null);

  const [recentCounts, setRecentCounts] = useState<Record<string, number>>({});
  const [refreshKey, setRefreshKey]     = useState(0);

  // Language toggle — default English; operator role gets the toggle
  const isOperator = profile?.role === "operator";
  const [lang, setLang] = useState<"en" | "hi">("en");
  const t = makeT(lang === "hi");

  useEffect(() => {
    createClient()
      .from("products")
      .select("*")
      .in("code", A20_PROD_CODES)
      .eq("is_active", true)
      .then(({ data }) => {
        const sorted = A20_PROD_CODES
          .map(code => (data ?? []).find((p: Product) => p.code === code))
          .filter(Boolean) as Product[];
        setProducts(sorted);
        setLoadingProducts(false);
      });
  }, []);

  useEffect(() => {
    if (!activeFactory || products.length === 0) return;
    supabase
      .from("production_job_cards")
      .select("product_id")
      .eq("factory_id", activeFactory.id)
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        for (const row of (data ?? []) as { product_id: string }[]) {
          counts[row.product_id] = (counts[row.product_id] ?? 0) + 1;
        }
        setRecentCounts(counts);
      });
  }, [activeFactory, products, supabase, refreshKey]);

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<"job_cards" | "dashboard">("job_cards");

  const handleDone = () => {
    setActiveProduct(null);
    setEditCardId(null);
    setRefreshKey(k => k + 1);
    setTab("dashboard"); // after saving/cancelling, land on Dashboard so the record is visible
  };

  // ── Form view ─────────────────────────────────────────────────────────────
  if (activeProduct && user && activeFactory) {
    // UPL Grade → dedicated rich form (new or edit)
    if (activeProduct.code === "SULPHUR_SC_UPL") {
      return (
        <LanguageContext.Provider value={lang}>
          <UplJobCardForm
            product={activeProduct}
            factoryId={activeFactory.id}
            userId={user.id}
            editCardId={editCardId}
            onDone={handleDone}
          />
        </LanguageContext.Provider>
      );
    }
    // Sulphur SC (Gain/Instasul) → dedicated rich form
    if (activeProduct.code === "SULPHUR_SC") {
      return (
        <LanguageContext.Provider value={lang}>
          <SulphurScJobCardForm
            product={activeProduct}
            factoryId={activeFactory.id}
            userId={user.id}
            editCardId={editCardId}
            onDone={handleDone}
          />
        </LanguageContext.Provider>
      );
    }
    // NUTRIZIN (Zinc Oxide 39.5% SC) → dedicated rich form with 4 instruction groups
    if (activeProduct.code === "NUTRIZIN") {
      return (
        <LanguageContext.Provider value={lang}>
          <NutrizinJobCardForm
            product={activeProduct}
            factoryId={activeFactory.id}
            userId={user.id}
            editCardId={editCardId}
            onDone={handleDone}
          />
        </LanguageContext.Provider>
      );
    }
    // INSTACAL (InstaCal 160) → dedicated rich form with 4 batch-size variants
    if (activeProduct.code === "INSTACAL") {
      return (
        <LanguageContext.Provider value={lang}>
          <InstacalJobCardForm
            product={activeProduct}
            factoryId={activeFactory.id}
            userId={user.id}
            editCardId={editCardId}
            onDone={handleDone}
          />
        </LanguageContext.Provider>
      );
    }
    // K_GUM (Kelzan Plus 1.4% Solution) → simple single-phase form
    if (activeProduct.code === "K_GUM") {
      return (
        <LanguageContext.Provider value={lang}>
          <KgumJobCardForm
            product={activeProduct}
            factoryId={activeFactory.id}
            userId={user.id}
            editCardId={editCardId}
            onDone={handleDone}
          />
        </LanguageContext.Provider>
      );
    }
    // INSTABORE (InstaBor 150) → dedicated form with Phase A/B, boric acid bags, heating times
    if (activeProduct.code === "INSTABORE") {
      return (
        <LanguageContext.Provider value={lang}>
          <InstaborJobCardForm
            product={activeProduct}
            factoryId={activeFactory.id}
            userId={user.id}
            editCardId={editCardId}
            onDone={handleDone}
          />
        </LanguageContext.Provider>
      );
    }
    // All other products → generic formula-driven form
    return (
      <GenericJobCardForm
        product={activeProduct}
        factoryId={activeFactory.id}
        userId={user.id}
        onDone={handleDone}
      />
    );
  }

  // ── Landing ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", overflowX: "auto",
        background: "var(--panel)", borderBottom: "1px solid var(--line)",
        marginBottom: 14,
      }}>
        {([
          { id: "job_cards" as const, label: t.tabJobCards },
          { id: "dashboard" as const, label: t.tabDashboard },
        ]).map(tb => (
          <button key={tb.id} type="button" onClick={() => setTab(tb.id)}
            style={{
              flex: "0 0 auto", minWidth: 160, padding: "11px 16px",
              border: "none", background: "none", fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
              color: tab === tb.id ? "var(--clay)" : "var(--ink-soft)",
              borderBottom: tab === tb.id
                ? "3px solid var(--clay)"
                : "3px solid transparent",
            }}>
            {tb.label}
          </button>
        ))}

        {/* Language toggle — shown for operator role */}
        {isOperator && (
          <div style={{ marginLeft: "auto", padding: "0 12px", display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => setLang(l => l === "en" ? "hi" : "en")}
              aria-label={t.langAriaLabel}
              style={{
                fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 14,
                border: "1px solid var(--clay)", background: "var(--clay-soft, #fff8f3)",
                color: "var(--clay)", cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              🌐 {t.langLabel}
            </button>
          </div>
        )}
      </div>

      {/* ── Production Job Card tab ─────────────────────────────────────── */}
      {tab === "job_cards" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{t.pageTitle}</h3>
            <div className="field-hint" style={{ marginTop: 4 }}>
              {activeFactory?.name ?? "Dombivli A-20"} · {t.pageHint}
            </div>
          </div>

          {loadingProducts ? (
            <div className="empty">{t.loadingProducts}</div>
          ) : products.length === 0 ? (
            <div className="empty" style={{ color: "var(--warn)" }}>
              {t.noProducts}
            </div>
          ) : (
            <>
              {/* Tile grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 14, marginBottom: 24,
              }}>
                {products.map(p => (
                  <ProductTile
                    key={p.id}
                    product={p}
                    recentCount={recentCounts[p.id] ?? 0}
                    onOpen={() => { setEditCardId(null); setActiveProduct(p); }}
                    lang={lang}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Dashboard tab ──────────────────────────────────────────────── */}
      {tab === "dashboard" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{t.dashTitle}</h3>
            <div className="field-hint" style={{ marginTop: 4 }}>
              {activeFactory?.name ?? "Dombivli A-20"} · {t.dashHint}
            </div>
          </div>

          {loadingProducts ? (
            <div className="empty">{t.loadingDash}</div>
          ) : activeFactory ? (
            <Dashboard
              products={products}
              factoryId={activeFactory.id}
              refreshKey={refreshKey}
              onEdit={(prod, cardId) => { setEditCardId(cardId); setActiveProduct(prod); }}
              onNew={prod => { setEditCardId(null); setActiveProduct(prod); }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

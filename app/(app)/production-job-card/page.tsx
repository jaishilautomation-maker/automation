"use client";

// =============================================================================
// Production Job Card — Module A (A-20 only)
//
// Flow:
//   1. Operator picks a product
//   2. Enters batch_size_kg and lot_no
//   3. Formula items auto-populate from product_formula_items, scaled to batch_size_kg
//   4. Operator fills added_qty_kg / rm_batch_no / drum_bag_no per row
//   5. Phase timing fields shown for products with Phase A / B
//   6. On save → INSERT production_job_cards + production_job_card_items
//   7. Submitted records viewable below the form (last 20)
//
// Access: operator, factory_admin, company_admin — enforced by RLS
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import type { Product, ProductFormulaItem, ProductionJobCard } from "@/lib/types";

// ---------------------------------------------------------------------------
// Local line-item type (formula item + operator-filled fields)
// ---------------------------------------------------------------------------
interface LineItem {
  formulaItemId: string;
  orderNo: number;
  phase: string | null;
  componentName: string;
  jscCode: string | null;
  instructedQty: number;   // already scaled to batch_size_kg
  addedQty: string;        // user input (string → number on submit)
  rmBatchNo: string;
  drumBagNo: string;
  remark: string;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Scale a formula qty from the reference batch size to the actual batch size */
function scaleQty(instructed: number, ref: number, actual: number): number {
  if (!ref || !actual) return instructed;
  return Math.round((instructed / ref) * actual * 1000) / 1000;
}

// A-20 production products in display order
const A20_PROD_CODES = [
  "SULPHUR_SC_UPL",
  "SULPHUR_SC",
  "NUTRIZIN",
  "INSTACAL",
  "K_GUM",
  "INSTABORE",
];

// Products that have Phase A + B
const PHASE_AWARE_PROD_CODES = ["SULPHUR_SC", "NUTRIZIN", "INSTACAL", "INSTABORE"];
export default function ProductionJobCardPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // Master data
  const [products, setProducts]     = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Form state — header
  const [productId, setProductId]   = useState("");
  const [lotNo, setLotNo]           = useState("");
  const [jobDate, setJobDate]       = useState(todayISO());
  const [batchSize, setBatchSize]   = useState("");

  // Phase timing
  const [premixStart, setPremixStart]       = useState("");
  const [premixEnd, setPremixEnd]           = useState("");
  const [beadMillStart, setBeadMillStart]   = useState("");
  const [beadMillEnd, setBeadMillEnd]       = useState("");
  const [flowRate, setFlowRate]             = useState("");
  const [slurryA, setSlurryA]               = useState("");
  const [slurryB, setSlurryB]               = useState("");
  const [ph, setPh]                         = useState("");

  // Line items
  const [lineItems, setLineItems]   = useState<LineItem[]>([]);
  const [loadingFormula, setLoadingFormula] = useState(false);

  // Records
  const [recentCards, setRecentCards] = useState<ProductionJobCard[]>([]);
  const [submitting, setSubmitting]   = useState(false);

  const selectedProduct = products.find(p => p.id === productId);
  const isPhaseAware = PHASE_AWARE_PROD_CODES.includes(selectedProduct?.code ?? "");

  // -------------------------------------------------------------------------
  // Load products — filtered to the 6 confirmed A-20 production products in spec order
  // -------------------------------------------------------------------------
  useEffect(() => {
    const sb = createClient();
    sb.from("products")
      .select("*")
      .in("code", A20_PROD_CODES)
      .eq("is_active", true)
      .then(({ data }) => {
        // Sort by spec order, not alphabetically
        const sorted = A20_PROD_CODES
          .map(code => (data ?? []).find((p: Product) => p.code === code))
          .filter(Boolean) as Product[];
        setProducts(sorted);
        setLoadingProducts(false);
      });
  }, []);

  // -------------------------------------------------------------------------
  // Load recent job cards
  // -------------------------------------------------------------------------
  const loadRecent = useCallback(async () => {
    if (!activeFactory) return;
    const { data } = await supabase
      .from("production_job_cards")
      .select("*")
      .eq("factory_id", activeFactory.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setRecentCards((data ?? []) as ProductionJobCard[]);
  }, [activeFactory, supabase]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  // -------------------------------------------------------------------------
  // When product + batch size change, reload formula and re-scale
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!productId) { setLineItems([]); return; }

    setLoadingFormula(true);
    supabase
      .from("product_formula_items")
      .select("*")
      .eq("product_id", productId)
      .order("phase")
      .order("order_no")
      .then(({ data }) => {
        const defs = (data ?? []) as ProductFormulaItem[];
        const bsKg = parseFloat(batchSize) || 0;

        setLineItems(
          defs.map(d => ({
            formulaItemId:   d.id,
            orderNo:         d.order_no,
            phase:           d.phase,
            componentName:   d.component_name,
            jscCode:         d.jsc_code,
            instructedQty:   bsKg > 0
              ? scaleQty(d.instructed_qty_kg, d.reference_batch_size_kg, bsKg)
              : d.instructed_qty_kg,
            addedQty:        "",
            rmBatchNo:       "",
            drumBagNo:       "",
            remark:          "",
          }))
        );
        setLoadingFormula(false);
      });
  }, [productId, supabase]);

  // Re-scale when batch size changes without refetching formula
  useEffect(() => {
    if (!lineItems.length) return;
    const bsKg = parseFloat(batchSize) || 0;
    if (!bsKg) return;

    setLineItems(prev =>
      prev.map(li => ({
        ...li,
        instructedQty: scaleQty(
          // reverse-scale back to original then re-scale
          li.instructedQty, bsKg, bsKg   // we stored scaled already
          // NOTE: formula items are re-fetched when product changes;
          // for batch-size-only changes we re-fetch from DB to get the reference qty
        ),
      }))
    );
    // Simpler: just re-trigger the formula load when batchSize changes
    if (productId) {
      setLoadingFormula(true);
      supabase
        .from("product_formula_items")
        .select("*")
        .eq("product_id", productId)
        .order("phase")
        .order("order_no")
        .then(({ data }) => {
          const defs = (data ?? []) as ProductFormulaItem[];
          setLineItems(
            defs.map((d, i) => ({
              formulaItemId:   d.id,
              orderNo:         d.order_no,
              phase:           d.phase,
              componentName:   d.component_name,
              jscCode:         d.jsc_code,
              instructedQty:   scaleQty(d.instructed_qty_kg, d.reference_batch_size_kg, bsKg),
              addedQty:        lineItems[i]?.addedQty ?? "",
              rmBatchNo:       lineItems[i]?.rmBatchNo ?? "",
              drumBagNo:       lineItems[i]?.drumBagNo ?? "",
              remark:          lineItems[i]?.remark ?? "",
            }))
          );
          setLoadingFormula(false);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchSize]);

  // -------------------------------------------------------------------------
  // Line item change handler
  // -------------------------------------------------------------------------
  function updateLine(idx: number, field: keyof Pick<LineItem, "addedQty" | "rmBatchNo" | "drumBagNo" | "remark">, val: string) {
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, [field]: val } : li));
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = async (statusVal: "draft" | "submitted") => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!productId)              { showToast("Select a product.", true); return; }
    if (!lotNo.trim())           { showToast("Lot number is required.", true); return; }
    if (!batchSize || isNaN(parseFloat(batchSize))) {
      showToast("Enter a valid batch size.", true); return;
    }

    setSubmitting(true);
    try {
      const bsKg = parseFloat(batchSize);

      // Insert job card header
      const { data: card, error: cardErr } = await supabase
        .from("production_job_cards")
        .insert({
          factory_id:                  activeFactory.id,
          product_id:                  productId,
          lot_no:                      lotNo.trim(),
          job_date:                    jobDate,
          operator_id:                 user.id,
          batch_size_kg:               bsKg,
          premix_start:                premixStart || null,
          premix_end:                  premixEnd   || null,
          bead_mill_start:             beadMillStart || null,
          bead_mill_end:               beadMillEnd   || null,
          flow_rate:                   flowRate ? parseFloat(flowRate) : null,
          collected_slurry_phase_a_kg: slurryA  ? parseFloat(slurryA)  : null,
          collected_slurry_phase_b_kg: slurryB  ? parseFloat(slurryB)  : null,
          ph:                          ph       ? parseFloat(ph)       : null,
          status:                      statusVal,
        })
        .select("id")
        .single();

      if (cardErr || !card) {
        showToast("Could not save: " + (cardErr?.message ?? "unknown"), true);
        return;
      }

      // Insert line items
      if (lineItems.length > 0) {
        const rows = lineItems.map(li => ({
          job_card_id:       card.id,
          formula_item_id:   li.formulaItemId,
          instructed_qty_kg: li.instructedQty,
          added_qty_kg:      li.addedQty ? parseFloat(li.addedQty) : null,
          rm_batch_no:       li.rmBatchNo  || null,
          drum_bag_no:       li.drumBagNo  || null,
          remark:            li.remark     || null,
        }));

        const { error: itemErr } = await supabase
          .from("production_job_card_items")
          .insert(rows);

        if (itemErr) {
          showToast("Card saved but items failed: " + itemErr.message, true);
          return;
        }
      }

      showToast(statusVal === "submitted" ? "Job card submitted ✓" : "Draft saved ✓");
      // Reset form
      setProductId(""); setLotNo(""); setBatchSize(""); setJobDate(todayISO());
      setPremixStart(""); setPremixEnd(""); setBeadMillStart(""); setBeadMillEnd("");
      setFlowRate(""); setSlurryA(""); setSlurryB(""); setPh(""); setLineItems([]);
      loadRecent();
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  const phases = Array.from(new Set(lineItems.map(li => li.phase)));
  const hasPhases = phases.some(p => p !== null);

  function renderLineGroup(phaseKey: string | null) {
    const rows = lineItems.filter(li => li.phase === phaseKey);
    if (!rows.length) return null;
    return (
      <div key={phaseKey ?? "main"} style={{ marginBottom: 16 }}>
        {hasPhases && (
          <div style={{
            padding: "6px 12px", background: "var(--surface-2, #f5f2ee)",
            borderRadius: 6, fontWeight: 700, fontSize: 12,
            marginBottom: 8, color: "var(--ink)",
          }}>
            Phase {phaseKey ?? "—"}
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
                <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--ink-soft)", fontWeight: 600 }}>#</th>
                <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--ink-soft)", fontWeight: 600 }}>JSC</th>
                <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--ink-soft)", fontWeight: 600 }}>Component</th>
                <th style={{ padding: "6px 10px", textAlign: "right", color: "var(--ink-soft)", fontWeight: 600 }}>Instructed (kg)</th>
                <th style={{ padding: "6px 10px", textAlign: "right", color: "var(--ink-soft)", fontWeight: 600 }}>Added (kg) *</th>
                <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--ink-soft)", fontWeight: 600 }}>RM Batch No</th>
                <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--ink-soft)", fontWeight: 600 }}>Drum/Bag No</th>
                <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--ink-soft)", fontWeight: 600 }}>Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((li, rowIdx) => {
                const globalIdx = lineItems.findIndex(x => x.formulaItemId === li.formulaItemId);
                return (
                  <tr key={li.formulaItemId} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "5px 10px", color: "var(--ink-soft)" }}>{li.orderNo}</td>
                    <td style={{ padding: "5px 10px", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{li.jscCode ?? "—"}</td>
                    <td style={{ padding: "5px 10px", fontWeight: 500 }}>{li.componentName}</td>
                    <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 600 }}>
                      {li.instructedQty.toFixed(3)}
                    </td>
                    <td style={{ padding: "5px 6px" }}>
                      <input
                        type="number"
                        step="any"
                        placeholder={li.instructedQty.toFixed(3)}
                        value={li.addedQty}
                        onChange={e => updateLine(globalIdx, "addedQty", e.target.value)}
                        style={{ width: 90, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: "5px 6px" }}>
                      <input
                        type="text"
                        placeholder="Batch no."
                        value={li.rmBatchNo}
                        onChange={e => updateLine(globalIdx, "rmBatchNo", e.target.value)}
                        style={{ width: 100 }}
                      />
                    </td>
                    <td style={{ padding: "5px 6px" }}>
                      <input
                        type="text"
                        placeholder="Drum/Bag"
                        value={li.drumBagNo}
                        onChange={e => updateLine(globalIdx, "drumBagNo", e.target.value)}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td style={{ padding: "5px 6px" }}>
                      <input
                        type="text"
                        placeholder="Remark"
                        value={li.remark}
                        onChange={e => updateLine(globalIdx, "remark", e.target.value)}
                        style={{ width: 110 }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* Header */}
      <div className="card">
        <h3>Production Job Card</h3>
        <div className="field-hint">{activeFactory?.name ?? "—"}</div>

        <div className="row2">
          <div>
            <label>Product *</label>
            {loadingProducts ? <div className="field-hint">Loading…</div> : (
              <select value={productId} onChange={e => setProductId(e.target.value)}>
                <option value="">— Select product —</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {isPhaseAware && productId && (
              <div className="field-hint" style={{ color: "var(--clay)" }}>
                This product has Phase A and Phase B — formula items will be grouped by phase.
              </div>
            )}
          </div>
          <div>
            <label>Batch Size (kg) *</label>
            <input
              type="number"
              step="any"
              placeholder="e.g. 500"
              value={batchSize}
              onChange={e => setBatchSize(e.target.value)}
            />
          </div>
        </div>

        <div className="row2">
          <div>
            <label>Lot No *</label>
            <input
              type="text"
              placeholder="e.g. LOT-2024-001"
              value={lotNo}
              onChange={e => setLotNo(e.target.value)}
            />
          </div>
          <div>
            <label>Job Date *</label>
            <input type="date" value={jobDate} onChange={e => setJobDate(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Phase timing (shown for all products — operator leaves blank if not applicable) */}
      {productId && (
        <div className="card">
          <h3>Process Timing</h3>
          <div className="row2">
            <div>
              <label>Premix Start</label>
              <input type="time" value={premixStart} onChange={e => setPremixStart(e.target.value)} />
            </div>
            <div>
              <label>Premix End</label>
              <input type="time" value={premixEnd} onChange={e => setPremixEnd(e.target.value)} />
            </div>
          </div>
          <div className="row2">
            <div>
              <label>Bead Mill Start</label>
              <input type="time" value={beadMillStart} onChange={e => setBeadMillStart(e.target.value)} />
            </div>
            <div>
              <label>Bead Mill End</label>
              <input type="time" value={beadMillEnd} onChange={e => setBeadMillEnd(e.target.value)} />
            </div>
          </div>
          <div className="row2">
            <div>
              <label>Flow Rate</label>
              <input type="number" step="any" placeholder="0" value={flowRate} onChange={e => setFlowRate(e.target.value)} />
            </div>
            <div>
              <label>pH</label>
              <input type="number" step="0.01" placeholder="0.00" value={ph} onChange={e => setPh(e.target.value)} />
            </div>
          </div>
          <div className="row2">
            <div>
              <label>Collected Slurry Phase A (kg)</label>
              <input type="number" step="any" placeholder="0" value={slurryA} onChange={e => setSlurryA(e.target.value)} />
            </div>
            <div>
              <label>Collected Slurry Phase B (kg)</label>
              <input type="number" step="any" placeholder="0" value={slurryB} onChange={e => setSlurryB(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {/* Formula line items */}
      {productId && (
        <div className="card">
          <div className="helper-row">
            <h3 style={{ margin: 0 }}>Formula — {selectedProduct?.name}</h3>
            {batchSize && <span className="field-hint">Scaled to {batchSize} kg</span>}
          </div>

          {loadingFormula ? (
            <div className="empty">Loading formula…</div>
          ) : lineItems.length === 0 ? (
            <div className="field-hint" style={{ color: "var(--warn)" }}>
              No formula items found for this product.
              Ask an admin to add rows to <code>product_formula_items</code>.
            </div>
          ) : (
            phases.map(ph => renderLineGroup(ph))
          )}
        </div>
      )}

      {/* Actions */}
      {productId && lineItems.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={submitting}
            onClick={() => handleSubmit("submitted")}
          >
            {submitting ? "Saving…" : "Submit Job Card"}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={submitting}
            onClick={() => handleSubmit("draft")}
          >
            Save as Draft
          </button>
        </div>
      )}

      {/* Recent records */}
      {recentCards.length > 0 && (
        <div className="card">
          <div className="helper-row">
            <h3 style={{ margin: 0 }}>Recent Job Cards</h3>
            <span className="count">{recentCards.length}</span>
          </div>
          {recentCards.map(c => {
            const prod = products.find(p => p.id === c.product_id);
            return (
              <div key={c.id} className="pending-item">
                <div className="pi-top">
                  <span style={{ fontWeight: 700 }}>{c.lot_no}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    padding: "2px 8px", borderRadius: 12,
                    background: c.status === "submitted" ? "var(--ok-soft)" : "#fff3e0",
                    color: c.status === "submitted" ? "var(--ok)" : "var(--warn)",
                  }}>
                    {c.status}
                  </span>
                </div>
                <div className="pi-sub">
                  {prod?.name ?? "—"} · {c.batch_size_kg} kg · {c.job_date}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

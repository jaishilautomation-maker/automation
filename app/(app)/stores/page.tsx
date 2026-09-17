"use client";

// =============================================================================
// Stores Module — JSCI A-20/1  (all English)
//
// Tabs:
//   1. Oil Issue      — pulveriser job card oil queue
//   2. Raw Material   — DPR-style RM ledger (matches Excel RM tab exactly)
//   3. Stock Ledger   — balance view for all categories
//   4. Issue Slip     — manual Material Issue Slip
//   5. PRN            — purchase requisitions
//   6. Dispatch       — FG dispatch entry
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { groupByJobNumber, type PulveriserJobCard } from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { buildStoresEmail } from "@/lib/notifications/pulveriser-emails";
import type {
  StoresStockItem,
  StoresStockLedger,
  PurchaseRequisition,
  StockItemCategory,
  PrnStatus,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Exact RM product list from the DPR RM sheet — used as dropdown options. */
const RM_PRODUCTS = [
  "CRUDE SULPHUR",
  "ELASTO 541 OIL",
  "P.SILICA",
  "CHEM GRIND OIL",
  "POWEROIL SAPPHIRE L3060",
  "POWEROIL CITRINE L4070",
  "GEAR OIL 320/PARTHAN",
  "MAGNESIUM CARBONATE IN KG",
  "POWER OIL CITRINE M 4150",
] as const;

type RmProduct = typeof RM_PRODUCTS[number];

const STATUS_OPTIONS = ["GOOD", "LOW", "LESS", "OUT OF STOCK"] as const;
type StockStatus = typeof STATUS_OPTIONS[number];

const PRN_STATUS_LABEL: Record<PrnStatus, string> = {
  draft:        "Draft",
  submitted:    "Submitted",
  approved:     "Approved",
  ordered:      "Ordered",
  partial:      "Partial",
  fulfilled:    "Fulfilled",
  cancelled:    "Cancelled",
  auto_flagged: "⚠ Auto-flagged",
};

const OPEN_PRN_STATUSES: PrnStatus[] = [
  "draft", "submitted", "approved", "ordered", "partial", "auto_flagged",
];

const CATEGORY_LABEL: Record<StockItemCategory, string> = {
  raw_material:       "Raw Material (RM)",
  finished_good:      "Finished Good (FG)",
  packaging_material: "Packing Material (PM)",
};

type Tab = "oil" | "rm" | "ledger" | "issue" | "prn" | "dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(n: number | null | undefined, dec = 3): string {
  if (n == null) return "—";
  return n.toFixed(dec);
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function today(): string { return new Date().toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function StoresPage() {
  const [tab, setTab] = useState<Tab>("oil");

  const TABS: { id: Tab; label: string }[] = [
    { id: "oil",      label: "🛢 Oil Issue" },
    { id: "rm",       label: "🧪 Raw Material" },
    { id: "ledger",   label: "📊 Stock Ledger" },
    { id: "issue",    label: "📋 Issue Slip" },
    { id: "prn",      label: "📦 PRN" },
    { id: "dispatch", label: "🚚 Dispatch" },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div style={{
        display: "flex", overflowX: "auto", gap: 0,
        background: "var(--panel)", borderBottom: "1px solid var(--line)",
        marginBottom: 14, position: "sticky", top: 104, zIndex: 10,
      }}>
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{
              flex: "0 0 auto", minWidth: 100, padding: "11px 12px",
              border: "none", background: "none", fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
              color: tab === t.id ? "var(--clay)" : "var(--ink-soft)",
              borderBottom: tab === t.id ? "3px solid var(--clay)" : "3px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "oil"      && <OilIssueSection />}
      {tab === "rm"       && <RawMaterialSection />}
      {tab === "ledger"   && <StockLedgerSection />}
      {tab === "issue"    && <IssueSlipSection />}
      {tab === "prn"      && <PrnSection />}
      {tab === "dispatch" && <DispatchSection />}
    </div>
  );
}

// =============================================================================
// TAB 1 — OIL ISSUE
// =============================================================================
function OilIssueSection() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [pending, setPending]       = useState<PulveriserJobCard[]>([]);
  const [loading, setLoading]       = useState(true);
  const [active, setActive]         = useState<PulveriserJobCard | null>(null);
  const [oilIssued, setOilIssued]   = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadPending = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pulveriser_job_cards").select("*")
      .eq("status", "pending_stores").not("material_code", "is", null)
      .order("created_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setPending((data ?? []) as PulveriserJobCard[]);
    setLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const handleIssue = async () => {
    if (!active || !user) return;
    const n = Number(oilIssued);
    if (!Number.isFinite(n)) { showToast("Enter a valid oil quantity.", true); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("pulveriser_job_cards")
        .update({ oil_issued_kg: n, oil_issued_by: user.id,
          oil_issued_at: new Date().toISOString(), status: "pending" })
        .eq("id", active.id).select("id");
      if (error) { showToast("Save failed: " + error.message, true); return; }
      if (!data?.length) { showToast("Save blocked — check factory access or card status.", true); return; }
      const nowISO = new Date().toISOString();
      const { subject, html } = buildStoresEmail({
        jobNumber: active.job_number, materialCode: active.material_code,
        oilRequiredKg: active.oil_required_kg, oilIssuedKg: n,
        submittedByName: profile?.full_name ?? "—", submittedAt: nowISO,
      });
      void notifyEvent({ eventType: "pulveriser_stores", subject, html,
        factoryId: active.factory_id, referenceId: active.id });
      showToast("Oil issued ✓ — operator can now run the batch.");
      setActive(null); setOilIssued(""); loadPending();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  if (active) return (
    <>
      <button className="back-link" type="button" onClick={() => { setActive(null); setOilIssued(""); }}>← Back to list</button>
      <div className="readonly-block">
        <b>{active.machine_number}</b> · {fmtDate(active.job_date)} · {active.shift ?? "—"} shift<br />
        <b>Batch:</b> {active.material_code} · <b>Party/Code:</b> {active.party_code ?? "—"} · Job: {active.job_number ?? "—"}<br />
        <b>Planned:</b> {active.planned_production_mt ?? "—"} MT · <b>Oil required:</b>{" "}
        {active.oil_required_kg != null ? `${active.oil_required_kg} kg` : "NA"}
      </div>
      <div className="card">
        <h3>Issue Oil</h3>
        <label>Oil Issued (kg) *</label>
        <input type="number" min="0" step="0.001" placeholder="0"
          value={oilIssued} onChange={e => setOilIssued(e.target.value)} />
        <div className="field-hint" style={{ marginTop: 6 }}>
          Issuing oil will open the card for the operator.
        </div>
      </div>
      <button className="btn btn-primary" type="button"
        disabled={submitting || !oilIssued.trim()} onClick={handleIssue}>
        {submitting ? "Saving…" : "Issue Oil & Send to Operator"}
      </button>
    </>
  );

  return (
    <div className="card">
      <h3>Job Cards Awaiting Oil Issue</h3>
      <div className="field-hint" style={{ marginBottom: 10 }}>
        Production has created these cards. Issue the required oil to open them for the operator.
      </div>
      {loading ? <div className="empty">Loading…</div>
        : pending.length === 0 ? <div className="empty">No cards pending oil issue.</div>
        : groupByJobNumber(pending).map(group => (
          <div key={group.jobNumber ?? group.entries[0].id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", margin: "4px 2px" }}>
              Job: {group.jobNumber ?? "—"}
              {group.entries.length > 1 && ` · ${group.entries.length} entries`}
            </div>
            {group.entries.map((jc, i) => (
              <div className="pending-item" key={jc.id}
                onClick={() => { setActive(jc); setOilIssued(jc.oil_issued_kg?.toString() ?? ""); }}>
                <div className="pi-top">
                  <span>Entry {i + 1} · {jc.machine_number} · {fmtDate(jc.job_date)}</span>
                  <span>{jc.shift ?? "—"}</span>
                </div>
                <div className="pi-sub">
                  Batch: {jc.material_code} · Party/Code: {jc.party_code ?? "—"} · Oil required:{" "}
                  {jc.oil_required_kg != null ? `${jc.oil_required_kg} kg` : "NA"}
                </div>
              </div>
            ))}
          </div>
        ))
      }
    </div>
  );
}

// =============================================================================
// TAB 2 — RAW MATERIAL
//
// DPR RM-style register. Each row = one daily entry per product.
// Columns match the Excel RM tab exactly:
//   Date | Name of Product | O/Bal | Qty Received | Material Return |
//   Qty Issued for Prodn | Qty Issued to Bal | Dispatch as it is |
//   Closing Balance | Status | Remarks
//
// Closing Balance = O/Bal + Qty Received + Material Return
//                  − Qty Issued for Prodn − Qty Issued to Bal − Dispatch as it is
//
// Entries are saved to stores_stock_ledger as separate rows per movement type
// (received → qty_received; issued for prodn / issued to bal / dispatch → qty_issued
//  or dispatch_qty) PLUS a summary row capturing the closing balance.
// For simplicity we save ONE ledger row per form submission that captures all
// movement fields at once (closing balance computed here).
// =============================================================================

interface RmEntry {
  id: string;           // local key for list rendering
  date: string;
  product: RmProduct | "";
  opening_balance: string;
  qty_received: string;
  material_return: string;
  qty_issued_prodn: string;
  qty_issued_bal: string;
  dispatch_as_is: string;
  closing_balance: number | null; // computed
  status: StockStatus | "";
  remarks: string;
}

function computeClosing(e: RmEntry): number | null {
  const ob   = Number(e.opening_balance);
  const rcv  = Number(e.qty_received);
  const ret  = Number(e.material_return);
  const isp  = Number(e.qty_issued_prodn);
  const isb  = Number(e.qty_issued_bal);
  const dis  = Number(e.dispatch_as_is);
  if ([ob, rcv, ret, isp, isb, dis].some(v => !Number.isFinite(v))) return null;
  return ob + rcv + ret - isp - isb - dis;
}

function blankRmEntry(): RmEntry {
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    date: today(), product: "",
    opening_balance: "", qty_received: "", material_return: "",
    qty_issued_prodn: "", qty_issued_bal: "", dispatch_as_is: "",
    closing_balance: null, status: "", remarks: "",
  };
}

/** Saved RM entry row (from stores_stock_ledger with extra columns we store in remark JSON). */
interface SavedRmRow {
  id: string;
  date: string;
  product: string;
  opening_balance: number;
  qty_received: number;
  material_return: number;
  qty_issued_prodn: number;
  qty_issued_bal: number;
  dispatch_as_is: number;
  closing_balance: number;
  status: string;
  remarks: string;
}

function RawMaterialSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [entry, setEntry]           = useState<RmEntry>(blankRmEntry());
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory]       = useState<SavedRmRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [filterProduct, setFilterProduct] = useState<RmProduct | "ALL">("ALL");

  // Compute closing balance reactively whenever any numeric field changes
  const closing = computeClosing(entry);

  const setField = <K extends keyof RmEntry>(key: K, val: RmEntry[K]) => {
    setEntry(prev => {
      const next = { ...prev, [key]: val };
      return { ...next, closing_balance: computeClosing(next) };
    });
  };

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    // We store RM entries in stores_stock_ledger with reference_type = 'rm_entry'
    // and pack all DPR fields into the remark column as JSON.
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("id, transaction_date, remark")
      .eq("reference_type", "rm_entry")
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) { showToast("Could not load history: " + error.message, true); setHistLoading(false); return; }

    const rows: SavedRmRow[] = [];
    for (const row of (data ?? []) as { id: string; transaction_date: string; remark: string | null }[]) {
      try {
        const parsed = JSON.parse(row.remark ?? "{}") as Partial<SavedRmRow>;
        rows.push({
          id:               row.id,
          date:             row.transaction_date,
          product:          parsed.product ?? "",
          opening_balance:  parsed.opening_balance  ?? 0,
          qty_received:     parsed.qty_received     ?? 0,
          material_return:  parsed.material_return  ?? 0,
          qty_issued_prodn: parsed.qty_issued_prodn ?? 0,
          qty_issued_bal:   parsed.qty_issued_bal   ?? 0,
          dispatch_as_is:   parsed.dispatch_as_is   ?? 0,
          closing_balance:  parsed.closing_balance  ?? 0,
          status:           parsed.status           ?? "",
          remarks:          parsed.remarks          ?? "",
        });
      } catch { /* skip malformed rows */ }
    }
    setHistory(rows);
    setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Pre-fill opening balance from last closing balance for same product
  const handleProductChange = async (product: RmProduct | "") => {
    setField("product", product);
    if (!product) return;

    // Find most recent closing balance for this product from history
    const last = history.find(r => r.product === product);
    if (last) {
      setField("opening_balance", last.closing_balance.toString());
    } else {
      setField("opening_balance", "");
    }
  };

  const handleSave = async () => {
    if (!entry.product) { showToast("Select a product.", true); return; }
    if (closing == null) { showToast("Fill all numeric fields to compute closing balance.", true); return; }
    if (!user) return;
    setSubmitting(true);
    try {
      // Find stores_stock_items id for this product (optional — for FK; if not found, still save)
      const { data: itemData } = await supabase
        .from("stores_stock_items")
        .select("id")
        .eq("category", "raw_material")
        .ilike("item_name", `%${entry.product}%`)
        .limit(1)
        .maybeSingle();

      const itemId = (itemData as { id: string } | null)?.id ?? null;

      // If no item found, we need a fallback — find any RM item to use as placeholder
      // (ledger requires item_id FK). If truly not found, skip ledger and show warning.
      if (!itemId) {
        showToast(`Warning: No item found for "${entry.product}" in stores_stock_items. Add the item first, then re-enter.`, true);
        setSubmitting(false);
        return;
      }

      // Pack all DPR fields into remark as JSON (our storage strategy for the RM register)
      const payload: SavedRmRow = {
        id: "",
        date:             entry.date,
        product:          entry.product,
        opening_balance:  Number(entry.opening_balance)  || 0,
        qty_received:     Number(entry.qty_received)     || 0,
        material_return:  Number(entry.material_return)  || 0,
        qty_issued_prodn: Number(entry.qty_issued_prodn) || 0,
        qty_issued_bal:   Number(entry.qty_issued_bal)   || 0,
        dispatch_as_is:   Number(entry.dispatch_as_is)   || 0,
        closing_balance:  closing,
        status:           entry.status,
        remarks:          entry.remarks,
      };

      const totalIssued   = payload.qty_issued_prodn + payload.qty_issued_bal;
      const totalDispatch = payload.dispatch_as_is;

      const { error } = await supabase
        .from("stores_stock_ledger")
        .insert({
          item_id:            itemId,
          transaction_date:   entry.date,
          transaction_source: "manual",
          qty_received:       payload.qty_received + payload.material_return,
          qty_issued:         totalIssued,
          dispatch_qty:       totalDispatch,
          closing_balance:    closing,
          reference_type:     "rm_entry",
          remark:             JSON.stringify(payload),
          entered_by:         user.id,
        });

      if (error) { showToast("Save failed: " + error.message, true); return; }

      showToast(`Saved ✓ — ${entry.product} · Closing balance: ${closing.toFixed(3)}`);
      setEntry(blankRmEntry());
      loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  const filteredHistory = filterProduct === "ALL"
    ? history
    : history.filter(r => r.product === filterProduct);

  return (
    <>
      {/* ── Entry form ── */}
      <div className="card">
        <h3>Raw Material Entry</h3>

        <div className="row2">
          <div>
            <label>Date *</label>
            <input type="date" value={entry.date}
              onChange={e => setField("date", e.target.value)} />
          </div>
          <div>
            <label>Name of Product *</label>
            <select value={entry.product}
              onChange={e => handleProductChange(e.target.value as RmProduct | "")}>
              <option value="">— Select product —</option>
              {RM_PRODUCTS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 1: Opening balance + Received + Return */}
        <div className="row3">
          <div>
            <label>Opening Balance</label>
            <input type="number" step="0.001" placeholder="0"
              value={entry.opening_balance}
              onChange={e => setField("opening_balance", e.target.value)} />
          </div>
          <div>
            <label>Qty Received</label>
            <input type="number" min="0" step="0.001" placeholder="0"
              value={entry.qty_received}
              onChange={e => setField("qty_received", e.target.value)} />
          </div>
          <div>
            <label>Material Return</label>
            <input type="number" min="0" step="0.001" placeholder="0"
              value={entry.material_return}
              onChange={e => setField("material_return", e.target.value)} />
          </div>
        </div>

        {/* Row 2: Issued for Prodn + Issued to Bal + Dispatch */}
        <div className="row3">
          <div>
            <label>Qty Issued for Production</label>
            <input type="number" min="0" step="0.001" placeholder="0"
              value={entry.qty_issued_prodn}
              onChange={e => setField("qty_issued_prodn", e.target.value)} />
          </div>
          <div>
            <label>Qty Issued to Balance</label>
            <input type="number" min="0" step="0.001" placeholder="0"
              value={entry.qty_issued_bal}
              onChange={e => setField("qty_issued_bal", e.target.value)} />
          </div>
          <div>
            <label>Dispatch as it is</label>
            <input type="number" min="0" step="0.001" placeholder="0"
              value={entry.dispatch_as_is}
              onChange={e => setField("dispatch_as_is", e.target.value)} />
          </div>
        </div>

        {/* Row 3: Closing balance (computed) + Status + Remarks */}
        <div className="row3">
          <div>
            <label>Closing Balance</label>
            <input type="text" disabled
              value={closing != null ? closing.toFixed(3) : "—"}
              style={{ fontWeight: 700,
                color: closing != null && closing < 0 ? "var(--warn)" : "var(--ok)" }} />
          </div>
          <div>
            <label>Status</label>
            <select value={entry.status}
              onChange={e => setField("status", e.target.value as StockStatus | "")}>
              <option value="">— Select —</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Remarks</label>
            <input type="text" placeholder="Optional note…"
              value={entry.remarks}
              onChange={e => setField("remarks", e.target.value)} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !entry.product || closing == null}
        onClick={handleSave}>
        {submitting ? "Saving…" : "Save Entry ✓"}
      </button>

      {/* ── History table ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>Raw Material History</h3>
          <select value={filterProduct}
            onChange={e => setFilterProduct(e.target.value as RmProduct | "ALL")}
            style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}>
            <option value="ALL">All Products</option>
            {RM_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {histLoading ? <div className="empty">Loading…</div>
          : filteredHistory.length === 0 ? <div className="empty">No entries yet.</div>
          : (
            <div style={{ overflowX: "auto" }}>
              <table className="dash" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th style={{ textAlign: "right" }}>O/Bal</th>
                    <th style={{ textAlign: "right" }}>Qty Recd.</th>
                    <th style={{ textAlign: "right" }}>Mat. Return</th>
                    <th style={{ textAlign: "right" }}>Issued Prodn</th>
                    <th style={{ textAlign: "right" }}>Issued Bal</th>
                    <th style={{ textAlign: "right" }}>Dispatch</th>
                    <th style={{ textAlign: "right" }}>C/Bal</th>
                    <th>Status</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map(row => (
                    <tr key={row.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(row.date)}</td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{row.product}</td>
                      <td style={{ textAlign: "right" }}>{fmt(row.opening_balance)}</td>
                      <td style={{ textAlign: "right", color: row.qty_received > 0 ? "var(--ok)" : undefined }}>
                        {row.qty_received > 0 ? `+${fmt(row.qty_received)}` : "—"}
                      </td>
                      <td style={{ textAlign: "right", color: row.material_return > 0 ? "var(--ok)" : undefined }}>
                        {row.material_return > 0 ? `+${fmt(row.material_return)}` : "—"}
                      </td>
                      <td style={{ textAlign: "right", color: row.qty_issued_prodn > 0 ? "var(--warn)" : undefined }}>
                        {row.qty_issued_prodn > 0 ? `−${fmt(row.qty_issued_prodn)}` : "—"}
                      </td>
                      <td style={{ textAlign: "right", color: row.qty_issued_bal > 0 ? "var(--warn)" : undefined }}>
                        {row.qty_issued_bal > 0 ? `−${fmt(row.qty_issued_bal)}` : "—"}
                      </td>
                      <td style={{ textAlign: "right", color: row.dispatch_as_is > 0 ? "var(--clay)" : undefined }}>
                        {row.dispatch_as_is > 0 ? `−${fmt(row.dispatch_as_is)}` : "—"}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700,
                        color: row.closing_balance < 0 ? "var(--warn)" : undefined }}>
                        {fmt(row.closing_balance)}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 6px",
                          borderRadius: 6,
                          background: row.status === "GOOD"         ? "var(--ok-soft)"
                                    : row.status === "OUT OF STOCK" ? "var(--warn-soft)"
                                    : row.status === "LESS"         ? "#fff3cd"
                                    : "var(--clay-soft)",
                          color:      row.status === "GOOD"         ? "var(--ok)"
                                    : row.status === "OUT OF STOCK" ? "var(--warn)"
                                    : row.status === "LESS"         ? "#7d6608"
                                    : "var(--clay)",
                        }}>
                          {row.status || "—"}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: "var(--ink-soft)", maxWidth: 120, whiteSpace: "normal" }}>
                        {row.remarks || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </>
  );
}

// =============================================================================
// TAB 3 — STOCK LEDGER
// =============================================================================
function StockLedgerSection() {
  const { showToast } = useToast();
  const supabase = createClient();

  const [items, setItems]           = useState<StoresStockItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filterCat, setFilterCat]   = useState<StockItemCategory | "all">("all");
  const [activeItem, setActiveItem] = useState<StoresStockItem | null>(null);
  const [ledger, setLedger]         = useState<StoresStockLedger[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [balances, setBalances]     = useState<Record<string, number>>({});

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_items").select("*").eq("is_active", true)
      .order("category").order("item_name");
    if (error) { showToast("Items load failed: " + error.message, true); setLoading(false); return; }
    const itemList = (data ?? []) as StoresStockItem[];
    setItems(itemList);
    if (itemList.length > 0) {
      const { data: ld } = await supabase
        .from("stores_stock_ledger")
        .select("item_id, closing_balance, created_at")
        .in("item_id", itemList.map(i => i.id))
        .order("created_at", { ascending: false });
      const bal: Record<string, number> = {};
      for (const row of (ld ?? []) as { item_id: string; closing_balance: number }[]) {
        if (!(row.item_id in bal)) bal[row.item_id] = row.closing_balance;
      }
      setBalances(bal);
    }
    setLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const openItem = async (item: StoresStockItem) => {
    setActiveItem(item); setLedgerLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger").select("*").eq("item_id", item.id)
      .order("created_at", { ascending: false }).limit(50);
    if (error) showToast("Ledger load failed: " + error.message, true);
    else setLedger((data ?? []) as StoresStockLedger[]);
    setLedgerLoading(false);
  };

  if (activeItem) {
    const bal = balances[activeItem.id] ?? 0;
    return (
      <>
        <button className="back-link" type="button" onClick={() => { setActiveItem(null); setLedger([]); }}>← Stock List</button>
        <div className="readonly-block">
          <b>{activeItem.item_name}</b> ({activeItem.item_code})<br />
          {CATEGORY_LABEL[activeItem.category]} · Unit: {activeItem.unit}<br />
          <b>Current Balance: {fmt(bal, 3)} {activeItem.unit}</b>
          {activeItem.min_threshold != null && (
            <span style={{ marginLeft: 10, fontWeight: 700,
              color: bal < activeItem.min_threshold ? "var(--warn)" : "var(--ok)" }}>
              {bal < activeItem.min_threshold ? "⚠ Below threshold" : "✓ OK"} (min {activeItem.min_threshold})
            </span>
          )}
        </div>
        <div className="card">
          <h3>Ledger History (last 50)</h3>
          {ledgerLoading ? <div className="empty">Loading…</div>
            : ledger.length === 0 ? <div className="empty">No transactions yet.</div>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="dash" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>Date</th><th>Source</th>
                      <th style={{ textAlign: "right" }}>Received</th>
                      <th style={{ textAlign: "right" }}>Issued</th>
                      <th style={{ textAlign: "right" }}>Dispatch</th>
                      <th style={{ textAlign: "right" }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map(row => (
                      <tr key={row.id}>
                        <td>{fmtDate(row.transaction_date)}</td>
                        <td style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                          {row.transaction_source === "manual"            ? "Manual"
                          : row.transaction_source === "production_fg"    ? "Production FG"
                          : row.transaction_source === "production_rm_oil" ? "Auto Oil"
                          : row.transaction_source === "production_rm_sul" ? "Auto Sulphur"
                          : "Dispatch"}
                        </td>
                        <td style={{ textAlign: "right", color: row.qty_received > 0 ? "var(--ok)" : undefined }}>
                          {row.qty_received > 0 ? `+${fmt(row.qty_received)}` : "—"}
                        </td>
                        <td style={{ textAlign: "right", color: row.qty_issued > 0 ? "var(--warn)" : undefined }}>
                          {row.qty_issued > 0 ? `−${fmt(row.qty_issued)}` : "—"}
                        </td>
                        <td style={{ textAlign: "right", color: row.dispatch_qty > 0 ? "var(--clay)" : undefined }}>
                          {row.dispatch_qty > 0 ? `−${fmt(row.dispatch_qty)}` : "—"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(row.closing_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </>
    );
  }

  const filtered = filterCat === "all" ? items : items.filter(i => i.category === filterCat);
  return (
    <>
      <div className="chip-group" style={{ marginBottom: 12 }}>
        {(["all", "raw_material", "finished_good", "packaging_material"] as const).map(cat => (
          <button key={cat} type="button"
            className={`chip${filterCat === cat ? " selected" : ""}`}
            onClick={() => setFilterCat(cat)}>
            {cat === "all" ? "All" : CATEGORY_LABEL[cat]}
          </button>
        ))}
      </div>
      {loading ? <div className="empty">Loading…</div>
        : filtered.length === 0 ? <div className="empty">No items found.</div>
        : filtered.map(item => {
          const bal = balances[item.id] ?? null;
          const below = bal != null && item.min_threshold != null && bal < item.min_threshold;
          return (
            <div key={item.id} className="pending-item" onClick={() => openItem(item)}>
              <div className="pi-top">
                <span style={{ fontWeight: 700 }}>{item.item_name}</span>
                <span style={{ fontWeight: 700, fontSize: 15,
                  color: below ? "var(--warn)" : "var(--ok)" }}>
                  {bal != null ? `${fmt(bal, 2)} ${item.unit}` : "—"}
                </span>
              </div>
              <div className="pi-sub">
                {CATEGORY_LABEL[item.category]} · Code: {item.item_code}
                {below && <span style={{ color: "var(--warn)", fontWeight: 700, marginLeft: 8 }}>⚠ Min: {item.min_threshold}</span>}
              </div>
            </div>
          );
        })
      }
    </>
  );
}

// =============================================================================
// TAB 4 — ISSUE SLIP
//
// Fields per the physical Material Issue Slip form (JSCI/STORE/02):
//   Date | Material Description | Unit | Quantity Required | Quantity Issued |
//   Used For | Remaining | Remark
//
// Remaining = current stock balance − Quantity Issued (computed live).
// The slip is saved as a ledger row; all extra fields are stored in remark JSON
// so they appear correctly in the history table.
// =============================================================================

/** Shape stored in the remark JSON column for slip reference_type rows. */
interface SlipPayload {
  date: string;
  material_description: string;
  unit: string;
  qty_required: number;
  qty_issued: number;
  used_for: string;
  remaining: number;
  remark: string;
  item_id: string;
}

function IssueSlipSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [items, setItems]                   = useState<StoresStockItem[]>([]);
  const [loading, setLoading]               = useState(true);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);

  // Form fields
  const [slipDate, setSlipDate]         = useState(today());
  const [qtyRequired, setQtyRequired]   = useState("");
  const [qtyIssued, setQtyIssued]       = useState("");
  const [usedFor, setUsedFor]           = useState("");
  const [remark, setRemark]             = useState("");
  const [submitting, setSubmitting]     = useState(false);

  // History
  const [recentSlips, setRecentSlips]   = useState<SlipPayload[]>([]);
  const [histLoading, setHistLoading]   = useState(true);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("stores_stock_items").select("*")
      .eq("is_active", true).in("category", ["raw_material", "packaging_material"])
      .order("category").order("item_name");
    setItems((data ?? []) as StoresStockItem[]);
    setLoading(false);
  }, [supabase]);

  const loadSlips = useCallback(async () => {
    setHistLoading(true);
    const { data } = await supabase
      .from("stores_stock_ledger")
      .select("remark")
      .eq("reference_type", "slip")
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) {
      const parsed: SlipPayload[] = [];
      for (const row of data as { remark: string | null }[]) {
        try {
          const p = JSON.parse(row.remark ?? "{}") as Partial<SlipPayload>;
          if (p.material_description) parsed.push(p as SlipPayload);
        } catch { /* skip */ }
      }
      setRecentSlips(parsed);
    }
    setHistLoading(false);
  }, [supabase]);

  useEffect(() => { loadItems(); loadSlips(); }, [loadItems, loadSlips]);

  // When item is selected, fetch its current stock balance
  const handleItemChange = async (itemId: string) => {
    setSelectedItemId(itemId);
    setCurrentBalance(null);
    if (!itemId) return;
    const { data } = await supabase
      .from("stores_stock_ledger")
      .select("closing_balance")
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setCurrentBalance((data as { closing_balance: number } | null)?.closing_balance ?? 0);
  };

  const selectedItem  = items.find(i => i.id === selectedItemId);
  const qtyIssuedNum  = Number(qtyIssued);
  const qtyRequiredNum = Number(qtyRequired);
  // Remaining = current balance − qty issued (computed live)
  const remaining     = currentBalance != null && Number.isFinite(qtyIssuedNum) && qtyIssuedNum >= 0
    ? currentBalance - qtyIssuedNum
    : null;

  const reset = () => {
    setSelectedItemId(""); setCurrentBalance(null);
    setQtyRequired(""); setQtyIssued(""); setUsedFor(""); setRemark("");
    setSlipDate(today());
  };

  const handleIssue = async () => {
    if (!selectedItemId || !qtyIssued.trim() || !user) {
      showToast("Select a material and enter Quantity Issued.", true); return;
    }
    if (!Number.isFinite(qtyIssuedNum) || qtyIssuedNum <= 0) {
      showToast("Enter a valid Quantity Issued (> 0).", true); return;
    }
    setSubmitting(true);
    try {
      const prevBal = currentBalance ?? 0;
      const newBal  = prevBal - qtyIssuedNum;

      const payload: SlipPayload = {
        date:                 slipDate,
        material_description: selectedItem?.item_name ?? selectedItemId,
        unit:                 selectedItem?.unit ?? "kg",
        qty_required:         Number.isFinite(qtyRequiredNum) ? qtyRequiredNum : 0,
        qty_issued:           qtyIssuedNum,
        used_for:             usedFor.trim(),
        remaining:            newBal,
        remark:               remark.trim(),
        item_id:              selectedItemId,
      };

      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id:            selectedItemId,
        transaction_date:   slipDate,
        transaction_source: "manual",
        qty_received:       0,
        qty_issued:         qtyIssuedNum,
        dispatch_qty:       0,
        closing_balance:    newBal,
        reference_type:     "slip",
        remark:             JSON.stringify(payload),
        entered_by:         user.id,
      });

      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast(`Issued ✓ — ${payload.material_description} ${qtyIssuedNum} ${payload.unit}. Remaining: ${newBal.toFixed(3)}`);
      reset();
      loadSlips();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      {/* ── Entry form ── */}
      <div className="card">
        <h3>Material Issue Slip</h3>

        {/* Row 1: Date + Material Description */}
        <div className="row2">
          <div>
            <label>Date</label>
            <input type="date" value={slipDate}
              onChange={e => setSlipDate(e.target.value)} />
          </div>
          <div>
            <label>Material Description *</label>
            {loading ? <div className="field-hint">Loading…</div> : (
              <select value={selectedItemId} onChange={e => handleItemChange(e.target.value)}>
                <option value="">— Select material —</option>
                {["raw_material", "packaging_material"].map(cat => (
                  <optgroup key={cat} label={CATEGORY_LABEL[cat as StockItemCategory]}>
                    {items.filter(i => i.category === cat).map(item => (
                      <option key={item.id} value={item.id}>
                        {item.item_name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Row 2: Unit (read-only from item) + Qty Required + Qty Issued */}
        <div className="row3">
          <div>
            <label>Unit</label>
            <input type="text" disabled
              value={selectedItem?.unit ?? "—"}
              placeholder="kg / nos / L…" />
          </div>
          <div>
            <label>Quantity Required</label>
            <input type="number" min="0" step="0.001" placeholder="0"
              value={qtyRequired}
              onChange={e => setQtyRequired(e.target.value)} />
          </div>
          <div>
            <label>Quantity Issued *</label>
            <input type="number" min="0.001" step="0.001" placeholder="0"
              value={qtyIssued}
              onChange={e => setQtyIssued(e.target.value)} />
          </div>
        </div>

        {/* Row 3: Used For + Remaining (computed) + Remark */}
        <div className="row3">
          <div>
            <label>Used For (Batch / Job No.)</label>
            <input type="text" placeholder="e.g. Batch 348, Job 301…"
              value={usedFor}
              onChange={e => setUsedFor(e.target.value)} />
          </div>
          <div>
            <label>Remaining</label>
            <input type="text" disabled
              value={remaining != null ? remaining.toFixed(3) : "—"}
              style={{
                fontWeight: 700,
                color: remaining != null && remaining < 0 ? "var(--warn)" : "var(--ok)",
              }} />
            {currentBalance != null && (
              <div className="field-hint">Current stock: {currentBalance.toFixed(3)}</div>
            )}
          </div>
          <div>
            <label>Remark</label>
            <input type="text" placeholder="Additional note…"
              value={remark}
              onChange={e => setRemark(e.target.value)} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !selectedItemId || !qtyIssued.trim()}
        onClick={handleIssue}>
        {submitting ? "Saving…" : "Issue Material ✓"}
      </button>

      {/* ── History table ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Issue Slip History (Last 30)</h3>
        {histLoading ? <div className="empty">Loading…</div>
          : recentSlips.length === 0 ? <div className="empty">No slips recorded yet.</div>
          : (
            <div style={{ overflowX: "auto" }}>
              <table className="dash" style={{ minWidth: 780 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Material Description</th>
                    <th>Unit</th>
                    <th style={{ textAlign: "right" }}>Qty Required</th>
                    <th style={{ textAlign: "right" }}>Qty Issued</th>
                    <th>Used For</th>
                    <th style={{ textAlign: "right" }}>Remaining</th>
                    <th>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSlips.map((row, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(row.date)}</td>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{row.material_description}</td>
                      <td style={{ fontSize: 12 }}>{row.unit}</td>
                      <td style={{ textAlign: "right" }}>
                        {row.qty_required > 0 ? fmt(row.qty_required) : "—"}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--warn)", fontWeight: 700 }}>
                        −{fmt(row.qty_issued)}
                      </td>
                      <td style={{ fontSize: 12 }}>{row.used_for || "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 700,
                        color: row.remaining < 0 ? "var(--warn)" : undefined }}>
                        {fmt(row.remaining)}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--ink-soft)" }}>{row.remark || "—"}</td>
                    </tr>
                  ))}
                </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// =============================================================================
// TAB 5 — PRN
// =============================================================================
function PrnSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  type PrnView = "list" | "create" | "detail";
  const [view, setView]               = useState<PrnView>("list");
  const [prns, setPrns]               = useState<(PurchaseRequisition & { item_name?: string })[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filterStatus, setFilterStatus] = useState<"open" | "all">("open");
  const [activePrn, setActivePrn]     = useState<(PurchaseRequisition & { item_name?: string }) | null>(null);
  const [items, setItems]             = useState<StoresStockItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [poQty, setPoQty]             = useState("");
  const [supplier, setSupplier]       = useState("");
  const [requiredBy, setRequiredBy]   = useState("");
  const [reason, setReason]           = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [receiveQty, setReceiveQty]   = useState("");

  const loadPrns = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("purchase_requisitions")
      .select("*, stores_stock_items(item_name)")
      .order("raised_at", { ascending: false });
    if (filterStatus === "open") q = q.in("status", OPEN_PRN_STATUSES);
    const { data, error } = await q;
    if (error) showToast("Could not load PRNs: " + error.message, true);
    else setPrns((data ?? []).map((r: Record<string, unknown>) => ({
      ...r, item_name: (r.stores_stock_items as { item_name: string } | null)?.item_name,
    })) as (PurchaseRequisition & { item_name?: string })[]);
    setLoading(false);
  }, [supabase, showToast, filterStatus]);

  const loadItems = useCallback(async () => {
    const { data } = await supabase.from("stores_stock_items").select("*")
      .eq("is_active", true).order("category").order("item_name");
    setItems((data ?? []) as StoresStockItem[]);
  }, [supabase]);

  useEffect(() => { loadPrns(); }, [loadPrns]);
  useEffect(() => { if (view === "create") loadItems(); }, [view, loadItems]);

  const handleCreate = async () => {
    if (!selectedItemId || !user) { showToast("Select an item.", true); return; }
    setSubmitting(true);
    try {
      const prnNum = `PRN-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.floor(Math.random()*9000+1000)}`;
      const { error } = await supabase.from("purchase_requisitions").insert({
        item_id: selectedItemId, prn_number: prnNum, status: "draft",
        po_qty: poQty.trim() ? Number(poQty) : null, received_qty: 0,
        preferred_supplier: supplier.trim() || null,
        required_by_date: requiredBy || null, reason: reason.trim() || null,
        raised_by: user.id, raised_at: new Date().toISOString(),
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast(`PRN ${prnNum} created ✓`);
      setSelectedItemId(""); setPoQty(""); setSupplier(""); setRequiredBy(""); setReason("");
      setView("list"); loadPrns();
    } catch (e: unknown) { showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  const handleUpdateReceived = async () => {
    if (!activePrn || !receiveQty.trim()) return;
    const addQty = Number(receiveQty);
    if (!Number.isFinite(addQty) || addQty <= 0) { showToast("Enter a valid quantity.", true); return; }
    const newReceived = (activePrn.received_qty ?? 0) + addQty;
    const newStatus: PrnStatus = (activePrn.po_qty ?? 0) > 0 && newReceived >= (activePrn.po_qty ?? 0) ? "fulfilled" : "partial";
    setSubmitting(true);
    try {
      const { error } = await supabase.from("purchase_requisitions")
        .update({ received_qty: newReceived, status: newStatus }).eq("id", activePrn.id);
      if (error) { showToast("Update failed: " + error.message, true); return; }
      showToast(`Received qty updated ✓ — total ${newReceived} (${newStatus})`);
      setReceiveQty(""); setActivePrn({ ...activePrn, received_qty: newReceived, status: newStatus }); loadPrns();
    } catch (e: unknown) { showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  if (view === "detail" && activePrn) {
    const pending = activePrn.po_qty != null ? activePrn.po_qty - (activePrn.received_qty ?? 0) : null;
    return (
      <>
        <button className="back-link" type="button" onClick={() => { setView("list"); setActivePrn(null); setReceiveQty(""); }}>← PRN List</button>
        <div className="card">
          <h3>PRN Detail</h3>
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            <b>PRN #:</b> {activePrn.prn_number ?? "—"}<br />
            <b>Item:</b> {activePrn.item_name ?? activePrn.item_id.slice(0, 8)}<br />
            <b>Status:</b> <span style={{ fontWeight: 700, color: activePrn.status === "auto_flagged" ? "var(--warn)" : "var(--ok)" }}>{PRN_STATUS_LABEL[activePrn.status]}</span><br />
            <b>PO Qty:</b> {activePrn.po_qty ?? "—"} · <b>Received:</b> {activePrn.received_qty ?? 0}<br />
            <b>Pending:</b> <span style={{ fontWeight: 700, color: (pending ?? 0) > 0 ? "var(--warn)" : "var(--ok)" }}>{pending ?? "—"}</span><br />
            <b>Supplier:</b> {activePrn.preferred_supplier ?? "—"} · <b>Required by:</b> {fmtDate(activePrn.required_by_date)}<br />
            <b>Reason:</b> {activePrn.reason ?? "—"}<br />
            {activePrn.auto_flagged_balance != null && <><b>Auto-flagged balance:</b> {activePrn.auto_flagged_balance}<br /></>}
            <b>Raised:</b> {fmtDate(activePrn.raised_at)}
          </div>
        </div>
        {!["fulfilled","cancelled"].includes(activePrn.status) && (
          <div className="card">
            <h3>Record Delivery</h3>
            <label>Qty received in this delivery</label>
            <input type="number" min="0.001" step="0.001" placeholder="0"
              value={receiveQty} onChange={e => setReceiveQty(e.target.value)} />
            <div className="field-hint">Received so far: {activePrn.received_qty ?? 0} · Pending: {pending ?? "—"}</div>
            <button className="btn btn-primary" type="button" style={{ marginTop: 10 }}
              disabled={submitting || !receiveQty.trim()} onClick={handleUpdateReceived}>
              {submitting ? "Updating…" : "Update Received Qty ✓"}
            </button>
          </div>
        )}
        {!["fulfilled","cancelled"].includes(activePrn.status) && (
          <button className="btn btn-ghost" type="button" style={{ color: "var(--warn)", marginTop: 4 }}
            onClick={async () => {
              if (!confirm(`Cancel PRN ${activePrn.prn_number}?`)) return;
              await supabase.from("purchase_requisitions").update({ status: "cancelled" }).eq("id", activePrn.id);
              showToast("PRN cancelled."); setView("list"); loadPrns();
            }}>Cancel PRN</button>
        )}
      </>
    );
  }

  if (view === "create") return (
    <>
      <button className="back-link" type="button" onClick={() => setView("list")}>← PRN List</button>
      <div className="card">
        <h3>Create New PRN</h3>
        <label>Item *</label>
        <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)}>
          <option value="">— Select item —</option>
          {(["raw_material","packaging_material","finished_good"] as StockItemCategory[]).map(cat => (
            <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
              {items.filter(i => i.category === cat).map(item => (
                <option key={item.id} value={item.id}>{item.item_name} ({item.item_code})</option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="row2">
          <div><label>PO Qty (optional)</label><input type="number" min="0" step="1" placeholder="0" value={poQty} onChange={e => setPoQty(e.target.value)} /></div>
          <div><label>Required by</label><input type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} /></div>
        </div>
        <label>Preferred Supplier</label>
        <input type="text" placeholder="Supplier name…" value={supplier} onChange={e => setSupplier(e.target.value)} />
        <label>Reason / Note</label>
        <textarea rows={2} placeholder="Why is this needed…" value={reason} onChange={e => setReason(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="button" disabled={submitting || !selectedItemId} onClick={handleCreate}>
        {submitting ? "Saving…" : "Create PRN ✓"}
      </button>
    </>
  );

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="chip-group" style={{ margin: 0 }}>
          {(["open","all"] as const).map(f => (
            <button key={f} type="button" className={`chip${filterStatus===f?" selected":""}`} onClick={() => setFilterStatus(f)}>
              {f === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary"
          style={{ width: "auto", padding: "8px 16px", marginTop: 0 }}
          onClick={() => setView("create")}>+ New PRN</button>
      </div>
      {loading ? <div className="empty">Loading…</div>
        : prns.length === 0 ? <div className="empty">No PRNs found.</div>
        : prns.map(prn => {
          const pending = prn.po_qty != null ? prn.po_qty - (prn.received_qty ?? 0) : null;
          return (
            <div key={prn.id} className="pending-item" onClick={() => { setActivePrn(prn); setView("detail"); }}>
              <div className="pi-top">
                <span>{prn.item_name ?? prn.item_id.slice(0,8)}</span>
                <span style={{ fontSize: 11, fontWeight: 700,
                  color: prn.status==="auto_flagged" ? "var(--warn)" : prn.status==="fulfilled" ? "var(--ok)" : "var(--ink-soft)" }}>
                  {PRN_STATUS_LABEL[prn.status]}
                </span>
              </div>
              <div className="pi-sub">
                {prn.prn_number ?? "—"} · PO: {prn.po_qty ?? "?"} · Received: {prn.received_qty ?? 0}
                {pending != null && <> · <b style={{ color: pending>0 ? "var(--warn)" : "var(--ok)" }}>Pending: {pending}</b></>}
                {prn.preferred_supplier && ` · ${prn.preferred_supplier}`}
              </div>
            </div>
          );
        })
      }
    </>
  );
}

// =============================================================================
// TAB 6 — DISPATCH
// =============================================================================
function DispatchSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [items, setItems]                   = useState<StoresStockItem[]>([]);
  const [loading, setLoading]               = useState(true);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [bags, setBags]                     = useState("");
  const [kgPerBag, setKgPerBag]             = useState("25");
  const [dispatchDate, setDispatchDate]     = useState(today());
  const [vehicleNo, setVehicleNo]           = useState("");
  const [partyName, setPartyName]           = useState("");
  const [remark, setRemark]                 = useState("");
  const [submitting, setSubmitting]         = useState(false);
  const [recent, setRecent]                 = useState<(StoresStockLedger & { item_name?: string })[]>([]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("stores_stock_items").select("*")
      .eq("is_active", true).eq("category", "finished_good").order("item_name");
    setItems((data ?? []) as StoresStockItem[]);
    setLoading(false);
  }, [supabase]);

  const loadRecent = useCallback(async () => {
    const { data } = await supabase.from("stores_stock_ledger")
      .select("*, stores_stock_items(item_name)").eq("transaction_source", "dispatch")
      .order("created_at", { ascending: false }).limit(20);
    if (data) setRecent(data.map((r: Record<string, unknown>) => ({
      ...r, item_name: (r.stores_stock_items as { item_name: string } | null)?.item_name,
    })) as (StoresStockLedger & { item_name?: string })[]);
  }, [supabase]);

  useEffect(() => { loadItems(); loadRecent(); }, [loadItems, loadRecent]);

  const selectedItem = items.find(i => i.id === selectedItemId);
  const bagsNum = Number(bags); const kgNum = Number(kgPerBag);
  const totalKg = Number.isFinite(bagsNum) && Number.isFinite(kgNum) && bagsNum > 0 && kgNum > 0 ? bagsNum * kgNum : null;

  const handleDispatch = async () => {
    if (!selectedItemId || !bags.trim() || !user || totalKg == null) {
      showToast("Select item, enter bags and kg/bag.", true); return;
    }
    setSubmitting(true);
    try {
      const { data: last } = await supabase.from("stores_stock_ledger")
        .select("closing_balance").eq("item_id", selectedItemId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const prevBal = (last as { closing_balance: number } | null)?.closing_balance ?? 0;
      const newBal  = prevBal - totalKg;
      const remarkParts = [
        partyName.trim() && `Party: ${partyName.trim()}`,
        vehicleNo.trim() && `Vehicle: ${vehicleNo.trim()}`,
        `${bagsNum} bags × ${kgNum} kg`,
        remark.trim(),
      ].filter(Boolean);
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id: selectedItemId, transaction_date: dispatchDate,
        transaction_source: "dispatch", qty_received: 0, qty_issued: 0,
        dispatch_qty: totalKg, closing_balance: newBal,
        reference_type: "dispatch",
        remark: remarkParts.join(" | ") || null, entered_by: user.id,
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast(`Dispatch recorded ✓ — ${selectedItem?.item_name ?? ""} ${bagsNum} bags (${totalKg} kg). Balance: ${newBal.toFixed(2)} kg`);
      setSelectedItemId(""); setBags(""); setVehicleNo(""); setPartyName(""); setRemark("");
      loadRecent(); loadItems();
    } catch (e: unknown) { showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <div className="card">
        <h3>Record FG Dispatch</h3>
        <label>Finished Good Item *</label>
        {loading ? <div className="field-hint">Loading…</div> : (
          <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)}>
            <option value="">— Select item —</option>
            {items.map(item => (
              <option key={item.id} value={item.id}>{item.item_name} ({item.item_code})</option>
            ))}
          </select>
        )}
        <div className="row3">
          <div><label>Bags *</label><input type="number" min="1" step="1" placeholder="0" value={bags} onChange={e => setBags(e.target.value)} /></div>
          <div><label>Kg / Bag</label><input type="number" min="0.1" step="0.1" placeholder="25" value={kgPerBag} onChange={e => setKgPerBag(e.target.value)} /></div>
          <div><label>Total Kg</label><input type="text" disabled value={totalKg != null ? totalKg.toFixed(2) : "—"} /></div>
        </div>
        <div className="row2">
          <div><label>Dispatch Date</label><input type="date" value={dispatchDate} onChange={e => setDispatchDate(e.target.value)} /></div>
          <div><label>Vehicle No.</label><input type="text" placeholder="MH04 AB 1234" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} /></div>
        </div>
        <label>Party Name</label>
        <input type="text" placeholder="Bridgestone India, MRF…" value={partyName} onChange={e => setPartyName(e.target.value)} />
        <label>Remark</label>
        <input type="text" placeholder="Additional note…" value={remark} onChange={e => setRemark(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="button"
        disabled={submitting || !selectedItemId || totalKg == null} onClick={handleDispatch}>
        {submitting ? "Saving…" : "Record Dispatch ✓"}
      </button>
      {recent.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Recent Dispatches (Last 20)</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="dash" style={{ minWidth: 420 }}>
              <thead><tr><th>Date</th><th>Item</th><th style={{ textAlign: "right" }}>Dispatch (kg)</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
              <tbody>
                {recent.map(row => (
                  <tr key={row.id}>
                    <td>{fmtDate(row.transaction_date)}</td>
                    <td style={{ fontSize: 12 }}>{row.item_name ?? row.item_id.slice(0,8)}</td>
                    <td style={{ textAlign: "right", color: "var(--clay)" }}>−{fmt(row.dispatch_qty)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(row.closing_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

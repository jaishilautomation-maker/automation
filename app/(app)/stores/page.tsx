"use client";

// =============================================================================
// Stores Module — JSCI A-20/1
//
// Five sections in a single tabbed page:
//
//   1. तेल जारी (Oil Issue)     — existing pulveriser oil-issue queue
//   2. स्टॉक खाता (Stock Ledger) — view current balances by category (RM/PM/FG)
//   3. माल जारी (Issue Slip)     — manual Material Issue Slip for RM/PM
//   4. PRN                       — create PRN, view list, update received qty
//   5. डिस्पैच (Dispatch)        — FG dispatch entry (Nivas Patil)
//
// All writes go directly to the Supabase tables created in migration 027/031.
// Ledger closing_balance is computed client-side before INSERT by reading the
// most recent row for that item — same approach as the DB triggers.
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

const CATEGORY_LABEL: Record<StockItemCategory, string> = {
  raw_material:      "कच्चा माल (RM)",
  finished_good:     "तैयार माल (FG)",
  packaging_material:"पैकिंग सामग्री (PM)",
};

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

type Tab = "oil" | "ledger" | "issue" | "prn" | "dispatch";

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function StoresPage() {
  const [tab, setTab] = useState<Tab>("oil");

  return (
    <div>
      {/* ── Tab bar ── */}
      <div style={{
        display: "flex", overflowX: "auto", gap: 0,
        background: "var(--panel)", borderBottom: "1px solid var(--line)",
        marginBottom: 14, position: "sticky", top: 104, zIndex: 10,
      }}>
        {([ 
          { id: "oil",      label: "🛢 तेल जारी" },
          { id: "ledger",   label: "📊 स्टॉक खाता" },
          { id: "issue",    label: "📋 माल जारी" },
          { id: "prn",      label: "📦 PRN" },
          { id: "dispatch", label: "🚚 डिस्पैच" },
        ] as { id: Tab; label: string }[]).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              flex: "0 0 auto",
              minWidth: 100,
              padding: "11px 12px",
              border: "none",
              background: "none",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              color: tab === t.id ? "var(--clay)" : "var(--ink-soft)",
              borderBottom: tab === t.id ? "3px solid var(--clay)" : "3px solid transparent",
              fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {tab === "oil"      && <OilIssueSection />}
      {tab === "ledger"   && <StockLedgerSection />}
      {tab === "issue"    && <IssueSlipSection />}
      {tab === "prn"      && <PrnSection />}
      {tab === "dispatch" && <DispatchSection />}
    </div>
  );
}

// =============================================================================
// TAB 1 — OIL ISSUE  (existing pulveriser oil-issue queue, moved here)
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
      .from("pulveriser_job_cards")
      .select("*")
      .eq("status", "pending_stores")
      .not("material_code", "is", null)
      .order("created_at", { ascending: false });
    if (error) showToast("Load nahi hua: " + error.message, true);
    else setPending((data ?? []) as PulveriserJobCard[]);
    setLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const openCard = (jc: PulveriserJobCard) => {
    setActive(jc);
    setOilIssued(jc.oil_issued_kg?.toString() ?? "");
  };
  const goBack = () => { setActive(null); setOilIssued(""); };

  const canSubmit = oilIssued.trim() !== "" && Number.isFinite(Number(oilIssued));

  const handleIssue = async () => {
    if (!active || !user || !canSubmit) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("pulveriser_job_cards")
        .update({
          oil_issued_kg: Number(oilIssued),
          oil_issued_by: user.id,
          oil_issued_at: new Date().toISOString(),
          status: "pending",
        })
        .eq("id", active.id)
        .select("id");
      if (error) { showToast("Save nahi hua: " + error.message, true); return; }
      if (!data || data.length === 0) {
        showToast("Save blocked — factory access ya card status jaanchein.", true);
        return;
      }
      const nowISO = new Date().toISOString();
      const { subject, html } = buildStoresEmail({
        jobNumber: active.job_number, materialCode: active.material_code,
        oilRequiredKg: active.oil_required_kg, oilIssuedKg: Number(oilIssued),
        submittedByName: profile?.full_name ?? "—", submittedAt: nowISO,
      });
      void notifyEvent({ eventType: "pulveriser_stores", subject, html,
        factoryId: active.factory_id, referenceId: active.id });
      showToast("Oil issued ✓ — operator ab batch chala sakta hai.");
      goBack(); loadPending();
    } catch (e: unknown) {
      showToast("Save nahi hua: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  if (active) {
    return (
      <>
        <button className="back-link" type="button" onClick={goBack}>← वापस जाएँ</button>
        <div className="readonly-block">
          <b>{active.machine_number}</b> · {fmtDate(active.job_date)} · {active.shift ?? "—"} shift<br />
          <b>Batch:</b> {active.material_code} · <b>Party/CODE:</b> {active.party_code ?? "—"} · Job: {active.job_number ?? "—"}<br />
          <b>Planned:</b> {active.planned_production_mt ?? "—"} MT ·{" "}
          <b>Oil required:</b> {active.oil_required_kg != null ? `${active.oil_required_kg} kg` : "NA"}
        </div>
        <div className="card">
          <h3>Oil Issue</h3>
          <label>Oil issued (kg) *</label>
          <input type="number" min="0" step="0.001" placeholder="0"
            value={oilIssued} onChange={e => setOilIssued(e.target.value)} />
          <div className="field-hint" style={{ marginTop: 6 }}>Issue karte hi card operator ke liye khul jaayega.</div>
        </div>
        <button className="btn btn-primary" type="button"
          disabled={submitting || !canSubmit} onClick={handleIssue}>
          {submitting ? "Save ho raha hai…" : "Issue oil & operator ko bhejein"}
        </button>
      </>
    );
  }

  return (
    <div className="card">
      <h3>Oil issue ke liye job cards</h3>
      <div className="field-hint" style={{ marginBottom: 10 }}>
        Production ne ye banaye hain। Required oil issue karein।
      </div>
      {loading ? <div className="empty">Load ho raha hai…</div>
        : pending.length === 0 ? <div className="empty">Koi card pending nahi hai।</div>
        : groupByJobNumber(pending).map(group => (
          <div key={group.jobNumber ?? group.entries[0].id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", margin: "4px 2px" }}>
              Job: {group.jobNumber ?? "—"}
              {group.entries.length > 1 && ` · ${group.entries.length} entries`}
            </div>
            {group.entries.map((jc, i) => (
              <div className="pending-item" key={jc.id} onClick={() => openCard(jc)}>
                <div className="pi-top">
                  <span>Entry {i + 1} · {jc.machine_number} · {fmtDate(jc.job_date)}</span>
                  <span>{jc.shift ?? "—"}</span>
                </div>
                <div className="pi-sub">
                  Batch: {jc.material_code} · Party/CODE: {jc.party_code ?? "—"} · Oil required:{" "}
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
// TAB 2 — STOCK LEDGER
// View current balances grouped by category, drill into ledger history.
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

  // Latest closing balance per item (from most recent ledger row)
  const [balances, setBalances]     = useState<Record<string, number>>({});

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_items")
      .select("*")
      .eq("is_active", true)
      .order("category")
      .order("item_name");
    if (error) { showToast("Items load nahi hue: " + error.message, true); setLoading(false); return; }
    const itemList = (data ?? []) as StoresStockItem[];
    setItems(itemList);

    // Load latest closing balance for each item in one query
    if (itemList.length > 0) {
      const ids = itemList.map(i => i.id);
      // Get the most recent ledger row per item using a subquery approach —
      // fetch last 1 row per item ordered by created_at desc
      const { data: ledgerData } = await supabase
        .from("stores_stock_ledger")
        .select("item_id, closing_balance, created_at")
        .in("item_id", ids)
        .order("created_at", { ascending: false });

      // Keep only the first (latest) row per item_id
      const bal: Record<string, number> = {};
      for (const row of (ledgerData ?? []) as { item_id: string; closing_balance: number }[]) {
        if (!(row.item_id in bal)) bal[row.item_id] = row.closing_balance;
      }
      setBalances(bal);
    }
    setLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const openItem = async (item: StoresStockItem) => {
    setActiveItem(item);
    setLedgerLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("*")
      .eq("item_id", item.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) showToast("Ledger load nahi hua: " + error.message, true);
    else setLedger((data ?? []) as StoresStockLedger[]);
    setLedgerLoading(false);
  };

  const goBack = () => { setActiveItem(null); setLedger([]); };

  const filtered = filterCat === "all" ? items : items.filter(i => i.category === filterCat);

  // Drill-down: ledger history for one item
  if (activeItem) {
    const bal = balances[activeItem.id] ?? 0;
    return (
      <>
        <button className="back-link" type="button" onClick={goBack}>← स्टॉक सूची</button>
        <div className="readonly-block">
          <b>{activeItem.item_name}</b> ({activeItem.item_code})<br />
          {CATEGORY_LABEL[activeItem.category]} · Unit: {activeItem.unit}<br />
          <b>Current balance: {fmt(bal, 3)} {activeItem.unit}</b>
          {activeItem.min_threshold != null && (
            <span style={{ marginLeft: 10, color: bal < activeItem.min_threshold ? "var(--warn)" : "var(--ok)", fontWeight: 700 }}>
              {bal < activeItem.min_threshold ? "⚠ Below threshold" : "✓ OK"} (min {activeItem.min_threshold})
            </span>
          )}
        </div>
        <div className="card">
          <h3>Ledger history (last 50)</h3>
          {ledgerLoading ? <div className="empty">Load ho raha hai…</div>
            : ledger.length === 0 ? <div className="empty">Koi transaction nahi।</div>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="dash" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Source</th>
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
                          {row.transaction_source === "manual" ? "Manual" :
                           row.transaction_source === "production_fg" ? "Production FG" :
                           row.transaction_source === "production_rm_oil" ? "Auto Oil" :
                           row.transaction_source === "production_rm_sul" ? "Auto Sulphur" :
                           "Dispatch"}
                          {row.remark && <div style={{ color: "var(--ink-soft)", fontSize: 10 }}>{row.remark.slice(0, 60)}</div>}
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

  return (
    <>
      {/* Category filter */}
      <div className="chip-group" style={{ marginBottom: 12 }}>
        {(["all", "raw_material", "finished_good", "packaging_material"] as const).map(cat => (
          <button key={cat} type="button"
            className={`chip${filterCat === cat ? " selected" : ""}`}
            onClick={() => setFilterCat(cat)}>
            {cat === "all" ? "सभी" : CATEGORY_LABEL[cat]}
          </button>
        ))}
      </div>

      {loading ? <div className="empty">Load ho raha hai…</div>
        : filtered.length === 0 ? <div className="empty">Koi item nahi mila।</div>
        : filtered.map(item => {
          const bal = balances[item.id] ?? null;
          const belowThreshold = bal != null && item.min_threshold != null && bal < item.min_threshold;
          return (
            <div key={item.id} className="pending-item" onClick={() => openItem(item)}>
              <div className="pi-top">
                <span style={{ fontWeight: 700 }}>{item.item_name}</span>
                <span style={{
                  fontWeight: 700, fontSize: 15,
                  color: belowThreshold ? "var(--warn)" : "var(--ok)",
                }}>
                  {bal != null ? `${fmt(bal, 2)} ${item.unit}` : "—"}
                </span>
              </div>
              <div className="pi-sub">
                {CATEGORY_LABEL[item.category]} · Code: {item.item_code}
                {belowThreshold && (
                  <span style={{ color: "var(--warn)", fontWeight: 700, marginLeft: 8 }}>
                    ⚠ Min: {item.min_threshold}
                  </span>
                )}
              </div>
            </div>
          );
        })
      }
    </>
  );
}

// =============================================================================
// TAB 3 — MATERIAL ISSUE SLIP
// Manual issuance of RM or PM to production — posts qty_issued ledger row.
// =============================================================================
function IssueSlipSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [items, setItems]             = useState<StoresStockItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [qty, setQty]                 = useState("");
  const [usedFor, setUsedFor]         = useState("");
  const [slipDate, setSlipDate]       = useState(new Date().toISOString().slice(0, 10));
  const [remark, setRemark]           = useState("");
  const [submitting, setSubmitting]   = useState(false);

  // Recent slips (last 20 manual issue rows)
  const [recentSlips, setRecentSlips] = useState<(StoresStockLedger & { item_name?: string })[]>([]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("stores_stock_items")
      .select("*")
      .eq("is_active", true)
      .in("category", ["raw_material", "packaging_material"])
      .order("category").order("item_name");
    setItems((data ?? []) as StoresStockItem[]);
    setLoading(false);
  }, [supabase]);

  const loadSlips = useCallback(async () => {
    const { data } = await supabase
      .from("stores_stock_ledger")
      .select("*, stores_stock_items(item_name)")
      .eq("transaction_source", "manual")
      .gt("qty_issued", 0)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) {
      setRecentSlips(data.map((r: Record<string, unknown>) => ({
        ...r,
        item_name: (r.stores_stock_items as { item_name: string } | null)?.item_name,
      })) as (StoresStockLedger & { item_name?: string })[]);
    }
  }, [supabase]);

  useEffect(() => { loadItems(); loadSlips(); }, [loadItems, loadSlips]);

  const selectedItem = items.find(i => i.id === selectedItemId);

  const handleIssue = async () => {
    if (!selectedItemId || !qty.trim() || !user) {
      showToast("Item aur quantity zaroori hai।", true); return;
    }
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      showToast("Valid quantity bharein।", true); return;
    }
    setSubmitting(true);
    try {
      // Get latest closing balance for this item
      const { data: lastRow } = await supabase
        .from("stores_stock_ledger")
        .select("closing_balance")
        .eq("item_id", selectedItemId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const prevBal = (lastRow as { closing_balance: number } | null)?.closing_balance ?? 0;
      const newBal  = prevBal - qtyNum;

      const { error } = await supabase
        .from("stores_stock_ledger")
        .insert({
          item_id:            selectedItemId,
          transaction_date:   slipDate,
          transaction_source: "manual",
          qty_received:       0,
          qty_issued:         qtyNum,
          dispatch_qty:       0,
          closing_balance:    newBal,
          reference_type:     "slip",
          remark:             [usedFor.trim() && `Used for: ${usedFor.trim()}`, remark.trim()]
                              .filter(Boolean).join(" | ") || null,
          entered_by:         user.id,
        });

      if (error) { showToast("Save nahi hua: " + error.message, true); return; }
      showToast(`माल जारी ✓ — ${selectedItem?.item_name ?? ""} ${qtyNum} ${selectedItem?.unit ?? ""} issued। New balance: ${newBal.toFixed(3)}`);
      setSelectedItemId(""); setQty(""); setUsedFor(""); setRemark("");
      loadSlips();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <div className="card">
        <h3>माल जारी करें (Material Issue)</h3>

        <label>Item *</label>
        {loading ? <div className="field-hint">Load ho raha hai…</div> : (
          <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)}>
            <option value="">— Item chune —</option>
            {["raw_material", "packaging_material"].map(cat => (
              <optgroup key={cat} label={CATEGORY_LABEL[cat as StockItemCategory]}>
                {items.filter(i => i.category === cat).map(item => (
                  <option key={item.id} value={item.id}>{item.item_name} ({item.item_code})</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        <div className="row2">
          <div>
            <label>Quantity ({selectedItem?.unit ?? "unit"}) *</label>
            <input type="number" min="0.001" step="0.001" placeholder="0"
              value={qty} onChange={e => setQty(e.target.value)} />
          </div>
          <div>
            <label>Date</label>
            <input type="date" value={slipDate} onChange={e => setSlipDate(e.target.value)} />
          </div>
        </div>

        <label>किस batch/job के लिए (Used for)</label>
        <input type="text" placeholder="जैसे Batch 348, Job 301…"
          value={usedFor} onChange={e => setUsedFor(e.target.value)} />

        <label>Remark (optional)</label>
        <input type="text" placeholder="Additional note…"
          value={remark} onChange={e => setRemark(e.target.value)} />
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !selectedItemId || !qty.trim()}
        onClick={handleIssue}>
        {submitting ? "Save ho raha hai…" : "माल जारी करें ✓"}
      </button>

      {/* Recent slips */}
      {recentSlips.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>हाल के स्लिप (Last 20)</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="dash" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th style={{ textAlign: "right" }}>Issued</th>
                  <th style={{ textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {recentSlips.map(row => (
                  <tr key={row.id}>
                    <td>{fmtDate(row.transaction_date)}</td>
                    <td style={{ fontSize: 12 }}>{row.item_name ?? row.item_id.slice(0, 8)}</td>
                    <td style={{ textAlign: "right", color: "var(--warn)" }}>−{fmt(row.qty_issued)}</td>
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

// =============================================================================
// TAB 4 — PRN  (Purchase Requisition Note)
// Create new PRN, view open/all PRNs, update received_qty incrementally.
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

  // Create form
  const [items, setItems]             = useState<StoresStockItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [poQty, setPoQty]             = useState("");
  const [supplier, setSupplier]       = useState("");
  const [requiredBy, setRequiredBy]   = useState("");
  const [reason, setReason]           = useState("");
  const [submitting, setSubmitting]   = useState(false);

  // Detail: update received qty
  const [receiveQty, setReceiveQty]   = useState("");

  const loadPrns = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("purchase_requisitions")
      .select("*, stores_stock_items(item_name)")
      .order("raised_at", { ascending: false });
    if (filterStatus === "open") {
      query = query.in("status", OPEN_PRN_STATUSES);
    }
    const { data, error } = await query;
    if (error) { showToast("PRN load nahi hua: " + error.message, true); }
    else {
      setPrns((data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        item_name: (r.stores_stock_items as { item_name: string } | null)?.item_name,
      })) as (PurchaseRequisition & { item_name?: string })[]);
    }
    setLoading(false);
  }, [supabase, showToast, filterStatus]);

  const loadItems = useCallback(async () => {
    const { data } = await supabase
      .from("stores_stock_items")
      .select("*")
      .eq("is_active", true)
      .order("category").order("item_name");
    setItems((data ?? []) as StoresStockItem[]);
  }, [supabase]);

  useEffect(() => { loadPrns(); }, [loadPrns]);
  useEffect(() => { if (view === "create") loadItems(); }, [view, loadItems]);

  const handleCreate = async () => {
    if (!selectedItemId || !user) { showToast("Item zaroori hai।", true); return; }
    setSubmitting(true);
    try {
      // Generate PRN number
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const prnNum  = `PRN-${dateStr}-${Math.floor(Math.random() * 9000 + 1000)}`;

      const { error } = await supabase
        .from("purchase_requisitions")
        .insert({
          item_id:            selectedItemId,
          prn_number:         prnNum,
          status:             "draft",
          po_qty:             poQty.trim() ? Number(poQty) : null,
          received_qty:       0,
          preferred_supplier: supplier.trim() || null,
          required_by_date:   requiredBy || null,
          reason:             reason.trim() || null,
          raised_by:          user.id,
          raised_at:          new Date().toISOString(),
        });

      if (error) { showToast("PRN save nahi hua: " + error.message, true); return; }
      showToast(`PRN ${prnNum} create hua ✓`);
      setSelectedItemId(""); setPoQty(""); setSupplier(""); setRequiredBy(""); setReason("");
      setView("list"); loadPrns();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  const handleUpdateReceived = async () => {
    if (!activePrn || !receiveQty.trim()) return;
    const addQty = Number(receiveQty);
    if (!Number.isFinite(addQty) || addQty <= 0) {
      showToast("Valid quantity bharein।", true); return;
    }
    const newReceived = (activePrn.received_qty ?? 0) + addQty;
    const poQtyNum = activePrn.po_qty ?? 0;
    const newStatus: PrnStatus = poQtyNum > 0 && newReceived >= poQtyNum ? "fulfilled" : "partial";

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("purchase_requisitions")
        .update({ received_qty: newReceived, status: newStatus })
        .eq("id", activePrn.id);
      if (error) { showToast("Update nahi hua: " + error.message, true); return; }
      showToast(`Received qty updated ✓ — now ${newReceived} (${newStatus})`);
      setReceiveQty("");
      // Refresh the active PRN data
      setActivePrn({ ...activePrn, received_qty: newReceived, status: newStatus });
      loadPrns();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  const handleCancel = async (prn: PurchaseRequisition) => {
    if (!confirm(`PRN ${prn.prn_number ?? prn.id.slice(0,8)} cancel karna chahte hain?`)) return;
    const { error } = await supabase
      .from("purchase_requisitions")
      .update({ status: "cancelled" })
      .eq("id", prn.id);
    if (error) { showToast("Cancel nahi hua: " + error.message, true); return; }
    showToast("PRN cancelled।");
    loadPrns();
  };

  // ── Detail view ────────────────────────────────────────────────────────
  if (view === "detail" && activePrn) {
    const pending_qty = activePrn.po_qty != null
      ? activePrn.po_qty - (activePrn.received_qty ?? 0)
      : null;
    return (
      <>
        <button className="back-link" type="button" onClick={() => { setView("list"); setActivePrn(null); setReceiveQty(""); }}>
          ← PRN list
        </button>
        <div className="card">
          <h3>PRN Detail</h3>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <b>PRN #:</b> {activePrn.prn_number ?? "—"}<br />
            <b>Item:</b> {activePrn.item_name ?? activePrn.item_id.slice(0, 8)}<br />
            <b>Status:</b>{" "}
            <span style={{ fontWeight: 700, color: activePrn.status === "auto_flagged" ? "var(--warn)" : "var(--ok)" }}>
              {PRN_STATUS_LABEL[activePrn.status]}
            </span><br />
            <b>PO Qty:</b> {activePrn.po_qty ?? "—"}<br />
            <b>Received:</b> {activePrn.received_qty ?? 0}<br />
            <b>Pending:</b>{" "}
            <span style={{ fontWeight: 700, color: (pending_qty ?? 0) > 0 ? "var(--warn)" : "var(--ok)" }}>
              {pending_qty != null ? pending_qty : "—"}
            </span><br />
            <b>Supplier:</b> {activePrn.preferred_supplier ?? "—"}<br />
            <b>Required by:</b> {fmtDate(activePrn.required_by_date)}<br />
            <b>Reason:</b> {activePrn.reason ?? "—"}<br />
            {activePrn.auto_flagged_balance != null && (
              <><b>Auto-flagged at balance:</b> {activePrn.auto_flagged_balance}<br /></>
            )}
            <b>Raised:</b> {fmtDate(activePrn.raised_at)}
          </div>
        </div>

        {/* Update received qty */}
        {!["fulfilled", "cancelled"].includes(activePrn.status) && (
          <div className="card">
            <h3>Delivery receive karein</h3>
            <label>Is delivery mein kitna mila? (qty)</label>
            <input type="number" min="0.001" step="0.001" placeholder="0"
              value={receiveQty} onChange={e => setReceiveQty(e.target.value)} />
            <div className="field-hint">
              Abhi tak mila: {activePrn.received_qty ?? 0} · Pending: {pending_qty ?? "—"}
            </div>
            <button className="btn btn-primary" type="button" style={{ marginTop: 10 }}
              disabled={submitting || !receiveQty.trim()} onClick={handleUpdateReceived}>
              {submitting ? "Update ho raha hai…" : "Received qty update karein ✓"}
            </button>
          </div>
        )}

        {!["fulfilled", "cancelled"].includes(activePrn.status) && (
          <button className="btn btn-ghost" type="button"
            style={{ color: "var(--warn)", marginTop: 4 }}
            onClick={() => handleCancel(activePrn)}>
            PRN Cancel karein
          </button>
        )}
      </>
    );
  }

  // ── Create view ────────────────────────────────────────────────────────
  if (view === "create") {
    return (
      <>
        <button className="back-link" type="button" onClick={() => setView("list")}>← PRN list</button>
        <div className="card">
          <h3>Naya PRN banayein</h3>

          <label>Item *</label>
          <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)}>
            <option value="">— Item chune —</option>
            {(["raw_material", "packaging_material", "finished_good"] as StockItemCategory[]).map(cat => (
              <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                {items.filter(i => i.category === cat).map(item => (
                  <option key={item.id} value={item.id}>{item.item_name} ({item.item_code})</option>
                ))}
              </optgroup>
            ))}
          </select>

          <div className="row2">
            <div>
              <label>PO Qty (optional)</label>
              <input type="number" min="0" step="1" placeholder="0"
                value={poQty} onChange={e => setPoQty(e.target.value)} />
            </div>
            <div>
              <label>Required by</label>
              <input type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} />
            </div>
          </div>

          <label>Preferred Supplier</label>
          <input type="text" placeholder="Supplier ka naam…"
            value={supplier} onChange={e => setSupplier(e.target.value)} />

          <label>Reason / Note</label>
          <textarea rows={2} placeholder="Kyu zaroorat hai…"
            value={reason} onChange={e => setReason(e.target.value)} />
        </div>

        <button className="btn btn-primary" type="button"
          disabled={submitting || !selectedItemId} onClick={handleCreate}>
          {submitting ? "Save ho raha hai…" : "PRN banayein ✓"}
        </button>
      </>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="chip-group" style={{ margin: 0 }}>
          <button type="button" className={`chip${filterStatus === "open" ? " selected" : ""}`}
            onClick={() => setFilterStatus("open")}>Open</button>
          <button type="button" className={`chip${filterStatus === "all" ? " selected" : ""}`}
            onClick={() => setFilterStatus("all")}>All</button>
        </div>
        <button type="button" className="btn btn-secondary"
          style={{ width: "auto", padding: "8px 16px", marginTop: 0 }}
          onClick={() => setView("create")}>
          + New PRN
        </button>
      </div>

      {loading ? <div className="empty">Load ho raha hai…</div>
        : prns.length === 0 ? <div className="empty">Koi PRN nahi mila।</div>
        : prns.map(prn => {
          const pending = prn.po_qty != null ? prn.po_qty - (prn.received_qty ?? 0) : null;
          return (
            <div key={prn.id} className="pending-item"
              onClick={() => { setActivePrn(prn); setView("detail"); }}>
              <div className="pi-top">
                <span>{prn.item_name ?? prn.item_id.slice(0, 8)}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: prn.status === "auto_flagged" ? "var(--warn)"
                       : prn.status === "fulfilled"     ? "var(--ok)"
                       : "var(--ink-soft)",
                }}>
                  {PRN_STATUS_LABEL[prn.status]}
                </span>
              </div>
              <div className="pi-sub">
                {prn.prn_number ?? "—"} · PO: {prn.po_qty ?? "?"}{" "}
                · Received: {prn.received_qty ?? 0}{" "}
                {pending != null && <> · <b style={{ color: pending > 0 ? "var(--warn)" : "var(--ok)" }}>Pending: {pending}</b></>}
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
// TAB 5 — DISPATCH  (FG dispatch entry — Nivas Patil)
// Posts a dispatch_qty ledger row for a Finished Good item.
// =============================================================================
function DispatchSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [items, setItems]             = useState<StoresStockItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [bags, setBags]               = useState("");
  const [kgPerBag, setKgPerBag]       = useState("25");
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNo, setVehicleNo]     = useState("");
  const [partyName, setPartyName]     = useState("");
  const [remark, setRemark]           = useState("");
  const [submitting, setSubmitting]   = useState(false);

  // Recent dispatches
  const [recent, setRecent]           = useState<(StoresStockLedger & { item_name?: string })[]>([]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("stores_stock_items")
      .select("*")
      .eq("is_active", true)
      .eq("category", "finished_good")
      .order("item_name");
    setItems((data ?? []) as StoresStockItem[]);
    setLoading(false);
  }, [supabase]);

  const loadRecent = useCallback(async () => {
    const { data } = await supabase
      .from("stores_stock_ledger")
      .select("*, stores_stock_items(item_name)")
      .eq("transaction_source", "dispatch")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) {
      setRecent(data.map((r: Record<string, unknown>) => ({
        ...r,
        item_name: (r.stores_stock_items as { item_name: string } | null)?.item_name,
      })) as (StoresStockLedger & { item_name?: string })[]);
    }
  }, [supabase]);

  useEffect(() => { loadItems(); loadRecent(); }, [loadItems, loadRecent]);

  const selectedItem = items.find(i => i.id === selectedItemId);

  // Computed dispatch qty in kg
  const bagsNum  = Number(bags);
  const kgNum    = Number(kgPerBag);
  const totalKg  = Number.isFinite(bagsNum) && Number.isFinite(kgNum) && bagsNum > 0 && kgNum > 0
    ? bagsNum * kgNum : null;

  const handleDispatch = async () => {
    if (!selectedItemId || !bags.trim() || !user) {
      showToast("Item aur bags zaroori hai।", true); return;
    }
    if (totalKg == null || totalKg <= 0) {
      showToast("Valid bags/kg bharein।", true); return;
    }
    setSubmitting(true);
    try {
      // Get latest closing balance
      const { data: lastRow } = await supabase
        .from("stores_stock_ledger")
        .select("closing_balance")
        .eq("item_id", selectedItemId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const prevBal = (lastRow as { closing_balance: number } | null)?.closing_balance ?? 0;
      const newBal  = prevBal - totalKg;

      const remarkParts = [
        partyName.trim() && `Party: ${partyName.trim()}`,
        vehicleNo.trim() && `Vehicle: ${vehicleNo.trim()}`,
        `${bagsNum} bags × ${kgNum} kg`,
        remark.trim(),
      ].filter(Boolean);

      const { error } = await supabase
        .from("stores_stock_ledger")
        .insert({
          item_id:            selectedItemId,
          transaction_date:   dispatchDate,
          transaction_source: "dispatch",
          qty_received:       0,
          qty_issued:         0,
          dispatch_qty:       totalKg,
          closing_balance:    newBal,
          reference_type:     "dispatch",
          remark:             remarkParts.join(" | ") || null,
          entered_by:         user.id,
        });

      if (error) { showToast("Dispatch save nahi hua: " + error.message, true); return; }
      showToast(`Dispatch ✓ — ${selectedItem?.item_name ?? ""} ${bagsNum} bags (${totalKg} kg). Balance: ${newBal.toFixed(2)} kg`);
      setSelectedItemId(""); setBags(""); setVehicleNo(""); setPartyName(""); setRemark("");
      loadRecent(); loadItems();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <div className="card">
        <h3>FG Dispatch करें</h3>

        <label>Finished Good Item *</label>
        {loading ? <div className="field-hint">Load ho raha hai…</div> : (
          <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)}>
            <option value="">— Item chune —</option>
            {items.map(item => (
              <option key={item.id} value={item.id}>{item.item_name} ({item.item_code})</option>
            ))}
          </select>
        )}

        <div className="row3">
          <div>
            <label>Bags *</label>
            <input type="number" min="1" step="1" placeholder="0"
              value={bags} onChange={e => setBags(e.target.value)} />
          </div>
          <div>
            <label>Kg/bag</label>
            <input type="number" min="0.1" step="0.1" placeholder="25"
              value={kgPerBag} onChange={e => setKgPerBag(e.target.value)} />
          </div>
          <div>
            <label>Total kg</label>
            <input type="text" disabled value={totalKg != null ? totalKg.toFixed(2) : "—"} />
          </div>
        </div>

        <div className="row2">
          <div>
            <label>Dispatch Date</label>
            <input type="date" value={dispatchDate} onChange={e => setDispatchDate(e.target.value)} />
          </div>
          <div>
            <label>Vehicle No.</label>
            <input type="text" placeholder="MH04 AB 1234"
              value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} />
          </div>
        </div>

        <label>Party Name</label>
        <input type="text" placeholder="Bridgestone India, MRF…"
          value={partyName} onChange={e => setPartyName(e.target.value)} />

        <label>Remark</label>
        <input type="text" placeholder="Additional note…"
          value={remark} onChange={e => setRemark(e.target.value)} />

        {/* Current balance preview */}
        {selectedItemId && (
          <div className="field-hint" style={{ marginTop: 8 }}>
            {selectedItem?.item_name} — {totalKg != null
              ? `Dispatching ${totalKg} kg`
              : "Bags aur kg/bag bharein"}
          </div>
        )}
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !selectedItemId || totalKg == null}
        onClick={handleDispatch}>
        {submitting ? "Save ho raha hai…" : "Dispatch record karein ✓"}
      </button>

      {/* Recent dispatches */}
      {recent.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>हाल के Dispatch (Last 20)</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="dash" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th style={{ textAlign: "right" }}>Dispatch (kg)</th>
                  <th style={{ textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(row => (
                  <tr key={row.id}>
                    <td>{fmtDate(row.transaction_date)}</td>
                    <td style={{ fontSize: 12 }}>{row.item_name ?? row.item_id.slice(0, 8)}</td>
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

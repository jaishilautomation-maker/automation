"use client";

// =============================================================================
// Stores Module -- JSCI A-20/1 (all English)
// Tabs: Oil Issue | Raw Material | Stock Ledger | Issue Slip | PRN | Dispatch
// NOTE: All display strings use plain ASCII only (no em-dash, minus sign,
//       ellipsis or other multi-byte Unicode) to prevent Turbopack parse errors.
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
type RmProduct = (typeof RM_PRODUCTS)[number];

const STATUS_OPTIONS = ["GOOD", "LOW", "LESS", "OUT OF STOCK"] as const;
type StockStatus = (typeof STATUS_OPTIONS)[number];

const PLANT_OPTIONS = ["A20/1", "A20", "NSK", "SNP"] as const;

const PRN_STATUS_LABEL: Record<PrnStatus, string> = {
  draft:        "Draft",
  submitted:    "Submitted",
  approved:     "Approved",
  ordered:      "Ordered",
  partial:      "Partial",
  fulfilled:    "Fulfilled",
  cancelled:    "Cancelled",
  auto_flagged: "Auto-flagged",
};

const OPEN_PRN_STATUSES: PrnStatus[] = [
  "draft","submitted","approved","ordered","partial","auto_flagged",
];

const CATEGORY_LABEL: Record<StockItemCategory, string> = {
  raw_material:       "Raw Material (RM)",
  finished_good:      "Finished Good (FG)",
  packaging_material: "Packing Material (PM)",
};

type Tab = "oil" | "rm" | "daily_prod" | "ledger" | "issue" | "prn" | "dispatch";

// ---------------------------------------------------------------------------
// Helpers -- plain ASCII only
// ---------------------------------------------------------------------------
function fmt(n: number | null | undefined, dec = 3): string {
  if (n == null) return "N/A";
  return n.toFixed(dec);
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const parts = iso.slice(0, 10).split("-");
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function nilText(s: string | null | undefined): string {
  return (s && s.trim()) ? s.trim() : "N/A";
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function StoresPage() {
  const [tab, setTab] = useState<Tab>("oil");

  const TABS: { id: Tab; label: string }[] = [
    { id: "oil",        label: "Oil Issue" },
    { id: "rm",         label: "Raw Material" },
    { id: "daily_prod", label: "Daily Production" },
    { id: "ledger",     label: "Stock Ledger" },
    { id: "issue",      label: "Issue Slip" },
    { id: "prn",        label: "PRN" },
    { id: "dispatch",   label: "Dispatch" },
  ];

  return (
    <div>
      <div style={{
        display: "flex", overflowX: "auto",
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
              borderBottom: tab === t.id
                ? "3px solid var(--clay)"
                : "3px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "oil"        && <OilIssueSection />}
      {tab === "rm"         && <RawMaterialSection />}
      {tab === "daily_prod" && <DailyProductionSection />}
      {tab === "ledger"     && <StockLedgerSection />}
      {tab === "issue"      && <IssueSlipSection />}
      {tab === "prn"        && <PrnSection />}
      {tab === "dispatch"   && <DispatchSection />}
    </div>
  );
}

// =============================================================================
// TAB 1 -- OIL ISSUE
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
      .eq("status", "pending_stores")
      .not("material_code", "is", null)
      .order("created_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setPending((data ?? []) as PulveriserJobCard[]);
    setLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const handleIssue = async () => {
    if (!active || !user) return;
    const n = Number(oilIssued);
    if (!Number.isFinite(n)) {
      showToast("Enter a valid oil quantity.", true); return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("pulveriser_job_cards")
        .update({
          oil_issued_kg: n,
          oil_issued_by: user.id,
          oil_issued_at: new Date().toISOString(),
          status: "pending",
        })
        .eq("id", active.id).select("id");
      if (error) { showToast("Save failed: " + error.message, true); return; }
      if (!data?.length) {
        showToast("Save blocked -- check factory access or card status.", true); return;
      }
      const nowISO = new Date().toISOString();
      const { subject, html } = buildStoresEmail({
        jobNumber: active.job_number,
        materialCode: active.material_code,
        oilRequiredKg: active.oil_required_kg,
        oilIssuedKg: n,
        submittedByName: profile?.full_name ?? "Unknown",
        submittedAt: nowISO,
      });
      void notifyEvent({
        eventType: "pulveriser_stores", subject, html,
        factoryId: active.factory_id, referenceId: active.id,
      });
      showToast("Oil issued -- operator can now run the batch.");
      setActive(null); setOilIssued(""); loadPending();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  if (active) {
    return (
      <>
        <button className="back-link" type="button"
          onClick={() => { setActive(null); setOilIssued(""); }}>
          Back to list
        </button>
        <div className="readonly-block">
          <b>{active.machine_number}</b> {fmtDate(active.job_date)} {active.shift ?? "N/A"} shift
          <br />
          <b>Batch:</b> {active.material_code} <b>Party/Code:</b> {active.party_code ?? "N/A"} Job: {active.job_number ?? "N/A"}
          <br />
          <b>Planned:</b> {active.planned_production_mt ?? "N/A"} MT{" "}
          <b>Oil required:</b>{" "}
          {active.oil_required_kg != null ? active.oil_required_kg + " kg" : "NA"}
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
          {submitting ? "Saving..." : "Issue Oil and Send to Operator"}
        </button>
      </>
    );
  }

  return (
    <div className="card">
      <h3>Job Cards Awaiting Oil Issue</h3>
      <div className="field-hint" style={{ marginBottom: 10 }}>
        Production has created these cards. Issue the required oil to open them for the operator.
      </div>
      {loading
        ? <div className="empty">Loading...</div>
        : pending.length === 0
          ? <div className="empty">No cards pending oil issue.</div>
          : groupByJobNumber(pending).map(group => (
            <div key={group.jobNumber ?? group.entries[0].id} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", margin: "4px 2px" }}>
                Job: {group.jobNumber ?? "N/A"}
                {group.entries.length > 1 ? " (" + group.entries.length + " entries)" : ""}
              </div>
              {group.entries.map((jc, i) => (
                <div className="pending-item" key={jc.id}
                  onClick={() => { setActive(jc); setOilIssued(jc.oil_issued_kg?.toString() ?? ""); }}>
                  <div className="pi-top">
                    <span>Entry {i + 1} {jc.machine_number} {fmtDate(jc.job_date)}</span>
                    <span>{jc.shift ?? "N/A"}</span>
                  </div>
                  <div className="pi-sub">
                    Batch: {jc.material_code} Party/Code: {jc.party_code ?? "N/A"}{" "}
                    Oil required: {jc.oil_required_kg != null ? jc.oil_required_kg + " kg" : "NA"}
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
// TAB 2 -- RAW MATERIAL
// DPR RM-style register matching the Excel RM tab columns exactly.
// =============================================================================
interface RmEntry {
  date: string;
  product: RmProduct | "";
  opening_balance: string;
  qty_received: string;
  material_return: string;
  qty_issued_prodn: string;
  qty_issued_bal: string;
  dispatch_as_is: string;
  closing_balance: number | null;
  status: StockStatus | "";
  remarks: string;
}

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

function computeRmClosing(e: RmEntry): number | null {
  const ob  = Number(e.opening_balance);
  const rcv = Number(e.qty_received);
  const ret = Number(e.material_return);
  const isp = Number(e.qty_issued_prodn);
  const isb = Number(e.qty_issued_bal);
  const dis = Number(e.dispatch_as_is);
  if ([ob, rcv, ret, isp, isb, dis].some(v => !Number.isFinite(v))) return null;
  return ob + rcv + ret - isp - isb - dis;
}

function blankRmEntry(): RmEntry {
  return {
    date: today(), product: "",
    opening_balance: "", qty_received: "", material_return: "",
    qty_issued_prodn: "", qty_issued_bal: "", dispatch_as_is: "",
    closing_balance: null, status: "", remarks: "",
  };
}

function RawMaterialSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [entry, setEntry]         = useState<RmEntry>(blankRmEntry());
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory]     = useState<SavedRmRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [filterProduct, setFilterProduct] = useState<RmProduct | "ALL">("ALL");

  const closing = computeRmClosing(entry);

  const setField = <K extends keyof RmEntry>(key: K, val: RmEntry[K]) => {
    setEntry(prev => {
      const next = { ...prev, [key]: val };
      return { ...next, closing_balance: computeRmClosing(next) };
    });
  };

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
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
        const p = JSON.parse(row.remark ?? "{}") as Partial<SavedRmRow>;
        rows.push({
          id: row.id, date: row.transaction_date,
          product: p.product ?? "",
          opening_balance:  p.opening_balance  ?? 0,
          qty_received:     p.qty_received     ?? 0,
          material_return:  p.material_return  ?? 0,
          qty_issued_prodn: p.qty_issued_prodn ?? 0,
          qty_issued_bal:   p.qty_issued_bal   ?? 0,
          dispatch_as_is:   p.dispatch_as_is   ?? 0,
          closing_balance:  p.closing_balance  ?? 0,
          status:           p.status           ?? "",
          remarks:          p.remarks          ?? "",
        });
      } catch { /* skip */ }
    }
    setHistory(rows); setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleProductChange = (product: RmProduct | "") => {
    const last = history.find(r => r.product === product);
    setEntry(prev => ({
      ...blankRmEntry(),
      date: prev.date,
      product,
      opening_balance: last ? String(last.closing_balance) : "",
    }));
  };

  const handleSave = async () => {
    if (!entry.product) { showToast("Select a product.", true); return; }
    if (closing == null) { showToast("Fill all numeric fields.", true); return; }
    if (!user) return;
    setSubmitting(true);
    try {
      const { data: itemData } = await supabase
        .from("stores_stock_items").select("id")
        .eq("category", "raw_material")
        .ilike("item_name", "%" + entry.product + "%")
        .limit(1).maybeSingle();
      const itemId = (itemData as { id: string } | null)?.id;
      if (!itemId) {
        showToast("No item found for \"" + entry.product + "\". Add it in Stock Ledger first.", true);
        setSubmitting(false); return;
      }
      const payload: SavedRmRow = {
        id: "",
        date: entry.date,
        product: entry.product,
        opening_balance:  Number(entry.opening_balance)  || 0,
        qty_received:     Number(entry.qty_received)     || 0,
        material_return:  Number(entry.material_return)  || 0,
        qty_issued_prodn: Number(entry.qty_issued_prodn) || 0,
        qty_issued_bal:   Number(entry.qty_issued_bal)   || 0,
        dispatch_as_is:   Number(entry.dispatch_as_is)   || 0,
        closing_balance:  closing,
        status: entry.status,
        remarks: entry.remarks,
      };
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id: itemId,
        transaction_date: entry.date,
        transaction_source: "manual",
        qty_received: payload.qty_received + payload.material_return,
        qty_issued:   payload.qty_issued_prodn + payload.qty_issued_bal,
        dispatch_qty: payload.dispatch_as_is,
        closing_balance: closing,
        reference_type: "rm_entry",
        remark: JSON.stringify(payload),
        entered_by: user.id,
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("Saved -- " + entry.product + " closing balance: " + closing.toFixed(3));
      setEntry(blankRmEntry());
      loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  const filtered = filterProduct === "ALL" ? history : history.filter(r => r.product === filterProduct);

  return (
    <>
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
              <option value="">-- Select product --</option>
              {RM_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

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

        <div className="row3">
          <div>
            <label>Qty Issued for Prodn</label>
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

        <div className="row3">
          <div>
            <label>Closing Balance</label>
            <input type="text" disabled
              value={closing != null ? closing.toFixed(3) : "N/A"}
              style={{
                fontWeight: 700,
                color: closing != null && closing < 0 ? "var(--warn)" : "var(--ok)",
              }} />
          </div>
          <div>
            <label>Status</label>
            <select value={entry.status}
              onChange={e => setField("status", e.target.value as StockStatus | "")}>
              <option value="">-- Select --</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label>Remarks</label>
            <input type="text" placeholder="Optional note..."
              value={entry.remarks}
              onChange={e => setField("remarks", e.target.value)} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !entry.product || closing == null}
        onClick={handleSave}>
        {submitting ? "Saving..." : "Save Entry"}
      </button>

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
        {histLoading
          ? <div className="empty">Loading...</div>
          : filtered.length === 0
            ? <div className="empty">No entries yet.</div>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="dash" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th style={{ textAlign: "right" }}>O/Bal</th>
                      <th style={{ textAlign: "right" }}>Qty Recd</th>
                      <th style={{ textAlign: "right" }}>Mat Return</th>
                      <th style={{ textAlign: "right" }}>Issued Prodn</th>
                      <th style={{ textAlign: "right" }}>Issued Bal</th>
                      <th style={{ textAlign: "right" }}>Dispatch</th>
                      <th style={{ textAlign: "right" }}>C/Bal</th>
                      <th>Status</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(row.date)}</td>
                        <td style={{ fontSize: 12, fontWeight: 600 }}>{row.product}</td>
                        <td style={{ textAlign: "right" }}>{fmt(row.opening_balance)}</td>
                        <td style={{ textAlign: "right", color: row.qty_received > 0 ? "var(--ok)" : undefined }}>
                          {row.qty_received > 0 ? "+" + fmt(row.qty_received) : "0"}
                        </td>
                        <td style={{ textAlign: "right", color: row.material_return > 0 ? "var(--ok)" : undefined }}>
                          {row.material_return > 0 ? "+" + fmt(row.material_return) : "0"}
                        </td>
                        <td style={{ textAlign: "right", color: row.qty_issued_prodn > 0 ? "var(--warn)" : undefined }}>
                          {row.qty_issued_prodn > 0 ? fmt(row.qty_issued_prodn) : "0"}
                        </td>
                        <td style={{ textAlign: "right", color: row.qty_issued_bal > 0 ? "var(--warn)" : undefined }}>
                          {row.qty_issued_bal > 0 ? fmt(row.qty_issued_bal) : "0"}
                        </td>
                        <td style={{ textAlign: "right", color: row.dispatch_as_is > 0 ? "var(--clay)" : undefined }}>
                          {row.dispatch_as_is > 0 ? fmt(row.dispatch_as_is) : "0"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700,
                          color: row.closing_balance < 0 ? "var(--warn)" : undefined }}>
                          {fmt(row.closing_balance)}
                        </td>
                        <td>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 6,
                            background: row.status === "GOOD" ? "var(--ok-soft)"
                              : row.status === "OUT OF STOCK" ? "var(--warn-soft)"
                              : row.status === "LESS" ? "#fff3cd"
                              : "var(--clay-soft)",
                            color: row.status === "GOOD" ? "var(--ok)"
                              : row.status === "OUT OF STOCK" ? "var(--warn)"
                              : row.status === "LESS" ? "#7d6608"
                              : "var(--clay)",
                          }}>
                            {row.status || "N/A"}
                          </span>
                        </td>
                        <td style={{ fontSize: 11, color: "var(--ink-soft)", maxWidth: 120 }}>
                          {nilText(row.remarks)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      </div>
    </>
  );
}

// =============================================================================
// TAB 3 -- DAILY PRODUCTION
//
// Mirrors the DAILY PRODN tab in the DPR Excel exactly.
// Columns (matching the Excel left-to-right):
//   Date | CEAT 108/EXPORT | M2615 | PLAIN-2615 | APOLLO 160108 | LANXESS |
//   CEAT R5299 | PLAIN/WE-10/S.A.EXPORT/Plain Lanxess | JKI-108 |
//   OLD BAGS (SHAKTI) | RUBBER MAKER 50 KG | Sulphur Powder (Gain Formulation) |
//   JUMBO BAG | Export Plan Bag W/O 25 Kg | TOTAL MT
//
// TOTAL MT formula (from the Excel cell P179):
//   = (B+C+D+E+F+G+H+N)*25/1000  [25 kg bags]
//   + (I+J+K+L)*50/1000           [50 kg bags]
//   + M*250/1000                  [250 kg jumbo bags]
//
// Each entry is one row per date. Saved to stores_stock_ledger with
// reference_type = 'daily_prod' and all fields packed as JSON in remark.
// =============================================================================

// Column definitions — drives both the form and the table header
interface DailyProdCol {
  key: string;
  label: string;        // full label for form
  shortLabel: string;   // abbreviated for table header
  bagKg: number;        // kg per bag (25, 50, or 250)
  colGroup: "25kg" | "50kg" | "250kg";
}

const DAILY_PROD_COLS: DailyProdCol[] = [
  { key: "ceat_108_export",     label: "CEAT 108 / EXPORT",                       shortLabel: "CEAT 108",    bagKg: 25,  colGroup: "25kg"  },
  { key: "m2615",               label: "M2615",                                    shortLabel: "M2615",       bagKg: 25,  colGroup: "25kg"  },
  { key: "plain_2615",          label: "PLAIN-2615",                               shortLabel: "PLAIN-2615",  bagKg: 25,  colGroup: "25kg"  },
  { key: "apollo_160108",       label: "APOLLO 160108",                            shortLabel: "APOLLO",      bagKg: 25,  colGroup: "25kg"  },
  { key: "lanxess",             label: "LANXESS",                                  shortLabel: "LANXESS",     bagKg: 25,  colGroup: "25kg"  },
  { key: "ceat_r5299",          label: "CEAT R5299",                               shortLabel: "CEAT R5299",  bagKg: 25,  colGroup: "25kg"  },
  { key: "plain_we10_sa",       label: "PLAIN / WE-10 / S.A. EXPORT / Plain Lanxess", shortLabel: "PLAIN/WE-10", bagKg: 25, colGroup: "25kg" },
  { key: "jki_108",             label: "JKI-108",                                  shortLabel: "JKI-108",     bagKg: 50,  colGroup: "50kg"  },
  { key: "old_bags_shakti",     label: "OLD BAGS (SHAKTI)",                        shortLabel: "OLD BAGS",    bagKg: 50,  colGroup: "50kg"  },
  { key: "rubber_maker_50kg",   label: "RUBBER MAKER 50 KG",                       shortLabel: "RUBBER 50",   bagKg: 50,  colGroup: "50kg"  },
  { key: "sulphur_gain",        label: "Sulphur Powder (Gain Formulation)",         shortLabel: "SUL GAIN",    bagKg: 50,  colGroup: "50kg"  },
  { key: "jumbo_bag",           label: "JUMBO BAG (500 KG)",                       shortLabel: "JUMBO",       bagKg: 250, colGroup: "250kg" },
  { key: "export_plan_25kg",    label: "Export Plan Bag W/O 25 Kg",                shortLabel: "EXP PLAN",    bagKg: 25,  colGroup: "25kg"  },
];

// Keys that use 25 kg bags (B,C,D,E,F,G,H,N in the Excel)
const BAGS_25KG = ["ceat_108_export","m2615","plain_2615","apollo_160108","lanxess","ceat_r5299","plain_we10_sa","export_plan_25kg"];
// Keys that use 50 kg bags (I,J,K,L)
const BAGS_50KG = ["jki_108","old_bags_shakti","rubber_maker_50kg","sulphur_gain"];
// Keys that use 250 kg bags (M)
const BAGS_250KG = ["jumbo_bag"];

type DailyProdRow = Record<string, string> & { date: string };

interface SavedDailyProdRow {
  id: string;
  date: string;
  values: Record<string, number>;
  total_mt: number;
}

/** Excel formula: (B+C+D+E+F+G+H+N)*25/1000 + (I+J+K+L)*50/1000 + M*250/1000 */
function calcTotalMt(vals: Record<string, string>): number {
  const n = (k: string) => Number(vals[k]) || 0;

  const sum25 = BAGS_25KG.reduce((s, k) => s + n(k), 0);
  const sum50 = BAGS_50KG.reduce((s, k) => s + n(k), 0);
  const sum250 = BAGS_250KG.reduce((s, k) => s + n(k), 0);

  return (sum25 * 25) / 1000 + (sum50 * 50) / 1000 + (sum250 * 250) / 1000;
}

function blankDailyProdRow(): DailyProdRow {
  const row: DailyProdRow = { date: today() };
  DAILY_PROD_COLS.forEach(c => { row[c.key] = ""; });
  return row;
}

function DailyProductionSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [entry, setEntry]           = useState<DailyProdRow>(blankDailyProdRow());
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory]       = useState<SavedDailyProdRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);

  // Compute total MT live from current entry
  const totalMt = calcTotalMt(entry);

  const setField = (key: string, val: string) => {
    setEntry(prev => ({ ...prev, [key]: val }));
  };

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("id, transaction_date, remark")
      .eq("reference_type", "daily_prod")
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(90);  // ~3 months of daily entries

    if (error) {
      showToast("Could not load history: " + error.message, true);
      setHistLoading(false);
      return;
    }

    const rows: SavedDailyProdRow[] = [];
    for (const row of (data ?? []) as { id: string; transaction_date: string; remark: string | null }[]) {
      try {
        const p = JSON.parse(row.remark ?? "{}") as { values?: Record<string, number>; total_mt?: number };
        rows.push({
          id: row.id,
          date: row.transaction_date,
          values: p.values ?? {},
          total_mt: p.total_mt ?? 0,
        });
      } catch { /* skip */ }
    }
    setHistory(rows);
    setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSave = async () => {
    if (!entry.date) { showToast("Enter a date.", true); return; }
    if (!user) return;

    // Check at least one column has a value
    const hasAny = DAILY_PROD_COLS.some(c => Number(entry[c.key]) > 0);
    if (!hasAny) { showToast("Enter at least one production quantity.", true); return; }

    setSubmitting(true);
    try {
      // We need an item_id FK — use any active item as a placeholder anchor.
      // Daily production entries are keyed by reference_type='daily_prod' not by item.
      // Use a dummy lookup: find the first active FG item for this factory.
      // If none found, we cannot insert (ledger requires item_id). Show helpful error.
      const { data: itemData } = await supabase
        .from("stores_stock_items")
        .select("id, factory_id")
        .eq("is_active", true)
        .eq("category", "finished_good")
        .limit(1)
        .maybeSingle();

      if (!itemData) {
        showToast("No stock items found. Run migrations 027 and 031 in Supabase first.", true);
        setSubmitting(false);
        return;
      }

      const numericVals: Record<string, number> = {};
      DAILY_PROD_COLS.forEach(c => {
        numericVals[c.key] = Number(entry[c.key]) || 0;
      });

      const payload = {
        date:     entry.date,
        values:   numericVals,
        total_mt: totalMt,
      };

      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id:            itemData.id,
        factory_id:         itemData.factory_id,
        transaction_date:   entry.date,
        transaction_source: "manual",
        qty_received:       0,
        qty_issued:         0,
        dispatch_qty:       0,
        closing_balance:    0,      // daily prod entry — not a stock movement
        reference_type:     "daily_prod",
        remark:             JSON.stringify(payload),
        entered_by:         user.id,
      });

      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("Daily production saved -- " + entry.date + " Total MT: " + totalMt.toFixed(3));
      setEntry(blankDailyProdRow());
      loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  // Column totals for the TOTAL row in history
  const colTotals: Record<string, number> = {};
  DAILY_PROD_COLS.forEach(c => {
    colTotals[c.key] = history.reduce((s, r) => s + (r.values[c.key] ?? 0), 0);
  });
  const grandTotalMt = history.reduce((s, r) => s + r.total_mt, 0);

  return (
    <>
      {/* ── Entry form ── */}
      <div className="card">
        <h3>Daily Production Entry</h3>

        <div style={{ marginBottom: 12 }}>
          <label>Date *</label>
          <input type="date" value={entry.date}
            onChange={e => setField("date", e.target.value)}
            style={{ maxWidth: 200 }} />
        </div>

        {/* 25 kg bag columns */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--clay)",
          textTransform: "uppercase", marginBottom: 4, marginTop: 8 }}>
          25 kg Bags
        </div>
        <div className="row2">
          {DAILY_PROD_COLS.filter(c => c.colGroup === "25kg").map(col => (
            <div key={col.key}>
              <label style={{ fontSize: 11 }}>{col.label}</label>
              <input type="number" min="0" step="1" placeholder="0"
                value={entry[col.key]}
                onChange={e => setField(col.key, e.target.value)} />
            </div>
          ))}
        </div>

        {/* 50 kg bag columns */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--clay)",
          textTransform: "uppercase", marginBottom: 4, marginTop: 12 }}>
          50 kg Bags
        </div>
        <div className="row2">
          {DAILY_PROD_COLS.filter(c => c.colGroup === "50kg").map(col => (
            <div key={col.key}>
              <label style={{ fontSize: 11 }}>{col.label}</label>
              <input type="number" min="0" step="1" placeholder="0"
                value={entry[col.key]}
                onChange={e => setField(col.key, e.target.value)} />
            </div>
          ))}
        </div>

        {/* 250 kg bag column */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--clay)",
          textTransform: "uppercase", marginBottom: 4, marginTop: 12 }}>
          250 kg Bags (Jumbo)
        </div>
        <div style={{ maxWidth: 220 }}>
          {DAILY_PROD_COLS.filter(c => c.colGroup === "250kg").map(col => (
            <div key={col.key}>
              <label style={{ fontSize: 11 }}>{col.label}</label>
              <input type="number" min="0" step="1" placeholder="0"
                value={entry[col.key]}
                onChange={e => setField(col.key, e.target.value)} />
            </div>
          ))}
        </div>

        {/* Total MT (computed live) */}
        <div style={{
          marginTop: 14, padding: "12px 16px",
          background: "var(--clay-soft)", borderRadius: 8,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>TOTAL MT</span>
          <span style={{ fontWeight: 700, fontSize: 20, color: "var(--clay)" }}>
            {totalMt.toFixed(3)} MT
          </span>
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>
          Formula: (25 kg cols x 25 + 50 kg cols x 50 + JUMBO x 250) / 1000
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting} onClick={handleSave}>
        {submitting ? "Saving..." : "Save Daily Production"}
      </button>

      {/* ── History table ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Daily Production History</h3>
        {histLoading
          ? <div className="empty">Loading...</div>
          : history.length === 0
            ? <div className="empty">No entries yet.</div>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="dash" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      {DAILY_PROD_COLS.map(c => (
                        <th key={c.key} style={{ textAlign: "right", fontSize: 10 }}>
                          {c.shortLabel}
                          <div style={{ fontWeight: 400, color: "var(--ink-soft)" }}>
                            {c.bagKg}kg
                          </div>
                        </th>
                      ))}
                      <th style={{ textAlign: "right", color: "var(--clay)" }}>
                        TOTAL MT
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                          {fmtDate(row.date)}
                        </td>
                        {DAILY_PROD_COLS.map(c => (
                          <td key={c.key} style={{ textAlign: "right" }}>
                            {row.values[c.key] > 0
                              ? row.values[c.key].toFixed(0)
                              : <span style={{ color: "var(--line)" }}>-</span>}
                          </td>
                        ))}
                        <td style={{ textAlign: "right", fontWeight: 700,
                          color: "var(--clay)" }}>
                          {row.total_mt.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                    {/* TOTAL row */}
                    <tr style={{ borderTop: "2px solid var(--line)",
                      background: "var(--clay-soft)" }}>
                      <td style={{ fontWeight: 700 }}>TOTAL</td>
                      {DAILY_PROD_COLS.map(c => (
                        <td key={c.key} style={{ textAlign: "right", fontWeight: 700 }}>
                          {colTotals[c.key] > 0 ? colTotals[c.key].toFixed(0) : "-"}
                        </td>
                      ))}
                      <td style={{ textAlign: "right", fontWeight: 700,
                        color: "var(--clay)", fontSize: 14 }}>
                        {grandTotalMt.toFixed(3)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
        }
      </div>
    </>
  );
}

// =============================================================================
// TAB 4 -- STOCK LEDGER
// =============================================================================
function StockLedgerSection() {
  const { showToast } = useToast();
  const supabase = createClient();

  const [items, setItems]         = useState<StoresStockItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filterCat, setFilterCat] = useState<StockItemCategory | "all">("all");
  const [activeItem, setActiveItem] = useState<StoresStockItem | null>(null);
  const [ledger, setLedger]       = useState<StoresStockLedger[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [balances, setBalances]   = useState<Record<string, number>>({});

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
    const below = activeItem.min_threshold != null && bal < activeItem.min_threshold;
    return (
      <>
        <button className="back-link" type="button"
          onClick={() => { setActiveItem(null); setLedger([]); }}>
          Back to Stock List
        </button>
        <div className="readonly-block">
          <b>{activeItem.item_name}</b> ({activeItem.item_code})
          <br />
          {CATEGORY_LABEL[activeItem.category]} Unit: {activeItem.unit}
          <br />
          <b>Current Balance: {fmt(bal, 3)} {activeItem.unit}</b>
          {activeItem.min_threshold != null && (
            <span style={{ marginLeft: 10, fontWeight: 700,
              color: below ? "var(--warn)" : "var(--ok)" }}>
              {below ? "Below threshold" : "OK"} (min {activeItem.min_threshold})
            </span>
          )}
        </div>
        <div className="card">
          <h3>Ledger History (last 50)</h3>
          {ledgerLoading
            ? <div className="empty">Loading...</div>
            : ledger.length === 0
              ? <div className="empty">No transactions yet.</div>
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
                            {row.transaction_source === "manual" ? "Manual"
                              : row.transaction_source === "production_fg" ? "Production FG"
                              : row.transaction_source === "production_rm_oil" ? "Auto Oil"
                              : row.transaction_source === "production_rm_sul" ? "Auto Sulphur"
                              : "Dispatch"}
                          </td>
                          <td style={{ textAlign: "right",
                            color: row.qty_received > 0 ? "var(--ok)" : undefined }}>
                            {row.qty_received > 0 ? "+" + fmt(row.qty_received) : "0"}
                          </td>
                          <td style={{ textAlign: "right",
                            color: row.qty_issued > 0 ? "var(--warn)" : undefined }}>
                            {row.qty_issued > 0 ? fmt(row.qty_issued) : "0"}
                          </td>
                          <td style={{ textAlign: "right",
                            color: row.dispatch_qty > 0 ? "var(--clay)" : undefined }}>
                            {row.dispatch_qty > 0 ? fmt(row.dispatch_qty) : "0"}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700 }}>
                            {fmt(row.closing_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          }
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
            className={"chip" + (filterCat === cat ? " selected" : "")}
            onClick={() => setFilterCat(cat)}>
            {cat === "all" ? "All" : CATEGORY_LABEL[cat]}
          </button>
        ))}
      </div>
      {loading
        ? <div className="empty">Loading...</div>
        : filtered.length === 0
          ? <div className="empty">No items found.</div>
          : filtered.map(item => {
            const bal = balances[item.id] ?? null;
            const below = bal != null && item.min_threshold != null && bal < item.min_threshold;
            return (
              <div key={item.id} className="pending-item" onClick={() => openItem(item)}>
                <div className="pi-top">
                  <span style={{ fontWeight: 700 }}>{item.item_name}</span>
                  <span style={{ fontWeight: 700, fontSize: 15,
                    color: below ? "var(--warn)" : "var(--ok)" }}>
                    {bal != null ? fmt(bal, 2) + " " + item.unit : "N/A"}
                  </span>
                </div>
                <div className="pi-sub">
                  {CATEGORY_LABEL[item.category]} Code: {item.item_code}
                  {below
                    ? <span style={{ color: "var(--warn)", fontWeight: 700, marginLeft: 8 }}>
                        Below min ({item.min_threshold})
                      </span>
                    : null}
                </div>
              </div>
            );
          })
      }
    </>
  );
}

// =============================================================================
// TAB 4 -- ISSUE SLIP
//
// Fields matching the physical JSCI/STORE/02 form:
//   No. | Plant | Date | Material Description | Unit |
//   Quantity Required | Quantity Issued | Used For | Remaining | Remark
//
// Remaining = current stock balance - Quantity Issued (computed live).
// =============================================================================

interface SlipPayload {
  slip_no: string;
  plant: string;
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
  const [slipNo, setSlipNo]           = useState("");
  const [plant, setPlant]             = useState("");
  const [slipDate, setSlipDate]       = useState(today());
  const [qtyRequired, setQtyRequired] = useState("");
  const [qtyIssued, setQtyIssued]     = useState("");
  const [usedFor, setUsedFor]         = useState("");
  const [remark, setRemark]           = useState("");
  const [submitting, setSubmitting]   = useState(false);

  // History
  const [recentSlips, setRecentSlips] = useState<SlipPayload[]>([]);
  const [histLoading, setHistLoading] = useState(true);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("stores_stock_items").select("*")
      .eq("is_active", true)
      .in("category", ["raw_material", "packaging_material"])
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

  const handleItemChange = async (itemId: string) => {
    setSelectedItemId(itemId);
    setCurrentBalance(null);
    if (!itemId) return;
    const { data } = await supabase
      .from("stores_stock_ledger")
      .select("closing_balance")
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    setCurrentBalance((data as { closing_balance: number } | null)?.closing_balance ?? 0);
  };

  const selectedItem   = items.find(i => i.id === selectedItemId);
  const qtyIssuedNum   = Number(qtyIssued);
  const qtyRequiredNum = Number(qtyRequired);
  const remaining      = currentBalance != null && Number.isFinite(qtyIssuedNum) && qtyIssuedNum >= 0
    ? currentBalance - qtyIssuedNum
    : null;

  const reset = () => {
    setSelectedItemId(""); setCurrentBalance(null);
    setSlipNo(""); setPlant(""); setSlipDate(today());
    setQtyRequired(""); setQtyIssued(""); setUsedFor(""); setRemark("");
  };

  const handleIssue = async () => {
    if (!selectedItemId || !qtyIssued.trim() || !user) {
      showToast("Select a material and enter Quantity Issued.", true); return;
    }
    if (!Number.isFinite(qtyIssuedNum) || qtyIssuedNum <= 0) {
      showToast("Enter a valid Quantity Issued (greater than 0).", true); return;
    }
    setSubmitting(true);
    try {
      const prevBal = currentBalance ?? 0;
      const newBal  = prevBal - qtyIssuedNum;

      const payload: SlipPayload = {
        slip_no:              slipNo.trim(),
        plant:                plant,
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
      showToast(
        "Issued -- " + payload.material_description +
        " " + qtyIssuedNum + " " + payload.unit +
        ". Remaining: " + newBal.toFixed(3)
      );
      reset();
      loadSlips();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <div className="card">
        <h3>Material Issue Slip</h3>

        {/* Row 1: No. | Plant | Date */}
        <div className="row3">
          <div>
            <label>No.</label>
            <input type="text" placeholder="e.g. 2236"
              value={slipNo} onChange={e => setSlipNo(e.target.value)} />
          </div>
          <div>
            <label>Plant</label>
            <select value={plant} onChange={e => setPlant(e.target.value)}>
              <option value="">-- Select plant --</option>
              {PLANT_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label>Date</label>
            <input type="date" value={slipDate}
              onChange={e => setSlipDate(e.target.value)} />
          </div>
        </div>

        {/* Row 2: Material Description | Unit */}
        <div className="row2">
          <div>
            <label>Material Description *</label>
            {loading
              ? <div className="field-hint">Loading...</div>
              : (
                <select value={selectedItemId} onChange={e => handleItemChange(e.target.value)}>
                  <option value="">-- Select material --</option>
                  {(["raw_material", "packaging_material"] as StockItemCategory[]).map(cat => (
                    <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                      {items.filter(i => i.category === cat).map(item => (
                        <option key={item.id} value={item.id}>{item.item_name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )
            }
          </div>
          <div>
            <label>Unit</label>
            <input type="text" disabled
              value={selectedItem?.unit ?? "N/A"}
              placeholder="kg / nos / L..." />
          </div>
        </div>

        {/* Row 3: Qty Required | Qty Issued | Used For */}
        <div className="row3">
          <div>
            <label>Quantity Required</label>
            <input type="number" min="0" step="0.001" placeholder="0"
              value={qtyRequired} onChange={e => setQtyRequired(e.target.value)} />
          </div>
          <div>
            <label>Quantity Issued *</label>
            <input type="number" min="0.001" step="0.001" placeholder="0"
              value={qtyIssued} onChange={e => setQtyIssued(e.target.value)} />
          </div>
          <div>
            <label>Used For (Batch / Job No.)</label>
            <input type="text" placeholder="e.g. Batch 348, Job 301"
              value={usedFor} onChange={e => setUsedFor(e.target.value)} />
          </div>
        </div>

        {/* Row 4: Remaining (computed) | Remark */}
        <div className="row2">
          <div>
            <label>Remaining</label>
            <input type="text" disabled
              value={remaining != null ? remaining.toFixed(3) : "N/A"}
              style={{
                fontWeight: 700,
                color: remaining != null && remaining < 0 ? "var(--warn)" : "var(--ok)",
              }} />
            {currentBalance != null && (
              <div className="field-hint">
                Current stock: {currentBalance.toFixed(3)} {selectedItem?.unit ?? ""}
              </div>
            )}
          </div>
          <div>
            <label>Remark</label>
            <input type="text" placeholder="Additional note..."
              value={remark} onChange={e => setRemark(e.target.value)} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !selectedItemId || !qtyIssued.trim()}
        onClick={handleIssue}>
        {submitting ? "Saving..." : "Issue Material"}
      </button>

      {/* History table */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Issue Slip History (Last 30)</h3>
        {histLoading
          ? <div className="empty">Loading...</div>
          : recentSlips.length === 0
            ? <div className="empty">No slips recorded yet.</div>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="dash" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>No.</th>
                      <th>Plant</th>
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
                        <td style={{ fontSize: 12 }}>{nilText(row.slip_no)}</td>
                        <td style={{ fontSize: 12 }}>{nilText(row.plant)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(row.date)}</td>
                        <td style={{ fontWeight: 600, fontSize: 12 }}>{row.material_description}</td>
                        <td style={{ fontSize: 12 }}>{row.unit}</td>
                        <td style={{ textAlign: "right" }}>
                          {row.qty_required > 0 ? fmt(row.qty_required) : "0"}
                        </td>
                        <td style={{ textAlign: "right", color: "var(--warn)", fontWeight: 700 }}>
                          {fmt(row.qty_issued)}
                        </td>
                        <td style={{ fontSize: 12 }}>{nilText(row.used_for)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700,
                          color: row.remaining < 0 ? "var(--warn)" : undefined }}>
                          {fmt(row.remaining)}
                        </td>
                        <td style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                          {nilText(row.remark)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      </div>
    </>
  );
}

// =============================================================================
// TAB 5 -- PRN
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
      ...r,
      item_name: (r.stores_stock_items as { item_name: string } | null)?.item_name,
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
      const prnNum = "PRN-" + new Date().toISOString().slice(0,10).replace(/-/g,"") +
        "-" + String(Math.floor(Math.random() * 9000 + 1000));
      const { error } = await supabase.from("purchase_requisitions").insert({
        item_id: selectedItemId, prn_number: prnNum, status: "draft",
        po_qty: poQty.trim() ? Number(poQty) : null, received_qty: 0,
        preferred_supplier: supplier.trim() || null,
        required_by_date: requiredBy || null,
        reason: reason.trim() || null,
        raised_by: user.id, raised_at: new Date().toISOString(),
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("PRN " + prnNum + " created.");
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
      showToast("Enter a valid quantity.", true); return;
    }
    const newReceived = (activePrn.received_qty ?? 0) + addQty;
    const newStatus: PrnStatus =
      (activePrn.po_qty ?? 0) > 0 && newReceived >= (activePrn.po_qty ?? 0)
        ? "fulfilled" : "partial";
    setSubmitting(true);
    try {
      const { error } = await supabase.from("purchase_requisitions")
        .update({ received_qty: newReceived, status: newStatus })
        .eq("id", activePrn.id);
      if (error) { showToast("Update failed: " + error.message, true); return; }
      showToast("Received qty updated -- total " + newReceived + " (" + newStatus + ")");
      setReceiveQty("");
      setActivePrn({ ...activePrn, received_qty: newReceived, status: newStatus });
      loadPrns();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  if (view === "detail" && activePrn) {
    const pending = activePrn.po_qty != null
      ? activePrn.po_qty - (activePrn.received_qty ?? 0)
      : null;
    return (
      <>
        <button className="back-link" type="button"
          onClick={() => { setView("list"); setActivePrn(null); setReceiveQty(""); }}>
          Back to PRN List
        </button>
        <div className="card">
          <h3>PRN Detail</h3>
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            <b>PRN No.:</b> {activePrn.prn_number ?? "N/A"}<br />
            <b>Item:</b> {activePrn.item_name ?? activePrn.item_id.slice(0,8)}<br />
            <b>Status:</b>{" "}
            <span style={{ fontWeight: 700,
              color: activePrn.status === "auto_flagged" ? "var(--warn)" : "var(--ok)" }}>
              {PRN_STATUS_LABEL[activePrn.status]}
            </span><br />
            <b>PO Qty:</b> {activePrn.po_qty ?? "N/A"}{" "}
            <b>Received:</b> {activePrn.received_qty ?? 0}<br />
            <b>Pending:</b>{" "}
            <span style={{ fontWeight: 700,
              color: (pending ?? 0) > 0 ? "var(--warn)" : "var(--ok)" }}>
              {pending ?? "N/A"}
            </span><br />
            <b>Supplier:</b> {activePrn.preferred_supplier ?? "N/A"}{" "}
            <b>Required by:</b> {fmtDate(activePrn.required_by_date)}<br />
            <b>Reason:</b> {activePrn.reason ?? "N/A"}<br />
            {activePrn.auto_flagged_balance != null &&
              <><b>Auto-flagged balance:</b> {activePrn.auto_flagged_balance}<br /></>}
            <b>Raised:</b> {fmtDate(activePrn.raised_at)}
          </div>
        </div>
        {!["fulfilled","cancelled"].includes(activePrn.status) && (
          <div className="card">
            <h3>Record Delivery</h3>
            <label>Qty received in this delivery</label>
            <input type="number" min="0.001" step="0.001" placeholder="0"
              value={receiveQty} onChange={e => setReceiveQty(e.target.value)} />
            <div className="field-hint">
              Received so far: {activePrn.received_qty ?? 0}{" "}
              Pending: {pending ?? "N/A"}
            </div>
            <button className="btn btn-primary" type="button" style={{ marginTop: 10 }}
              disabled={submitting || !receiveQty.trim()}
              onClick={handleUpdateReceived}>
              {submitting ? "Updating..." : "Update Received Qty"}
            </button>
          </div>
        )}
        {!["fulfilled","cancelled"].includes(activePrn.status) && (
          <button className="btn btn-ghost" type="button"
            style={{ color: "var(--warn)", marginTop: 4 }}
            onClick={async () => {
              if (!confirm("Cancel PRN " + (activePrn.prn_number ?? "") + "?")) return;
              await supabase.from("purchase_requisitions")
                .update({ status: "cancelled" }).eq("id", activePrn.id);
              showToast("PRN cancelled.");
              setView("list"); loadPrns();
            }}>
            Cancel PRN
          </button>
        )}
      </>
    );
  }

  if (view === "create") {
    return (
      <>
        <button className="back-link" type="button" onClick={() => setView("list")}>
          Back to PRN List
        </button>
        <div className="card">
          <h3>Create New PRN</h3>
          <label>Item *</label>
          <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)}>
            <option value="">-- Select item --</option>
            {(["raw_material","packaging_material","finished_good"] as StockItemCategory[]).map(cat => (
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
          <input type="text" placeholder="Supplier name..."
            value={supplier} onChange={e => setSupplier(e.target.value)} />
          <label>Reason / Note</label>
          <textarea rows={2} placeholder="Why is this needed..."
            value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="button"
          disabled={submitting || !selectedItemId} onClick={handleCreate}>
          {submitting ? "Saving..." : "Create PRN"}
        </button>
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 12 }}>
        <div className="chip-group" style={{ margin: 0 }}>
          {(["open","all"] as const).map(f => (
            <button key={f} type="button"
              className={"chip" + (filterStatus === f ? " selected" : "")}
              onClick={() => setFilterStatus(f)}>
              {f === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary"
          style={{ width: "auto", padding: "8px 16px", marginTop: 0 }}
          onClick={() => setView("create")}>
          + New PRN
        </button>
      </div>
      {loading
        ? <div className="empty">Loading...</div>
        : prns.length === 0
          ? <div className="empty">No PRNs found.</div>
          : prns.map(prn => {
            const pending = prn.po_qty != null
              ? prn.po_qty - (prn.received_qty ?? 0)
              : null;
            return (
              <div key={prn.id} className="pending-item"
                onClick={() => { setActivePrn(prn); setView("detail"); }}>
                <div className="pi-top">
                  <span>{prn.item_name ?? prn.item_id.slice(0,8)}</span>
                  <span style={{ fontSize: 11, fontWeight: 700,
                    color: prn.status === "auto_flagged" ? "var(--warn)"
                      : prn.status === "fulfilled" ? "var(--ok)"
                      : "var(--ink-soft)" }}>
                    {PRN_STATUS_LABEL[prn.status]}
                  </span>
                </div>
                <div className="pi-sub">
                  {prn.prn_number ?? "N/A"} PO: {prn.po_qty ?? "?"}{" "}
                  Received: {prn.received_qty ?? 0}
                  {pending != null
                    ? <b style={{ color: pending > 0 ? "var(--warn)" : "var(--ok)",
                        marginLeft: 4 }}>
                        Pending: {pending}
                      </b>
                    : null}
                  {prn.preferred_supplier ? " " + prn.preferred_supplier : ""}
                </div>
              </div>
            );
          })
      }
    </>
  );
}

// =============================================================================
// TAB 6 -- DISPATCH
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
      .select("*, stores_stock_items(item_name)")
      .eq("transaction_source", "dispatch")
      .order("created_at", { ascending: false }).limit(20);
    if (data) setRecent(data.map((r: Record<string, unknown>) => ({
      ...r,
      item_name: (r.stores_stock_items as { item_name: string } | null)?.item_name,
    })) as (StoresStockLedger & { item_name?: string })[]);
  }, [supabase]);

  useEffect(() => { loadItems(); loadRecent(); }, [loadItems, loadRecent]);

  const selectedItem = items.find(i => i.id === selectedItemId);
  const bagsNum = Number(bags);
  const kgNum   = Number(kgPerBag);
  const totalKg = Number.isFinite(bagsNum) && Number.isFinite(kgNum) && bagsNum > 0 && kgNum > 0
    ? bagsNum * kgNum : null;

  const handleDispatch = async () => {
    if (!selectedItemId || !bags.trim() || !user || totalKg == null) {
      showToast("Select item, enter bags and kg per bag.", true); return;
    }
    setSubmitting(true);
    try {
      const { data: last } = await supabase.from("stores_stock_ledger")
        .select("closing_balance").eq("item_id", selectedItemId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const prevBal = (last as { closing_balance: number } | null)?.closing_balance ?? 0;
      const newBal  = prevBal - totalKg;
      const parts = [
        partyName.trim() ? "Party: " + partyName.trim() : "",
        vehicleNo.trim() ? "Vehicle: " + vehicleNo.trim() : "",
        bagsNum + " bags x " + kgNum + " kg",
        remark.trim(),
      ].filter(Boolean);
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id: selectedItemId,
        transaction_date: dispatchDate,
        transaction_source: "dispatch",
        qty_received: 0, qty_issued: 0,
        dispatch_qty: totalKg,
        closing_balance: newBal,
        reference_type: "dispatch",
        remark: parts.join(" | ") || null,
        entered_by: user.id,
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast(
        "Dispatch recorded -- " + (selectedItem?.item_name ?? "") +
        " " + bagsNum + " bags (" + totalKg + " kg). Balance: " + newBal.toFixed(2) + " kg"
      );
      setSelectedItemId(""); setBags(""); setVehicleNo(""); setPartyName(""); setRemark("");
      loadRecent(); loadItems();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <div className="card">
        <h3>Record FG Dispatch</h3>
        <label>Finished Good Item *</label>
        {loading
          ? <div className="field-hint">Loading...</div>
          : (
            <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)}>
              <option value="">-- Select item --</option>
              {items.map(item => (
                <option key={item.id} value={item.id}>
                  {item.item_name} ({item.item_code})
                </option>
              ))}
            </select>
          )
        }
        <div className="row3">
          <div>
            <label>Bags *</label>
            <input type="number" min="1" step="1" placeholder="0"
              value={bags} onChange={e => setBags(e.target.value)} />
          </div>
          <div>
            <label>Kg / Bag</label>
            <input type="number" min="0.1" step="0.1" placeholder="25"
              value={kgPerBag} onChange={e => setKgPerBag(e.target.value)} />
          </div>
          <div>
            <label>Total Kg</label>
            <input type="text" disabled
              value={totalKg != null ? totalKg.toFixed(2) : "N/A"} />
          </div>
        </div>
        <div className="row2">
          <div>
            <label>Dispatch Date</label>
            <input type="date" value={dispatchDate}
              onChange={e => setDispatchDate(e.target.value)} />
          </div>
          <div>
            <label>Vehicle No.</label>
            <input type="text" placeholder="MH04 AB 1234"
              value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} />
          </div>
        </div>
        <label>Party Name</label>
        <input type="text" placeholder="Bridgestone India, MRF..."
          value={partyName} onChange={e => setPartyName(e.target.value)} />
        <label>Remark</label>
        <input type="text" placeholder="Additional note..."
          value={remark} onChange={e => setRemark(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="button"
        disabled={submitting || !selectedItemId || totalKg == null}
        onClick={handleDispatch}>
        {submitting ? "Saving..." : "Record Dispatch"}
      </button>
      {recent.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Recent Dispatches (Last 20)</h3>
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
                    <td style={{ fontSize: 12 }}>
                      {row.item_name ?? row.item_id.slice(0,8)}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--clay)" }}>
                      {fmt(row.dispatch_qty)}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                      {fmt(row.closing_balance)}
                    </td>
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

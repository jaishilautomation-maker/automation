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

type Tab = "oil" | "job_cards" | "rm" | "received" | "supplied" | "daily_prod" | "daily_dispatch" | "packing_material" | "finished_goods" | "ball_mill" | "batch_wise" | "ledger" | "issue" | "prn" | "dispatch";

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
    { id: "job_cards",        label: "Job Cards" },
    { id: "oil",              label: "Oil Issue" },
    { id: "rm",               label: "Raw Material" },
    { id: "received",         label: "Received" },
    { id: "supplied",         label: "Supplied" },
    { id: "daily_prod",       label: "Daily Production" },
    { id: "daily_dispatch",   label: "Daily Dispatch" },
    { id: "packing_material", label: "Packing Material" },
    { id: "finished_goods",   label: "Finished Goods" },
    { id: "ball_mill",        label: "Ball Mill" },
    { id: "batch_wise",       label: "Batch Wise" },
    { id: "ledger",           label: "Stock Ledger" },
    { id: "issue",            label: "Issue Slip" },
    { id: "prn",              label: "PRN" },
    { id: "dispatch",         label: "Dispatch" },
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

      {tab === "job_cards"      && <JobCardsSection onGoToTab={setTab} />}
      {tab === "oil"            && <OilIssueSection />}
      {tab === "rm"             && <RawMaterialSection />}
      {tab === "received"   && <ReceivedSection />}
      {tab === "supplied"   && <SuppliedSection />}
      {tab === "daily_prod"     && <DailyProductionSection />}
      {tab === "daily_dispatch"   && <DailyDispatchSection />}
      {tab === "packing_material" && <PackingMaterialSection />}
      {tab === "finished_goods"   && <FinishedGoodsSection />}
      {tab === "ball_mill"        && <BallMillSection />}
      {tab === "batch_wise"       && <BatchWiseSection />}
      {tab === "ledger"           && <StockLedgerSection />}
      {tab === "issue"      && <IssueSlipSection />}
      {tab === "prn"        && <PrnSection />}
      {tab === "dispatch"   && <DispatchSection />}
    </div>
  );
}

// =============================================================================
// TAB 0 -- JOB CARDS FROM PRODUCTION
//
// Shows ALL pulveriser job cards that Production has created, grouped by status.
// Stores can see everything Production filled in without re-entering any data.
// From here Stores can:
//   1. Issue oil (jumps to Oil Issue tab with the card pre-selected)
//   2. Create a pre-filled Material Issue Slip for sulphur or oil
//   3. View finalized cards for reference
//
// Status filter: Pending Stores (action needed) | All Recent
// =============================================================================
function JobCardsSection({ onGoToTab }: { onGoToTab: (t: Tab) => void }) {
  const { showToast } = useToast();
  const supabase = createClient();

  const [cards, setCards]         = useState<PulveriserJobCard[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<"pending" | "all">("pending");
  const [selected, setSelected]   = useState<PulveriserJobCard | null>(null);

  const loadCards = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("pulveriser_job_cards")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter === "pending") {
      q = q.eq("status", "pending_stores");
    }
    const { data, error } = await q;
    if (error) showToast("Could not load job cards: " + error.message, true);
    else setCards((data ?? []) as PulveriserJobCard[]);
    setLoading(false);
  }, [supabase, showToast, filter]);

  useEffect(() => { loadCards(); }, [loadCards]);

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      pending_stores:   { label: "Pending Stores",  color: "var(--warn)",  bg: "var(--warn-soft)" },
      pending:          { label: "Pending Operator", color: "var(--clay)",  bg: "var(--clay-soft)" },
      submitted_for_qc: { label: "In QC Review",    color: "#1a6b3c",      bg: "#e4efe3" },
      finalized:        { label: "Finalized",        color: "var(--ok)",    bg: "var(--ok-soft)" },
    };
    const s = map[status] ?? { label: status, color: "var(--ink-soft)", bg: "var(--line)" };
    return (
      <span style={{
        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
        color: s.color, background: s.bg, whiteSpace: "nowrap",
      }}>
        {s.label}
      </span>
    );
  };

  // Detail view for a single card
  if (selected) {
    const jc = selected;
    return (
      <>
        <button className="back-link" type="button" onClick={() => setSelected(null)}>
          Back to Job Cards
        </button>

        {/* Status + action banner */}
        <div style={{
          padding: "12px 16px", borderRadius: 8, marginBottom: 14,
          background: jc.status === "pending_stores" ? "var(--warn-soft)" : "var(--clay-soft)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              Job {jc.job_number ?? jc.id.slice(0, 8)}
            </div>
            <div style={{ fontSize: 12, marginTop: 2 }}>
              {statusBadge(jc.status)}
            </div>
          </div>
          {jc.status === "pending_stores" && (
            <button type="button" className="btn btn-primary"
              style={{ width: "auto", padding: "8px 18px", marginTop: 0, fontSize: 13 }}
              onClick={() => { setSelected(null); onGoToTab("oil"); }}>
              Go to Oil Issue
            </button>
          )}
        </div>

        {/* Production details -- read only, exactly as Production filled */}
        <div className="card">
          <h3>Production Details (filled by Production Incharge)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px",
            fontSize: 13, lineHeight: 1.8 }}>
            <div><b>Machine:</b> {jc.machine_number ?? "N/A"}</div>
            <div><b>Job Number:</b> {jc.job_number ?? "N/A"}</div>
            <div><b>Date:</b> {fmtDate(jc.job_date)}</div>
            <div><b>Shift:</b> {jc.shift ?? "N/A"}</div>
            <div><b>Batch No. (Material Code):</b> {jc.material_code ?? "N/A"}</div>
            <div><b>Party / CODE:</b> {jc.party_code ?? "N/A"}</div>
            <div><b>Planned Production:</b> {jc.planned_production_mt != null ? jc.planned_production_mt + " MT" : "N/A"}</div>
            <div>
              <b>Oil Required (auto):</b>{" "}
              <span style={{ fontWeight: 700, color: "var(--clay)" }}>
                {jc.oil_required_kg != null ? jc.oil_required_kg + " kg" : "N/A"}
              </span>
            </div>
          </div>
        </div>

        {/* Sulphur details */}
        <div className="card">
          <h3>Sulphur Details</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px",
            fontSize: 13, lineHeight: 1.8 }}>
            <div><b>Supplier:</b> {jc.sulphur_supplier ?? "N/A"}</div>
            <div><b>Lot Number:</b> {jc.sulphur_lot_number ?? "N/A"}</div>
            <div><b>Empty Date:</b> {fmtDate(jc.sulphur_empty_date)}</div>
          </div>
        </div>

        {/* Oil details */}
        <div className="card">
          <h3>Oil Details</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px",
            fontSize: 13, lineHeight: 1.8 }}>
            <div><b>Supplier:</b> {jc.oil_supplier ?? "N/A"}</div>
            <div><b>Batch Number:</b> {jc.oil_batch_number ?? "N/A"}</div>
            <div><b>Quantity:</b> {jc.oil_quantity != null ? jc.oil_quantity + " L" : "N/A"}</div>
            <div>
              <b>Oil Issued by Stores:</b>{" "}
              <span style={{ fontWeight: 700,
                color: jc.oil_issued_kg != null ? "var(--ok)" : "var(--warn)" }}>
                {jc.oil_issued_kg != null ? jc.oil_issued_kg + " kg" : "Not yet issued"}
              </span>
            </div>
          </div>
        </div>

        {/* Operator details (if filled) */}
        {jc.actual_production_mt != null && (
          <div className="card">
            <h3>Operator Details</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px",
              fontSize: 13, lineHeight: 1.8 }}>
              <div><b>Actual Production:</b> {jc.actual_production_mt} MT</div>
              <div><b>Expected Oil:</b> {jc.expected_oil_kg ?? "N/A"} kg</div>
              <div><b>Actual Oil Consumption:</b> {jc.actual_oil_consumption_kg ?? "N/A"} kg</div>
              <div><b>Oil Variance:</b> {jc.oil_variance_kg ?? "N/A"} kg</div>
            </div>
          </div>
        )}

        {/* Quick actions for Stores */}
        {jc.status === "pending_stores" && (
          <div className="card">
            <h3>Stores Actions</h3>
            <div className="field-hint" style={{ marginBottom: 12 }}>
              Use these shortcuts to pre-fill other sections based on this job card.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary"
                style={{ width: "auto", padding: "10px 18px", marginTop: 0 }}
                onClick={() => { setSelected(null); onGoToTab("oil"); }}>
                Issue Oil
              </button>
              <button type="button" className="btn btn-secondary"
                style={{ width: "auto", padding: "10px 18px", marginTop: 0 }}
                onClick={() => { setSelected(null); onGoToTab("issue"); }}>
                Create Issue Slip
              </button>
              <button type="button" className="btn btn-secondary"
                style={{ width: "auto", padding: "10px 18px", marginTop: 0 }}
                onClick={() => { setSelected(null); onGoToTab("rm"); }}>
                Update Raw Material
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // List view
  const groups = groupByJobNumber(cards);

  return (
    <>
      {/* Filter + refresh */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 12 }}>
        <div className="chip-group" style={{ margin: 0 }}>
          <button type="button"
            className={"chip" + (filter === "pending" ? " selected" : "")}
            onClick={() => setFilter("pending")}>
            Pending Stores
          </button>
          <button type="button"
            className={"chip" + (filter === "all" ? " selected" : "")}
            onClick={() => setFilter("all")}>
            All Recent
          </button>
        </div>
        <button type="button" className="btn btn-ghost"
          style={{ width: "auto", padding: "6px 14px", marginTop: 0, fontSize: 12 }}
          onClick={loadCards}>
          Refresh
        </button>
      </div>

      {/* Info banner */}
      {filter === "pending" && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 14,
          background: "var(--warn-soft)", fontSize: 13, color: "var(--warn)",
          fontWeight: 600,
        }}>
          These job cards are waiting for you to issue oil before the operator can start the batch.
        </div>
      )}

      {loading ? <div className="empty">Loading...</div>
        : groups.length === 0
          ? <div className="empty">
              {filter === "pending"
                ? "No job cards waiting for oil issue."
                : "No job cards found."}
            </div>
          : groups.map(group => (
            <div key={group.jobNumber ?? group.entries[0].id} style={{ marginBottom: 16 }}>
              {/* Job number header */}
              <div style={{
                fontSize: 12, fontWeight: 700, color: "var(--ink-soft)",
                margin: "4px 2px 6px", textTransform: "uppercase", letterSpacing: "0.5px",
              }}>
                Job: {group.jobNumber ?? "No Job Number"}
                {group.entries.length > 1 && " (" + group.entries.length + " entries)"}
              </div>

              {group.entries.map((jc, i) => (
                <div key={jc.id}
                  className="pending-item"
                  style={{ marginBottom: 8 }}
                  onClick={() => setSelected(jc)}>
                  <div className="pi-top">
                    <span style={{ fontWeight: 700 }}>
                      Entry {i + 1} -- {jc.machine_number} -- {fmtDate(jc.job_date)} -- {jc.shift ?? "N/A"} Shift
                    </span>
                    {statusBadge(jc.status)}
                  </div>
                  <div className="pi-sub" style={{ marginTop: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
                      <span><b>Batch:</b> {jc.material_code ?? "N/A"}</span>
                      <span><b>Party/Code:</b> {jc.party_code ?? "N/A"}</span>
                      <span><b>Planned:</b> {jc.planned_production_mt != null ? jc.planned_production_mt + " MT" : "N/A"}</span>
                      <span>
                        <b>Oil Required:</b>{" "}
                        <span style={{ color: "var(--clay)", fontWeight: 700 }}>
                          {jc.oil_required_kg != null ? jc.oil_required_kg + " kg" : "N/A"}
                        </span>
                      </span>
                      {jc.oil_issued_kg != null && (
                        <span>
                          <b>Oil Issued:</b>{" "}
                          <span style={{ color: "var(--ok)", fontWeight: 700 }}>
                            {jc.oil_issued_kg} kg
                          </span>
                        </span>
                      )}
                      {jc.sulphur_supplier && (
                        <span><b>Sulphur:</b> {jc.sulphur_supplier} / {jc.sulphur_lot_number ?? "N/A"}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
      }
    </>
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
  // Formula-computed fields (editable overrides; auto-filled from formulas)
  qty_issued_to_bal_mill: string;   // Formula 11 — Qty issued to Ball Mill
  net_balance: string;              // Formula 22 — Net balance after deduction
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
  qty_issued_to_bal_mill: number;
  net_balance: number;
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
    qty_issued_to_bal_mill: "", net_balance: "",
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
          qty_issued_to_bal_mill: p.qty_issued_to_bal_mill ?? 0,
          net_balance:            p.net_balance            ?? 0,
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
        .from("stores_stock_items").select("id, factory_id")
        .eq("category", "raw_material")
        .ilike("item_name", "%" + entry.product + "%")
        .limit(1).maybeSingle();
      const itemId = (itemData as { id: string; factory_id: string } | null)?.id;
      const factoryId = (itemData as { id: string; factory_id: string } | null)?.factory_id;
      if (!itemId || !factoryId) {
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
        qty_issued_to_bal_mill: Number(entry.qty_issued_to_bal_mill) || 0,
        net_balance:            Number(entry.net_balance)            || closing,
      };
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id: itemId,
        factory_id: factoryId,
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

        {/* Formula-computed fields (from Excel formulas -- editable overrides) */}
        <div style={{ marginTop: 10, padding: "10px 12px",
          background: "var(--clay-soft)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--clay)",
            textTransform: "uppercase", marginBottom: 8 }}>
            Formula Fields (Excel cross-references)
          </div>
          <div className="row3">
            <div>
              <label style={{ fontSize: 11 }}>
                Closing Balance (C3+D3+E3-F3-G3-H3)
              </label>
              <input type="text" disabled
                value={closing != null ? closing.toFixed(3) : "N/A"}
                style={{ fontWeight: 700,
                  color: closing != null && closing < 0 ? "var(--warn)" : "var(--ok)" }} />
            </div>
            <div>
              <label style={{ fontSize: 11 }}>
                Qty Issued to Ball Mill (G col)
              </label>
              <input type="number" step="0.001" placeholder="0"
                value={entry.qty_issued_to_bal_mill}
                onChange={e => setField("qty_issued_to_bal_mill", e.target.value)} />
              <div className="field-hint">Ref: VLOOKUP DAILY PRODN col 22</div>
            </div>
            <div>
              <label style={{ fontSize: 11 }}>
                Net Balance (M col = I - N)
              </label>
              <input type="number" step="0.001" placeholder="0"
                value={entry.net_balance}
                onChange={e => setField("net_balance", e.target.value)} />
              <div className="field-hint">Override: closing - fixed deduction</div>
            </div>
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
                      <th style={{ textAlign: "right" }}>Ball Mill</th>
                      <th style={{ textAlign: "right" }}>Net Bal</th>
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
                        <td style={{ textAlign: "right" }}>
                          {row.qty_issued_to_bal_mill > 0 ? fmt(row.qty_issued_to_bal_mill) : "0"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700,
                          color: row.net_balance < 0 ? "var(--warn)" : undefined }}>
                          {fmt(row.net_balance)}
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
// TAB 3 -- RECEIVED ENTRY BOOK
//
// Mirrors the RECEIVED tab in the DPR Excel exactly.
// Columns: Date | Particular | Transport | Materials | Vehicle No | O/WT |
//          F/Wt | Bags/Loose | INV/CHL No | Remarks | PO No
//
// Remarks field has a searchable multi-select filter dropdown with all
// predefined values from the Excel filter list.
// =============================================================================

// =============================================================================
// SHARED -- Searchable Code dropdown (used by both Received and Supplied)
// =============================================================================

/** Reusable searchable single-select dropdown for Code fields */
function CodeDropdown({
  codes,
  value,
  onChange,
  placeholder,
}: {
  codes: readonly string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [search, setSearch]   = useState("");
  const [open, setOpen]       = useState(false);
  const filtered = search.trim()
    ? codes.filter(c => c.toLowerCase().includes(search.toLowerCase()))
    : codes;
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(p => !p)} style={{
        width: "100%", padding: "10px 12px",
        border: "1px solid var(--line)", borderRadius: 8,
        fontSize: 15, background: "#fff", cursor: "pointer",
        color: value ? "var(--ink)" : "var(--ink-soft)", userSelect: "none",
      }}>
        {value || placeholder || "-- Select code --"}
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0,
          background: "#fff", border: "1px solid var(--line)", borderRadius: 8,
          zIndex: 200, boxShadow: "0 4px 16px rgba(0,0,0,.12)",
          maxHeight: 300, display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
            <input autoFocus type="text" placeholder="Search..."
              value={search} onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              style={{ width: "100%", padding: "6px 10px",
                border: "1px solid var(--line)", borderRadius: 6, fontSize: 13 }} />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <div onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
              style={{ padding: "9px 14px", cursor: "pointer", fontSize: 13,
                color: "var(--ink-soft)", borderBottom: "1px solid var(--line)",
                background: !value ? "var(--clay-soft)" : undefined }}>
              (Blanks) -- Clear
            </div>
            {filtered.map(c => (
              <div key={c} onClick={() => { onChange(c); setOpen(false); setSearch(""); }}
                style={{ padding: "9px 14px", cursor: "pointer", fontSize: 13,
                  background: value === c ? "var(--clay-soft)" : undefined,
                  color: value === c ? "var(--clay)" : "var(--ink)" }}>
                {c}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--ink-soft)" }}>
                No results
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Reusable multi-select filter dropdown for history table */
function CodeFilterDropdown({
  codes,
  selected,
  onToggle,
  onClear,
  onClose,
}: {
  codes: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? codes.filter(c => c.toLowerCase().includes(search.toLowerCase()))
    : codes;
  return (
    <div style={{
      position: "absolute", top: "100%", right: 0,
      background: "#fff", border: "1px solid var(--line)", borderRadius: 8,
      zIndex: 200, boxShadow: "0 4px 16px rgba(0,0,0,.12)",
      width: 280, maxHeight: 340, display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
        <input autoFocus type="text" placeholder="Search..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: "100%", padding: "6px 10px",
            border: "1px solid var(--line)", borderRadius: 6, fontSize: 13 }} />
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8,
          padding: "9px 14px", cursor: "pointer", fontSize: 13,
          fontWeight: 700, borderBottom: "1px solid var(--line)" }}>
          <input type="checkbox" checked={selected.length === 0}
            onChange={() => onClear()} />
          (Select All)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8,
          padding: "9px 14px", cursor: "pointer", fontSize: 13,
          borderBottom: "1px solid var(--line)" }}>
          <input type="checkbox" checked={selected.includes("")}
            onChange={() => onToggle("")} />
          (Blanks)
        </label>
        {filtered.map(c => (
          <label key={c} style={{ display: "flex", alignItems: "center", gap: 8,
            padding: "8px 14px", cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(c)}
              onChange={() => onToggle(c)} />
            {c}
          </label>
        ))}
      </div>
      <div style={{ padding: "8px 10px", borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary"
          style={{ padding: "6px 14px", fontSize: 12, marginTop: 0 }}
          onClick={onClose}>Apply</button>
        <button type="button" className="btn btn-ghost"
          style={{ padding: "6px 14px", fontSize: 12, marginTop: 0 }}
          onClick={() => { onClear(); onClose(); }}>Clear</button>
      </div>
    </div>
  );
}

// =============================================================================
// TAB 3 -- RECEIVED ENTRY BOOK
// Columns: Date | Particular | Transport | Materials | Vehicle No | O/WT |
//          F/Wt | Bags/Loose | INV/CHL No | Code (dropdown) | Remarks (free text) | PO No
// =============================================================================

const RECEIVED_CODES = [
  "008/2026-27","Apollo bag","Ceat108 bag","Chem Grind Oil","Code R5299",
  "Crude Sulphur Shifting","DC no. 323","Document not Received","DS-10",
  "ELASTO 541 OIL","Export Pallet Loading","For Lab","For Repair",
  "Gear oil 320","Jumbo Bags Shifting","JKI bag","Jumbo Bags Loading",
  "Jumbo Bags Unloading","Lanxess bag","LR no. 27482","LR no. 61084",
  "LR no. 61086","LR No 357","LR No.","LR No. 1067","LR No. 120",
  "LR No. 121","LR No. 122","LR No. 123","LR No. 124","LR No. 125",
  "LR No. 126","LR No. 127","LR No. 128","LR No. 129","LR No. 137",
  "LR No. 139","LR No. 151","LR no. 153","LR no. 154","LR No. 227809",
  "LR No. 2739","LR No. 2741","LR No. 2742","LR No. 2743","LR No. 2744",
  "LR No. 27458","LR No. 27459","LR No. 27460","LR No. 27462","LR No. 27464",
  "LR No. 27467","LR No. 27470","LR No. 27478","LR No. 27479","LR No. 27484",
  "LR No. 27489","LR No. 27490","LR No. 27492","LR No. 27493","LR No. 27494",
  "LR No. 27495","LR No. 27498","LR No. 27499","LR No. 27500","LR No. 27801",
  "LR No. 27802","LR No. 27803","LR No. 27807","LR No. 27808","LR No. 2823",
  "LR No. 2824","LR No. 2825","LR No. 2826","LR No. 2832","LR No. 2835",
  "LR No. 2836","LR No. 2837","LR No. 2838","LR No. 2839","LR No. 2840",
  "LR No. 2841","LR No. 2842","LR No. 2843","LR No. 2848","LR No. 2849",
  "LR No. 2850","LR No. 2851","LR No. 2852","LR No. 2853","LR No. 2854",
  "LR No. 2855","LR No. 2856","LR No. 2863","LR No. 2864","LR No. 2865",
  "LR No. 2866","LR No. 2867","LR No. 2868","LR No. 2869","LR No. 2870",
  "LR No. 2871","LR No. 2872","LR No. 2873","LR No. 2874","LR No. 2875",
  "LR No. 2876","LR No. 2877","LR No. 2878","LR No. 2879","LR No. 2880",
  "LR No. 2884","LR No. 2885","LR No. 2886","LR No. 2887","LR No. 2888",
  "LR No. 2889","LR No. 2890","LR No. 2891","LR No. 2892","LR No. 2893",
  "LR No. 2894","LR No. 2895","LR No. 2896","LR No. 2897","LR No. 2898",
  "LR No. 2901","LR No. 2902","LR No. 2903","LR No. 2904","LR No. 2905",
  "LR No. 2912","LR No. 2913","LR No. 2914","LR No. 2915","LR No. 3473",
  "LR No. 3475","Lr No. 353","LR No. 354","LR No. 355","LR No. 359",
  "LR No. 361","Lr No. 363","Lr No. 366","LR No. 377","LR No. 378",
  "LR No. 381","Lr No. 385","LR No. 395","LR No. 398","LR No. 400",
  "LR No. 401","LR No. 4152176641","LR No. 60685","LR No. 60686",
  "LR No. 60690","LR No. 60703","LR No. 60754","LR No. 60783","LR No. 60784",
  "LR No. 60786","LR No. 60801","LR No. 60802","LR No. 60822","LR No. 60823",
  "LR No. 60846","LR No. 60847","LR No. 60868","LR No. 60869","LR No. 60893",
  "LR No. 60898","LR No. 60912","LR No. 60919","LR No. 60958","LR No. 60965",
  "LR No. 60982","LR No. 60984","LR No. 60996","LR No. 61009","LR No. 61057",
  "LR No. 61058","LR No. 61083","LR No. 61117","LR No. 61133","LR No. 61134",
  "LR No. 61185","LR No. 61277","LR No. 61286","LR No. 61288","LR No. 61289",
  "LR No. 61387","LR No. 61388","LR No. 61403","LR No. 61658","LR No. 61659",
  "LR No. 61667","LR No. 61668","LR No. 61669","LR No. 61671","LR No. 61680",
  "LR No. 61685","Lr No. 61734","LR no. 61735","LR no. 61740","LR No. 61743",
  "LR No. 61751","LR No. 61755","LR No. 61756","LR No. 61764","LR No. 61765",
  "LR No. 61766","LR No. 66060","LR No. 66076","LR no. 66084","LR No. 66089",
  "LR No. 66098","LR No. 66144","LR No. 66160","LR No. 66213","LR No. 66216",
  "LR No. 66222","LR No. 66227","LR No. 66229","LR No. 66258","LR No. 66269",
  "LR No. 66274","LR No. 66289","LR No. 66404","LR No. 66424","LR No. 66427",
  "LR No. 66434","LR No. 66453","LR No. 66489","LR No. 66492","LR No. NA",
  "LR No. ZULFO/26-27/0104","LR No. ZULFO/26-27/0105","LR No. ZULFO/26-27/0106",
  "LR No. ZULFO/26-27/0107","LR No. ZULFO/26-27/0109","LR No. ZULFO/26-27/0110",
  "LR No. ZULFO/26-27/0111","LR No. ZULFO/26-27/0112","LR No.1081",
  "LR No.26605","LR No.2881","LR No.2882","M2615 bag","Old bag",
  "Pallet Loading","Pallet Unloadin","Power Oil M4150","R5299 bag","Return",
  "Returned","Returned after repairing","Rubber bag","Sulhphur Shifting",
  "Sulphur loading","Sulphur Shifting","sulphur Unloading","Sulphur Unloading at B-11",
  "Sulphur Unloding","W10 bag","Westage Loading",
] as const;

interface ReceivedEntry {
  date: string;
  particular: string;
  transport: string;
  materials: string;
  vehicle_no: string;
  o_wt: string;
  f_wt: string;
  bags_loose: string;
  inv_chl_no: string;
  code: string;
  remarks: string;
  po_no: string;
}
interface SavedReceivedRow extends ReceivedEntry { id: string; }

function blankReceivedEntry(): ReceivedEntry {
  return {
    date: today(), particular: "", transport: "", materials: "",
    vehicle_no: "", o_wt: "", f_wt: "", bags_loose: "",
    inv_chl_no: "", code: "", remarks: "", po_no: "",
  };
}

function ReceivedSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [entry, setEntry]           = useState<ReceivedEntry>(blankReceivedEntry());
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory]       = useState<SavedReceivedRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [filterCodes, setFilterCodes] = useState<string[]>([]);
  const [filterDropOpen, setFilterDropOpen] = useState(false);

  const setField = (k: keyof ReceivedEntry, v: string) =>
    setEntry(prev => ({ ...prev, [k]: v }));

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("id, transaction_date, remark")
      .eq("reference_type", "received_entry")
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) { showToast("Could not load: " + error.message, true); setHistLoading(false); return; }
    const rows: SavedReceivedRow[] = [];
    for (const row of (data ?? []) as { id: string; transaction_date: string; remark: string | null }[]) {
      try {
        const p = JSON.parse(row.remark ?? "{}") as Partial<ReceivedEntry>;
        rows.push({
          id: row.id, date: row.transaction_date,
          particular: p.particular ?? "", transport: p.transport ?? "",
          materials: p.materials ?? "", vehicle_no: p.vehicle_no ?? "",
          o_wt: p.o_wt ?? "", f_wt: p.f_wt ?? "",
          bags_loose: p.bags_loose ?? "", inv_chl_no: p.inv_chl_no ?? "",
          code: p.code ?? (p as Record<string,string>).remark ?? "",
          remarks: p.remarks ?? "", po_no: p.po_no ?? "",
        });
      } catch { /* skip */ }
    }
    setHistory(rows); setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const histFiltered = filterCodes.length === 0
    ? history
    : history.filter(r => filterCodes.includes(r.code));

  const handleSave = async () => {
    if (!entry.date) { showToast("Enter a date.", true); return; }
    if (!entry.particular.trim() && !entry.materials.trim()) {
      showToast("Enter at least Particular or Materials.", true); return;
    }
    if (!user) return;
    setSubmitting(true);
    try {
      const { data: itemData } = await supabase
        .from("stores_stock_items").select("id, factory_id")
        .eq("is_active", true).limit(1).maybeSingle();
      if (!itemData) {
        showToast("No stock items found. Run migration 027 in Supabase first.", true);
        setSubmitting(false); return;
      }
      const payload: ReceivedEntry = {
        date: entry.date, particular: entry.particular.trim(),
        transport: entry.transport.trim(), materials: entry.materials.trim(),
        vehicle_no: entry.vehicle_no.trim(), o_wt: entry.o_wt.trim(),
        f_wt: entry.f_wt.trim(), bags_loose: entry.bags_loose.trim(),
        inv_chl_no: entry.inv_chl_no.trim(), code: entry.code,
        remarks: entry.remarks.trim(), po_no: entry.po_no.trim(),
      };
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id: itemData.id, factory_id: itemData.factory_id,
        transaction_date: entry.date, transaction_source: "manual",
        qty_received: 0, qty_issued: 0, dispatch_qty: 0, closing_balance: 0,
        reference_type: "received_entry", remark: JSON.stringify(payload),
        entered_by: user.id,
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("Received entry saved -- " + entry.date + " " + (entry.particular || entry.materials));
      setEntry(blankReceivedEntry()); loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <div className="card">
        <h3>Received Entry Book</h3>
        <div className="row3">
          <div>
            <label>Date *</label>
            <input type="date" value={entry.date} onChange={e => setField("date", e.target.value)} />
          </div>
          <div>
            <label>Particular</label>
            <input type="text" placeholder="e.g. Aquaproof Plastics"
              value={entry.particular} onChange={e => setField("particular", e.target.value)} />
          </div>
          <div>
            <label>Transport</label>
            <input type="text" placeholder="e.g. Party Transport"
              value={entry.transport} onChange={e => setField("transport", e.target.value)} />
          </div>
        </div>
        <div className="row3">
          <div>
            <label>Materials</label>
            <input type="text" placeholder="e.g. HDPE/PP bags for Apollo 160108 25 Kg"
              value={entry.materials} onChange={e => setField("materials", e.target.value)} />
          </div>
          <div>
            <label>Vehicle No.</label>
            <input type="text" placeholder="e.g. MH05EL3625"
              value={entry.vehicle_no} onChange={e => setField("vehicle_no", e.target.value)} />
          </div>
          <div>
            <label>O/WT</label>
            <input type="text" placeholder="e.g. 2034.000"
              value={entry.o_wt} onChange={e => setField("o_wt", e.target.value)} />
          </div>
        </div>
        <div className="row3">
          <div>
            <label>F/Wt</label>
            <input type="text" placeholder="e.g. 2034 Nos"
              value={entry.f_wt} onChange={e => setField("f_wt", e.target.value)} />
          </div>
          <div>
            <label>Bags / Loose</label>
            <input type="text" placeholder="e.g. Size 20x32 Printed"
              value={entry.bags_loose} onChange={e => setField("bags_loose", e.target.value)} />
          </div>
          <div>
            <label>INV / CHL No.</label>
            <input type="text" placeholder="e.g. AP/0049/2026-27"
              value={entry.inv_chl_no} onChange={e => setField("inv_chl_no", e.target.value)} />
          </div>
        </div>
        <div className="row3">
          <div>
            <label>Code</label>
            <CodeDropdown codes={RECEIVED_CODES} value={entry.code}
              onChange={v => setField("code", v)} placeholder="-- Select code --" />
          </div>
          <div>
            <label>Remarks (free text)</label>
            <input type="text" placeholder="Enter remark manually..."
              value={entry.remarks} onChange={e => setField("remarks", e.target.value)} />
          </div>
          <div>
            <label>PO No.</label>
            <input type="text" placeholder="e.g. 34/26-27"
              value={entry.po_no} onChange={e => setField("po_no", e.target.value)} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting} onClick={handleSave}>
        {submitting ? "Saving..." : "Save Received Entry"}
      </button>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>
            Received History
            {filterCodes.length > 0 ? " (filtered: " + filterCodes.length + ")" : " (all)"}
          </h3>
          <div style={{ position: "relative" }}>
            <button type="button"
              onClick={() => setFilterDropOpen(p => !p)}
              style={{
                padding: "6px 14px", border: "1px solid var(--line)", borderRadius: 6,
                background: filterCodes.length > 0 ? "var(--clay)" : "#fff",
                color: filterCodes.length > 0 ? "#fff" : "var(--ink-soft)",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>
              Filter Code {filterCodes.length > 0 ? "(" + filterCodes.length + ")" : ""}
            </button>
            {filterDropOpen && (
              <CodeFilterDropdown
                codes={RECEIVED_CODES}
                selected={filterCodes}
                onToggle={v => setFilterCodes(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                onClear={() => setFilterCodes([])}
                onClose={() => setFilterDropOpen(false)}
              />
            )}
          </div>
        </div>
        {histLoading ? <div className="empty">Loading...</div>
          : histFiltered.length === 0 ? <div className="empty">No entries found.</div>
          : (
            <div style={{ overflowX: "auto" }}>
              <table className="dash" style={{ minWidth: 1100 }}>
                <thead>
                  <tr>
                    <th>Date</th><th>Particular</th><th>Transport</th>
                    <th>Materials</th><th>Vehicle No.</th>
                    <th style={{ textAlign: "right" }}>O/WT</th>
                    <th style={{ textAlign: "right" }}>F/Wt</th>
                    <th>Bags/Loose</th><th>INV/CHL No.</th>
                    <th>Code</th><th>Remarks</th><th>PO No.</th>
                  </tr>
                </thead>
                <tbody>
                  {histFiltered.map(row => (
                    <tr key={row.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(row.date)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.particular)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.transport)}</td>
                      <td style={{ fontSize: 12, maxWidth: 160, whiteSpace: "normal" }}>{nilText(row.materials)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.vehicle_no)}</td>
                      <td style={{ textAlign: "right", fontSize: 12 }}>{nilText(row.o_wt)}</td>
                      <td style={{ textAlign: "right", fontSize: 12 }}>{nilText(row.f_wt)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.bags_loose)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.inv_chl_no)}</td>
                      <td style={{ fontSize: 12, color: "var(--clay)", fontWeight: 600 }}>{nilText(row.code)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.remarks)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.po_no)}</td>
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
// TAB 4 -- SUPPLIED
// Same structure as Received but for outgoing/supplied entries.
// Code dropdown has its own list (shorter, supply-focused codes).
// =============================================================================

const SUPPLIED_CODES = [
  "Code 160108","Code 2615","Code Ceat 108","Code Crude","Code Export",
  "Code JKI","Code Lanxess","Code Lanxess 2% Oil","Code M2615","Code Old",
  "Code R5299","Code Rubber","Code SC","Code W10","DS-10",
  "For Apollo","For Repair","For Repairing","Replace",
] as const;

interface SuppliedEntry {
  date: string;
  particular: string;
  transport: string;
  materials: string;
  vehicle_no: string;
  o_wt: string;
  f_wt: string;
  bags_loose: string;
  inv_chl_no: string;
  code: string;
  remarks: string;
  po_no: string;
}
interface SavedSuppliedRow extends SuppliedEntry { id: string; }

function blankSuppliedEntry(): SuppliedEntry {
  return {
    date: today(), particular: "", transport: "", materials: "",
    vehicle_no: "", o_wt: "", f_wt: "", bags_loose: "",
    inv_chl_no: "", code: "", remarks: "", po_no: "",
  };
}

function SuppliedSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [entry, setEntry]           = useState<SuppliedEntry>(blankSuppliedEntry());
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory]       = useState<SavedSuppliedRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [filterCodes, setFilterCodes] = useState<string[]>([]);
  const [filterDropOpen, setFilterDropOpen] = useState(false);

  const setField = (k: keyof SuppliedEntry, v: string) =>
    setEntry(prev => ({ ...prev, [k]: v }));

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("id, transaction_date, remark")
      .eq("reference_type", "supplied_entry")
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) { showToast("Could not load: " + error.message, true); setHistLoading(false); return; }
    const rows: SavedSuppliedRow[] = [];
    for (const row of (data ?? []) as { id: string; transaction_date: string; remark: string | null }[]) {
      try {
        const p = JSON.parse(row.remark ?? "{}") as Partial<SuppliedEntry>;
        rows.push({
          id: row.id, date: row.transaction_date,
          particular: p.particular ?? "", transport: p.transport ?? "",
          materials: p.materials ?? "", vehicle_no: p.vehicle_no ?? "",
          o_wt: p.o_wt ?? "", f_wt: p.f_wt ?? "",
          bags_loose: p.bags_loose ?? "", inv_chl_no: p.inv_chl_no ?? "",
          code: p.code ?? "", remarks: p.remarks ?? "", po_no: p.po_no ?? "",
        });
      } catch { /* skip */ }
    }
    setHistory(rows); setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const histFiltered = filterCodes.length === 0
    ? history
    : history.filter(r => filterCodes.includes(r.code));

  const handleSave = async () => {
    if (!entry.date) { showToast("Enter a date.", true); return; }
    if (!entry.particular.trim() && !entry.materials.trim()) {
      showToast("Enter at least Particular or Materials.", true); return;
    }
    if (!user) return;
    setSubmitting(true);
    try {
      const { data: itemData } = await supabase
        .from("stores_stock_items").select("id, factory_id")
        .eq("is_active", true).limit(1).maybeSingle();
      if (!itemData) {
        showToast("No stock items found. Run migration 027 in Supabase first.", true);
        setSubmitting(false); return;
      }
      const payload: SuppliedEntry = {
        date: entry.date, particular: entry.particular.trim(),
        transport: entry.transport.trim(), materials: entry.materials.trim(),
        vehicle_no: entry.vehicle_no.trim(), o_wt: entry.o_wt.trim(),
        f_wt: entry.f_wt.trim(), bags_loose: entry.bags_loose.trim(),
        inv_chl_no: entry.inv_chl_no.trim(), code: entry.code,
        remarks: entry.remarks.trim(), po_no: entry.po_no.trim(),
      };
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id: itemData.id, factory_id: itemData.factory_id,
        transaction_date: entry.date, transaction_source: "manual",
        qty_received: 0, qty_issued: 0, dispatch_qty: 0, closing_balance: 0,
        reference_type: "supplied_entry", remark: JSON.stringify(payload),
        entered_by: user.id,
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("Supplied entry saved -- " + entry.date + " " + (entry.particular || entry.materials));
      setEntry(blankSuppliedEntry()); loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <div className="card">
        <h3>Supplied Entry Book</h3>
        <div className="row3">
          <div>
            <label>Date *</label>
            <input type="date" value={entry.date} onChange={e => setField("date", e.target.value)} />
          </div>
          <div>
            <label>Particular</label>
            <input type="text" placeholder="e.g. Aquaproof Plastics"
              value={entry.particular} onChange={e => setField("particular", e.target.value)} />
          </div>
          <div>
            <label>Transport</label>
            <input type="text" placeholder="e.g. Party Transport"
              value={entry.transport} onChange={e => setField("transport", e.target.value)} />
          </div>
        </div>
        <div className="row3">
          <div>
            <label>Materials</label>
            <input type="text" placeholder="e.g. HDPE/PP bags 25 Kg"
              value={entry.materials} onChange={e => setField("materials", e.target.value)} />
          </div>
          <div>
            <label>Vehicle No.</label>
            <input type="text" placeholder="e.g. MH05EL3625"
              value={entry.vehicle_no} onChange={e => setField("vehicle_no", e.target.value)} />
          </div>
          <div>
            <label>O/WT</label>
            <input type="text" placeholder="e.g. 2034.000"
              value={entry.o_wt} onChange={e => setField("o_wt", e.target.value)} />
          </div>
        </div>
        <div className="row3">
          <div>
            <label>F/Wt</label>
            <input type="text" placeholder="e.g. 2034 Nos"
              value={entry.f_wt} onChange={e => setField("f_wt", e.target.value)} />
          </div>
          <div>
            <label>Bags / Loose</label>
            <input type="text" placeholder="e.g. Size 20x32 Printed"
              value={entry.bags_loose} onChange={e => setField("bags_loose", e.target.value)} />
          </div>
          <div>
            <label>INV / CHL No.</label>
            <input type="text" placeholder="e.g. AP/0049/2026-27"
              value={entry.inv_chl_no} onChange={e => setField("inv_chl_no", e.target.value)} />
          </div>
        </div>
        <div className="row3">
          <div>
            <label>Code</label>
            <CodeDropdown codes={SUPPLIED_CODES} value={entry.code}
              onChange={v => setField("code", v)} placeholder="-- Select code --" />
          </div>
          <div>
            <label>Remarks (free text)</label>
            <input type="text" placeholder="Enter remark manually..."
              value={entry.remarks} onChange={e => setField("remarks", e.target.value)} />
          </div>
          <div>
            <label>PO No.</label>
            <input type="text" placeholder="e.g. 34/26-27"
              value={entry.po_no} onChange={e => setField("po_no", e.target.value)} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting} onClick={handleSave}>
        {submitting ? "Saving..." : "Save Supplied Entry"}
      </button>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>
            Supplied History
            {filterCodes.length > 0 ? " (filtered: " + filterCodes.length + ")" : " (all)"}
          </h3>
          <div style={{ position: "relative" }}>
            <button type="button"
              onClick={() => setFilterDropOpen(p => !p)}
              style={{
                padding: "6px 14px", border: "1px solid var(--line)", borderRadius: 6,
                background: filterCodes.length > 0 ? "var(--clay)" : "#fff",
                color: filterCodes.length > 0 ? "#fff" : "var(--ink-soft)",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>
              Filter Code {filterCodes.length > 0 ? "(" + filterCodes.length + ")" : ""}
            </button>
            {filterDropOpen && (
              <CodeFilterDropdown
                codes={SUPPLIED_CODES}
                selected={filterCodes}
                onToggle={v => setFilterCodes(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                onClear={() => setFilterCodes([])}
                onClose={() => setFilterDropOpen(false)}
              />
            )}
          </div>
        </div>
        {histLoading ? <div className="empty">Loading...</div>
          : histFiltered.length === 0 ? <div className="empty">No entries found.</div>
          : (
            <div style={{ overflowX: "auto" }}>
              <table className="dash" style={{ minWidth: 1100 }}>
                <thead>
                  <tr>
                    <th>Date</th><th>Particular</th><th>Transport</th>
                    <th>Materials</th><th>Vehicle No.</th>
                    <th style={{ textAlign: "right" }}>O/WT</th>
                    <th style={{ textAlign: "right" }}>F/Wt</th>
                    <th>Bags/Loose</th><th>INV/CHL No.</th>
                    <th>Code</th><th>Remarks</th><th>PO No.</th>
                  </tr>
                </thead>
                <tbody>
                  {histFiltered.map(row => (
                    <tr key={row.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(row.date)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.particular)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.transport)}</td>
                      <td style={{ fontSize: 12, maxWidth: 160, whiteSpace: "normal" }}>{nilText(row.materials)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.vehicle_no)}</td>
                      <td style={{ textAlign: "right", fontSize: 12 }}>{nilText(row.o_wt)}</td>
                      <td style={{ textAlign: "right", fontSize: 12 }}>{nilText(row.f_wt)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.bags_loose)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.inv_chl_no)}</td>
                      <td style={{ fontSize: 12, color: "var(--clay)", fontWeight: 600 }}>{nilText(row.code)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.remarks)}</td>
                      <td style={{ fontSize: 12 }}>{nilText(row.po_no)}</td>
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
// TAB 5 -- DAILY PRODUCTION
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
// DAILY DISPATCH SECTION
//
// Mirrors the DAILY DISPATCH 2026-27 tab in the DPR Excel.
// Columns (B through O + TOTAL MT):
//   B  CEAT 108/EXPORT      25 kg bags
//   C  M2615                25 kg bags
//   D  PLAIN-2615           25 kg bags
//   E  APOLLO 160108        25 kg bags
//   F  LANXESS              25 kg bags
//   G  CEAT R5299           25 kg bags
//   H  PLAIN/WE-10          25 kg bags
//   I  Lanxess 2% Oil       25 kg bags
//   J  JKI-108              50 kg bags
//   K  OLD BAGS 50 KG       50 kg bags
//   L  RUBBER MAKER 50 KG   50 kg bags
//   M  Sulphur Powder for Pesticide Formulation  50 kg bags
//   N  JUMBO BAG-500 KG     550 kg bags
//   O  Export Plan Bag W/O 25 Kg  25 kg bags
//
// TOTAL MT formula (from Excel):
//   =(B*25+C*25+D*25+E*25+F*25+G*25+H*25+I*25+O*25)/1000
//   +(J*50+K*50+L*50+M*50)/1000
//   +(N*550)/1000
// =============================================================================

interface DailyDispatchCol {
  key: string;
  label: string;
  shortLabel: string;
  bagKg: number;
}

const DAILY_DISPATCH_COLS: DailyDispatchCol[] = [
  { key: "ceat_108_export",  label: "CEAT 108/EXPORT",                          shortLabel: "CEAT 108",   bagKg: 25  },
  { key: "m2615",            label: "M2615",                                    shortLabel: "M2615",      bagKg: 25  },
  { key: "plain_2615",       label: "PLAIN-2615",                               shortLabel: "PLAIN-2615", bagKg: 25  },
  { key: "apollo_160108",    label: "APOLLO 160108",                            shortLabel: "APOLLO",     bagKg: 25  },
  { key: "lanxess",          label: "LANXESS",                                  shortLabel: "LANXESS",    bagKg: 25  },
  { key: "ceat_r5299",       label: "CEAT R5299",                               shortLabel: "CEAT R5299", bagKg: 25  },
  { key: "plain_we10",       label: "PLAIN / WE-10",                            shortLabel: "PLAIN/WE-10",bagKg: 25  },
  { key: "lanxess_2pct_oil", label: "Lanxess 2% Oil",                           shortLabel: "LANX 2%",   bagKg: 25  },
  { key: "jki_108",          label: "JKI-108",                                  shortLabel: "JKI-108",    bagKg: 50  },
  { key: "old_bags_50kg",    label: "OLD BAGS 50 KG",                           shortLabel: "OLD 50",     bagKg: 50  },
  { key: "rubber_maker_50kg",label: "RUBBER MAKER 50 KG",                       shortLabel: "RUBBER 50",  bagKg: 50  },
  { key: "sulphur_pesticide",label: "Sulphur Powder for Pesticide Formulation", shortLabel: "SUL PEST",   bagKg: 50  },
  { key: "jumbo_bag_500kg",  label: "JUMBO BAG-500 KG",                         shortLabel: "JUMBO 500",  bagKg: 550 },
  { key: "export_plan_25kg", label: "Export Plan Bag W/O 25 Kg",                shortLabel: "EXP PLAN",   bagKg: 25  },
];

// Keys grouped by bag weight for the formula
const DISPATCH_25KG  = ["ceat_108_export","m2615","plain_2615","apollo_160108",
                         "lanxess","ceat_r5299","plain_we10","lanxess_2pct_oil","export_plan_25kg"];
const DISPATCH_50KG  = ["jki_108","old_bags_50kg","rubber_maker_50kg","sulphur_pesticide"];
const DISPATCH_550KG = ["jumbo_bag_500kg"];

type DailyDispatchRow = Record<string, string> & { date: string };

interface SavedDailyDispatchRow {
  id: string;
  date: string;
  values: Record<string, number>;
  total_mt: number;
}

/** Excel formula:
 *  =(B*25+C*25+D*25+E*25+F*25+G*25+H*25+I*25+O*25)/1000
 *  +(J*50+K*50+L*50+M*50)/1000
 *  +(N*550)/1000
 */
function calcDispatchTotalMt(vals: Record<string, string>): number {
  const n = (k: string) => Number(vals[k]) || 0;
  const sum25  = DISPATCH_25KG.reduce((s, k) => s + n(k), 0);
  const sum50  = DISPATCH_50KG.reduce((s, k) => s + n(k), 0);
  const sum550 = DISPATCH_550KG.reduce((s, k) => s + n(k), 0);
  return (sum25 * 25) / 1000 + (sum50 * 50) / 1000 + (sum550 * 550) / 1000;
}

function blankDispatchRow(): DailyDispatchRow {
  const row: DailyDispatchRow = { date: today() };
  DAILY_DISPATCH_COLS.forEach(c => { row[c.key] = ""; });
  return row;
}

function DailyDispatchSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [entry, setEntry]             = useState<DailyDispatchRow>(blankDispatchRow());
  const [submitting, setSubmitting]   = useState(false);
  const [history, setHistory]         = useState<SavedDailyDispatchRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);

  const totalMt = calcDispatchTotalMt(entry);

  const setField = (key: string, val: string) =>
    setEntry(prev => ({ ...prev, [key]: val }));

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("id, transaction_date, remark")
      .eq("reference_type", "daily_dispatch")
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(90);
    if (error) {
      showToast("Could not load history: " + error.message, true);
      setHistLoading(false); return;
    }
    const rows: SavedDailyDispatchRow[] = [];
    for (const row of (data ?? []) as { id: string; transaction_date: string; remark: string | null }[]) {
      try {
        const p = JSON.parse(row.remark ?? "{}") as { values?: Record<string, number>; total_mt?: number };
        rows.push({
          id: row.id, date: row.transaction_date,
          values: p.values ?? {}, total_mt: p.total_mt ?? 0,
        });
      } catch { /* skip */ }
    }
    setHistory(rows); setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSave = async () => {
    if (!entry.date) { showToast("Enter a date.", true); return; }
    const hasAny = DAILY_DISPATCH_COLS.some(c => Number(entry[c.key]) > 0);
    if (!hasAny) { showToast("Enter at least one dispatch quantity.", true); return; }
    if (!user) return;
    setSubmitting(true);
    try {
      const { data: itemData } = await supabase
        .from("stores_stock_items").select("id, factory_id")
        .eq("is_active", true).limit(1).maybeSingle();
      if (!itemData) {
        showToast("No stock items found. Run migrations in Supabase first.", true);
        setSubmitting(false); return;
      }
      const numVals: Record<string, number> = {};
      DAILY_DISPATCH_COLS.forEach(c => { numVals[c.key] = Number(entry[c.key]) || 0; });
      const payload = { date: entry.date, values: numVals, total_mt: totalMt };
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id:            itemData.id,
        factory_id:         itemData.factory_id,
        transaction_date:   entry.date,
        transaction_source: "manual",
        qty_received: 0, qty_issued: 0, dispatch_qty: 0,
        closing_balance: 0,
        reference_type: "daily_dispatch",
        remark: JSON.stringify(payload),
        entered_by: user.id,
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("Daily dispatch saved -- " + entry.date + " Total MT: " + totalMt.toFixed(3));
      setEntry(blankDispatchRow()); loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  // Column totals for TOTAL row
  const colTotals: Record<string, number> = {};
  DAILY_DISPATCH_COLS.forEach(c => {
    colTotals[c.key] = history.reduce((s, r) => s + (r.values[c.key] ?? 0), 0);
  });
  const grandTotal = history.reduce((s, r) => s + r.total_mt, 0);

  return (
    <>
      <div className="card">
        <h3>Daily Dispatch Entry</h3>

        <div style={{ marginBottom: 12 }}>
          <label>Date *</label>
          <input type="date" value={entry.date}
            onChange={e => setField("date", e.target.value)}
            style={{ maxWidth: 200 }} />
        </div>

        {/* 25 kg columns */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--clay)",
          textTransform: "uppercase", marginBottom: 4, marginTop: 8 }}>
          25 kg Bags
        </div>
        <div className="row2">
          {DAILY_DISPATCH_COLS.filter(c => c.bagKg === 25).map(col => (
            <div key={col.key}>
              <label style={{ fontSize: 11 }}>{col.label}</label>
              <input type="number" min="0" step="1" placeholder="0"
                value={entry[col.key]}
                onChange={e => setField(col.key, e.target.value)} />
            </div>
          ))}
        </div>

        {/* 50 kg columns */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--clay)",
          textTransform: "uppercase", marginBottom: 4, marginTop: 12 }}>
          50 kg Bags
        </div>
        <div className="row2">
          {DAILY_DISPATCH_COLS.filter(c => c.bagKg === 50).map(col => (
            <div key={col.key}>
              <label style={{ fontSize: 11 }}>{col.label}</label>
              <input type="number" min="0" step="1" placeholder="0"
                value={entry[col.key]}
                onChange={e => setField(col.key, e.target.value)} />
            </div>
          ))}
        </div>

        {/* 550 kg (Jumbo) column */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--clay)",
          textTransform: "uppercase", marginBottom: 4, marginTop: 12 }}>
          550 kg Bags (Jumbo)
        </div>
        <div style={{ maxWidth: 220 }}>
          {DAILY_DISPATCH_COLS.filter(c => c.bagKg === 550).map(col => (
            <div key={col.key}>
              <label style={{ fontSize: 11 }}>{col.label}</label>
              <input type="number" min="0" step="1" placeholder="0"
                value={entry[col.key]}
                onChange={e => setField(col.key, e.target.value)} />
            </div>
          ))}
        </div>

        {/* TOTAL MT */}
        <div style={{
          marginTop: 14, padding: "12px 16px",
          background: "var(--clay-soft)", borderRadius: 8,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>TOTAL MT</span>
            <div className="field-hint" style={{ marginTop: 2 }}>
              (25kg cols x 25 + 50kg cols x 50 + JUMBO x 550) / 1000
            </div>
          </div>
          <span style={{ fontWeight: 700, fontSize: 20, color: "var(--clay)" }}>
            {totalMt.toFixed(3)} MT
          </span>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting} onClick={handleSave}>
        {submitting ? "Saving..." : "Save Daily Dispatch"}
      </button>

      {/* History table */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Daily Dispatch History</h3>
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
                      {DAILY_DISPATCH_COLS.map(c => (
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
                        {DAILY_DISPATCH_COLS.map(c => (
                          <td key={c.key} style={{ textAlign: "right" }}>
                            {(row.values[c.key] ?? 0) > 0
                              ? (row.values[c.key]).toFixed(0)
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
                      {DAILY_DISPATCH_COLS.map(c => (
                        <td key={c.key} style={{ textAlign: "right", fontWeight: 700 }}>
                          {colTotals[c.key] > 0 ? colTotals[c.key].toFixed(0) : "-"}
                        </td>
                      ))}
                      <td style={{ textAlign: "right", fontWeight: 700,
                        color: "var(--clay)", fontSize: 14 }}>
                        {grandTotal.toFixed(3)}
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
// PACKING MATERIAL SECTION
//
// Mirrors the PACKING MATERIAL 2026-27 tab in the DPR Excel.
// Columns:
//   Date | Name of Product | Op. Bal (C) | Qty.Rec (D) | BY TRANSFER (E) |
//   Qty. issued (F) | TO TRANSFER (G) | Cl. Bal (H) | Status (I) | Remark (J)
//
// Closing Balance formula: H = C + D + E - F - G
// =============================================================================

const PM_PRODUCTS = [
  "CEAT 108/EXPORT",
  "MRF-M-2615",
  "LANXESS",
  "WOODEN PALLETS",
  "CEAT R5299",
  "APOLLO TYRE - 160108",
  "Plain Bags EXPORT 25 kg for Export",
  "THREAD CONE",
  "BRIDGESTONE WE-10",
  "RUBBER MAKER 50 KG",
  "JKI-108 50 KG",
  "JUMBO BAGS 500 KG",
  "Old Bags",
] as const;
type PmProduct = (typeof PM_PRODUCTS)[number];

const PM_STATUS_OPTIONS = ["GOOD", "LESS", "OUT OF STOCK"] as const;

interface PmEntry {
  date: string;
  product: PmProduct | "";
  op_bal: string;
  qty_received: string;
  by_transfer: string;
  qty_issued: string;
  to_transfer: string;
  cl_bal: number | null;   // computed: C + D + E - F - G
  status: string;
  remark: string;
}

interface SavedPmRow {
  id: string;
  date: string;
  product: string;
  op_bal: number;
  qty_received: number;
  by_transfer: number;
  qty_issued: number;
  to_transfer: number;
  cl_bal: number;
  status: string;
  remark: string;
}

function computePmCl(e: PmEntry): number | null {
  const c = Number(e.op_bal);
  const d = Number(e.qty_received);
  const ee = Number(e.by_transfer);
  const f = Number(e.qty_issued);
  const g = Number(e.to_transfer);
  if ([c, d, ee, f, g].some(v => !Number.isFinite(v))) return null;
  return c + d + ee - f - g;
}

function blankPmEntry(): PmEntry {
  return {
    date: today(), product: "",
    op_bal: "", qty_received: "", by_transfer: "",
    qty_issued: "", to_transfer: "",
    cl_bal: null, status: "", remark: "",
  };
}

function PackingMaterialSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [entry, setEntry]           = useState<PmEntry>(blankPmEntry());
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory]       = useState<SavedPmRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [filterProduct, setFilterProduct] = useState<PmProduct | "ALL">("ALL");

  const clBal = computePmCl(entry);

  const setField = <K extends keyof PmEntry>(key: K, val: PmEntry[K]) => {
    setEntry(prev => {
      const next = { ...prev, [key]: val };
      return { ...next, cl_bal: computePmCl(next) };
    });
  };

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("id, transaction_date, remark")
      .eq("reference_type", "pm_entry")
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) { showToast("Could not load: " + error.message, true); setHistLoading(false); return; }
    const rows: SavedPmRow[] = [];
    for (const row of (data ?? []) as { id: string; transaction_date: string; remark: string | null }[]) {
      try {
        const p = JSON.parse(row.remark ?? "{}") as Partial<SavedPmRow>;
        rows.push({
          id: row.id, date: row.transaction_date,
          product:      p.product      ?? "",
          op_bal:       p.op_bal       ?? 0,
          qty_received: p.qty_received ?? 0,
          by_transfer:  p.by_transfer  ?? 0,
          qty_issued:   p.qty_issued   ?? 0,
          to_transfer:  p.to_transfer  ?? 0,
          cl_bal:       p.cl_bal       ?? 0,
          status:       p.status       ?? "",
          remark:       p.remark       ?? "",
        });
      } catch { /* skip */ }
    }
    setHistory(rows); setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Auto-fill op_bal from last closing balance for this product
  const handleProductChange = (product: PmProduct | "") => {
    const last = history.find(r => r.product === product);
    setEntry(prev => ({
      ...blankPmEntry(),
      date: prev.date,
      product,
      op_bal: last ? String(last.cl_bal) : "",
    }));
  };

  const handleSave = async () => {
    if (!entry.product) { showToast("Select a product.", true); return; }
    if (clBal == null) { showToast("Fill all numeric fields.", true); return; }
    if (!user) return;
    setSubmitting(true);
    try {
      // Look up item for FK -- use packing_material category
      const { data: itemData } = await supabase
        .from("stores_stock_items").select("id, factory_id")
        .eq("is_active", true)
        .eq("category", "packaging_material")
        .limit(1).maybeSingle();

      // Fallback to any item if no PM item found
      const { data: fallback } = itemData
        ? { data: itemData }
        : await supabase.from("stores_stock_items").select("id, factory_id")
            .eq("is_active", true).limit(1).maybeSingle();

      const anchor = (fallback ?? itemData) as { id: string; factory_id: string } | null;
      if (!anchor) {
        showToast("No stock items found. Run migration 027 in Supabase first.", true);
        setSubmitting(false); return;
      }

      const payload: SavedPmRow = {
        id: "",
        date:         entry.date,
        product:      entry.product,
        op_bal:       Number(entry.op_bal)       || 0,
        qty_received: Number(entry.qty_received) || 0,
        by_transfer:  Number(entry.by_transfer)  || 0,
        qty_issued:   Number(entry.qty_issued)   || 0,
        to_transfer:  Number(entry.to_transfer)  || 0,
        cl_bal:       clBal,
        status:       entry.status,
        remark:       entry.remark,
      };

      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id:            anchor.id,
        factory_id:         anchor.factory_id,
        transaction_date:   entry.date,
        transaction_source: "manual",
        qty_received:       payload.qty_received + payload.by_transfer,
        qty_issued:         payload.qty_issued + payload.to_transfer,
        dispatch_qty:       0,
        closing_balance:    clBal,
        reference_type:     "pm_entry",
        remark:             JSON.stringify(payload),
        entered_by:         user.id,
      });

      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("Saved -- " + entry.product + " Cl. Bal: " + clBal.toFixed(0));
      setEntry(blankPmEntry()); loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  const filtered = filterProduct === "ALL"
    ? history
    : history.filter(r => r.product === filterProduct);

  return (
    <>
      <div className="card">
        <h3>Packing Material Entry</h3>

        {/* Row 1: Date | Name of Product */}
        <div className="row2">
          <div>
            <label>Date *</label>
            <input type="date" value={entry.date}
              onChange={e => setField("date", e.target.value)} />
          </div>
          <div>
            <label>Name of Product *</label>
            <select value={entry.product}
              onChange={e => handleProductChange(e.target.value as PmProduct | "")}>
              <option value="">-- Select product --</option>
              {PM_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: Op. Bal (C) | Qty.Rec (D) | By Transfer (E) */}
        <div className="row3">
          <div>
            <label>Op. Bal (C)</label>
            <input type="number" step="1" placeholder="0"
              value={entry.op_bal}
              onChange={e => setField("op_bal", e.target.value)} />
          </div>
          <div>
            <label>Qty. Rec (D)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={entry.qty_received}
              onChange={e => setField("qty_received", e.target.value)} />
          </div>
          <div>
            <label>By Transfer (E)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={entry.by_transfer}
              onChange={e => setField("by_transfer", e.target.value)} />
          </div>
        </div>

        {/* Row 3: Qty. Issued (F) | To Transfer (G) | Cl. Bal (H) computed */}
        <div className="row3">
          <div>
            <label>Qty. Issued (F)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={entry.qty_issued}
              onChange={e => setField("qty_issued", e.target.value)} />
          </div>
          <div>
            <label>To Transfer (G)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={entry.to_transfer}
              onChange={e => setField("to_transfer", e.target.value)} />
          </div>
          <div>
            <label>Cl. Bal (H = C+D+E-F-G)</label>
            <input type="text" disabled
              value={clBal != null ? clBal.toFixed(0) : "N/A"}
              style={{
                fontWeight: 700,
                color: clBal != null && clBal < 0 ? "var(--warn)" : "var(--ok)",
              }} />
          </div>
        </div>

        {/* Row 4: Status | Remark */}
        <div className="row2">
          <div>
            <label>Status (I)</label>
            <select value={entry.status}
              onChange={e => setField("status", e.target.value)}>
              <option value="">-- Select --</option>
              {PM_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label>Remark (J)</label>
            <input type="text" placeholder="Optional note..."
              value={entry.remark}
              onChange={e => setField("remark", e.target.value)} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !entry.product || clBal == null}
        onClick={handleSave}>
        {submitting ? "Saving..." : "Save Packing Material Entry"}
      </button>

      {/* History table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>Packing Material History</h3>
          <select value={filterProduct}
            onChange={e => setFilterProduct(e.target.value as PmProduct | "ALL")}
            style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}>
            <option value="ALL">All Products</option>
            {PM_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {histLoading
          ? <div className="empty">Loading...</div>
          : filtered.length === 0
            ? <div className="empty">No entries yet.</div>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="dash" style={{ minWidth: 820 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Name of Product</th>
                      <th style={{ textAlign: "right" }}>Op. Bal (C)</th>
                      <th style={{ textAlign: "right" }}>Qty.Rec (D)</th>
                      <th style={{ textAlign: "right" }}>By Transfer (E)</th>
                      <th style={{ textAlign: "right" }}>Qty. Issued (F)</th>
                      <th style={{ textAlign: "right" }}>To Transfer (G)</th>
                      <th style={{ textAlign: "right" }}>Cl. Bal (H)</th>
                      <th>Status (I)</th>
                      <th>Remark (J)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(row.date)}</td>
                        <td style={{ fontSize: 12, fontWeight: 600 }}>{row.product}</td>
                        <td style={{ textAlign: "right" }}>{row.op_bal.toFixed(0)}</td>
                        <td style={{ textAlign: "right",
                          color: row.qty_received > 0 ? "var(--ok)" : undefined }}>
                          {row.qty_received > 0 ? "+" + row.qty_received.toFixed(0) : "0"}
                        </td>
                        <td style={{ textAlign: "right",
                          color: row.by_transfer > 0 ? "var(--ok)" : undefined }}>
                          {row.by_transfer > 0 ? "+" + row.by_transfer.toFixed(0) : "0"}
                        </td>
                        <td style={{ textAlign: "right",
                          color: row.qty_issued > 0 ? "var(--warn)" : undefined }}>
                          {row.qty_issued > 0 ? row.qty_issued.toFixed(0) : "0"}
                        </td>
                        <td style={{ textAlign: "right",
                          color: row.to_transfer > 0 ? "var(--clay)" : undefined }}>
                          {row.to_transfer > 0 ? row.to_transfer.toFixed(0) : "0"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700,
                          color: row.cl_bal < 0 ? "var(--warn)" : undefined }}>
                          {row.cl_bal.toFixed(0)}
                        </td>
                        <td>
                          <span style={{
                            fontSize: 11, fontWeight: 700,
                            padding: "2px 6px", borderRadius: 6,
                            background: row.status === "GOOD" ? "var(--ok-soft)"
                              : row.status === "OUT OF STOCK" ? "var(--warn-soft)"
                              : row.status === "LESS" ? "#fff3cd"
                              : "transparent",
                            color: row.status === "GOOD" ? "var(--ok)"
                              : row.status === "OUT OF STOCK" ? "var(--warn)"
                              : row.status === "LESS" ? "#7d6608"
                              : "var(--ink-soft)",
                          }}>
                            {row.status || "N/A"}
                          </span>
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
// FINISHED GOODS SECTION
//
// Mirrors the FINISHED GOODS (SULPHUR POWDER) 2026-27 tab in the DPR Excel.
// Columns:
//   B  Sulphur Powder (product name)
//   C  O/BAL in BAGS   (Opening Balance in bags)
//   D  PROD            (Production in bags)
//   E  Repacking material / BY TR
//   F  Less packing Stock
//   G  Transfer material / TO TR
//   H  Dispatch
//   I  C/BAL IN BAGS   Formula: I = C + D + E - F - G - H
//   J  TOTAL MT        = C/BAL IN BAGS x bag_kg / 1000
//
// Bag sizes by product:
//   Standard (25 kg) : most products
//   50 kg            : RUBBER MAKER.50 KG, OLD BAGS (SHAKTI & OTHERS), J.K. INDUSTRIES
//   550 kg           : Sulphur Powder(Jumbo Bag-550 KG)
//   500 kg           : BRIDGESTONE WE-10(500 KG JUMBO)
// =============================================================================

const FG_PRODUCTS: { name: string; bagKg: number }[] = [
  { name: "CEAT-108/ EXPORT",                         bagKg: 25  },
  { name: "MRF LIMITED (M-2615)",                     bagKg: 25  },
  { name: "EXPORT Plain Bag 25 KG A2052",              bagKg: 25  },
  { name: "LANXESS INDIA PVT LTD",                    bagKg: 25  },
  { name: "CEAT HALOL/NAGPUR-R5299(Halol/Nag)",        bagKg: 25  },
  { name: "APOLLO TYRE/CLASSIC AUTO 160108",           bagKg: 25  },
  { name: "CODE 2615 w/o Oil (MRF Grade)",             bagKg: 25  },
  { name: "Lanxess 2% Oil",                            bagKg: 25  },
  { name: "MRF Ltd 2615 - Rejected",                  bagKg: 25  },
  { name: "Lanxess R.M. 25 KG - Rejected",            bagKg: 25  },
  { name: "CEAT R5299 - Rejected",                    bagKg: 25  },
  { name: "Apollo 160108 - Rejected",                 bagKg: 25  },
  { name: "Jayam Chemical 0.5% Silica",               bagKg: 25  },
  { name: "EOC POLYMERS",                             bagKg: 25  },
  { name: "BRIDGESTONE WE-10 FINISHED",               bagKg: 25  },
  { name: "BRIDGESTONE/Lanxess(Semifinish) PLA",      bagKg: 25  },
  { name: "RUBBER MAKER.50 KG",                       bagKg: 50  },
  { name: "OLD BAGS (SHAKTI & OTHERS)",               bagKg: 50  },
  { name: "J.K. INDUSTRIES",                         bagKg: 50  },
  { name: "FOR PESTICIDE FORMULATION (SC)",           bagKg: 25  },
  { name: "Sulphur Powder(Jumbo Bag-550 KG)",         bagKg: 550 },
  { name: "BRIDGESTONE WE-10(500 KG JUMBO)",          bagKg: 500 },
  { name: "RUBBER MAKER.50 KG - Rejected",            bagKg: 50  },
];

type FgProductName = (typeof FG_PRODUCTS)[number]["name"];

interface FgEntry {
  date: string;
  product: FgProductName | "";
  op_bal: string;
  production: string;
  repacking_by_tr: string;
  less_packing_stock: string;
  transfer_to_tr: string;
  dispatch: string;
  cl_bal: number | null;    // I = C+D+E-F-G-H
  total_mt: number | null;  // I * bagKg / 1000
  remark: string;
}

interface SavedFgRow {
  id: string;
  date: string;
  product: string;
  bag_kg: number;
  op_bal: number;
  production: number;
  repacking_by_tr: number;
  less_packing_stock: number;
  transfer_to_tr: number;
  dispatch: number;
  cl_bal: number;
  total_mt: number;
  remark: string;
}

function computeFgClBal(e: FgEntry): number | null {
  const c = Number(e.op_bal);
  const d = Number(e.production);
  const ee = Number(e.repacking_by_tr);
  const f = Number(e.less_packing_stock);
  const g = Number(e.transfer_to_tr);
  const h = Number(e.dispatch);
  if ([c, d, ee, f, g, h].some(v => !Number.isFinite(v))) return null;
  return c + d + ee - f - g - h;
}

function blankFgEntry(): FgEntry {
  return {
    date: today(), product: "",
    op_bal: "", production: "", repacking_by_tr: "",
    less_packing_stock: "", transfer_to_tr: "", dispatch: "",
    cl_bal: null, total_mt: null, remark: "",
  };
}

function FinishedGoodsSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [entry, setEntry]           = useState<FgEntry>(blankFgEntry());
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory]       = useState<SavedFgRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [filterProduct, setFilterProduct] = useState<FgProductName | "ALL">("ALL");

  const selectedProd = FG_PRODUCTS.find(p => p.name === entry.product);
  const bagKg = selectedProd?.bagKg ?? 25;
  const clBal = computeFgClBal(entry);
  const totalMt = clBal != null ? (clBal * bagKg) / 1000 : null;

  const setField = <K extends keyof FgEntry>(key: K, val: FgEntry[K]) => {
    setEntry(prev => {
      const next = { ...prev, [key]: val };
      const cl = computeFgClBal(next);
      const bk = FG_PRODUCTS.find(p => p.name === next.product)?.bagKg ?? 25;
      return { ...next, cl_bal: cl, total_mt: cl != null ? (cl * bk) / 1000 : null };
    });
  };

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("id, transaction_date, remark")
      .eq("reference_type", "fg_entry")
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) { showToast("Could not load: " + error.message, true); setHistLoading(false); return; }
    const rows: SavedFgRow[] = [];
    for (const row of (data ?? []) as { id: string; transaction_date: string; remark: string | null }[]) {
      try {
        const p = JSON.parse(row.remark ?? "{}") as Partial<SavedFgRow>;
        rows.push({
          id: row.id, date: row.transaction_date,
          product:            p.product            ?? "",
          bag_kg:             p.bag_kg             ?? 25,
          op_bal:             p.op_bal             ?? 0,
          production:         p.production         ?? 0,
          repacking_by_tr:    p.repacking_by_tr    ?? 0,
          less_packing_stock: p.less_packing_stock ?? 0,
          transfer_to_tr:     p.transfer_to_tr     ?? 0,
          dispatch:           p.dispatch           ?? 0,
          cl_bal:             p.cl_bal             ?? 0,
          total_mt:           p.total_mt           ?? 0,
          remark:             p.remark             ?? "",
        });
      } catch { /* skip */ }
    }
    setHistory(rows); setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Auto-fill op_bal from last closing balance for this product
  const handleProductChange = (product: FgProductName | "") => {
    const last = history.find(r => r.product === product);
    const bk = FG_PRODUCTS.find(p => p.name === product)?.bagKg ?? 25;
    const cl = last ? last.cl_bal : null;
    setEntry({
      ...blankFgEntry(),
      date: entry.date, product,
      op_bal: last ? String(last.cl_bal) : "",
      cl_bal: cl,
      total_mt: cl != null ? (cl * bk) / 1000 : null,
    });
  };

  const handleSave = async () => {
    if (!entry.product) { showToast("Select a product.", true); return; }
    if (clBal == null) { showToast("Fill all numeric fields.", true); return; }
    if (!user) return;
    setSubmitting(true);
    try {
      // Find FG item in stores_stock_items, fallback to any item
      const { data: fgItem } = await supabase
        .from("stores_stock_items").select("id, factory_id")
        .eq("is_active", true).eq("category", "finished_good")
        .limit(1).maybeSingle();
      const { data: anyItem } = fgItem
        ? { data: fgItem }
        : await supabase.from("stores_stock_items").select("id, factory_id")
            .eq("is_active", true).limit(1).maybeSingle();
      const anchor = (anyItem ?? fgItem) as { id: string; factory_id: string } | null;
      if (!anchor) {
        showToast("No stock items found. Run migration 027 first.", true);
        setSubmitting(false); return;
      }
      const payload: SavedFgRow = {
        id: "", date: entry.date, product: entry.product,
        bag_kg:             bagKg,
        op_bal:             Number(entry.op_bal)             || 0,
        production:         Number(entry.production)         || 0,
        repacking_by_tr:    Number(entry.repacking_by_tr)    || 0,
        less_packing_stock: Number(entry.less_packing_stock) || 0,
        transfer_to_tr:     Number(entry.transfer_to_tr)     || 0,
        dispatch:           Number(entry.dispatch)           || 0,
        cl_bal:             clBal,
        total_mt:           totalMt ?? 0,
        remark:             entry.remark,
      };
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id:            anchor.id,
        factory_id:         anchor.factory_id,
        transaction_date:   entry.date,
        transaction_source: "manual",
        qty_received:       payload.production + payload.repacking_by_tr,
        qty_issued:         payload.less_packing_stock + payload.transfer_to_tr,
        dispatch_qty:       payload.dispatch,
        closing_balance:    clBal,
        reference_type:     "fg_entry",
        remark:             JSON.stringify(payload),
        entered_by:         user.id,
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("Saved -- " + entry.product + " C/Bal: " + clBal.toFixed(0) + " bags | " + (totalMt ?? 0).toFixed(3) + " MT");
      setEntry(blankFgEntry()); loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  // Totals for history table TOTAL row
  const filtered = filterProduct === "ALL" ? history : history.filter(r => r.product === filterProduct);
  const totals = {
    op_bal: filtered.reduce((s, r) => s + r.op_bal, 0),
    production: filtered.reduce((s, r) => s + r.production, 0),
    repacking_by_tr: filtered.reduce((s, r) => s + r.repacking_by_tr, 0),
    less_packing_stock: filtered.reduce((s, r) => s + r.less_packing_stock, 0),
    transfer_to_tr: filtered.reduce((s, r) => s + r.transfer_to_tr, 0),
    dispatch: filtered.reduce((s, r) => s + r.dispatch, 0),
    cl_bal: filtered.reduce((s, r) => s + r.cl_bal, 0),
    total_mt: filtered.reduce((s, r) => s + r.total_mt, 0),
  };

  return (
    <>
      <div className="card">
        <h3>Finished Goods Entry (Sulphur Powder)</h3>

        {/* Row 1: Date | Product */}
        <div className="row2">
          <div>
            <label>Date *</label>
            <input type="date" value={entry.date}
              onChange={e => setField("date", e.target.value)} />
          </div>
          <div>
            <label>Sulphur Powder (Product) *</label>
            <select value={entry.product}
              onChange={e => handleProductChange(e.target.value as FgProductName | "")}>
              <option value="">-- Select product --</option>
              {FG_PRODUCTS.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.bagKg} kg/bag)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Bag size info */}
        {entry.product && (
          <div className="field-hint" style={{ marginBottom: 8 }}>
            Bag size: {bagKg} kg/bag | TOTAL MT = C/BAL x {bagKg} / 1000
          </div>
        )}

        {/* Row 2: O/BAL (C) | PROD (D) | Repacking BY TR (E) */}
        <div className="row3">
          <div>
            <label>O/BAL in BAGS (C)</label>
            <input type="number" step="1" placeholder="0"
              value={entry.op_bal}
              onChange={e => setField("op_bal", e.target.value)} />
          </div>
          <div>
            <label>PROD (D)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={entry.production}
              onChange={e => setField("production", e.target.value)} />
          </div>
          <div>
            <label>Repacking material / BY TR (E)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={entry.repacking_by_tr}
              onChange={e => setField("repacking_by_tr", e.target.value)} />
          </div>
        </div>

        {/* Row 3: Less packing Stock (F) | Transfer TO TR (G) | Dispatch (H) */}
        <div className="row3">
          <div>
            <label>Less packing Stock (F)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={entry.less_packing_stock}
              onChange={e => setField("less_packing_stock", e.target.value)} />
          </div>
          <div>
            <label>Transfer material / TO TR (G)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={entry.transfer_to_tr}
              onChange={e => setField("transfer_to_tr", e.target.value)} />
          </div>
          <div>
            <label>Dispatch (H)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={entry.dispatch}
              onChange={e => setField("dispatch", e.target.value)} />
          </div>
        </div>

        {/* Row 4: C/BAL computed | TOTAL MT computed | Remark */}
        <div className="row3">
          <div>
            <label>C/BAL IN BAGS (I = C+D+E-F-G-H)</label>
            <input type="text" disabled
              value={clBal != null ? clBal.toFixed(0) : "N/A"}
              style={{
                fontWeight: 700,
                color: clBal != null && clBal < 0 ? "var(--warn)" : "var(--ok)",
              }} />
          </div>
          <div>
            <label>TOTAL MT (J = I x {bagKg}/1000)</label>
            <input type="text" disabled
              value={totalMt != null ? totalMt.toFixed(3) : "N/A"}
              style={{ fontWeight: 700, color: "var(--clay)" }} />
          </div>
          <div>
            <label>Remark</label>
            <input type="text" placeholder="Optional note..."
              value={entry.remark}
              onChange={e => setField("remark", e.target.value)} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !entry.product || clBal == null}
        onClick={handleSave}>
        {submitting ? "Saving..." : "Save Finished Goods Entry"}
      </button>

      {/* History table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>Finished Goods History</h3>
          <select value={filterProduct}
            onChange={e => setFilterProduct(e.target.value as FgProductName | "ALL")}
            style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}>
            <option value="ALL">All Products</option>
            {FG_PRODUCTS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>

        {histLoading
          ? <div className="empty">Loading...</div>
          : filtered.length === 0
            ? <div className="empty">No entries yet.</div>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="dash" style={{ minWidth: 950 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sulphur Powder</th>
                      <th style={{ textAlign: "right" }}>O/BAL Bags (C)</th>
                      <th style={{ textAlign: "right" }}>PROD (D)</th>
                      <th style={{ textAlign: "right" }}>Repkg/BY TR (E)</th>
                      <th style={{ textAlign: "right" }}>Less Pkg (F)</th>
                      <th style={{ textAlign: "right" }}>Transfer/TO TR (G)</th>
                      <th style={{ textAlign: "right" }}>Dispatch (H)</th>
                      <th style={{ textAlign: "right" }}>C/BAL Bags (I)</th>
                      <th style={{ textAlign: "right", color: "var(--clay)" }}>TOTAL MT (J)</th>
                      <th>Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(row.date)}</td>
                        <td style={{ fontSize: 12, fontWeight: 600, maxWidth: 160, whiteSpace: "normal" }}>
                          {row.product}
                        </td>
                        <td style={{ textAlign: "right" }}>{row.op_bal.toFixed(0)}</td>
                        <td style={{ textAlign: "right",
                          color: row.production > 0 ? "var(--ok)" : undefined }}>
                          {row.production > 0 ? "+" + row.production.toFixed(0) : "0"}
                        </td>
                        <td style={{ textAlign: "right",
                          color: row.repacking_by_tr > 0 ? "var(--ok)" : undefined }}>
                          {row.repacking_by_tr > 0 ? "+" + row.repacking_by_tr.toFixed(0) : "0"}
                        </td>
                        <td style={{ textAlign: "right",
                          color: row.less_packing_stock > 0 ? "var(--warn)" : undefined }}>
                          {row.less_packing_stock > 0 ? row.less_packing_stock.toFixed(0) : "0"}
                        </td>
                        <td style={{ textAlign: "right",
                          color: row.transfer_to_tr > 0 ? "var(--clay)" : undefined }}>
                          {row.transfer_to_tr > 0 ? row.transfer_to_tr.toFixed(0) : "0"}
                        </td>
                        <td style={{ textAlign: "right",
                          color: row.dispatch > 0 ? "var(--warn)" : undefined }}>
                          {row.dispatch > 0 ? row.dispatch.toFixed(0) : "0"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700,
                          color: row.cl_bal < 0 ? "var(--warn)" : undefined }}>
                          {row.cl_bal.toFixed(0)}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700,
                          color: "var(--clay)" }}>
                          {row.total_mt.toFixed(3)}
                        </td>
                        <td style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                          {nilText(row.remark)}
                        </td>
                      </tr>
                    ))}
                    {/* TOTAL row */}
                    {filtered.length > 1 && (
                      <tr style={{ borderTop: "2px solid var(--line)",
                        background: "var(--clay-soft)" }}>
                        <td colSpan={2} style={{ fontWeight: 700 }}>TOTAL</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{totals.op_bal.toFixed(0)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{totals.production.toFixed(0)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{totals.repacking_by_tr.toFixed(0)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{totals.less_packing_stock.toFixed(0)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{totals.transfer_to_tr.toFixed(0)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{totals.dispatch.toFixed(0)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{totals.cl_bal.toFixed(0)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700,
                          color: "var(--clay)", fontSize: 14 }}>{totals.total_mt.toFixed(3)}</td>
                        <td></td>
                      </tr>
                    )}
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
// BALL MILL PRODUCTION SECTION
//
// Mirrors the BALL MILL PRODUCTION 2026-27 tab in the DPR Excel.
//
// LEFT SIDE — Ball Mill Manufacturing Details:
//   A  Date of Ball Milling
//   B  SHIFT  (1ST / 2ND)
//   C  Party  (Lanxess / W10)
//   D  BATCH NO
//   E  Qty. MFG. Ball Mill  (bags)
//   F  KG = E * 25
//   G  Total weight MT = F / 1000
//
// RIGHT SIDE — Dispatch Details with Closing Stock:
//   H  Dispatch Date
//   I  LOCATION
//   J  BATCH NO (dispatch)
//   K  Dispatch Bags
//   L  Balance Bags (Running Balance)
//      Formula: L = L_prev + E(1ST) + E(2ND) - K
//
// Formulas implemented:
//   F (KG)          = E * 25
//   G (Total MT)    = F / 1000  = E * 25 / 1000
//   L (Balance)     = prev_L + sum_of_E_for_date - K
// =============================================================================

const BALL_MILL_SHIFTS   = ["1ST", "2ND"] as const;
const BALL_MILL_PARTIES  = ["Lanxess", "W10"] as const;

type BallMillShift  = (typeof BALL_MILL_SHIFTS)[number];
type BallMillParty  = (typeof BALL_MILL_PARTIES)[number];

/** One production row (left side) */
interface BmProdRow {
  date: string;
  shift: BallMillShift | "";
  party: BallMillParty | "";
  batch_no: string;
  qty_mfg: string;       // E — Qty. MFG. Ball Mill (bags)
  kg: number | null;     // F = E * 25
  total_mt: number | null; // G = F / 1000
}

/** One dispatch row (right side) — can be on the same or different date */
interface BmDispatchRow {
  dispatch_date: string;
  location: string;
  batch_no: string;
  dispatch_bags: string;  // K
}

/** Saved combined entry per submit */
interface SavedBmEntry {
  id: string;
  date: string;
  prod_rows: BmProdRow[];
  dispatch_rows: BmDispatchRow[];
  balance_bags: number;  // L — running balance stored
}

function blankProdRow(): BmProdRow {
  return { date: today(), shift: "", party: "", batch_no: "", qty_mfg: "", kg: null, total_mt: null };
}
function blankBmDispatchRow(): BmDispatchRow {
  return { dispatch_date: today(), location: "", batch_no: "", dispatch_bags: "" };
}

function computeBmRow(r: BmProdRow): BmProdRow {
  const e = Number(r.qty_mfg);
  const kg = Number.isFinite(e) && e >= 0 ? e * 25 : null;
  return { ...r, kg, total_mt: kg != null ? kg / 1000 : null };
}

function BallMillSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [prodRows, setProdRows]         = useState<BmProdRow[]>([blankProdRow()]);
  const [dispatchRows, setDispatchRows] = useState<BmDispatchRow[]>([blankBmDispatchRow()]);
  const [prevBalance, setPrevBalance]   = useState<string>("");
  const [submitting, setSubmitting]     = useState(false);
  const [history, setHistory]           = useState<SavedBmEntry[]>([]);
  const [histLoading, setHistLoading]   = useState(true);

  // Computed balance: prev_L + sum(E rows) - sum(K dispatches)
  const sumProd      = prodRows.reduce((s, r) => s + (Number(r.qty_mfg) || 0), 0);
  const sumDispatch  = dispatchRows.reduce((s, r) => s + (Number(r.dispatch_bags) || 0), 0);
  const prevBal      = Number(prevBalance) || 0;
  const newBalance   = prevBal + sumProd - sumDispatch;

  // Prod row helpers
  const updateProdRow = (idx: number, patch: Partial<BmProdRow>) => {
    setProdRows(prev => prev.map((r, i) =>
      i === idx ? computeBmRow({ ...r, ...patch }) : r
    ));
  };
  const addProdRow    = () => setProdRows(prev => [...prev, blankProdRow()]);
  const removeProdRow = (idx: number) => {
    if (prodRows.length === 1) return;
    setProdRows(prev => prev.filter((_, i) => i !== idx));
  };

  // Dispatch row helpers
  const updateDispatch = (idx: number, patch: Partial<BmDispatchRow>) =>
    setDispatchRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const addDispatch    = () => setDispatchRows(prev => [...prev, blankBmDispatchRow()]);
  const removeDispatch = (idx: number) => {
    if (dispatchRows.length === 1) return;
    setDispatchRows(prev => prev.filter((_, i) => i !== idx));
  };

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("id, transaction_date, remark")
      .eq("reference_type", "ball_mill_entry")
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) { showToast("Could not load: " + error.message, true); setHistLoading(false); return; }
    const rows: SavedBmEntry[] = [];
    for (const row of (data ?? []) as { id: string; transaction_date: string; remark: string | null }[]) {
      try {
        const p = JSON.parse(row.remark ?? "{}") as Partial<SavedBmEntry>;
        rows.push({
          id: row.id, date: row.transaction_date,
          prod_rows:     p.prod_rows     ?? [],
          dispatch_rows: p.dispatch_rows ?? [],
          balance_bags:  p.balance_bags  ?? 0,
        });
      } catch { /* skip */ }
    }
    setHistory(rows);
    // Auto-fill prev balance from most recent entry
    if (rows.length > 0) setPrevBalance(String(rows[0].balance_bags));
    setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSave = async () => {
    if (!user) return;
    const hasAnyProd = prodRows.some(r => r.qty_mfg.trim() !== "" && r.date && r.shift && r.party);
    if (!hasAnyProd) { showToast("Fill at least one production row (date, shift, party, qty).", true); return; }
    setSubmitting(true);
    try {
      const { data: anchor } = await supabase
        .from("stores_stock_items").select("id, factory_id")
        .eq("is_active", true).limit(1).maybeSingle();
      if (!anchor) {
        showToast("No stock items found. Run migration 027 first.", true);
        setSubmitting(false); return;
      }
      const computedRows = prodRows.map(computeBmRow);
      const payload: Omit<SavedBmEntry, "id"> = {
        date:          computedRows[0]?.date ?? today(),
        prod_rows:     computedRows,
        dispatch_rows: dispatchRows,
        balance_bags:  newBalance,
      };
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id:            anchor.id,
        factory_id:         anchor.factory_id,
        transaction_date:   payload.date,
        transaction_source: "manual",
        qty_received:       sumProd * 25,
        qty_issued:         sumDispatch * 25,
        dispatch_qty:       0,
        closing_balance:    newBalance,
        reference_type:     "ball_mill_entry",
        remark:             JSON.stringify(payload),
        entered_by:         user.id,
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("Ball Mill entry saved -- Balance: " + newBalance + " bags");
      setProdRows([blankProdRow()]);
      setDispatchRows([blankBmDispatchRow()]);
      loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      {/* ── Manufacturing Details ── */}
      <div className="card">
        <div className="helper-row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Ball Mill Manufacturing Details</h3>
          <button type="button" className="btn btn-ghost"
            style={{ width: "auto", padding: "6px 14px", fontSize: 12, marginTop: 0 }}
            onClick={addProdRow}>+ Add Row</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--clay-soft)" }}>
                <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 11 }}>Date (A)</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 11 }}>Shift (B)</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 11 }}>Party (C)</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 11 }}>Batch No (D)</th>
                <th style={{ padding: "8px 6px", textAlign: "right", fontSize: 11 }}>Qty MFG Bags (E)</th>
                <th style={{ padding: "8px 6px", textAlign: "right", fontSize: 11 }}>KG (F=E*25)</th>
                <th style={{ padding: "8px 6px", textAlign: "right", fontSize: 11 }}>Total MT (G=F/1000)</th>
                <th style={{ padding: "8px 6px", width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {prodRows.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 4px" }}>
                    <input type="date" value={row.date}
                      onChange={e => updateProdRow(idx, { date: e.target.value })}
                      style={{ width: 130, padding: "4px 6px", fontSize: 12,
                        border: "1px solid var(--line)", borderRadius: 6 }} />
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <select value={row.shift}
                      onChange={e => updateProdRow(idx, { shift: e.target.value as BallMillShift | "" })}
                      style={{ padding: "4px 6px", fontSize: 12,
                        border: "1px solid var(--line)", borderRadius: 6 }}>
                      <option value="">--</option>
                      {BALL_MILL_SHIFTS.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <select value={row.party}
                      onChange={e => updateProdRow(idx, { party: e.target.value as BallMillParty | "" })}
                      style={{ padding: "4px 6px", fontSize: 12,
                        border: "1px solid var(--line)", borderRadius: 6 }}>
                      <option value="">--</option>
                      {BALL_MILL_PARTIES.map(p => (
                        <option key={p} value={p}
                          style={{ color: p === "Lanxess" ? "var(--clay)" : "var(--ok)" }}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input type="text" value={row.batch_no}
                      onChange={e => updateProdRow(idx, { batch_no: e.target.value })}
                      placeholder="e.g. 215"
                      style={{ width: 80, padding: "4px 6px", fontSize: 12,
                        border: "1px solid var(--line)", borderRadius: 6 }} />
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right" }}>
                    <input type="number" min="0" step="1" value={row.qty_mfg}
                      onChange={e => updateProdRow(idx, { qty_mfg: e.target.value })}
                      placeholder="0"
                      style={{ width: 70, padding: "4px 6px", fontSize: 12,
                        border: "1px solid var(--line)", borderRadius: 6,
                        textAlign: "right" }} />
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: 600 }}>
                    {row.kg != null ? row.kg.toFixed(0) : "0"}
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: 600,
                    color: "var(--clay)" }}>
                    {row.total_mt != null ? row.total_mt.toFixed(3) : "0.000"}
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "center" }}>
                    {prodRows.length > 1 && (
                      <button type="button" onClick={() => removeProdRow(idx)}
                        style={{ background: "none", border: "none",
                          color: "var(--warn)", cursor: "pointer", fontSize: 14 }}>
                        x
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {/* Summary row */}
              <tr style={{ background: "var(--clay-soft)", fontWeight: 700 }}>
                <td colSpan={4} style={{ padding: "8px 6px", fontSize: 12 }}>Total</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{sumProd}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{(sumProd * 25).toFixed(0)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right", color: "var(--clay)" }}>
                  {(sumProd * 25 / 1000).toFixed(3)}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Dispatch Details ── */}
      <div className="card">
        <div className="helper-row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Dispatch Details with Closing Stock</h3>
          <button type="button" className="btn btn-ghost"
            style={{ width: "auto", padding: "6px 14px", fontSize: 12, marginTop: 0 }}
            onClick={addDispatch}>+ Add Dispatch</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#e8f4e8" }}>
                <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 11 }}>Dispatch Date (H)</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 11 }}>Location (I)</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 11 }}>Batch No (J)</th>
                <th style={{ padding: "8px 6px", textAlign: "right", fontSize: 11 }}>Dispatch Bags (K)</th>
                <th style={{ padding: "8px 6px", width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {dispatchRows.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 4px" }}>
                    <input type="date" value={row.dispatch_date}
                      onChange={e => updateDispatch(idx, { dispatch_date: e.target.value })}
                      style={{ width: 130, padding: "4px 6px", fontSize: 12,
                        border: "1px solid var(--line)", borderRadius: 6 }} />
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input type="text" value={row.location}
                      onChange={e => updateDispatch(idx, { location: e.target.value })}
                      placeholder="e.g. Pune, Lanxess"
                      style={{ width: 100, padding: "4px 6px", fontSize: 12,
                        border: "1px solid var(--line)", borderRadius: 6 }} />
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input type="text" value={row.batch_no}
                      onChange={e => updateDispatch(idx, { batch_no: e.target.value })}
                      placeholder="e.g. 1,05,11,31"
                      style={{ width: 120, padding: "4px 6px", fontSize: 12,
                        border: "1px solid var(--line)", borderRadius: 6 }} />
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right" }}>
                    <input type="number" min="0" step="1" value={row.dispatch_bags}
                      onChange={e => updateDispatch(idx, { dispatch_bags: e.target.value })}
                      placeholder="0"
                      style={{ width: 70, padding: "4px 6px", fontSize: 12,
                        border: "1px solid var(--line)", borderRadius: 6,
                        textAlign: "right" }} />
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "center" }}>
                    {dispatchRows.length > 1 && (
                      <button type="button" onClick={() => removeDispatch(idx)}
                        style={{ background: "none", border: "none",
                          color: "var(--warn)", cursor: "pointer", fontSize: 14 }}>
                        x
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Running Balance (L) ── */}
      <div className="card">
        <h3>Running Balance (L = prev_L + sum_E - sum_K)</h3>
        <div className="row3">
          <div>
            <label>Previous Balance (L_prev)</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={prevBalance}
              onChange={e => setPrevBalance(e.target.value)} />
            <div className="field-hint">Auto-filled from last saved entry</div>
          </div>
          <div>
            <label>Total Produced (sum E)</label>
            <input type="text" disabled value={sumProd}
              style={{ fontWeight: 600, color: "var(--ok)" }} />
          </div>
          <div>
            <label>Total Dispatched (sum K)</label>
            <input type="text" disabled value={sumDispatch}
              style={{ fontWeight: 600, color: "var(--warn)" }} />
          </div>
        </div>
        <div style={{
          marginTop: 12, padding: "12px 16px",
          background: "var(--clay-soft)", borderRadius: 8,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            Balance Bags (L = {prevBal} + {sumProd} - {sumDispatch})
          </span>
          <span style={{ fontWeight: 700, fontSize: 20,
            color: newBalance < 0 ? "var(--warn)" : "var(--clay)" }}>
            {newBalance} bags
          </span>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting} onClick={handleSave}>
        {submitting ? "Saving..." : "Save Ball Mill Entry"}
      </button>

      {/* ── History ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Ball Mill History</h3>
        {histLoading ? <div className="empty">Loading...</div>
          : history.length === 0 ? <div className="empty">No entries yet.</div>
          : history.map(entry => (
            <div key={entry.id} style={{
              border: "1px solid var(--line)", borderRadius: 8,
              padding: 12, marginBottom: 12,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                marginBottom: 8, fontWeight: 700, fontSize: 13 }}>
                <span>{fmtDate(entry.date)}</span>
                <span style={{ color: "var(--clay)" }}>
                  Balance: {entry.balance_bags} bags
                </span>
              </div>

              {/* Production rows */}
              {entry.prod_rows.length > 0 && (
                <div style={{ overflowX: "auto", marginBottom: 8 }}>
                  <table className="dash" style={{ minWidth: 500, fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Date</th><th>Shift</th><th>Party</th>
                        <th>Batch</th>
                        <th style={{ textAlign: "right" }}>Bags</th>
                        <th style={{ textAlign: "right" }}>KG</th>
                        <th style={{ textAlign: "right" }}>MT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.prod_rows.map((r, i) => (
                        <tr key={i}>
                          <td>{fmtDate(r.date)}</td>
                          <td style={{ fontWeight: 700,
                            color: r.shift === "1ST" ? "var(--clay)" : "var(--ok)" }}>
                            {r.shift}
                          </td>
                          <td style={{ color: r.party === "Lanxess" ? "var(--clay)" : "var(--ok)",
                            fontWeight: 600 }}>{r.party}</td>
                          <td>{nilText(r.batch_no)}</td>
                          <td style={{ textAlign: "right" }}>{r.qty_mfg || "0"}</td>
                          <td style={{ textAlign: "right" }}>{r.kg != null ? r.kg.toFixed(0) : "0"}</td>
                          <td style={{ textAlign: "right" }}>
                            {r.total_mt != null ? r.total_mt.toFixed(3) : "0.000"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Dispatch rows */}
              {entry.dispatch_rows.some(r => r.dispatch_bags.trim() !== "") && (
                <div style={{ overflowX: "auto" }}>
                  <table className="dash" style={{ minWidth: 420, fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Dispatch Date</th>
                        <th>Location</th>
                        <th>Batch No</th>
                        <th style={{ textAlign: "right" }}>Dispatch Bags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.dispatch_rows.filter(r => r.dispatch_bags.trim() !== "").map((r, i) => (
                        <tr key={i}>
                          <td>{fmtDate(r.dispatch_date)}</td>
                          <td>{nilText(r.location)}</td>
                          <td>{nilText(r.batch_no)}</td>
                          <td style={{ textAlign: "right", fontWeight: 700,
                            color: "var(--warn)" }}>
                            {r.dispatch_bags}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))
        }
      </div>
    </>
  );
}

// =============================================================================
// BATCH WISE SECTION
//
// Columns (from the Excel Batch Wise tab):
//   A  Batch No.
//   B  Qty in Bags
//   C  Code
//   D  Mfg Date
//   E  Qty in MT        = IF(Code="Rubber" OR "JKI", B*50, B*25) / 1000
//   F  1st Dispatch Date
//   G  1st Inv No.
//   H  1st Qty in Bag
//   I  2nd Dispatch Date
//   J  2nd Inv No.
//   K  2nd Qty in Bag
//   (more dispatch slots can be added)
//   O  Remaining Qty in Bags = B - H - K - N...
//   P  Remaining Qty in MT   = IF(Code="Rubber" OR "JKI", O*50, O*25) / 1000
//
// Dispatch slots: starts with 2, user can add more (3rd, 4th, etc.)
// Column B also supports manual arithmetic expressions (e.g. "12+49+51").
// =============================================================================

const BATCH_CODES = [
  "JKI","MRF","P2615","w10","Ceat","Apollo","R5299","Rubber",
  "Export","Lanxess","160108","Shakti","2615","BKT",
] as const;
type BatchCode = (typeof BATCH_CODES)[number];

// Codes that use 50 kg bags
const HEAVY_CODES: string[] = ["Rubber", "JKI"];

function bagKgForCode(code: string): number {
  return HEAVY_CODES.includes(code) ? 50 : 25;
}

/** Evaluate a simple arithmetic expression like "12+49+51" safely */
function evalArith(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  // Only allow digits, +, -, spaces, dots
  if (!/^[\d\s+\-.]+$/.test(trimmed)) return null;
  try {
    // Split on + and -, parse as sum
    const parts = trimmed.split("+").map(p => p.trim());
    const total = parts.reduce((sum, p) => {
      const n = Number(p);
      return Number.isFinite(n) ? sum + n : NaN;
    }, 0);
    return Number.isFinite(total) ? total : null;
  } catch { return null; }
}

interface DispatchSlot {
  date: string;
  inv_no: string;
  qty_bags: string;
}

interface BatchWiseEntry {
  batch_no: string;
  qty_bags: string;          // B — supports "12+49+51" arithmetic
  code: BatchCode | "";
  mfg_date: string;
  dispatches: DispatchSlot[];
}

interface SavedBatchRow {
  id: string;
  batch_no: string;
  qty_bags_expr: string;
  qty_bags: number;
  code: string;
  mfg_date: string;
  qty_mt: number;
  dispatches: DispatchSlot[];
  remaining_bags: number;
  remaining_mt: number;
}

function blankDispatchSlot(): DispatchSlot {
  return { date: "", inv_no: "", qty_bags: "" };
}

function blankBatchEntry(): BatchWiseEntry {
  return {
    batch_no: "", qty_bags: "", code: "", mfg_date: today(),
    dispatches: [blankDispatchSlot(), blankDispatchSlot()],
  };
}

function computeBatchDerived(e: BatchWiseEntry): {
  qtyBags: number | null;
  qtyMt: number | null;
  remainingBags: number | null;
  remainingMt: number | null;
} {
  const qtyBags = evalArith(e.qty_bags);
  const bkKg = bagKgForCode(e.code);
  const qtyMt = qtyBags != null ? (qtyBags * bkKg) / 1000 : null;

  const totalDispatched = e.dispatches.reduce((s, d) => {
    const n = evalArith(d.qty_bags);
    return s + (n ?? 0);
  }, 0);

  const remainingBags = qtyBags != null ? qtyBags - totalDispatched : null;
  const remainingMt   = remainingBags != null ? (remainingBags * bkKg) / 1000 : null;

  return { qtyBags, qtyMt, remainingBags, remainingMt };
}

function BatchWiseSection() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [entry, setEntry]           = useState<BatchWiseEntry>(blankBatchEntry());
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory]       = useState<SavedBatchRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [filterCode, setFilterCode] = useState<BatchCode | "ALL">("ALL");

  const derived = computeBatchDerived(entry);

  const setField = <K extends keyof BatchWiseEntry>(key: K, val: BatchWiseEntry[K]) =>
    setEntry(prev => ({ ...prev, [key]: val }));

  const updateDispatch = (idx: number, patch: Partial<DispatchSlot>) =>
    setEntry(prev => ({
      ...prev,
      dispatches: prev.dispatches.map((d, i) => i === idx ? { ...d, ...patch } : d),
    }));

  const addDispatch = () =>
    setEntry(prev => ({ ...prev, dispatches: [...prev.dispatches, blankDispatchSlot()] }));

  const removeDispatch = (idx: number) => {
    if (entry.dispatches.length <= 2) {
      showToast("Minimum 2 dispatch slots required.", true); return;
    }
    setEntry(prev => ({ ...prev, dispatches: prev.dispatches.filter((_, i) => i !== idx) }));
  };

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    const { data, error } = await supabase
      .from("stores_stock_ledger")
      .select("id, transaction_date, remark")
      .eq("reference_type", "batch_wise_entry")
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) { showToast("Could not load: " + error.message, true); setHistLoading(false); return; }
    const rows: SavedBatchRow[] = [];
    for (const row of (data ?? []) as { id: string; transaction_date: string; remark: string | null }[]) {
      try {
        const p = JSON.parse(row.remark ?? "{}") as Partial<SavedBatchRow>;
        rows.push({
          id: row.id,
          batch_no:       p.batch_no       ?? "",
          qty_bags_expr:  p.qty_bags_expr  ?? "",
          qty_bags:       p.qty_bags       ?? 0,
          code:           p.code           ?? "",
          mfg_date:       p.mfg_date       ?? row.transaction_date,
          qty_mt:         p.qty_mt         ?? 0,
          dispatches:     p.dispatches     ?? [],
          remaining_bags: p.remaining_bags ?? 0,
          remaining_mt:   p.remaining_mt   ?? 0,
        });
      } catch { /* skip */ }
    }
    setHistory(rows); setHistLoading(false);
  }, [supabase, showToast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSave = async () => {
    if (!entry.batch_no.trim()) { showToast("Enter a Batch No.", true); return; }
    if (!entry.code) { showToast("Select a Code.", true); return; }
    if (derived.qtyBags == null) { showToast("Enter a valid Qty in Bags (numbers or arithmetic like 12+49+51).", true); return; }
    if (!user) return;
    setSubmitting(true);
    try {
      const { data: anchor } = await supabase
        .from("stores_stock_items").select("id, factory_id")
        .eq("is_active", true).limit(1).maybeSingle();
      if (!anchor) {
        showToast("No stock items found. Run migration 027 first.", true);
        setSubmitting(false); return;
      }
      const totalDispatched = entry.dispatches.reduce((s, d) => s + (evalArith(d.qty_bags) ?? 0), 0);
      const payload: Omit<SavedBatchRow, "id"> = {
        batch_no:       entry.batch_no.trim(),
        qty_bags_expr:  entry.qty_bags.trim(),
        qty_bags:       derived.qtyBags ?? 0,
        code:           entry.code,
        mfg_date:       entry.mfg_date,
        qty_mt:         derived.qtyMt ?? 0,
        dispatches:     entry.dispatches,
        remaining_bags: derived.remainingBags ?? 0,
        remaining_mt:   derived.remainingMt   ?? 0,
      };
      const { error } = await supabase.from("stores_stock_ledger").insert({
        item_id:            anchor.id,
        factory_id:         anchor.factory_id,
        transaction_date:   entry.mfg_date || today(),
        transaction_source: "manual",
        qty_received:       derived.qtyBags ?? 0,
        qty_issued:         totalDispatched,
        dispatch_qty:       0,
        closing_balance:    derived.remainingBags ?? 0,
        reference_type:     "batch_wise_entry",
        remark:             JSON.stringify(payload),
        entered_by:         user.id,
      });
      if (error) { showToast("Save failed: " + error.message, true); return; }
      showToast("Batch saved -- " + entry.batch_no + " Remaining: " + (derived.remainingBags ?? 0) + " bags / " + (derived.remainingMt ?? 0).toFixed(3) + " MT");
      setEntry(blankBatchEntry()); loadHistory();
    } catch (e: unknown) {
      showToast("Error: " + (e instanceof Error ? e.message : String(e)), true);
    } finally { setSubmitting(false); }
  };

  const filtered = filterCode === "ALL" ? history : history.filter(r => r.code === filterCode);

  return (
    <>
      <div className="card">
        <h3>Batch Wise Entry</h3>

        {/* Row 1: Batch No | Code | Mfg Date */}
        <div className="row3">
          <div>
            <label>Batch No. (A) *</label>
            <input type="text" placeholder="e.g. 164, Ex61"
              value={entry.batch_no}
              onChange={e => setField("batch_no", e.target.value)} />
          </div>
          <div>
            <label>Code (C) *</label>
            <select value={entry.code}
              onChange={e => setField("code", e.target.value as BatchCode | "")}>
              <option value="">-- Select code --</option>
              {BATCH_CODES.map(c => (
                <option key={c} value={c}>
                  {c} {HEAVY_CODES.includes(c) ? "(50 kg/bag)" : "(25 kg/bag)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Mfg Date (D)</label>
            <input type="date" value={entry.mfg_date}
              onChange={e => setField("mfg_date", e.target.value)} />
          </div>
        </div>

        {/* Row 2: Qty in Bags (supports arithmetic) | Qty in MT (computed) */}
        <div className="row2">
          <div>
            <label>Qty in Bags (B) -- supports arithmetic like 12+49+51</label>
            <input type="text" placeholder="e.g. 200 or 12+49+51"
              value={entry.qty_bags}
              onChange={e => setField("qty_bags", e.target.value)} />
            {derived.qtyBags != null && entry.qty_bags.includes("+") && (
              <div className="field-hint">= {derived.qtyBags} bags</div>
            )}
          </div>
          <div>
            <label>
              Qty in MT (E = B x {entry.code ? bagKgForCode(entry.code) : 25} / 1000)
            </label>
            <input type="text" disabled
              value={derived.qtyMt != null ? derived.qtyMt.toFixed(3) : "N/A"}
              style={{ fontWeight: 700, color: "var(--ok)" }} />
          </div>
        </div>

        {/* Dispatch Slots */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: 8 }}>
            <label style={{ margin: 0, fontSize: 13, fontWeight: 700,
              color: "var(--clay)", textTransform: "uppercase" }}>
              Dispatch Details ({entry.dispatches.length} slots)
            </label>
            <button type="button" className="btn btn-ghost"
              style={{ width: "auto", padding: "5px 12px", fontSize: 12, marginTop: 0 }}
              onClick={addDispatch}>
              + Add Dispatch Slot
            </button>
          </div>

          {entry.dispatches.map((d, idx) => (
            <div key={idx} style={{
              border: "1px solid var(--line)", borderRadius: 8,
              padding: 10, marginBottom: 8, background: "var(--surface)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 12,
                  color: "var(--ink-soft)" }}>
                  {idx === 0 ? "1st" : idx === 1 ? "2nd" : idx === 2 ? "3rd" : (idx+1)+"th"} Dispatch
                </span>
                {entry.dispatches.length > 2 && (
                  <button type="button"
                    onClick={() => removeDispatch(idx)}
                    style={{ background: "none", border: "none",
                      color: "var(--warn)", cursor: "pointer",
                      fontSize: 12, fontWeight: 700 }}>
                    Remove
                  </button>
                )}
              </div>
              <div className="row3">
                <div>
                  <label style={{ fontSize: 11 }}>
                    {idx === 0 ? "F" : idx === 1 ? "I" : idx === 2 ? "L" : String.fromCharCode(70 + idx*3)} — Dispatch Date
                  </label>
                  <input type="date" value={d.date}
                    onChange={e => updateDispatch(idx, { date: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 11 }}>
                    {idx === 0 ? "G" : idx === 1 ? "J" : idx === 2 ? "M" : "-"} — Inv No.
                  </label>
                  <input type="text" placeholder="e.g. C/119/26-27"
                    value={d.inv_no}
                    onChange={e => updateDispatch(idx, { inv_no: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 11 }}>
                    {idx === 0 ? "H" : idx === 1 ? "K" : idx === 2 ? "N" : "-"} — Qty in Bags (arithmetic ok)
                  </label>
                  <input type="text" placeholder="e.g. 28 or 2+12+26"
                    value={d.qty_bags}
                    onChange={e => updateDispatch(idx, { qty_bags: e.target.value })} />
                  {d.qty_bags.includes("+") && evalArith(d.qty_bags) != null && (
                    <div className="field-hint">= {evalArith(d.qty_bags)} bags</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Remaining summary */}
        <div style={{
          marginTop: 12, padding: "12px 16px",
          background: "var(--clay-soft)", borderRadius: 8,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                Remaining Qty in Bags (O = B - H - K - N...)
              </div>
              <div className="field-hint">
                {derived.qtyBags ?? 0}{" "}
                {entry.dispatches.map((d, i) => {
                  const n = evalArith(d.qty_bags);
                  return n != null && n > 0 ? " - " + n : "";
                }).join("")}
                {" "}= {derived.remainingBags ?? 0}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, fontSize: 18,
                color: (derived.remainingBags ?? 0) < 0 ? "var(--warn)" : "var(--clay)" }}>
                {derived.remainingBags ?? 0} bags
              </div>
              <div style={{ fontWeight: 700, fontSize: 14,
                color: "var(--ink-soft)" }}>
                {derived.remainingMt != null ? derived.remainingMt.toFixed(3) : "0.000"} MT
              </div>
            </div>
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting || !entry.batch_no.trim() || !entry.code}
        onClick={handleSave}>
        {submitting ? "Saving..." : "Save Batch Entry"}
      </button>

      {/* History table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>Batch Wise History</h3>
          <select value={filterCode}
            onChange={e => setFilterCode(e.target.value as BatchCode | "ALL")}
            style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}>
            <option value="ALL">All Codes</option>
            {BATCH_CODES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {histLoading ? <div className="empty">Loading...</div>
          : filtered.length === 0 ? <div className="empty">No entries yet.</div>
          : (
            <div style={{ overflowX: "auto" }}>
              <table className="dash" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>Batch No (A)</th>
                    <th>Code (C)</th>
                    <th>Mfg Date (D)</th>
                    <th style={{ textAlign: "right" }}>Qty Bags (B)</th>
                    <th style={{ textAlign: "right" }}>Qty MT (E)</th>
                    {[0, 1, 2].map(i => (
                      <th key={i} style={{ textAlign: "center", fontSize: 10 }}>
                        {i === 0 ? "1st" : i === 1 ? "2nd" : "3rd"} Dispatch
                        <br />(Date / Inv / Bags)
                      </th>
                    ))}
                    <th style={{ textAlign: "right" }}>Rem. Bags (O)</th>
                    <th style={{ textAlign: "right" }}>Rem. MT (P)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr key={row.id}>
                      <td style={{ fontWeight: 700 }}>{row.batch_no}</td>
                      <td style={{ fontSize: 12, fontWeight: 600,
                        color: HEAVY_CODES.includes(row.code) ? "var(--clay)" : "var(--ok)" }}>
                        {row.code}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(row.mfg_date)}</td>
                      <td style={{ textAlign: "right" }}>
                        {row.qty_bags_expr !== String(row.qty_bags)
                          ? <span title={row.qty_bags_expr}>{row.qty_bags}</span>
                          : row.qty_bags}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--ok)" }}>
                        {row.qty_mt.toFixed(3)}
                      </td>
                      {[0, 1, 2].map(i => {
                        const d = row.dispatches[i];
                        return (
                          <td key={i} style={{ textAlign: "center", fontSize: 11,
                            color: "var(--ink-soft)" }}>
                            {d && (d.date || d.qty_bags) ? (
                              <>
                                {fmtDate(d.date)}<br />
                                {nilText(d.inv_no)}<br />
                                <b>{(evalArith(d.qty_bags) ?? d.qty_bags) || "0"}</b>
                              </>
                            ) : "-"}
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "right", fontWeight: 700,
                        color: row.remaining_bags < 0 ? "var(--warn)" : undefined }}>
                        {row.remaining_bags}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700,
                        color: "var(--clay)" }}>
                        {row.remaining_mt.toFixed(3)}
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
        factory_id:         selectedItem?.factory_id ?? null,
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
        factory_id: selectedItem?.factory_id ?? null,
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

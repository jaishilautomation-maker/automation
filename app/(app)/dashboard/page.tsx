"use client";

// =============================================================================
// Dashboard — module-aware
//
// Job Card mode  → existing shifts table + CSV/Excel export
// Lab QC mode    → per-factory daily QC pass/fail summary from
//                  v_factory_qc_summary + recent QC records overview
//
// Active module is read from ModuleContext (set on the select-module page).
// Falls back to Job Card view if no module is selected.
// =============================================================================

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/lib/toast-context";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import type { FactoryQcSummary } from "@/lib/types";

// ---------------------------------------------------------------------------
// Job Card types (unchanged from original)
// ---------------------------------------------------------------------------
interface ShiftRow {
  id: string;
  shift_date: string;
  machine: string;
  shift_type: string;
  operator: string | null;
  planned: number | null;
  actual: number | null;
  bags: number | null;
  production_submitted: boolean;
  lab_submitted: boolean;
  batch_no: string | null;
  jobno: string | null;
  checkpoint_cleaning: boolean;
  checkpoint_roller: boolean;
  checkpoint_mesh: boolean;
  hours_total: number | null;
  reason: string | null;
  sig_operator: string | null;
  sig_maintenance: string | null;
  sig_production: string | null;
  sig_qc: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Production dashboard source filter types
// ---------------------------------------------------------------------------
type ProdSource = "job_card" | "breakdown" | "preventive";

interface JobCardRow {
  id: string;
  status: "pending_stores" | "pending" | "submitted_for_qc" | "finalized";
  machine_number: string | null;
  job_date: string | null;
  shift: string | null;
  job_number: string | null;
  material_code: string | null;
  party_code: string | null;
  created_at: string;
}
interface BreakdownDashRow {
  id: string;
  sr_no: number | null;
  machine_name: string;
  start_at: string;
  finish_at: string | null;
  nature_of_breakdown: string | null;
}
interface PmDashRow {
  id: string;
  completed_at: string;
  pm_schedule_items: { machine: string; component: string; task: string } | null;
}

const EXPORT_COLS: [keyof ShiftRow, string][] = [
  ["shift_date","Date"], ["machine","Machine"], ["shift_type","Shift"],
  ["operator","Operator"], ["jobno","Job No"],
  ["checkpoint_cleaning","Cleaning Done"], ["checkpoint_roller","Roller Checked"], ["checkpoint_mesh","Mesh Checked"],
  ["hours_total","Total Hours"],
  ["planned","Planned (bags)"], ["actual","Actual (bags)"], ["batch_no","Batch No"],
  ["bags","Bags (final)"], ["reason","Low Production Reason"],
  ["sig_operator","Operator Sign"], ["sig_maintenance","Maintenance Sign"],
  ["sig_production","Production Sign"], ["sig_qc","QC Sign"],
  ["production_submitted","Production Submitted"], ["lab_submitted","Lab Submitted"],
  ["created_at","Created At"],
];

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n"))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const { showToast } = useToast();
  const { activeModule, activeFactory } = useModule();
  const { profile } = useAuth();
  const supabase = createClient();

  const isLabQc = activeModule === "lab_qc";
  const isOperator = profile?.role === "operator";

  // ── Job Card state ───────────────────────────────────────────────────────
  const [shifts, setShifts]      = useState<ShiftRow[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);

  // ── Production dashboard source filter (job_card | breakdown | preventive) ─
  const [prodSource, setProdSource] = useState<ProdSource>("job_card");
  const [jobCards, setJobCards]     = useState<JobCardRow[]>([]);
  const [breakdowns, setBreakdowns] = useState<BreakdownDashRow[]>([]);
  const [pmItems, setPmItems]       = useState<PmDashRow[]>([]);
  const [loadingProd, setLoadingProd] = useState(false);

  // ── Lab QC state ─────────────────────────────────────────────────────────
  const [qcSummary, setQcSummary]       = useState<FactoryQcSummary[]>([]);
  const [loadingQc, setLoadingQc]       = useState(false);
  const [qcDateRange, setQcDateRange]   = useState(30); // days

  // ─────────────────────────────────────────────────────────────────────────
  // Load data based on active module
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isOperator) return;
    if (isLabQc) {
      loadQcSummary();
    } else {
      loadShifts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLabQc, activeFactory, qcDateRange]);

  // Production dashboard: load the selected source (job card / breakdown / PM)
  useEffect(() => {
    if (isOperator || isLabQc || !activeFactory) return;
    const loadProd = async () => {
      setLoadingProd(true);
      try {
        if (prodSource === "job_card") {
          const { data } = await supabase
            .from("pulveriser_job_cards")
            .select("id, status, machine_number, job_date, shift, job_number, material_code, party_code, created_at")
            .eq("factory_id", activeFactory.id)
            .order("created_at", { ascending: false });
          setJobCards((data ?? []) as JobCardRow[]);
        } else if (prodSource === "breakdown") {
          const { data } = await supabase
            .from("breakdown_register")
            .select("id, sr_no, machine_name, start_at, finish_at, nature_of_breakdown")
            .eq("factory_id", activeFactory.id)
            .order("created_at", { ascending: false });
          setBreakdowns((data ?? []) as BreakdownDashRow[]);
        } else {
          const { data } = await supabase
            .from("pm_completions")
            .select("id, completed_at, pm_schedule_items(machine, component, task)")
            .order("completed_at", { ascending: false })
            .limit(200);
          setPmItems((data ?? []) as unknown as PmDashRow[]);
        }
      } finally {
        setLoadingProd(false);
      }
    };
    loadProd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLabQc, activeFactory, prodSource]);

  const loadShifts = async () => {
    setLoadingShifts(true);
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setShifts(data ?? []);
    setLoadingShifts(false);
  };

  const loadQcSummary = async () => {
    if (!activeFactory) return;
    setLoadingQc(true);
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - qcDateRange);
    const { data, error } = await supabase
      .from("v_factory_qc_summary")
      .select("*")
      .eq("factory_id", activeFactory.id)
      .gte("test_date", sinceDate.toISOString().slice(0, 10))
      .order("test_date", { ascending: false });
    if (error) {
      // v_factory_qc_summary does not exist in every deployment (A-20 project
      // doesn't have it — it's an A-20/1-only view). Silently skip rather than
      // showing an error toast; the empty state renders a "No QC records" message.
      if (!error.message.includes("schema cache")) {
        showToast("Could not load QC summary: " + error.message, true);
      }
    } else {
      setQcSummary((data ?? []) as FactoryQcSummary[]);
    }
    setLoadingQc(false);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Job Card export helpers (unchanged)
  // ─────────────────────────────────────────────────────────────────────────

  const totalBags = shifts.reduce((s, r) => s + (r.bags ?? 0), 0);
  const flagged   = shifts.filter(r => (r.planned ?? 0) > 0 && (r.actual ?? 0) < (r.planned ?? 0)).length;

  const handleCSV = () => {
    if (shifts.length === 0) { showToast("No data to export", true); return; }
    const header = EXPORT_COLS.map(c => c[1]).join(",");
    const rows   = shifts.map(r => EXPORT_COLS.map(c => csvEscape(r[c[0]])).join(","));
    const csv    = [header, ...rows].join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `jobcard-shifts-${todayISO()}.csv`);
    showToast("CSV downloaded");
  };

  const handleXLSX = async () => {
    if (shifts.length === 0) { showToast("No data to export", true); return; }
    setXlsxBusy(true);
    try {
      const XLSX = (await import("xlsx")).default;
      const shiftIds = shifts.map(s => s.id);
      const { data: batchRows } = await supabase
        .from("batch_entries")
        .select("*")
        .in("shift_id", shiftIds)
        .order("seq");

      const shiftsData = shifts.map(r => {
        const obj: Record<string, unknown> = {};
        EXPORT_COLS.forEach(c => (obj[c[1]] = r[c[0]]));
        return obj;
      });

      const BATCH_COLS: [string, string][] = [
        ["shift_id","Shift ID"], ["seq","Batch #"], ["from_time","From"], ["to_time","To"],
        ["material","Material Code"], ["sulphur","Sulphur Supplier/Lot/Date"],
        ["oil","Oil Supplier/Batch/Qty"], ["calcifier","Calcifier VFD"],
        ["blower_in","Blower Inlet Valve"], ["blower_out","Blower Outlet Valve"],
        ["bag","Finished Bag"], ["packing","Packing Size"],
        ["qc","QC Incharge"], ["stores","Stores Incharge"], ["work","Work Details"],
      ];
      const batchData = (batchRows ?? []).map(r => {
        const obj: Record<string, unknown> = {};
        BATCH_COLS.forEach(c => (obj[c[1]] = (r as Record<string, unknown>)[c[0]]));
        return obj;
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shiftsData), "Shifts");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(batchData), "Batch Entries");
      XLSX.writeFile(wb, `jobcard-full-export-${todayISO()}.xlsx`);
      showToast("Excel file downloaded");
    } catch (e: unknown) {
      showToast("Export failed: " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setXlsxBusy(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Lab QC summary aggregation
  // ─────────────────────────────────────────────────────────────────────────

  const totalQcTests  = qcSummary.reduce((s, r) => s + r.total_tests, 0);
  const totalQcPassed = qcSummary.reduce((s, r) => s + r.passed, 0);
  const totalQcFailed = qcSummary.reduce((s, r) => s + r.failed, 0);
  const passRate = totalQcTests > 0
    ? Math.round((totalQcPassed / totalQcTests) * 100)
    : null;

  // Group by product for the table
  const byProduct: Record<string, { total: number; passed: number; failed: number }> = {};
  qcSummary.forEach(r => {
    if (!byProduct[r.product_name]) byProduct[r.product_name] = { total: 0, passed: 0, failed: 0 };
    byProduct[r.product_name].total  += r.total_tests;
    byProduct[r.product_name].passed += r.passed;
    byProduct[r.product_name].failed += r.failed;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  // Operators must not see aggregate data — blocked even by direct URL.
  if (isOperator) {
    return (
      <div className="card">
        <div className="empty">यह पेज उपलब्ध नहीं है।</div>
      </div>
    );
  }

  // ── Lab QC dashboard ─────────────────────────────────────────────────────
  if (isLabQc) {
    return (
      <>
        {/* Metrics */}
        <div className="metric-grid">
          <div className="metric">
            <div className="num">{loadingQc ? "…" : totalQcTests}</div>
            <div className="lbl">Tests ({qcDateRange}d)</div>
          </div>
          <div className="metric">
            <div className="num" style={{ color: "var(--ok)" }}>
              {loadingQc ? "…" : passRate !== null ? `${passRate}%` : "—"}
            </div>
            <div className="lbl">Pass rate</div>
          </div>
          <div className="metric">
            <div className="num" style={{ color: totalQcFailed > 0 ? "var(--warn)" : "var(--ink)" }}>
              {loadingQc ? "…" : totalQcFailed}
            </div>
            <div className="lbl">Failed</div>
          </div>
        </div>

        {/* Date range selector */}
        <div className="card" style={{ padding: "10px 16px" }}>
          <div className="helper-row" style={{ margin: 0 }}>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              {activeFactory?.name} · Last
            </span>
            <div className="chip-group" style={{ margin: 0 }}>
              {[7, 30, 90].map(d => (
                <div
                  key={d}
                  className={`chip${qcDateRange === d ? " selected" : ""}`}
                  style={{ padding: "5px 12px", fontSize: 12 }}
                  onClick={() => setQcDateRange(d)}
                >
                  {d}d
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Per-product summary table */}
        <div className="card">
          <h3>QC Summary by Product</h3>
          {loadingQc ? (
            <div className="empty">Loading…</div>
          ) : Object.keys(byProduct).length === 0 ? (
            <div className="empty">No QC records in this period.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="dash">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Tests</th>
                    <th>Passed</th>
                    <th>Failed</th>
                    <th>Pass rate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byProduct).map(([product, stats]) => {
                    const pr = Math.round((stats.passed / stats.total) * 100);
                    return (
                      <tr key={product}>
                        <td>{product}</td>
                        <td>{stats.total}</td>
                        <td>
                          <span className="badge ok">{stats.passed}</span>
                        </td>
                        <td>
                          {stats.failed > 0
                            ? <span className="badge warn">{stats.failed}</span>
                            : <span className="badge ok">0</span>}
                        </td>
                        <td>
                          <span className={`badge ${pr >= 80 ? "ok" : "warn"}`}>
                            {pr}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="small-note">
          Pass/fail counts are based on <code>appearance_ok</code> recorded at submission.
          Full parametric pass/fail logic (comparing values against specification limits in{" "}
          <code>qc_test_definitions</code>) will be added in a future milestone once the lab
          confirms all formula factors.
        </div>
      </>
    );
  }

  // ── Production dashboard (source-filtered: Job Card / Breakdown / Preventive)
  const PROD_SOURCES: { key: ProdSource; label: string }[] = [
    { key: "job_card",   label: "Job Card" },
    { key: "breakdown",  label: "Breakdown" },
    { key: "preventive", label: "Preventive" },
  ];

  const jcFinalized = jobCards.filter(j => j.status === "finalized").length;
  const jcPending   = jobCards.filter(j => j.status !== "finalized").length;
  const bdOngoing   = breakdowns.filter(b => !b.finish_at).length;

  return (
    <>
      {/* Source filter */}
      <div className="card" style={{ padding: "10px 16px", marginBottom: 12 }}>
        <div className="helper-row" style={{ margin: 0 }}>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
            {activeFactory?.name ?? ""} · Dashboard
          </span>
          <div className="chip-group" style={{ margin: 0 }}>
            {PROD_SOURCES.map(s => (
              <div
                key={s.key}
                className={`chip${prodSource === s.key ? " selected" : ""}`}
                style={{ padding: "5px 12px", fontSize: 12 }}
                onClick={() => setProdSource(s.key)}
              >
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Job Card view ── */}
      {prodSource === "job_card" && (
        <>
          <div className="metric-grid">
            <div className="metric">
              <div className="num">{loadingProd ? "…" : jobCards.length}</div>
              <div className="lbl">Job cards</div>
            </div>
            <div className="metric">
              <div className="num" style={{ color: "var(--ok)" }}>{loadingProd ? "…" : jcFinalized}</div>
              <div className="lbl">Finalized</div>
            </div>
            <div className="metric">
              <div className="num" style={{ color: jcPending > 0 ? "var(--warn)" : "var(--ink)" }}>
                {loadingProd ? "…" : jcPending}
              </div>
              <div className="lbl">In progress</div>
            </div>
          </div>
          <div className="card">
            <div className="helper-row"><h3 style={{ margin: 0 }}>Pulveriser job cards</h3></div>
            <div style={{ overflowX: "auto" }}>
              <table className="dash">
                <thead>
                  <tr><th>Date</th><th>Machine</th><th>Shift</th><th>Job</th><th>Batch</th><th>Party/CODE</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {!loadingProd && jobCards.map(j => (
                    <tr key={j.id}>
                      <td>{j.job_date ?? "—"}</td>
                      <td>{j.machine_number ?? "—"}</td>
                      <td>{j.shift ?? "—"}</td>
                      <td>{j.job_number ?? "—"}</td>
                      <td>{j.material_code ?? "—"}</td>
                      <td>{j.party_code ?? "—"}</td>
                      <td>
                        <span className={`badge ${j.status === "finalized" ? "ok" : "warn"}`}>
                          {j.status === "finalized" ? "Finalized" : j.status === "submitted_for_qc" ? "Submitted" : j.status === "pending_stores" ? "Awaiting Stores" : "Pending"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {loadingProd && <div className="empty">Loading…</div>}
            {!loadingProd && jobCards.length === 0 && <div className="empty">No job cards yet.</div>}
          </div>
        </>
      )}

      {/* ── Breakdown view ── */}
      {prodSource === "breakdown" && (
        <>
          <div className="metric-grid">
            <div className="metric">
              <div className="num">{loadingProd ? "…" : breakdowns.length}</div>
              <div className="lbl">Breakdowns</div>
            </div>
            <div className="metric">
              <div className="num" style={{ color: bdOngoing > 0 ? "var(--warn)" : "var(--ink)" }}>
                {loadingProd ? "…" : bdOngoing}
              </div>
              <div className="lbl">Ongoing</div>
            </div>
            <div className="metric">
              <div className="num" style={{ color: "var(--ok)" }}>
                {loadingProd ? "…" : breakdowns.length - bdOngoing}
              </div>
              <div className="lbl">Resolved</div>
            </div>
          </div>
          <div className="card">
            <div className="helper-row"><h3 style={{ margin: 0 }}>Breakdown register</h3></div>
            <div style={{ overflowX: "auto" }}>
              <table className="dash">
                <thead>
                  <tr><th>SR</th><th>Machine</th><th>Start</th><th>Nature</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {!loadingProd && breakdowns.map(b => (
                    <tr key={b.id}>
                      <td>{b.sr_no ?? "—"}</td>
                      <td>{b.machine_name}</td>
                      <td>{new Date(b.start_at).toLocaleDateString("en-IN")}</td>
                      <td>{b.nature_of_breakdown ?? "—"}</td>
                      <td>
                        <span className={`badge ${b.finish_at ? "ok" : "warn"}`}>
                          {b.finish_at ? "Resolved" : "Ongoing"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {loadingProd && <div className="empty">Loading…</div>}
            {!loadingProd && breakdowns.length === 0 && <div className="empty">No breakdown entries yet.</div>}
          </div>
        </>
      )}

      {/* ── Preventive view ── */}
      {prodSource === "preventive" && (
        <>
          <div className="metric-grid">
            <div className="metric">
              <div className="num">{loadingProd ? "…" : pmItems.length}</div>
              <div className="lbl">Completions</div>
            </div>
          </div>
          <div className="card">
            <div className="helper-row"><h3 style={{ margin: 0 }}>Preventive maintenance — completions</h3></div>
            <div style={{ overflowX: "auto" }}>
              <table className="dash">
                <thead>
                  <tr><th>Date</th><th>Machine</th><th>Component</th><th>Task</th></tr>
                </thead>
                <tbody>
                  {!loadingProd && pmItems.map(c => (
                    <tr key={c.id}>
                      <td>{new Date(c.completed_at).toLocaleDateString("en-IN")}</td>
                      <td>{c.pm_schedule_items?.machine ?? "—"}</td>
                      <td>{c.pm_schedule_items?.component ?? "—"}</td>
                      <td>{c.pm_schedule_items?.task ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {loadingProd && <div className="empty">Loading…</div>}
            {!loadingProd && pmItems.length === 0 && <div className="empty">No maintenance completions yet.</div>}
          </div>
        </>
      )}

      {/* Legacy shift export kept available under Job Card view */}
      {prodSource === "job_card" && shifts.length > 0 && (
        <div className="card">
          <div className="helper-row"><h3 style={{ margin: 0 }}>Legacy shift export</h3></div>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            {shifts.length} legacy shift record(s) · {totalBags} bags · {flagged} below target
          </div>
          <button className="btn btn-secondary" type="button" onClick={handleCSV}>↙ Download CSV</button>
          <button className="btn btn-secondary" type="button" onClick={handleXLSX} disabled={xlsxBusy}>
            {xlsxBusy ? "Preparing file…" : "↙ Download Excel (.xlsx)"}
          </button>
        </div>
      )}
    </>
  );
}

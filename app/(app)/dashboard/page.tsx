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
  const supabase = createClient();

  const isLabQc = activeModule === "lab_qc";

  // ── Job Card state ───────────────────────────────────────────────────────
  const [shifts, setShifts]      = useState<ShiftRow[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);

  // ── Lab QC state ─────────────────────────────────────────────────────────
  const [qcSummary, setQcSummary]       = useState<FactoryQcSummary[]>([]);
  const [loadingQc, setLoadingQc]       = useState(false);
  const [qcDateRange, setQcDateRange]   = useState(30); // days

  // ─────────────────────────────────────────────────────────────────────────
  // Load data based on active module
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isLabQc) {
      loadQcSummary();
    } else {
      loadShifts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLabQc, activeFactory, qcDateRange]);

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
    if (error) showToast("Could not load QC summary: " + error.message, true);
    else setQcSummary((data ?? []) as FactoryQcSummary[]);
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

  // ── Job Card dashboard (original) ────────────────────────────────────────
  return (
    <>
      <div className="metric-grid">
        <div className="metric">
          <div className="num">{loadingShifts ? "…" : shifts.length}</div>
          <div className="lbl">Shifts logged</div>
        </div>
        <div className="metric">
          <div className="num">{loadingShifts ? "…" : totalBags}</div>
          <div className="lbl">Total bags</div>
        </div>
        <div className="metric">
          <div className="num">{loadingShifts ? "…" : flagged}</div>
          <div className="lbl">Below target</div>
        </div>
      </div>

      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>All shift records</h3>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="dash">
            <thead>
              <tr>
                <th>Date</th><th>Machine</th><th>Shift</th>
                <th>Operator</th><th>Planned</th><th>Actual</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!loadingShifts && shifts.map(r => {
                const below = (r.planned ?? 0) > 0 && (r.actual ?? 0) < (r.planned ?? 0);
                return (
                  <tr key={r.id}>
                    <td>{r.shift_date}</td>
                    <td>{r.machine}</td>
                    <td>{r.shift_type}</td>
                    <td>{r.operator ?? "—"}</td>
                    <td>{r.planned ?? 0}</td>
                    <td>{r.actual ?? 0}</td>
                    <td>
                      <span className="badge ok">Op ✓</span>
                      <span className={`badge ${r.production_submitted ? "ok" : "warn"}`}>
                        Prod {r.production_submitted ? "✓" : "⏳"}
                      </span>
                      <span className={`badge ${r.lab_submitted ? "ok" : "warn"}`}>
                        Lab {r.lab_submitted ? "✓" : "⏳"}
                      </span>
                      {below && <span className="badge warn">Below target</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loadingShifts && <div className="empty">Loading…</div>}
        {!loadingShifts && shifts.length === 0 && <div className="empty">No records yet.</div>}

        <button className="btn btn-secondary" type="button" onClick={handleCSV} style={{ marginTop: 12 }}>
          ↙ Download CSV
        </button>
        <button className="btn btn-secondary" type="button" onClick={handleXLSX} disabled={xlsxBusy}>
          {xlsxBusy ? "Preparing file…" : "↙ Download Excel (.xlsx)"}
        </button>
      </div>

      <div className="small-note">
        Status shows Op / Prod / Lab completion for each shift. Downloads include every shift and
        batch entry currently in the database, not just what&apos;s shown on screen.
      </div>
    </>
  );
}

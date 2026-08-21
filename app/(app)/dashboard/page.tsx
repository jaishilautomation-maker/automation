"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/lib/toast-context";

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

export default function DashboardPage() {
  const { showToast } = useToast();
  const supabase = createClient();

  const [shifts, setShifts]     = useState<ShiftRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [xlsxBusy, setXlsxBusy] = useState(false);

  const loadShifts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setShifts(data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadShifts(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalBags  = shifts.reduce((s, r) => s + (r.bags ?? 0), 0);
  const flagged    = shifts.filter(r => (r.planned ?? 0) > 0 && (r.actual ?? 0) < (r.planned ?? 0)).length;

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

      // fetch batch entries for all shifts
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
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(batchData),  "Batch Entries");
      XLSX.writeFile(wb, `jobcard-full-export-${todayISO()}.xlsx`);
      showToast("Excel file downloaded");
    } catch (e: unknown) {
      showToast("Export failed: " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setXlsxBusy(false);
    }
  };

  return (
    <>
      <div className="metric-grid">
        <div className="metric">
          <div className="num">{loading ? "…" : shifts.length}</div>
          <div className="lbl">Shifts logged</div>
        </div>
        <div className="metric">
          <div className="num">{loading ? "…" : totalBags}</div>
          <div className="lbl">Total bags</div>
        </div>
        <div className="metric">
          <div className="num">{loading ? "…" : flagged}</div>
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
              {!loading && shifts.map(r => {
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
        {loading && <div className="empty">Loading…</div>}
        {!loading && shifts.length === 0 && <div className="empty">No records yet.</div>}

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

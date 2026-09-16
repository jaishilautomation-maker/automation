"use client";

// =============================================================================
// Packing Machine Breakdown Report — Module C (A-20 only)
//
// Single form matching the paper layout:
//   Block 1 — Report Header (doc no, machine, department, date/time)
//   Block 2 — Problem Reported + Nature of Fault (4 checkboxes, multi-select)
//   Block 3 — Breakdown Details (fault detail, root cause, action taken,
//              cause of delay, spare parts, quantity/specification)
//   Block 4 — Machine Handover (date + time)
//   Block 5 — Approval & Signatures (4 name fields)
//   Block 6 — Production Remarks
//
// Past reports shown below the form (most recent first, last 20).
// Access: operator, factory_admin, company_admin
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import type { PackingBreakdownReport, PackingFaultType } from "@/lib/types";

const FAULT_TYPES: { value: PackingFaultType; label: string }[] = [
  { value: "electrical",  label: "Electrical" },
  { value: "mechanical",  label: "Mechanical" },
  { value: "hydraulic",   label: "Hydraulic" },
  { value: "pneumatic",   label: "Pneumatic" },
];

const PACKING_MACHINES = [
  "All Storage Tank",
  "Distribution Panel",
  "Turning Table",
  "Filling Machine",
  "Capping Machine",
  "Sealing Machine",
  "Labeller Machine",
  "Printer",
  "Heat Shrink Packing Machine",
  "Pneumatic Compressor",
] as const;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function nowTime() {
  return new Date().toTimeString().slice(0, 5);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function PackingBreakdownPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // Form state
  const [documentNo, setDocumentNo]       = useState("");
  const [machineCode, setMachineCode]     = useState("");
  const [machineName, setMachineName]     = useState<string>("");
  const [department, setDepartment]       = useState("Packing");
  const [reportingDate, setReportingDate] = useState(todayISO());
  const [reportingTime, setReportingTime] = useState(nowTime());

  const [problemReported, setProblemReported]   = useState("");
  const [natureFaults, setNatureFaults]         = useState<PackingFaultType[]>([]);
  const [attendedBy, setAttendedBy]             = useState("");

  const [faultDetails, setFaultDetails]         = useState("");
  const [rootCause, setRootCause]               = useState("");
  const [actionTaken, setActionTaken]           = useState("");
  const [causeOfDelay, setCauseOfDelay]         = useState("");
  const [spareParts, setSpareParts]             = useState("");
  const [qtySec, setQtySec]                     = useState("");

  const [handoverDate, setHandoverDate]         = useState("");
  const [handoverTime, setHandoverTime]         = useState("");

  const [prodSuperSign, setProdSuperSign]       = useState("");
  const [prodManagerSign, setProdManagerSign]   = useState("");
  const [maintEngSign, setMaintEngSign]         = useState("");
  const [maintHeadSign, setMaintHeadSign]       = useState("");

  const [productionRemarks, setProductionRemarks] = useState("");

  const [submitting, setSubmitting]             = useState(false);
  const [reports, setReports]                   = useState<PackingBreakdownReport[]>([]);

  // -------------------------------------------------------------------------
  // Load recent reports
  // -------------------------------------------------------------------------
  const loadReports = useCallback(async () => {
    if (!activeFactory) return;
    const { data } = await supabase
      .from("packing_breakdown_reports")
      .select("*")
      .eq("factory_id", activeFactory.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setReports((data ?? []) as PackingBreakdownReport[]);
  }, [activeFactory, supabase]);

  useEffect(() => { loadReports(); }, [loadReports]);

  // -------------------------------------------------------------------------
  // Nature of fault toggle
  // -------------------------------------------------------------------------
  function toggleFault(ft: PackingFaultType) {
    setNatureFaults(prev =>
      prev.includes(ft) ? prev.filter(f => f !== ft) : [...prev, ft]
    );
  }

  // -------------------------------------------------------------------------
  // Reset form
  // -------------------------------------------------------------------------
  function resetForm() {
    setDocumentNo(""); setMachineCode(""); setMachineName(""); setDepartment("Packing");
    setReportingDate(todayISO()); setReportingTime(nowTime());
    setProblemReported(""); setNatureFaults([]); setAttendedBy("");
    setFaultDetails(""); setRootCause(""); setActionTaken("");
    setCauseOfDelay(""); setSpareParts(""); setQtySec("");
    setHandoverDate(""); setHandoverTime("");
    setProdSuperSign(""); setProdManagerSign(""); setMaintEngSign(""); setMaintHeadSign("");
    setProductionRemarks("");
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!machineName)            { showToast("Select a machine.", true); return; }
    if (!problemReported.trim()) { showToast("Problem reported is required.", true); return; }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("packing_breakdown_reports")
        .insert({
          factory_id:                  activeFactory.id,
          document_no:                 documentNo.trim() || null,
          machine_code:                machineCode.trim() || null,
          machine_name:                machineName,
          department:                  department.trim() || "Packing",
          reporting_date:              reportingDate,
          reporting_time:              reportingTime || null,
          problem_reported:            problemReported.trim() || null,
          nature_of_fault:             natureFaults,
          attended_by:                 attendedBy.trim() || null,
          fault_details:               faultDetails.trim() || null,
          root_cause:                  rootCause.trim() || null,
          action_taken:                actionTaken.trim() || null,
          cause_of_delay:              causeOfDelay.trim() || null,
          spare_parts_consumed:        spareParts.trim() || null,
          quantity_specification:      qtySec.trim() || null,
          handed_over_date:            handoverDate || null,
          handed_over_time:            handoverTime || null,
          production_supervisor_sign:  prodSuperSign.trim() || null,
          production_manager_sign:     prodManagerSign.trim() || null,
          maintenance_engineer_sign:   maintEngSign.trim() || null,
          maintenance_head_sign:       maintHeadSign.trim() || null,
          production_remarks:          productionRemarks.trim() || null,
          created_by:                  user.id,
        });

      if (error) { showToast("Could not save: " + error.message, true); return; }
      showToast("Breakdown report saved ✓");
      resetForm();
      loadReports();
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* Block 1 — Header */}
      <div className="card">
        <h3>Packing Machine Breakdown Report</h3>
        <div className="field-hint">{activeFactory?.name ?? "—"}</div>

        <div className="row2">
          <div>
            <label>Document No</label>
            <input type="text" placeholder="e.g. PKG-BD-001" value={documentNo} onChange={e => setDocumentNo(e.target.value)} />
          </div>
          <div>
            <label>Machine Code</label>
            <input type="text" placeholder="e.g. FM-01" value={machineCode} onChange={e => setMachineCode(e.target.value)} />
          </div>
        </div>

        <label>Machine Name *</label>
        <select value={machineName} onChange={e => setMachineName(e.target.value)}>
          <option value="">— Select machine —</option>
          {PACKING_MACHINES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <div className="row2">
          <div>
            <label>Department</label>
            <input type="text" value={department} onChange={e => setDepartment(e.target.value)} />
          </div>
          <div />
        </div>

        <div className="row2">
          <div>
            <label>Reporting Date *</label>
            <input type="date" value={reportingDate} onChange={e => setReportingDate(e.target.value)} />
          </div>
          <div>
            <label>Reporting Time</label>
            <input type="time" value={reportingTime} onChange={e => setReportingTime(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Block 2 — Problem + Nature of Fault */}
      <div className="card">
        <h3>Problem Details</h3>

        <label>Problem Reported *</label>
        <textarea
          rows={3}
          placeholder="Describe the problem observed"
          value={problemReported}
          onChange={e => setProblemReported(e.target.value)}
        />

        <label>Nature of Fault (select all that apply)</label>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          {FAULT_TYPES.map(ft => (
            <label key={ft.value} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
              <input
                type="checkbox"
                checked={natureFaults.includes(ft.value)}
                onChange={() => toggleFault(ft.value)}
              />
              {ft.label}
            </label>
          ))}
        </div>

        <label>Attended By</label>
        <input type="text" placeholder="Name of person who attended" value={attendedBy} onChange={e => setAttendedBy(e.target.value)} />
      </div>

      {/* Block 3 — Breakdown Details */}
      <div className="card">
        <h3>Breakdown Details</h3>

        <label>Fault Details</label>
        <textarea rows={3} placeholder="Describe the exact fault" value={faultDetails} onChange={e => setFaultDetails(e.target.value)} />

        <label>Root Cause</label>
        <textarea rows={2} placeholder="Why did it fail?" value={rootCause} onChange={e => setRootCause(e.target.value)} />

        <label>Action Taken</label>
        <textarea rows={3} placeholder="What was done to fix it" value={actionTaken} onChange={e => setActionTaken(e.target.value)} />

        <label>Cause of Delay (if any)</label>
        <input type="text" placeholder="Reason for delay in repair" value={causeOfDelay} onChange={e => setCauseOfDelay(e.target.value)} />

        <div className="row2">
          <div>
            <label>Spare Parts Consumed</label>
            <input type="text" placeholder="Part names" value={spareParts} onChange={e => setSpareParts(e.target.value)} />
          </div>
          <div>
            <label>Quantity / Specification</label>
            <input type="text" placeholder="Qty and specs" value={qtySec} onChange={e => setQtySec(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Block 4 — Machine Handover */}
      <div className="card">
        <h3>Machine Handover</h3>
        <div className="row2">
          <div>
            <label>Handed Over Date</label>
            <input type="date" value={handoverDate} onChange={e => setHandoverDate(e.target.value)} />
          </div>
          <div>
            <label>Handed Over Time</label>
            <input type="time" value={handoverTime} onChange={e => setHandoverTime(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Block 5 — Approval & Signatures */}
      <div className="card">
        <h3>Approval & Signatures</h3>
        <div className="row2">
          <div>
            <label>Production Supervisor</label>
            <input type="text" placeholder="Name" value={prodSuperSign} onChange={e => setProdSuperSign(e.target.value)} />
          </div>
          <div>
            <label>Production Manager</label>
            <input type="text" placeholder="Name" value={prodManagerSign} onChange={e => setProdManagerSign(e.target.value)} />
          </div>
        </div>
        <div className="row2">
          <div>
            <label>Maintenance Engineer</label>
            <input type="text" placeholder="Name" value={maintEngSign} onChange={e => setMaintEngSign(e.target.value)} />
          </div>
          <div>
            <label>Maintenance Head</label>
            <input type="text" placeholder="Name" value={maintHeadSign} onChange={e => setMaintHeadSign(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Block 6 — Production Remarks */}
      <div className="card">
        <h3>Production Remarks</h3>
        <textarea
          rows={3}
          placeholder="Additional production remarks"
          value={productionRemarks}
          onChange={e => setProductionRemarks(e.target.value)}
        />
      </div>

      <button
        className="btn btn-primary"
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        style={{ marginBottom: 20 }}
      >
        {submitting ? "Saving…" : "Save Breakdown Report"}
      </button>

      {/* Recent reports */}
      {reports.length > 0 && (
        <div className="card">
          <div className="helper-row">
            <h3 style={{ margin: 0 }}>Recent Reports</h3>
            <span className="count">{reports.length}</span>
          </div>
          {reports.map(r => (
            <div key={r.id} className="pending-item">
              <div className="pi-top">
                <span style={{ fontWeight: 700 }}>
                  {r.machine_name}{r.document_no ? ` · ${r.document_no}` : ""}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  {fmtDate(r.reporting_date)}{r.reporting_time ? ` ${r.reporting_time}` : ""}
                </span>
              </div>
              {r.problem_reported && (
                <div className="pi-sub">{r.problem_reported.slice(0, 120)}</div>
              )}
              {r.nature_of_fault?.length > 0 && (
                <div className="pi-sub" style={{ color: "var(--warn)" }}>
                  {r.nature_of_fault.join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

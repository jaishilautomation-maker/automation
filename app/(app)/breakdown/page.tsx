"use client";

// =============================================================================
// Breakdown Register — Form JSCI/PROD/04
// A-20/1 only · Access: production_incharge, factory_admin, company_admin
//
// Layout:
//   1. Machine selector tabs at the top
//   2. List of past breakdowns for selected machine (most recent first)
//   3. "Add entry" button → inline form below the list
//
// Rules:
//   - Append-only: no edit or delete for production_incharge
//   - sr_no is set by the DB trigger fn_breakdown_sr_no()
//   - finish_at is optional (entry can be open while breakdown is ongoing)
//   - All times stored as UTC timestamptz; displayed in local time
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import { BREAKDOWN_MACHINES } from "@/lib/types";
import type { BreakdownMachine, BreakdownEntry } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localNow(): string {
  // Returns "YYYY-MM-DDTHH:MM" for datetime-local input
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function durationLabel(startIso: string, finishIso: string | null): string {
  if (!finishIso) return "Ongoing";
  const mins = Math.round(
    (new Date(finishIso).getTime() - new Date(startIso).getTime()) / 60000
  );
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function BreakdownPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [selectedMachine, setSelectedMachine] = useState<BreakdownMachine>(BREAKDOWN_MACHINES[0]);
  const [entries, setEntries]     = useState<BreakdownEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [startAt, setStartAt]                   = useState(localNow());
  const [finishAt, setFinishAt]                 = useState("");
  const [natureOfBreakdown, setNatureOfBreakdown] = useState("");
  const [repairCarriedOut, setRepairCarriedOut] = useState("");
  const [partsReplaced, setPartsReplaced]       = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [remarks, setRemarks]                   = useState("");

  // -------------------------------------------------------------------------
  // Load entries for selected machine
  // -------------------------------------------------------------------------
  const loadEntries = useCallback(async () => {
    if (!activeFactory) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("breakdown_register")
      .select("*")
      .eq("factory_id", activeFactory.id)
      .eq("machine_name", selectedMachine)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) showToast("Could not load entries: " + error.message, true);
    else setEntries((data ?? []) as BreakdownEntry[]);
    setLoading(false);
  }, [activeFactory, selectedMachine, supabase, showToast]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // -------------------------------------------------------------------------
  // Reset form
  // -------------------------------------------------------------------------
  const resetForm = () => {
    setStartAt(localNow()); setFinishAt(""); setNatureOfBreakdown("");
    setRepairCarriedOut(""); setPartsReplaced(""); setCorrectiveAction(""); setRemarks("");
  };

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!startAt) { showToast("Start time is required.", true); return; }
    if (!natureOfBreakdown.trim()) { showToast("Nature of breakdown is required.", true); return; }

    if (finishAt && new Date(finishAt) <= new Date(startAt)) {
      showToast("Finish time must be after start time.", true);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("breakdown_register")
        .insert({
          factory_id:           activeFactory.id,
          machine_name:         selectedMachine,
          // sr_no set by DB trigger — do not supply it
          start_at:             new Date(startAt).toISOString(),
          finish_at:            finishAt ? new Date(finishAt).toISOString() : null,
          nature_of_breakdown:  natureOfBreakdown.trim(),
          repair_carried_out:   repairCarriedOut.trim()  || null,
          parts_replaced:       partsReplaced.trim()     || null,
          corrective_action:    correctiveAction.trim()  || null,
          remarks:              remarks.trim()            || null,
          created_by:           user.id,
        });

      if (error) { showToast("Could not save: " + error.message, true); return; }

      showToast("Breakdown entry saved ✓");
      setShowForm(false);
      resetForm();
      loadEntries();
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
      {/* Page header */}
      <div className="card" style={{ marginBottom: 0, borderBottom: "none", borderRadius: "8px 8px 0 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>Breakdown Register</h3>
            <div className="field-hint">Form JSCI/PROD/04 · {activeFactory?.name ?? "—"}</div>
          </div>
          {!showForm && (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => { resetForm(); setShowForm(true); }}
            >
              + New entry
            </button>
          )}
        </div>
      </div>

      {/* Machine tabs */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "10px 16px",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderTop: "none",
          marginBottom: 12,
        }}
      >
        {BREAKDOWN_MACHINES.map(m => (
          <button
            key={m}
            type="button"
            onClick={() => { setSelectedMachine(m); setShowForm(false); }}
            style={{
              padding: "5px 12px",
              borderRadius: 20,
              border: "1px solid var(--line)",
              background: selectedMachine === m ? "var(--clay)" : "var(--surface)",
              color: selectedMachine === m ? "#fff" : "var(--ink)",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: selectedMachine === m ? 600 : 400,
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Add entry form */}
      {showForm && (
        <div className="card">
          <h3>New Breakdown Entry — {selectedMachine}</h3>

          <div className="row2">
            <div>
              <label>Breakdown start *</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={e => setStartAt(e.target.value)}
              />
            </div>
            <div>
              <label>Breakdown finish (leave blank if ongoing)</label>
              <input
                type="datetime-local"
                value={finishAt}
                onChange={e => setFinishAt(e.target.value)}
              />
            </div>
          </div>

          <label>Nature of breakdown *</label>
          <textarea
            rows={2}
            placeholder="Describe what failed / what was the issue"
            value={natureOfBreakdown}
            onChange={e => setNatureOfBreakdown(e.target.value)}
          />

          <label>Repair carried out</label>
          <textarea
            rows={2}
            placeholder="What was done to fix it"
            value={repairCarriedOut}
            onChange={e => setRepairCarriedOut(e.target.value)}
          />

          <div className="row2">
            <div>
              <label>Parts replaced</label>
              <input
                type="text"
                placeholder="Part names / part numbers"
                value={partsReplaced}
                onChange={e => setPartsReplaced(e.target.value)}
              />
            </div>
            <div>
              <label>Corrective action</label>
              <input
                type="text"
                placeholder="Action to prevent recurrence"
                value={correctiveAction}
                onChange={e => setCorrectiveAction(e.target.value)}
              />
            </div>
          </div>

          <label>Remarks / Sign</label>
          <input
            type="text"
            placeholder="Additional remarks or production incharge name"
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
          />

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button
              className="btn btn-primary"
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting ? "Saving…" : "Save Entry"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => { setShowForm(false); resetForm(); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Entries list */}
      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>{selectedMachine} — Breakdown history</h3>
          <span className="count">{entries.length}</span>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="empty">No breakdown entries for {selectedMachine}.</div>
        ) : (
          entries.map(e => (
            <div key={e.id} className="pending-item">
              <div className="pi-top">
                <span style={{ fontWeight: 700 }}>
                  SR {e.sr_no} · {fmtDatetime(e.start_at)}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: e.finish_at ? "var(--ok-soft)" : "var(--warn-soft, #fff3e0)",
                    color: e.finish_at ? "var(--ok)" : "var(--warn)",
                    fontWeight: 600,
                  }}
                >
                  {e.finish_at ? `Resolved · ${durationLabel(e.start_at, e.finish_at)}` : "Ongoing"}
                </span>
              </div>

              {e.nature_of_breakdown && (
                <div className="pi-sub">
                  <b>Nature:</b> {e.nature_of_breakdown}
                </div>
              )}
              {e.repair_carried_out && (
                <div className="pi-sub">
                  <b>Repair:</b> {e.repair_carried_out}
                </div>
              )}
              {e.parts_replaced && (
                <div className="pi-sub">
                  <b>Parts:</b> {e.parts_replaced}
                </div>
              )}
              {e.corrective_action && (
                <div className="pi-sub">
                  <b>Corrective action:</b> {e.corrective_action}
                </div>
              )}
              {e.remarks && (
                <div className="pi-sub" style={{ color: "var(--ink-soft)" }}>
                  {e.remarks}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

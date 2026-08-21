"use client";

// =============================================================================
// Lab QC — Hourly Readings (Sulphur Powder production, Factory A 20/1)
//
// Append-only: one row per hourly reading per batch.
// test_results driven by qc_test_definitions WHERE material_id = SULPHUR_POWDER
//                                               AND phase = 'none'
// (2 fields: colour_appearance + appearance_photo)
//
// The reading timestamp is captured at submission time (not user-editable
// beyond selecting the approximate hour, which keeps the form simple).
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { evalFormula } from "@/lib/formula";
import QcFieldRenderer from "@/components/QcFieldRenderer";
import type { QcTestDefinition } from "@/lib/types";

// ---------------------------------------------------------------------------
// Batch option (WIP batches of SULPHUR_POWDER at this factory)
// ---------------------------------------------------------------------------
interface BatchOption {
  id: string;
  batch_number: string;
  production_date: string;
}

// ---------------------------------------------------------------------------
// Recent reading row (for the "today's readings" summary below the form)
// ---------------------------------------------------------------------------
interface RecentReading {
  id: string;
  reading_time: string;
  test_results: Record<string, unknown>;
}

export default function HourlyReadingPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // Batches
  const [batches, setBatches]         = useState<BatchOption[]>([]);
  const [batchId, setBatchId]         = useState("");
  const [loadingBatches, setLoadingBatches] = useState(true);

  // Test definitions
  const [testDefs, setTestDefs]       = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);

  // Form state
  const [values, setValues]           = useState<Record<string, string>>({});
  const [readingTime, setReadingTime] = useState(() =>
    new Date().toISOString().slice(0, 16) // datetime-local format: "YYYY-MM-DDTHH:MM"
  );
  const [remarks, setRemarks]         = useState("");
  const [submitting, setSubmitting]   = useState(false);

  // Recent readings for the selected batch (today only)
  const [recentReadings, setRecentReadings] = useState<RecentReading[]>([]);

  // -------------------------------------------------------------------------
  // Load SULPHUR_POWDER WIP/FG batches at this factory
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!activeFactory) return;

    supabase
      .from("materials")
      .select("id")
      .eq("code", "SULPHUR_POWDER")
      .single()
      .then(({ data: mat }) => {
        if (!mat) { setLoadingBatches(false); return; }
        return supabase
          .from("batches")
          .select("id, batch_number, production_date")
          .eq("factory_id", activeFactory.id)
          .eq("material_id", mat.id)
          .order("production_date", { ascending: false })
          .limit(30);
      })
      .then(res => {
        if (res) setBatches((res.data ?? []) as BatchOption[]);
        setLoadingBatches(false);
      });
  }, [activeFactory, supabase]);

  // -------------------------------------------------------------------------
  // Load test definitions (phase='none' for SULPHUR_POWDER = hourly fields)
  // -------------------------------------------------------------------------
  useEffect(() => {
    supabase
      .from("materials")
      .select("id")
      .eq("code", "SULPHUR_POWDER")
      .single()
      .then(({ data: mat }) => {
        if (!mat) { setLoadingDefs(false); return; }
        return supabase
          .from("qc_test_definitions")
          .select("*")
          .eq("material_id", mat.id)
          .eq("phase", "none")
          .eq("is_active", true)
          .order("sort_order");
      })
      .then(res => {
        if (res) {
          const defs = (res.data ?? []) as QcTestDefinition[];
          setTestDefs(defs);
          const init: Record<string, string> = {};
          defs.forEach(d => { init[d.test_key] = ""; });
          setValues(init);
        }
        setLoadingDefs(false);
      });
  }, [supabase]);

  // -------------------------------------------------------------------------
  // Load today's readings for the selected batch
  // -------------------------------------------------------------------------
  const loadRecentReadings = useCallback(async (bid: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("hourly_readings")
      .select("id, reading_time, test_results")
      .eq("batch_id", bid)
      .gte("reading_time", today)
      .order("reading_time", { ascending: false });
    setRecentReadings((data ?? []) as RecentReading[]);
  }, [supabase]);

  useEffect(() => {
    if (batchId) loadRecentReadings(batchId);
    else setRecentReadings([]);
  }, [batchId, loadRecentReadings]);

  // -------------------------------------------------------------------------
  // Field change handler (recalculates formulas live)
  // -------------------------------------------------------------------------
  const handleChange = useCallback(
    (key: string, val: string) => {
      setValues(prev => {
        const next = { ...prev, [key]: val };
        testDefs
          .filter(d => d.is_calculated && d.formula)
          .forEach(d => {
            const result = evalFormula(d.formula!, next);
            next[d.test_key] = result !== null ? String(result) : "";
          });
        return next;
      });
    },
    [testDefs]
  );

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!batchId) { showToast("Select a batch.", true); return; }

    setSubmitting(true);
    try {
      const testResults: Record<string, number | string> = {};
      testDefs.forEach(d => {
        const raw = values[d.test_key];
        if (!raw) return;
        if (d.input_type === "number") {
          const n = parseFloat(raw);
          if (!isNaN(n)) testResults[d.test_key] = n;
        } else {
          testResults[d.test_key] = raw;
        }
      });

      const { error } = await supabase.from("hourly_readings").insert({
        batch_id:     batchId,
        factory_id:   activeFactory.id,
        recorded_by:  user.id,
        reading_time: new Date(readingTime).toISOString(),
        test_results: testResults,
        remarks:      remarks.trim() || null,
      });

      if (error) { showToast("Could not save: " + error.message, true); return; }

      showToast("Reading saved ✓");
      // Reset values only; keep batch selected for next reading
      setValues(prev => Object.fromEntries(Object.keys(prev).map(k => [k, ""])));
      setRemarks("");
      setReadingTime(new Date().toISOString().slice(0, 16));
      loadRecentReadings(batchId);
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
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Hourly Readings — Sulphur Powder</h3>

        <label>Batch *</label>
        {loadingBatches ? (
          <div className="field-hint">Loading batches…</div>
        ) : batches.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            No Sulphur Powder batches at {activeFactory?.name}.
          </div>
        ) : (
          <select value={batchId} onChange={e => setBatchId(e.target.value)}>
            <option value="">— Select batch —</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>
                {b.batch_number} · {b.production_date}
              </option>
            ))}
          </select>
        )}

        <label>Reading Time *</label>
        <input
          type="datetime-local"
          value={readingTime}
          onChange={e => setReadingTime(e.target.value)}
        />
      </div>

      {batchId && (
        <>
          {/* Dynamic test fields */}
          {loadingDefs ? (
            <div className="card"><div className="empty">Loading fields…</div></div>
          ) : (
            <div className="card">
              <h3>Observations</h3>
              {testDefs.map(def => (
                <QcFieldRenderer
                  key={def.id}
                  def={def}
                  value={values[def.test_key] ?? ""}
                  onChange={handleChange}
                />
              ))}

              <label>Remarks</label>
              <input
                type="text"
                placeholder="Optional notes for this reading"
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
              />
            </div>
          )}

          <button
            className="btn btn-primary"
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Saving…" : "Save Reading"}
          </button>

          {/* Today's readings summary */}
          {recentReadings.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h3>Today&apos;s Readings for this Batch</h3>
              {recentReadings.map(r => (
                <div key={r.id} className="pending-item">
                  <div className="pi-top">
                    <span>
                      {new Date(r.reading_time).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                      {(r.test_results as Record<string, unknown>)["colour_appearance"] as string ?? "—"}
                    </span>
                  </div>
                </div>
              ))}
              <div className="field-hint">{recentReadings.length} reading(s) logged today</div>
            </div>
          )}
        </>
      )}
    </>
  );
}

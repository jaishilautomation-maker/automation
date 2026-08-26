"use client";

// =============================================================================
// Lab QC — Hourly Readings (Sulphur Powder production, Factory A 20/1)
//
// Append-only: one row per hourly reading per batch.
// test_results driven by qc_test_definitions WHERE material_id = SULPHUR_POWDER
//                                               AND phase = 'none'
//
// User enters a BATCH NUMBER (text input). If a batch with that number exists,
// we link to it; otherwise we create a new batch record automatically.
// =============================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { evalFormula } from "@/lib/formula";
import QcFieldRenderer, { type PhotoUploadProps } from "@/components/QcFieldRenderer";
import type { PhotoUploaderHandle } from "@/components/PhotoUploader";
import type { QcTestDefinition } from "@/lib/types";

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

  // Batch number (free text input)
  const [batchNumber, setBatchNumber] = useState("");
  const [resolvedBatchId, setResolvedBatchId] = useState<string | null>(null);

  // Test definitions
  const [testDefs, setTestDefs]       = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);

  // Form state
  const [values, setValues]           = useState<Record<string, string>>({});
  const [readingTime, setReadingTime] = useState(() =>
    new Date().toISOString().slice(0, 16)
  );
  const [remarks, setRemarks]         = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});

  // Recent readings for the entered batch number
  const [recentReadings, setRecentReadings] = useState<RecentReading[]>([]);

  // -------------------------------------------------------------------------
  // Load test definitions (phase='B' for full batch analysis fields)
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
          .eq("phase", "B")
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
  // Resolve batch number → batch_id (look up or will create on submit)
  // Also load recent readings for this batch
  // -------------------------------------------------------------------------
  const resolveBatch = useCallback(async (bn: string) => {
    if (!bn.trim() || !activeFactory) {
      setResolvedBatchId(null);
      setRecentReadings([]);
      return;
    }

    // Look for existing batch
    const { data } = await supabase
      .from("batches")
      .select("id")
      .eq("factory_id", activeFactory.id)
      .eq("batch_number", bn.trim())
      .maybeSingle();

    const bid = data?.id ?? null;
    setResolvedBatchId(bid);

    // Load recent readings if batch found
    if (bid) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: readings } = await supabase
        .from("hourly_readings")
        .select("id, reading_time, test_results")
        .eq("batch_id", bid)
        .gte("reading_time", today)
        .order("reading_time", { ascending: false });
      setRecentReadings((readings ?? []) as RecentReading[]);
    } else {
      setRecentReadings([]);
    }
  }, [activeFactory, supabase]);

  // Debounce batch lookup on blur
  const handleBatchBlur = () => { resolveBatch(batchNumber); };

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
  // Submit — direct supabase client (same as rm-receipt pattern)
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!batchNumber.trim()) { showToast("Batch number is required.", true); return; }

    setSubmitting(true);
    try {
      // Resolve or create batch
      let batchId = resolvedBatchId;

      if (!batchId) {
        // Create a new batch record (same pattern as rm-receipt which works)
        const { data: newBatch, error: batchErr } = await supabase
          .from("batches")
          .insert({
            batch_number:    batchNumber.trim(),
            factory_id:      activeFactory.id,
            material_id:     null,
            product_id:      null,
            batch_type:      "fg",
            production_date: new Date().toISOString().slice(0, 10),
            quantity:        null,
            unit:            "kg",
            source_batch_id: null,
            created_by:      user.id,
          })
          .select("id")
          .single();

        if (batchErr || !newBatch) {
          showToast("Could not create batch: " + (batchErr?.message ?? "unknown"), true);
          return;
        }
        batchId = newBatch.id;
        setResolvedBatchId(batchId);
      }

      // Build test_results
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

      // Insert hourly reading
      const { data: newRow, error } = await supabase.from("hourly_readings").insert({
        batch_id:     batchId,
        factory_id:   activeFactory.id,
        recorded_by:  user.id,
        reading_time: new Date(readingTime).toISOString(),
        test_results: testResults,
        remarks:      remarks.trim() || null,
      }).select("id").single();

      if (error || !newRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }

      // Flush pending photo uploads
      await Promise.all(Object.values(uploaderRefs.current).filter(Boolean).map(r => r!.flush(newRow.id)));

      showToast("Reading saved ✓");
      // Reset values only; keep batch number for next reading
      setValues(prev => Object.fromEntries(Object.keys(prev).map(k => [k, ""])));
      setRemarks("");
      setReadingTime(new Date().toISOString().slice(0, 16));
      resolveBatch(batchNumber);
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

        <label>Batch Number *</label>
        <input
          type="text"
          placeholder="Enter batch number e.g. SP-260824-001"
          value={batchNumber}
          onChange={e => setBatchNumber(e.target.value)}
          onBlur={handleBatchBlur}
        />
        {batchNumber.trim() && resolvedBatchId && (
          <div className="field-hint" style={{ color: "var(--ok)" }}>
            ✓ Existing batch found
          </div>
        )}
        {batchNumber.trim() && !resolvedBatchId && (
          <div className="field-hint">
            New batch — will be created on save
          </div>
        )}

        <label>Reading Time *</label>
        <input
          type="datetime-local"
          value={readingTime}
          onChange={e => setReadingTime(e.target.value)}
        />
      </div>

      {batchNumber.trim() && (
        <>
          {/* Dynamic test fields */}
          {loadingDefs ? (
            <div className="card"><div className="empty">Loading fields…</div></div>
          ) : (
            <div className="card">
              <h3>Test Results</h3>
              <div className="field-hint" style={{ marginBottom: 12 }}>
                Green fields are auto-calculated. Enter input values and they update automatically.
              </div>
              {testDefs.map(def => (
                <QcFieldRenderer
                  key={def.id}
                  def={def}
                  value={values[def.test_key] ?? ""}
                  onChange={handleChange}
                  photoUploadProps={(user && activeFactory) ? {
                    factoryCode:  activeFactory.code,
                    factoryId:    activeFactory.id,
                    entityType:   "hourly_reading",
                    entityId:     null,
                    userId:       user.id,
                    onUploaded:   (key, path) => handleChange(key, path),
                    uploaderRefs,
                  } : undefined}
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

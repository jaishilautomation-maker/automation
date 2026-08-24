"use client";

// =============================================================================
// Preventive Maintenance — Form JSCI/PROD/06
// A-20/1 only · Access: production_incharge, factory_admin, company_admin
//
// Layout:
//   - Table grouped by machine
//   - Columns: Sr | Component | Task | Freq | Last Done | Next Due | Status | Action
//   - "Mark done today" button → inserts a pm_completions row
//   - Status badge: OK (green) / Due Soon (orange) / Overdue (red)
//
// Due-status logic (computed client-side, not stored):
//   next_due = last_completed_at + frequency_weeks * 7 days
//   If no completion: next_due = today - frequency_weeks * 7  → always overdue
//   Due soon = next_due within the next 7 days (one week warning window)
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import type { PmScheduleItem, PmCompletion, PmItemWithStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Due-status computation
// ---------------------------------------------------------------------------

function computeDueStatus(item: PmScheduleItem, lastDoneAt: string | null): PmItemWithStatus {
  const now = new Date();
  const freqMs = item.frequency_weeks * 7 * 24 * 60 * 60 * 1000;

  let nextDue: Date;
  if (lastDoneAt) {
    nextDue = new Date(new Date(lastDoneAt).getTime() + freqMs);
  } else {
    // Never done → treat as overdue since (today - frequency) to show it
    nextDue = new Date(now.getTime() - freqMs);
  }

  const msUntilDue = nextDue.getTime() - now.getTime();
  const oneDayMs   = 24 * 60 * 60 * 1000;

  let status: PmItemWithStatus["status"];
  if (msUntilDue < 0) {
    status = "overdue";
  } else if (msUntilDue <= 7 * oneDayMs) {
    status = "due_soon";
  } else {
    status = "ok";
  }

  return {
    item,
    lastDoneAt,
    nextDueAt: nextDue.toISOString(),
    status,
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function freqLabel(weeks: number): string {
  if (weeks === 1)  return "Weekly";
  if (weeks === 2)  return "Fortnightly";
  if (weeks === 4)  return "Monthly";
  if (weeks === 12) return "Quarterly";
  if (weeks === 24) return "Half-yearly";
  return `${weeks}w`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MaintenancePage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [itemsWithStatus, setItemsWithStatus] = useState<PmItemWithStatus[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [markingId, setMarkingId]             = useState<string | null>(null);

  // Filter controls
  const [filterMachine, setFilterMachine]   = useState<string>("All");
  const [filterStatus, setFilterStatus]     = useState<"all" | "overdue" | "due_soon">("all");

  // -------------------------------------------------------------------------
  // Load schedule + latest completions
  // -------------------------------------------------------------------------
  const load = useCallback(async () => {
    if (!activeFactory) return;
    setLoading(true);

    // Fetch all schedule items for this factory
    const { data: scheduleData, error: schedErr } = await supabase
      .from("pm_schedule_items")
      .select("*")
      .eq("factory_id", activeFactory.id)
      .order("sr_no");

    if (schedErr) {
      showToast("Could not load schedule: " + schedErr.message, true);
      setLoading(false);
      return;
    }

    const schedule = (scheduleData ?? []) as PmScheduleItem[];
    if (schedule.length === 0) { setItemsWithStatus([]); setLoading(false); return; }

    // Fetch the latest completion for each item in one query
    // We select all completions for these items, then reduce to latest per item
    const itemIds = schedule.map(s => s.id);
    const { data: compData } = await supabase
      .from("pm_completions")
      .select("schedule_item_id, completed_at")
      .in("schedule_item_id", itemIds)
      .order("completed_at", { ascending: false });

    // Build a map: schedule_item_id → latest completed_at
    const latestCompletion: Record<string, string> = {};
    for (const c of (compData ?? []) as Pick<PmCompletion, "schedule_item_id" | "completed_at">[]) {
      if (!latestCompletion[c.schedule_item_id]) {
        latestCompletion[c.schedule_item_id] = c.completed_at;
      }
    }

    const computed = schedule.map(item =>
      computeDueStatus(item, latestCompletion[item.id] ?? null)
    );

    setItemsWithStatus(computed);
    setLoading(false);
  }, [activeFactory, supabase, showToast]);

  useEffect(() => { load(); }, [load]);

  // -------------------------------------------------------------------------
  // Mark done today
  // -------------------------------------------------------------------------
  const handleMarkDone = async (itemId: string) => {
    if (!user) { showToast("Session error — refresh.", true); return; }
    setMarkingId(itemId);
    try {
      const { error } = await supabase
        .from("pm_completions")
        .insert({
          schedule_item_id: itemId,
          completed_at:     new Date().toISOString(),
          completed_by:     user.id,
          notes:            null,
        });

      if (error) { showToast("Could not save: " + error.message, true); return; }
      showToast("Marked done ✓");
      load(); // refresh
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setMarkingId(null);
    }
  };

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------
  const machines = ["All", ...Array.from(new Set(itemsWithStatus.map(i => i.item.machine)))];

  const filtered = itemsWithStatus.filter(i => {
    if (filterMachine !== "All" && i.item.machine !== filterMachine) return false;
    if (filterStatus === "overdue"  && i.status !== "overdue")  return false;
    if (filterStatus === "due_soon" && i.status !== "due_soon" && i.status !== "overdue") return false;
    return true;
  });

  // Group by machine for display
  const grouped: Record<string, PmItemWithStatus[]> = {};
  for (const i of filtered) {
    if (!grouped[i.item.machine]) grouped[i.item.machine] = [];
    grouped[i.item.machine].push(i);
  }

  // Summary counts
  const overdueCount  = itemsWithStatus.filter(i => i.status === "overdue").length;
  const dueSoonCount  = itemsWithStatus.filter(i => i.status === "due_soon").length;

  // -------------------------------------------------------------------------
  // Status badge helper
  // -------------------------------------------------------------------------
  function StatusBadge({ status }: { status: PmItemWithStatus["status"] }) {
    const cfg = {
      ok:       { label: "OK",        bg: "var(--ok-soft)", color: "var(--ok)" },
      due_soon: { label: "Due Soon",  bg: "#fff3e0",        color: "var(--warn)" },
      overdue:  { label: "Overdue",   bg: "#ffebee",        color: "#d32f2f" },
    }[status];
    return (
      <span style={{
        fontSize: 11, fontWeight: 600,
        padding: "2px 8px", borderRadius: 12,
        background: cfg.bg, color: cfg.color,
        whiteSpace: "nowrap",
      }}>
        {cfg.label}
      </span>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* Page header */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>Preventive Maintenance</h3>
            <div className="field-hint">Form JSCI/PROD/06 · {activeFactory?.name ?? "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {overdueCount > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#d32f2f" }}>
                {overdueCount} overdue
              </span>
            )}
            {dueSoonCount > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)" }}>
                {dueSoonCount} due soon
              </span>
            )}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["all", "due_soon", "overdue"] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterStatus(f)}
                style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                  border: "1px solid var(--line)",
                  background: filterStatus === f ? "var(--clay)" : "var(--surface)",
                  color: filterStatus === f ? "#fff" : "var(--ink)",
                  fontWeight: filterStatus === f ? 600 : 400,
                }}
              >
                {f === "all" ? "All" : f === "due_soon" ? "Due / Overdue" : "Overdue only"}
              </button>
            ))}
          </div>

          <select
            value={filterMachine}
            onChange={e => setFilterMachine(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line)" }}
          >
            {machines.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="empty">Loading schedule…</div></div>
      ) : itemsWithStatus.length === 0 ? (
        <div className="card">
          <div className="empty">
            No PM schedule found for this factory. Run migration 013 in Supabase SQL Editor.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty">No items match the current filter.</div></div>
      ) : (
        Object.entries(grouped).map(([machine, items]) => (
          <div key={machine} className="card" style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
            {/* Machine header */}
            <div style={{
              padding: "10px 16px",
              background: "var(--surface-2, #f9f7f4)",
              borderBottom: "1px solid var(--line)",
              fontWeight: 700,
              fontSize: 13,
            }}>
              {machine}
            </div>

            {/* Table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)" }}>Sr</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)" }}>Component</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)" }}>Task</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)" }}>Freq</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)" }}>Last Done</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)" }}>Next Due</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)" }}>Status</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink-soft)" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i, idx) => (
                    <tr
                      key={i.item.id}
                      style={{
                        borderBottom: idx < items.length - 1 ? "1px solid var(--line)" : "none",
                        background: i.status === "overdue" ? "#fff5f5" : "transparent",
                      }}
                    >
                      <td style={{ padding: "8px 12px", color: "var(--ink-soft)" }}>{i.item.sr_no}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 500 }}>{i.item.component}</td>
                      <td style={{ padding: "8px 12px" }}>{i.item.task}</td>
                      <td style={{ padding: "8px 12px", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                        {freqLabel(i.item.frequency_weeks)}
                      </td>
                      <td style={{ padding: "8px 12px", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                        {fmtDate(i.lastDoneAt)}
                      </td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontWeight: i.status !== "ok" ? 600 : 400 }}>
                        {fmtDate(i.nextDueAt)}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <StatusBadge status={i.status} />
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: 11, padding: "4px 10px", whiteSpace: "nowrap" }}
                          disabled={markingId === i.item.id}
                          onClick={() => handleMarkDone(i.item.id)}
                        >
                          {markingId === i.item.id ? "Saving…" : "Mark done today"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      <div className="small-note">
        Status is computed from the last completion date + frequency interval.
        "Due soon" = due within the next 7 days.
        All times are in your local timezone.
      </div>
    </>
  );
}

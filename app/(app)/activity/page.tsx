"use client";

// =============================================================================
// Activity — field-level audit drill-down (factory_admin / company_admin only)
//
// Accessible from the select-module page (beside Manage Users tile).
// Lets a manager pick a user + date, then see a timeline of every individual
// field entry for records saved that day — field name, value, when the user
// says they filled it (entered_at), and when the server received it (recorded_at).
//
// Rows where entered_at and recorded_at differ by more than 5 minutes are
// highlighted in amber — that gap is the signal for a potentially backdated
// client timestamp.
//
// This page is pull-based (manager visits when they want to check something).
// The push mechanism is the daily digest email from /api/field-audit-digest.
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";

interface ProfileRow {
  id: string;
  full_name: string;
}

interface FieldEntry {
  id: string;
  user_id: string;
  module: string;
  record_id: string;
  field_name: string;
  field_value: string | null;
  entered_at: string;
  recorded_at: string;
}

const FLAG_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function gapMs(row: FieldEntry): number {
  return new Date(row.recorded_at).getTime() - new Date(row.entered_at).getTime();
}

function fmtGap(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const MODULE_LABELS: Record<string, string> = {
  batch_analysis: "Batch Analysis",
  rm_receipt:     "RM Receipt",
  rm_qc:          "RM QC",
  job_card:       "Job Card",
  breakdown:      "Breakdown",
  pm:             "Preventive Maintenance",
};

export default function ActivityPage() {
  const { profile } = useAuth();
  const { activeFactory } = useModule();
  const { showToast } = useToast();
  const supabase = createClient();

  const [users, setUsers]       = useState<ProfileRow[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [entries, setEntries]   = useState<FieldEntry[]>([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);

  // Load user list (all profiles the current user can see)
  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, full_name")
      .order("full_name")
      .then(({ data }) => setUsers((data ?? []) as ProfileRow[]));
  }, [supabase]);

  const search = useCallback(async () => {
    if (!selectedDate) { showToast("Select a date.", true); return; }
    setLoading(true);
    setSearched(true);

    const dayStart = new Date(selectedDate + "T00:00:00.000Z").toISOString();
    const dayEnd   = new Date(selectedDate + "T23:59:59.999Z").toISOString();

    let query = supabase
      .from("field_entry_log")
      .select("*")
      .gte("recorded_at", dayStart)
      .lte("recorded_at", dayEnd)
      .order("entered_at", { ascending: true });

    if (selectedUser) query = query.eq("user_id", selectedUser);

    const { data, error } = await query;
    if (error) { showToast("Could not load: " + error.message, true); setLoading(false); return; }
    setEntries((data ?? []) as FieldEntry[]);
    setLoading(false);
  }, [selectedDate, selectedUser, supabase, showToast]);

  const flagged  = entries.filter(r => gapMs(r) > FLAG_THRESHOLD_MS);
  const byRecord = entries.reduce<Record<string, FieldEntry[]>>((acc, r) => {
    const key = `${r.module}::${r.record_id}`;
    (acc[key] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <div className="card">
        <h3>Activity — Field-level Audit Drill-down</h3>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          Select a user and date to see a timeline of every field they filled in.
          Rows highlighted in amber have a gap between client timestamp and server
          receipt of more than 5 minutes — a potential signal for backdating.
        </p>

        <div className="row2">
          <div>
            <label>User</label>
            <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
              <option value="">— All users —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Date</label>
            <input type="date" value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)} />
          </div>
        </div>

        <button className="btn btn-primary" type="button"
          disabled={loading} onClick={search} style={{ marginTop: 12 }}>
          {loading ? "Loading…" : "Search"}
        </button>
      </div>

      {searched && !loading && (
        <>
          {entries.length === 0 ? (
            <div className="card">
              <div className="empty">No field entries found for this selection.</div>
            </div>
          ) : (
            <>
              {/* Summary banner */}
              <div className="card" style={{
                background: flagged.length > 0 ? "#fff8e1" : "var(--ok-soft)",
                borderColor: flagged.length > 0 ? "var(--warn)" : "var(--ok)",
              }}>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
                  <div><b>Total entries:</b> {entries.length}</div>
                  <div><b>Records touched:</b> {Object.keys(byRecord).length}</div>
                  <div><b>Modules:</b> {[...new Set(entries.map(r => MODULE_LABELS[r.module] ?? r.module))].join(", ")}</div>
                  {flagged.length > 0 ? (
                    <div style={{ color: "var(--warn)", fontWeight: 700 }}>
                      ⚠ {flagged.length} entries flagged (&gt;5 min gap)
                    </div>
                  ) : (
                    <div style={{ color: "var(--ok)", fontWeight: 700 }}>✓ No timing anomalies</div>
                  )}
                </div>
              </div>

              {/* Detail grouped by record */}
              {Object.entries(byRecord).map(([key, rows]) => {
                const [module, recordId] = key.split("::");
                const userName = users.find(u => u.id === rows[0].user_id)?.full_name ?? rows[0].user_id;
                const anyFlag  = rows.some(r => gapMs(r) > FLAG_THRESHOLD_MS);
                return (
                  <div key={key} className="card" style={anyFlag ? { borderColor: "var(--warn)" } : undefined}>
                    <div style={{ marginBottom: 8 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px",
                        borderRadius: 10, background: "var(--clay-soft)", color: "var(--clay)",
                        marginRight: 8,
                      }}>
                        {MODULE_LABELS[module] ?? module}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                        Record: <code style={{ fontSize: 11 }}>{recordId.slice(0, 8)}…</code>
                        {" · "}User: <b>{userName}</b>
                      </span>
                    </div>

                    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--panel)", textAlign: "left" }}>
                          <th style={{ padding: "4px 8px" }}>Field</th>
                          <th style={{ padding: "4px 8px" }}>Value</th>
                          <th style={{ padding: "4px 8px" }}>Entered at</th>
                          <th style={{ padding: "4px 8px" }}>Received at</th>
                          <th style={{ padding: "4px 8px" }}>Gap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => {
                          const gap   = gapMs(r);
                          const isFlagged = gap > FLAG_THRESHOLD_MS;
                          return (
                            <tr key={r.id} style={{
                              background: isFlagged ? "#fff8e1" : undefined,
                              borderTop: "1px solid var(--line)",
                            }}>
                              <td style={{ padding: "4px 8px", fontWeight: 600 }}>{r.field_name}</td>
                              <td style={{ padding: "4px 8px", color: "var(--ink-soft)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {r.field_value ?? <em style={{ color: "var(--ink-soft)" }}>cleared</em>}
                              </td>
                              <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{fmtTime(r.entered_at)}</td>
                              <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{fmtTime(r.recorded_at)}</td>
                              <td style={{ padding: "4px 8px", whiteSpace: "nowrap", color: isFlagged ? "var(--warn)" : "var(--ink-soft)", fontWeight: isFlagged ? 700 : 400 }}>
                                {isFlagged ? `⚠ ${fmtGap(gap)}` : fmtGap(gap)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </>
  );
}

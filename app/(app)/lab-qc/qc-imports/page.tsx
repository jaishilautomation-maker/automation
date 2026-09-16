"use client";

// =============================================================================
// Lab QC — QC Imports (A-20 side)
//
// Shows QC records received from A-20/1 via the exchange protocol.
// Search by source batch number, filter by material/product/status/date.
// Clicking a row shows the full payload and revision history.
//
// This page is present in both A-20/1 and A-20 deployments (same codebase),
// but only makes sense on A-20. On A-20/1 it is not linked in the nav and
// the qc_imports table does not exist, so the page renders an informational
// message if the table query fails.
// =============================================================================

import { useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/lib/toast-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface QcImportRow {
  id: string;
  exchange_id: string;
  source_factory: string;
  source_table: string;
  source_record_id: string;
  source_batch_number: string | null;
  material: string | null;
  product: string | null;
  qc_type: string | null;
  test_result: string | null;
  qc_status: string;
  tested_at: string | null;
  finalized_at: string | null;
  transferred_at: string;
  version: number;
  status: "active" | "superseded";
  payload: Record<string, unknown>;
  superseded_by: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function resultBadge(result: string | null) {
  if (!result || result === "pending") {
    return { label: "Pending", bg: "#f5f5f5", color: "var(--ink-soft)" };
  }
  if (result === "pass") return { label: "Pass", bg: "var(--ok-soft)", color: "var(--ok)" };
  if (result === "fail") return { label: "Fail", bg: "#ffebee", color: "#d32f2f" };
  return { label: result, bg: "#f5f5f5", color: "var(--ink-soft)" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function QcImportsPage() {
  const { showToast } = useToast();
  const supabase = createClient();

  const [query, setQuery]               = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "superseded">("active");
  const [results, setResults]           = useState<QcImportRow[]>([]);
  const [loading, setLoading]           = useState(false);
  const [searched, setSearched]         = useState(false);
  const [selectedRow, setSelectedRow]   = useState<QcImportRow | null>(null);
  const [history, setHistory]           = useState<QcImportRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------
  const doSearch = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    setSelectedRow(null);

    try {
      let q = supabase
        .from("qc_imports")
        .select("*")
        .order("transferred_at", { ascending: false })
        .limit(100);

      if (filterStatus !== "all") q = q.eq("status", filterStatus);

      const trimmed = query.trim();
      if (trimmed) {
        // Search by source_batch_number (partial match) or exchange_id
        q = q.or(
          `source_batch_number.ilike.%${trimmed}%,` +
          `material.ilike.%${trimmed}%,` +
          `product.ilike.%${trimmed}%,` +
          `source_factory.ilike.%${trimmed}%`
        );
      }

      const { data, error } = await q;

      if (error) {
        // Table may not exist on A-20/1 deployment
        if (error.code === "42P01") {
          showToast("qc_imports table not found — this page is for A-20 deployment only.", true);
          setResults([]);
        } else {
          showToast("Search failed: " + error.message, true);
        }
      } else {
        setResults((data ?? []) as QcImportRow[]);
      }
    } finally {
      setLoading(false);
    }
  }, [query, filterStatus, supabase, showToast]);

  // -------------------------------------------------------------------------
  // Load revision history for a selected row
  // -------------------------------------------------------------------------
  const loadHistory = useCallback(async (row: QcImportRow) => {
    setSelectedRow(row);
    setLoadingHistory(true);
    const { data } = await supabase
      .from("qc_imports")
      .select("*")
      .eq("source_factory", row.source_factory)
      .eq("source_record_id", row.source_record_id)
      .order("version", { ascending: false });
    setHistory((data ?? []) as QcImportRow[]);
    setLoadingHistory(false);
  }, [supabase]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>QC Imports from A-20/1</h3>
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Finalized QC records received from Dombivli A-20/1 via the exchange protocol.
          Search by batch number, material, or product name.
        </div>

        <input
          type="text"
          placeholder="Search batch number, material, product, factory…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch()}
          autoFocus
        />

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          {(["active", "all", "superseded"] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                border: "1px solid var(--line)",
                background: filterStatus === s ? "var(--clay)" : "var(--surface)",
                color: filterStatus === s ? "#fff" : "var(--ink)",
                fontWeight: filterStatus === s ? 600 : 400,
              }}
            >
              {s === "active" ? "Active" : s === "superseded" ? "Superseded" : "All versions"}
            </button>
          ))}
          <button className="btn btn-primary" type="button" onClick={doSearch} style={{ fontSize: 13 }}>
            Search
          </button>
        </div>
      </div>

      {/* Results list */}
      {loading && <div className="empty">Searching…</div>}

      {!loading && searched && results.length === 0 && (
        <div className="empty">No records found.</div>
      )}

      {!loading && results.length > 0 && !selectedRow && (
        <div className="card">
          <div className="helper-row">
            <h3 style={{ margin: 0 }}>Results</h3>
            <span className="count">{results.length}</span>
          </div>

          {results.map(row => {
            const badge = resultBadge(row.test_result);
            return (
              <div
                key={row.id}
                className="pending-item"
                style={{ cursor: "pointer" }}
                onClick={() => loadHistory(row)}
              >
                <div className="pi-top">
                  <span style={{ fontWeight: 700 }}>
                    {row.source_batch_number ?? row.source_record_id.slice(0, 8)}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
                    background: badge.bg, color: badge.color,
                  }}>
                    {badge.label}
                  </span>
                </div>
                <div className="pi-sub">
                  {row.qc_type ?? row.source_table} ·{" "}
                  {row.material ?? row.product ?? "—"} ·{" "}
                  From: {row.source_factory} ·{" "}
                  Received: {fmtDate(row.transferred_at)}
                  {row.version > 1 && (
                    <span style={{ color: "var(--warn)", marginLeft: 6 }}>v{row.version}</span>
                  )}
                  {row.status === "superseded" && (
                    <span style={{ color: "var(--ink-soft)", marginLeft: 6 }}>[superseded]</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail / history panel */}
      {selectedRow && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>
              {selectedRow.source_batch_number ?? selectedRow.source_record_id.slice(0, 8)}
            </h3>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => setSelectedRow(null)}
            >
              ← Back to results
            </button>
          </div>

          {/* Active version detail */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 13 }}>
            {[
              ["QC Type",    selectedRow.qc_type ?? "—"],
              ["Material",   selectedRow.material ?? "—"],
              ["Product",    selectedRow.product ?? "—"],
              ["Result",     selectedRow.test_result ?? "pending"],
              ["Tested",     fmtDate(selectedRow.tested_at)],
              ["Finalized",  fmtDate(selectedRow.finalized_at)],
              ["Received",   fmtDate(selectedRow.transferred_at)],
              ["Source",     selectedRow.source_factory],
              ["Version",    String(selectedRow.version)],
              ["Status",     selectedRow.status],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 2 }}>{label}</div>
                <div style={{ fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Payload */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--ink-soft)" }}>
              Full QC payload (read-only)
            </div>
            <textarea
              readOnly
              rows={10}
              value={JSON.stringify(selectedRow.payload, null, 2)}
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: 11,
                width: "100%",
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: 10,
                resize: "vertical",
              }}
            />
          </div>

          {/* Revision history */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--ink-soft)" }}>
              Revision history
            </div>
            {loadingHistory ? (
              <div className="field-hint">Loading…</div>
            ) : (
              history.map(h => (
                <div
                  key={h.id}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13,
                    opacity: h.status === "superseded" ? 0.6 : 1,
                  }}
                >
                  <span>
                    v{h.version} · {fmtDate(h.transferred_at)}
                    {h.status === "superseded" && (
                      <span style={{ color: "var(--ink-soft)", marginLeft: 6 }}>[superseded]</span>
                    )}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
                    background: resultBadge(h.test_result).bg,
                    color: resultBadge(h.test_result).color,
                  }}>
                    {resultBadge(h.test_result).label}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

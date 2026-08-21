"use client";

// =============================================================================
// Lab QC — Search
//
// Single search bar querying v_unified_search (Postgres full-text search).
// Results link to the batch detail / QC record for that batch.
// The view does factory-scoped filtering automatically via RLS.
// =============================================================================

import { useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import type { UnifiedSearchRow } from "@/lib/types";

// Debounce helper — fires after user stops typing for `delay` ms
function useDebounce<T extends (...args: Parameters<T>) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return useCallback(
    ((...args: Parameters<T>) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    }) as T,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn]
  );
}

export default function LabQcSearchPage() {
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<UnifiedSearchRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) { setResults([]); setSearched(false); return; }

      setLoading(true);
      setSearched(true);
      try {
        // v_unified_search exposes a search_vector column.
        // Supabase's .textSearch() method maps to @@ plainto_tsquery.
        const { data, error } = await supabase
          .from("v_unified_search")
          .select("*")
          .textSearch("search_vector", trimmed, { type: "plain", config: "english" })
          // Factory scope: RLS handles it, but we also filter client-side for the
          // active factory so cross-factory admins see only the selected factory.
          .eq(activeFactory ? "factory_id" : "id", activeFactory?.id ?? "")
          .order("production_date", { ascending: false })
          .limit(50);

        if (error) throw error;
        setResults((data ?? []) as UnifiedSearchRow[]);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [supabase, activeFactory]
  );

  const debouncedSearch = useDebounce(doSearch, 350);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    debouncedSearch(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") doSearch(query);
  };

  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Search</h3>
        <input
          type="text"
          placeholder="Search batch number, lot, product, material, chemist…"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div className="field-hint">
          Search across batch numbers, lot numbers, product names, material names, and chemist names
          {activeFactory ? ` at ${activeFactory.name}` : ""}.
        </div>
      </div>

      {loading && <div className="empty">Searching…</div>}

      {!loading && searched && results.length === 0 && (
        <div className="empty">No results for &ldquo;{query}&rdquo;</div>
      )}

      {!loading && results.length > 0 && (
        <div className="card">
          <div className="helper-row">
            <h3 style={{ margin: 0 }}>Results</h3>
            <span className="count">{results.length} found</span>
          </div>

          {results.map(row => (
            <div key={row.batch_id} className="pending-item">
              <div className="pi-top">
                <span style={{ fontWeight: 700 }}>{row.batch_number}</span>
                <span
                  className="badge ok"
                  style={{ fontSize: 10 }}
                >
                  {row.batch_type.toUpperCase()}
                </span>
              </div>
              <div className="pi-sub">
                {row.material_name ?? row.product_name ?? "—"} ·{" "}
                {row.factory_name} · {row.production_date}
                {row.lot_number ? ` · Lot: ${row.lot_number}` : ""}
                {row.created_by_name ? ` · ${row.created_by_name}` : ""}
              </div>
            </div>
          ))}

          <div className="field-hint" style={{ marginTop: 8 }}>
            Click a result to view the batch record. (Full batch detail page — coming in the
            next milestone.)
          </div>
        </div>
      )}
    </>
  );
}

// =============================================================================
// lib/extra-ingredient-rows.ts
//
// Utilities for the dynamic ingredient rows feature (migration 030).
// ExtraRow is serialised as JSON into production_job_cards.extra_ingredient_rows.
// =============================================================================

import type { ExtraRow } from "@/components/DynamicIngredientRows";

/** Parse the raw DB value (string | null | unknown) into ExtraRow[]. */
export function parseExtraRows(raw: unknown): ExtraRow[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    // Light validation — only keep objects that look like ExtraRow
    return (parsed as unknown[]).filter(
      (r): r is ExtraRow =>
        r !== null &&
        typeof r === "object" &&
        typeof (r as ExtraRow).id            === "string" &&
        typeof (r as ExtraRow).phase         === "string" &&
        typeof (r as ExtraRow).componentName === "string",
    );
  } catch {
    return [];
  }
}

/** Serialise ExtraRow[] for storage in the DB (as a JSONB column). */
export function serialiseExtraRows(rows: ExtraRow[]): unknown {
  // Strip rows that have absolutely no data (componentName AND all qty fields empty)
  const meaningful = rows.filter(r =>
    r.componentName.trim() !== "" ||
    r.instructedQty.trim() !== "" ||
    r.addedQty.trim()      !== ""
  );
  return meaningful.length > 0 ? meaningful : null;
}

/**
 * Sum the instructedQty of extra rows matching a given phase key.
 * Returns a number (0 if no matching rows or all empty).
 */
export function extraInstructedTotal(rows: ExtraRow[], phase: string): number {
  return rows
    .filter(r => r.phase === phase)
    .reduce((s, r) => {
      const n = parseFloat(r.instructedQty);
      return s + (isNaN(n) ? 0 : n);
    }, 0);
}

/**
 * Sum the addedQty of extra rows matching a given phase key.
 * Returns a number (0 if no matching rows or all empty).
 */
export function extraAddedTotal(rows: ExtraRow[], phase: string): number {
  return rows
    .filter(r => r.phase === phase)
    .reduce((s, r) => {
      const n = parseFloat(r.addedQty);
      return s + (isNaN(n) ? 0 : n);
    }, 0);
}

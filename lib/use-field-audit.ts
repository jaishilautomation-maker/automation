// =============================================================================
// useFieldAudit — field-level audit capture hook
//
// Usage in any form page:
//
//   const audit = useFieldAudit();
//
//   // On each input's onBlur:
//   onBlur={() => audit.record("field_name", currentValue)}
//
//   // On submit, after you have the record_id:
//   await audit.flush(supabase, user.id, "batch_analysis", newRow.id);
//
// Contract:
//   - Zero network calls during data entry — all captured in local React state.
//   - One batched multi-row INSERT per form submit.
//   - Only records fields whose value changed since the last recorded snapshot.
//   - Never throws — failures are logged to console, never block the DB save.
//   - `flush` automatically resets the buffer after a successful insert.
// =============================================================================

import { useRef, useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FieldEntry {
  field_name:  string;
  field_value: string | null;
  entered_at:  string;  // ISO timestamptz — client-reported time of field fill
}

export interface FieldAuditHandle {
  /**
   * Call from each field's `onBlur`. Only queues an entry if the value
   * has changed from the last recorded value for that field.
   */
  record: (fieldName: string, value: string | null | undefined) => void;

  /**
   * Flush the buffer to `field_entry_log` as a single batched INSERT.
   * Call this in the submit handler after the main record is saved and
   * you have the `recordId`.
   *
   * @param supabase  — the browser Supabase client from the form page
   * @param userId    — auth.users.id of the submitting user
   * @param module    — one of the module keys ('batch_analysis', 'rm_receipt', etc.)
   * @param recordId  — UUID of the saved row in that module's table
   */
  flush: (
    supabase: SupabaseClient,
    userId:   string,
    module:   string,
    recordId: string,
  ) => Promise<void>;

  /** Reset the buffer (called automatically after a successful flush). */
  reset: () => void;
}

export function useFieldAudit(): FieldAuditHandle {
  // Buffer lives in a ref so it doesn't cause re-renders.
  const buffer = useRef<FieldEntry[]>([]);
  // Tracks the last recorded value per field so we only log changes.
  const lastValues = useRef<Record<string, string | null>>({});

  const record = useCallback((fieldName: string, rawValue: string | null | undefined) => {
    const value = rawValue === undefined ? null : rawValue === "" ? null : rawValue;
    const last  = lastValues.current[fieldName];

    // Normalise: treat null and undefined as the same (no value).
    const hasChanged = value !== last;
    if (!hasChanged) return;

    lastValues.current[fieldName] = value;
    buffer.current.push({
      field_name:  fieldName,
      field_value: value,
      entered_at:  new Date().toISOString(),
    });
  }, []);

  const flush = useCallback(async (
    supabase: SupabaseClient,
    userId:   string,
    module:   string,
    recordId: string,
  ): Promise<void> => {
    const entries = buffer.current.slice(); // snapshot
    if (entries.length === 0) return;

    const rows = entries.map(e => ({
      user_id:     userId,
      module,
      record_id:   recordId,
      field_name:  e.field_name,
      field_value: e.field_value,
      entered_at:  e.entered_at,
    }));

    try {
      const { error } = await supabase.from("field_entry_log").insert(rows);
      if (error) {
        console.error("[useFieldAudit] flush failed:", error.message);
        return; // keep buffer — caller's save is unaffected
      }
      // Only reset on success so a retry can re-flush.
      buffer.current   = [];
      lastValues.current = {};
    } catch (err) {
      console.error("[useFieldAudit] flush exception:", err);
    }
  }, []);

  const reset = useCallback(() => {
    buffer.current     = [];
    lastValues.current = {};
  }, []);

  return { record, flush, reset };
}

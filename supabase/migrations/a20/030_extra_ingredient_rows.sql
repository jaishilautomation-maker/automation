-- =============================================================================
-- A-20 Migration 030: Extra (dynamic) ingredient rows on production job cards
--
-- Adds a single nullable JSONB column to production_job_cards to store
-- any additional ingredient rows that the operator adds at production time.
-- These rows are not part of the formula master (product_formula_items) and
-- therefore cannot be stored in production_job_card_items (which has a
-- NOT NULL FK on formula_item_id).
--
-- Column:
--   extra_ingredient_rows   jsonb   — array of ExtraRow objects, or NULL
--
-- ExtraRow shape (enforced in the application layer, not the DB):
--   {
--     id:             string  — client-generated uuid (crypto.randomUUID) for
--                               React keying; never stored in product_formula_items
--     phase:          string  — 'A' | 'B' | 'A_843' | 'A_600' etc., matching
--                               the same phase key used by the formula rows in
--                               that form
--     componentName:  string  — free-text or material code entered by operator
--     instructedQty:  string  — numeric string (kg), or ""
--     addedQty:       string  — numeric string (kg), or ""
--     rmBatchNo:      string  — raw material batch number
--     drumBagNo:      string  — drum / bag identifier
--   }
--
-- This column is intentionally nullable and opaque (jsonb not jsonb[]) so that:
--   • Existing rows for all products have NULL here with no schema change needed
--   • Each form serialises / deserialises its own subset of the array
--   • The column can grow to hold other forms' extra data without conflicts
--
-- All 6 A-20 operator job-card forms use the same column.
-- A-20/1 has a separate Supabase project and is unaffected.
-- =============================================================================

ALTER TABLE public.production_job_cards
    ADD COLUMN IF NOT EXISTS extra_ingredient_rows jsonb;

COMMENT ON COLUMN public.production_job_cards.extra_ingredient_rows
    IS 'Operator-added ingredient rows that are not in the formula master. '
       'Array of {id, phase, componentName, instructedQty, addedQty, rmBatchNo, drumBagNo}.';

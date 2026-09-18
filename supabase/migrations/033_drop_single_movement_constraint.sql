-- =============================================================================
-- Migration 033: Drop chk_ledger_single_movement constraint
--
-- PROBLEM:
--   The constraint chk_ledger_single_movement (added in migration 027) requires
--   that at most ONE of qty_received, qty_issued, dispatch_qty is non-zero per
--   ledger row. This was designed for simple single-movement rows.
--
-- WHY IT MUST BE DROPPED:
--   Several DPR register sections (Raw Material, Packing Material, Finished
--   Goods, Ball Mill) save SUMMARY rows that legitimately contain multiple
--   movement values in a single record — e.g. a daily RM entry has both
--   qty_received AND qty_issued in the same row, matching how the Excel DPR
--   tabs work. Blocking these with a constraint breaks the stores module.
--
--   The chk_ledger_non_negative constraint (all values >= 0) is kept — that
--   one is safe and useful.
--
-- Depends on: 027 (stores_stock_ledger).
-- =============================================================================

ALTER TABLE public.stores_stock_ledger
    DROP CONSTRAINT IF EXISTS chk_ledger_single_movement;

-- =============================================================================
-- END OF MIGRATION 033
-- Dropped : chk_ledger_single_movement
-- Kept    : chk_ledger_non_negative (qty_received/issued/dispatch >= 0)
-- =============================================================================

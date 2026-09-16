-- =============================================================================
-- Migration 021: Set oil_feed_std = 0 (not NULL) for no-oil-dosing party codes
--
-- Shakti, 108, Rubber and 2615 run without oil dosing. Their mill rows were
-- seeded with oil_feed_std = NULL, which the app/trigger treat as "no standard"
-- (oil_required shows NA). Business rule: treat these as std = 0 so the formula
--   oil_required_kg = planned_MT * 1000 * std
-- yields 0 for these codes instead of NA.
--
-- Only touches these 4 mill rows. Idempotent.
--
-- Depends on: 017 (vfd_parameters seed).
-- =============================================================================

UPDATE public.vfd_parameters
SET oil_feed_std = 0
WHERE machine_type = 'mill'
  AND party_code IN ('Shakti', '108', 'Rubber', '2615')
  AND oil_feed_std IS NULL;

-- =============================================================================
-- END OF MIGRATION 021
-- =============================================================================

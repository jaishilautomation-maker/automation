-- =============================================================================
-- Migration 026: Allow multiple low-production reasons per hourly reading
--
-- Previously low_production_reason was a single text value with a CHECK
-- constraint limiting it to one of 6 fixed strings. The UI now allows the
-- operator to select multiple reasons (stored as comma-joined text, e.g.
-- "Mesh clogging (जाली भरना), Power off (बिजली बंद होना)").
--
-- Change: drop the single-value CHECK constraint. The column stays text —
-- existing single-value rows are unaffected; new rows may contain
-- comma-separated combinations.
-- =============================================================================

ALTER TABLE public.pulveriser_hourly_readings
    DROP CONSTRAINT IF EXISTS chk_pulveriser_low_prod_reason;

-- =============================================================================
-- Migration 051: Guarantee oil_feed_std = 0 (not NULL) for no-oil-dosing codes
--                using their CURRENT display-label party_code values.
--
-- Background:
--   Migration 021 zeroed oil_feed_std for the OLD codes ('Shakti','108',
--   'Rubber','2615') only where it was NULL. Migration 043 then RENAMED those
--   codes to display labels (e.g. '2615' → 'Plain-2615') and added new codes.
--   Any renamed/new plain code whose mill-row oil_feed_std ended up NULL makes
--   the "Oil Required (auto)" calculation return NA and the recompute trigger
--   store NULL — the bug seen in testing for plain/Shakti batches
--   (oil_required registered as zero/blank).
--
-- Fix:
--   For every mill row whose party_code is a known no-oil-dosing code (by its
--   current display label), set oil_feed_std = 0 where it is currently NULL.
--   With std = 0, oil_required_kg = planned_MT * 1000 * 0 = 0 (a real zero),
--   which is the intended business rule for these codes.
-- =============================================================================

UPDATE public.vfd_parameters
SET oil_feed_std = 0
WHERE machine_type = 'mill'
  AND oil_feed_std IS NULL
  AND party_code IN (
    'Shakti',
    'Rubber',
    'Ceat 108',       -- was '108'
    'Plain-2615',     -- was '2615'
    'Plain Lanxess',
    'Sulphur Powder'
  );

-- Recompute oil columns on any existing job cards that were left with a NULL
-- oil_required_kg because their code's std was NULL at insert time. Touching a
-- monitored column re-fires fn_pulveriser_recompute_oil.
UPDATE public.pulveriser_job_cards jc
SET planned_production_mt = jc.planned_production_mt
FROM public.vfd_parameters vp
WHERE vp.machine_type = 'mill'
  AND vp.party_code = jc.party_code
  AND vp.oil_feed_std = 0
  AND jc.oil_required_kg IS NULL
  AND jc.planned_production_mt IS NOT NULL;

-- =============================================================================
-- END OF MIGRATION 051
-- =============================================================================

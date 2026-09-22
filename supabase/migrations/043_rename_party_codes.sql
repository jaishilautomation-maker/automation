-- =============================================================================
-- Migration 043 — Rename Party/CODE values to display labels
--
-- Renames existing vfd_parameters.party_code values to the human-friendly
-- labels used in the Production Job Card dropdown, and adds two new zero-oil
-- codes (Plain Lanxess, Sulphur Powder).
--
-- Because party_code is also stored on pulveriser_job_cards.material_code,
-- historic job cards are updated too so their oil-standard lookup keeps working.
--
-- Final dropdown list (mill rows, ordered):
--   Ceat 108, M2615, Plain-2615, Apollo 160108, LANXESS, Ceat R5299,
--   Plain Lanxess, JKI-108, Shakti, Rubber, Sulphur Powder
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rename existing codes in vfd_parameters (both machine_type rows)
--    Order matters: rename to temporary-safe distinct targets. Since all new
--    names are unique and don't collide with remaining old names, a direct
--    UPDATE per code is safe.
-- ---------------------------------------------------------------------------
UPDATE public.vfd_parameters SET party_code = 'Ceat 108'      WHERE party_code = '108';
UPDATE public.vfd_parameters SET party_code = 'M2615'         WHERE party_code = 'M-2615';
UPDATE public.vfd_parameters SET party_code = 'Plain-2615'    WHERE party_code = '2615';
UPDATE public.vfd_parameters SET party_code = 'Apollo 160108' WHERE party_code = '160108';
UPDATE public.vfd_parameters SET party_code = 'LANXESS'       WHERE party_code = 'Lanxess';
UPDATE public.vfd_parameters SET party_code = 'Ceat R5299'    WHERE party_code = 'R5299';
UPDATE public.vfd_parameters SET party_code = 'JKI-108'       WHERE party_code = 'JKI108';
UPDATE public.vfd_parameters SET party_code = 'JKI-108'       WHERE party_code = 'JKI';
-- 'Shakti' and 'Rubber' keep their names — no change.

-- ---------------------------------------------------------------------------
-- 2. Propagate renames to historic job cards (material_code holds party_code)
-- ---------------------------------------------------------------------------
UPDATE public.pulveriser_job_cards SET material_code = 'Ceat 108'      WHERE material_code = '108';
UPDATE public.pulveriser_job_cards SET material_code = 'M2615'         WHERE material_code = 'M-2615';
UPDATE public.pulveriser_job_cards SET material_code = 'Plain-2615'    WHERE material_code = '2615';
UPDATE public.pulveriser_job_cards SET material_code = 'Apollo 160108' WHERE material_code = '160108';
UPDATE public.pulveriser_job_cards SET material_code = 'LANXESS'       WHERE material_code = 'Lanxess';
UPDATE public.pulveriser_job_cards SET material_code = 'Ceat R5299'    WHERE material_code = 'R5299';
UPDATE public.pulveriser_job_cards SET material_code = 'JKI-108'       WHERE material_code IN ('JKI108', 'JKI');

-- ---------------------------------------------------------------------------
-- 3. Add the two new zero-oil codes (Plain Lanxess, Sulphur Powder)
--    Both have no oil dosing → oil_feed_std = 0 (oil_required computes to 0,
--    not NA). VFD reference values left NULL (no standard defined yet).
-- ---------------------------------------------------------------------------
INSERT INTO public.vfd_parameters
    (party_code, machine_type, classifier_vfd, feeder_vfd, oil_feed_std, oil_feed_min, oil_feed_max, pump_flow, mesh_size_300)
VALUES
    ('Plain Lanxess',  'mill', NULL, NULL, 0, NULL, NULL, NULL, '-'),
    ('Sulphur Powder', 'mill', NULL, NULL, 0, NULL, NULL, NULL, '-')
ON CONFLICT (party_code, machine_type) DO UPDATE SET
    oil_feed_std = EXCLUDED.oil_feed_std;

-- =============================================================================
-- END OF MIGRATION 043
--   Renamed 7 mill+pump codes to display labels, propagated to job cards,
--   added Plain Lanxess + Sulphur Powder (both zero-oil).
-- =============================================================================

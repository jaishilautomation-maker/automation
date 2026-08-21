-- =============================================================================
-- Migration 006: Fix factory code inconsistency
-- Problem: 001_initial_schema.sql seeded factory code 'DBV_20' for
--          "Factory A 20" (the Dombivli 20/2 / Factory A 20 site).
--          005_seed_factories.sql then inserted a second row with code
--          'DBV_20_2' for the same site, creating a duplicate.
--
-- The canonical factory codes are:
--   DBV_20_1 — Dombivli Factory 20/1  (already correct in 001 + 005)
--   DBV_20_2 — Dombivli Factory 20/2  (001 used 'DBV_20' — this migration
--                                       renames it to 'DBV_20_2')
--   NSK      — Nashik                 (already correct)
--   SNP      — Sonepat                (already correct)
--
-- After this migration:
--   The 'DBV_20' row (id = 00000000-0000-0000-0000-000000000002) is
--   renamed to 'DBV_20_2' with updated name + location.
--   The duplicate 'DBV_20_2' row inserted by 005 is removed (it has no
--   FK children because factory_activities in 001 reference the fixed UUID).
--   All factory_activities seeded in 001 reference that fixed UUID directly
--   so they remain valid — no cascade needed.
-- =============================================================================

-- Step 1: Remove the duplicate DBV_20_2 row inserted by migration 005.
-- This row has a system-generated UUID and no factory_activities children
-- (001 seeded activities against the fixed UUID 000...0002, not this one).
DELETE FROM public.factories
WHERE code = 'DBV_20_2'
  AND id != '00000000-0000-0000-0000-000000000002';

-- Step 2: Rename the original DBV_20 row to DBV_20_2 and update its
-- display name and location to match the architecture document naming.
UPDATE public.factories
SET
    code     = 'DBV_20_2',
    name     = 'Dombivli — Factory 20/2',
    location = 'Dombivli'
WHERE id = '00000000-0000-0000-0000-000000000002';

-- Step 3: Ensure DBV_20_1 name/location is consistent with 005's naming style.
UPDATE public.factories
SET
    name     = 'Dombivli — Factory 20/1',
    location = 'Dombivli'
WHERE id = '00000000-0000-0000-0000-000000000001';

-- Step 4: Verify final state (informational — safe to run in SQL editor).
-- Expected: 4 rows with codes DBV_20_1, DBV_20_2, NSK, SNP
-- SELECT id, code, name, location FROM public.factories ORDER BY code;

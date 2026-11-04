-- =============================================================================
-- A-20 Migration 026: Remove duplicate qc_test_definitions rows
--
-- ROOT CAUSE: qc_test_definitions has UNIQUE (material_id, product_id, phase,
-- test_key), but exactly one of material_id / product_id is always NULL, and
-- Postgres treats NULLs as distinct in UNIQUE constraints. The constraint
-- therefore never fires, so every "INSERT ... ON CONFLICT DO NOTHING" in the
-- seed migrations (003, 007, 008, 021, 023) inserted a fresh row each time a
-- migration was re-run. The form then rendered each duplicate (e.g. "Wet Sieve
-- 200 — Fineness — auto" twice).
--
-- Safe: no table has an FK to qc_test_definitions.id; saved results are stored
-- in product_qc / rm_qc JSONB keyed by test_key, not by definition id.
--
-- Fix:
--   1. Keep ONE row per (product_id|material_id, phase, test_key) — prefer an
--      active row, then the lowest id — and delete the rest.
--   2. Add partial unique indexes (one for product rows, one for material rows)
--      so ON CONFLICT DO NOTHING works from now on and re-runs cannot duplicate.
-- =============================================================================

BEGIN;

-- 1a. Product rows
DELETE FROM public.qc_test_definitions d
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY product_id, phase, test_key
           ORDER BY is_active DESC, id
         ) AS rn
  FROM public.qc_test_definitions
  WHERE product_id IS NOT NULL
) x
WHERE d.id = x.id AND x.rn > 1;

-- 1b. Material rows
DELETE FROM public.qc_test_definitions d
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY material_id, phase, test_key
           ORDER BY is_active DESC, id
         ) AS rn
  FROM public.qc_test_definitions
  WHERE material_id IS NOT NULL
) x
WHERE d.id = x.id AND x.rn > 1;

-- 2. Unique indexes that treat the non-null parent correctly
CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_defs_product_phase_key
  ON public.qc_test_definitions (product_id, phase, test_key)
  WHERE product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_defs_material_phase_key
  ON public.qc_test_definitions (material_id, phase, test_key)
  WHERE material_id IS NOT NULL;

COMMIT;

-- Verify (should return zero rows):
-- SELECT product_id, material_id, phase, test_key, COUNT(*)
-- FROM public.qc_test_definitions
-- GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;

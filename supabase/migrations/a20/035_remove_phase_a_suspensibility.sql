-- =============================================================================
-- A-20 Migration 035: Remove Suspensibility from Phase A (Sulphur SC, Zinc SC)
--
-- Run on the Factory A-20 Supabase project, AFTER 034.
--
-- Suspensibility is a Phase B (final product) test only. Migration 034 added a
-- Phase A suspensibility block to Sulphur SC; remove it from the form:
--   Sulphur SC Phase A: suspension_sample_m, sediment_aliquot_v2, suspensibility
--   Zinc SC     Phase A: no suspension fields are seeded, but any that exist
--                        (susp_*, suspension) are switched off defensively.
--
-- Rows are set is_active = false (not deleted), so history is preserved and the
-- form simply stops rendering them. Phase B is untouched. Idempotent.
-- =============================================================================

BEGIN;

UPDATE public.qc_test_definitions d
   SET is_active = false
  FROM public.products p
 WHERE d.product_id = p.id
   AND d.phase::text = 'A'
   AND (
        (p.code = 'SULPHUR_SC' AND d.test_key IN ('suspension_sample_m','sediment_aliquot_v2','suspension_sediment_m','suspensibility'))
     OR (p.code = 'ZINC_SC'    AND (d.test_key LIKE 'susp\_%' ESCAPE '\' OR d.test_key = 'suspension'))
   );

COMMIT;

-- Verify (expect no active suspension rows in Phase A):
-- SELECT p.code, d.phase, d.test_key, d.is_active FROM qc_test_definitions d
-- JOIN products p ON p.id = d.product_id
-- WHERE p.code IN ('SULPHUR_SC','ZINC_SC') AND d.phase::text = 'A'
--   AND (d.test_key ILIKE '%susp%' OR d.test_key = 'sediment_aliquot_v2');

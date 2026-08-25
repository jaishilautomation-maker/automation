-- =============================================================================
-- A-20 Migration 004: Fix Lab QC activities and product visibility
--
-- 1. Deactivate batch_analysis from A-20 Lab QC activities
--    (not applicable to A-20 — only used at A-20/1 for Sulphur Powder)
-- 2. Deactivate hourly_reading from A-20 Lab QC activities
--    (also A-20/1 only)
-- =============================================================================

UPDATE public.factory_activities
SET    is_active = false
WHERE  module   = 'lab_qc'
  AND  activity IN ('batch_analysis', 'hourly_reading')
  AND  factory_id = (SELECT id FROM public.factories WHERE code = 'DBV_20_2');

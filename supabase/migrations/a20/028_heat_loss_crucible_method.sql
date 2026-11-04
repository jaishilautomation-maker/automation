-- =============================================================================
-- A-20 Migration 028: Heat Loss (crucible method) wherever A-20 had "Moisture"
--
-- The reference form (A-20/1 Batch Analysis, 075) is:
--     Heat Loss - Temperature used (C)   [select 65 / 70 / 105]
--     Empty crucible weight (E)          (g)
--     Weight of sample taken (W)         (g)
--     Crucible + residue after heating (W2) (g)
--     Heat Loss (%)  - auto  =  (W - (W2 - E)) / W x 100
--
-- A-20 raw-material QC still used the old mass-only fields
--     MOISTURE - Mass before heating M / Mass after heating M1
--     MOISTURE - Moisture = 100 x (M - M1) / M
-- on five materials: SULPHUR_POWDER, ZINC_OXIDE, TEBUCONAZOLE, BORIC_POWDER, K_GUM.
-- They are replaced by the fieldset above, same keys / labels as A-20/1.
--
-- The old moisture_* definitions are DEACTIVATED, not deleted: every saved
-- test_results value stays in the database (same approach as A-20/1 migration 073).
--
-- Room is made in the sort order so the new block sits exactly where the old
-- moisture block was. Idempotent (skips a material that already has
-- heat_loss_percent). Run AFTER 026 (unique indexes) and 027.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  codes text[] := ARRAY['SULPHUR_POWDER','ZINC_OXIDE','TEBUCONAZOLE','BORIC_POWDER','K_GUM'];
  c      text;
  mid    uuid;
  s      int;     -- first sort_order of the old moisture block
  e      int;     -- last  sort_order of the old moisture block
  shift  int;
BEGIN
  FOREACH c IN ARRAY codes LOOP
    SELECT id INTO mid FROM public.materials WHERE code = c;
    IF mid IS NULL THEN
      RAISE NOTICE '028: material % not found - skipped', c;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.qc_test_definitions
                WHERE material_id = mid AND phase::text = 'none' AND test_key = 'heat_loss_percent') THEN
      RAISE NOTICE '028: % already has Heat Loss - skipped', c;
      CONTINUE;
    END IF;

    SELECT min(sort_order), max(sort_order) INTO s, e
      FROM public.qc_test_definitions
     WHERE material_id = mid AND phase::text = 'none'
       AND test_key IN ('moisture_m','moisture_m1','moisture_result');

    IF s IS NULL THEN
      RAISE NOTICE '028: % has no moisture fields - skipped', c;
      CONTINUE;
    END IF;

    -- the new block is 5 rows; push later fields down if the old block was smaller
    shift := 5 - (e - s + 1);
    IF shift > 0 THEN
      UPDATE public.qc_test_definitions
         SET sort_order = sort_order + shift
       WHERE material_id = mid AND phase::text = 'none' AND sort_order > e
         AND test_key NOT IN ('moisture_m','moisture_m1','moisture_result');
    END IF;

    -- retire the old mass-only moisture fields (history kept)
    UPDATE public.qc_test_definitions
       SET is_active = false
     WHERE material_id = mid AND phase::text = 'none'
       AND test_key IN ('moisture_m','moisture_m1','moisture_result');

    INSERT INTO public.qc_test_definitions
      (material_id, phase, test_key, label, unit, input_type, options, formula, is_calculated, sort_order, section_label)
    VALUES
      (mid, 'none', 'heat_loss_temp',     'Heat Loss — Temperature used', '°C', 'select',
         '["65","70","105"]'::jsonb, NULL, false, s,     'Heat Loss'),
      (mid, 'none', 'heat_loss_crucible', 'Empty crucible weight (E)',    'g',  'number',
         NULL, NULL, false, s + 1, 'Heat Loss'),
      (mid, 'none', 'heat_loss_m_before', 'Weight of sample taken (W)',   'g',  'number',
         NULL, NULL, false, s + 2, 'Heat Loss'),
      (mid, 'none', 'heat_loss_w2',       'Crucible + residue after heating (W2)', 'g', 'number',
         NULL, NULL, false, s + 3, 'Heat Loss'),
      (mid, 'none', 'heat_loss_percent',  'Heat Loss', '%', 'number',
         NULL, '((heat_loss_m_before - (heat_loss_w2 - heat_loss_crucible)) / heat_loss_m_before) * 100',
         true, s + 4, 'Heat Loss');

    RAISE NOTICE '028: % converted to Heat Loss (crucible method) at sort_order %', c, s;
  END LOOP;
END $$;

COMMIT;

-- Verify (expect 5 rows per converted material, old moisture rows inactive):
-- SELECT m.code, d.test_key, d.sort_order, d.is_active, d.formula
-- FROM qc_test_definitions d JOIN materials m ON m.id = d.material_id
-- WHERE d.test_key LIKE 'heat_loss%' OR d.test_key LIKE 'moisture%'
-- ORDER BY m.code, d.sort_order;

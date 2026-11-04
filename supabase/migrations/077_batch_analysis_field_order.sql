-- =============================================================================
-- Migration 077 (A-20/1 project): explicit Batch Analysis (Sulphur Powder,
-- phase B) field order.
--
-- WHY: the form renders qc_test_definitions ORDER BY sort_order. The original
-- seeds (001: 1-39, 040: 101-109) were never laid out as one sequence, and 075
-- only renumbered the heat-loss block, so "Insolubility in Toluene" (101) ended
-- up wedged around the Heat Loss fields (102-106), and equal sort_order values
-- left the order undefined.
--
-- NEW ORDER = the order of the COA / paper form (JSCI/QC/17), every group
-- contiguous, every field a unique position:
--   Appearance -> Purity (CS2) -> Insolubility in Toluene (Sr 1 alternative) ->
--   Acidity -> Ash -> Mesh 100/200/325 -> Oil -> Melting Point ->
--   Specific Gravity -> Bulk Density -> Heat Loss -> Alkalinity ->
--   Total Sulphur -> Softening Point -> Acetone Solubility
--
-- Nothing is deleted here; unlisted active fields are parked after the listed
-- ones. Idempotent. Run AFTER 075.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.reorder_mat(p_mat text, p_phase text, p_items text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_mid uuid; v_key text; v_sec text; i int;
BEGIN
  SELECT id INTO v_mid FROM public.materials WHERE code = p_mat;
  IF v_mid IS NULL THEN
    RAISE NOTICE '077: material % not found - nothing reordered', p_mat;
    RETURN;
  END IF;

  UPDATE public.qc_test_definitions
     SET sort_order = 5000 + (sort_order % 1000)
   WHERE material_id = v_mid AND phase::text = p_phase
     AND test_key <> ALL (SELECT split_part(x, '|', 1) FROM unnest(p_items) x);

  FOR i IN 1 .. array_length(p_items, 1) LOOP
    v_key := split_part(p_items[i], '|', 1);
    v_sec := NULLIF(split_part(p_items[i], '|', 2), '');
    UPDATE public.qc_test_definitions
       SET sort_order = i * 10, section_label = COALESCE(v_sec, section_label)
     WHERE material_id = v_mid AND phase::text = p_phase AND test_key = v_key;
  END LOOP;
END $$;

SELECT pg_temp.reorder_mat('SULPHUR_POWDER', 'B', ARRAY[
  'colour_appearance|Appearance',
  'appearance_photo|Appearance',

  'purity_e|Purity (Solubility in CS2)',
  'purity_w1|Purity (Solubility in CS2)',
  'purity_w2|Purity (Solubility in CS2)',
  'purity_percent|Purity (Solubility in CS2)',

  'insolubility_toluene|Insolubility in Toluene',

  'acidity_v1|Acidity (as H2SO4)',
  'acidity_v2|Acidity (as H2SO4)',
  'acidity_n|Acidity (as H2SO4)',
  'acidity_m|Acidity (as H2SO4)',
  'acidity_percent|Acidity (as H2SO4)',

  'ash_m|Ash Content',
  'ash_m1|Ash Content',
  'ash_percent|Ash Content',

  'mesh100_m|Mesh Size - 100 Mesh',
  'mesh100_m_ret|Mesh Size - 100 Mesh',
  'mesh100_pct|Mesh Size - 100 Mesh',
  'mesh200_m|Mesh Size - 200 Mesh',
  'mesh200_m_ret|Mesh Size - 200 Mesh',
  'mesh200_pct|Mesh Size - 200 Mesh',
  'mesh325_m|Mesh Size - 325 Mesh',
  'mesh325_m_ret|Mesh Size - 325 Mesh',
  'mesh325_pct|Mesh Size - 325 Mesh',

  'oil_mass_loss|Oil Content',
  'oil_original_mass|Oil Content',
  'oil_percent|Oil Content',

  'melting_point|Melting Point',

  'sg_w1|Specific Gravity',
  'sg_w2|Specific Gravity',
  'sg_w3|Specific Gravity',
  'sg_w4|Specific Gravity',
  'sg_sl|Specific Gravity',
  'sg_value|Specific Gravity',

  'bd_mass|Bulk Density',
  'bd_volume|Bulk Density',
  'bd_value|Bulk Density',

  'heat_loss_temp|Heat Loss',
  'heat_loss_crucible|Heat Loss',
  'heat_loss_m_before|Heat Loss',
  'heat_loss_w2|Heat Loss',
  'heat_loss_percent|Heat Loss',

  'alkalinity_naoh|Alkalinity (as NaOH)',
  'total_sulphur_percent|Total Sulphur Content',
  'softening_point|Softening Point',
  'acetone_solubility|Acetone Solubility'
]);

-- Heat loss formula guard: the crucible method must be the one in force
-- (same as the form image: Empty crucible E, Sample W, Crucible + residue W2).
UPDATE public.qc_test_definitions d
   SET formula = '((heat_loss_m_before - (heat_loss_w2 - heat_loss_crucible)) / heat_loss_m_before) * 100',
       is_calculated = true
  FROM public.materials m
 WHERE d.material_id = m.id AND m.code = 'SULPHUR_POWDER'
   AND d.phase::text = 'B' AND d.test_key = 'heat_loss_percent';

-- Moisture (superseded by Heat Loss in 073) must stay off the form.
UPDATE public.qc_test_definitions d
   SET is_active = false
  FROM public.materials m
 WHERE d.material_id = m.id AND m.code = 'SULPHUR_POWDER'
   AND d.phase::text = 'B'
   AND d.test_key IN ('moisture_percent','moisture_m_before','moisture_m1_after','heat_loss_m_after');

COMMIT;

-- Verify: Heat Loss must be one contiguous block, toluene right after purity.
-- SELECT sort_order, test_key, section_label, is_active
-- FROM qc_test_definitions d JOIN materials m ON m.id = d.material_id
-- WHERE m.code = 'SULPHUR_POWDER' AND d.phase::text = 'B' AND d.is_active
-- ORDER BY sort_order;

-- =============================================================================
-- Migration 078 (A-20/1 project): Insolubility in Toluene — raw inputs + formula
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 077.
--
-- WHY: "Insolubility in Toluene" (test_key insolubility_toluene, material
-- SULPHUR_POWDER, phase B) was a single direct-% entry (migration 040). The lab
-- actually derives it from a gravimetric test, like Heat Loss. Per the SOP:
--
--     Insoluble content (%) = Residual mass (g) / Original sample mass (g) * 100
--
-- This adds the two raw inputs and turns insolubility_toluene into a CALCULATED
-- field, exactly mirroring the heat_loss pattern (040 + 077):
--
--     insol_toluene_residual_mass  — Residual mass (g)          [new input]
--     insol_toluene_sample_mass    — Original sample mass (g)   [new input]
--     insolubility_toluene         — now is_calculated = true, formula above
--
-- The form (app/(app)/lab-qc/batch-analysis/page.tsx) renders every active
-- phase-B def and already recomputes is_calculated fields live via
-- lib/formula.ts evalFormula on each keystroke — no page change is needed.
-- The result keeps writing to test_results["insolubility_toluene"], which is
-- the exact key the COA reads (lib/coa/catalog.ts Sr-1 altSourceFields), so the
-- Apollo Tyres (party_code 'Apollo 160108') certificate is unaffected.
--
-- The two inputs are visible on every party's form (the form shows all phase-B
-- defs, same as the Heat Loss raw inputs) — this is the existing behaviour.
--
-- Idempotent: ON CONFLICT DO NOTHING + explicit UPDATEs; reorder is re-runnable.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  mid_sp uuid;
BEGIN

SELECT id INTO mid_sp FROM public.materials WHERE code = 'SULPHUR_POWDER';
IF mid_sp IS NULL THEN
  RAISE NOTICE '078: SULPHUR_POWDER material not found — skipping.';
  RETURN;
END IF;

-- ── New raw inputs (sort_order set authoritatively by the reorder below) ────
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order, section_label)
VALUES (mid_sp, 'B', 'insol_toluene_residual_mass', 'Insolubility in Toluene — Residual mass (R)', 'g', 'number', 110, 'Insolubility in Toluene')
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order, section_label)
VALUES (mid_sp, 'B', 'insol_toluene_sample_mass', 'Insolubility in Toluene — Original sample mass (W)', 'g', 'number', 111, 'Insolubility in Toluene')
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Convert the result field to calculated ──────────────────────────────────
UPDATE public.qc_test_definitions
   SET is_calculated = true,
       input_type    = 'number',
       unit          = '%',
       formula       = '(insol_toluene_residual_mass / insol_toluene_sample_mass) * 100'
 WHERE material_id = mid_sp AND phase = 'B' AND test_key = 'insolubility_toluene';

END;
$$;

-- ── Reorder so the two inputs sit directly above the result (077 helper) ────
CREATE OR REPLACE FUNCTION pg_temp.reorder_mat(p_mat text, p_phase text, p_items text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_mid uuid; v_key text; v_sec text; i int;
BEGIN
  SELECT id INTO v_mid FROM public.materials WHERE code = p_mat;
  IF v_mid IS NULL THEN RETURN; END IF;

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

-- Same sequence as 077, with the two new toluene inputs inserted before the
-- insolubility_toluene result.
SELECT pg_temp.reorder_mat('SULPHUR_POWDER', 'B', ARRAY[
  'colour_appearance|Appearance',
  'appearance_photo|Appearance',

  'purity_e|Purity (Solubility in CS2)',
  'purity_w1|Purity (Solubility in CS2)',
  'purity_w2|Purity (Solubility in CS2)',
  'purity_percent|Purity (Solubility in CS2)',

  'insol_toluene_residual_mass|Insolubility in Toluene',
  'insol_toluene_sample_mass|Insolubility in Toluene',
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

COMMIT;

-- Verify (toluene: two inputs then the calculated result, contiguous):
-- SELECT sort_order, test_key, section_label, is_calculated, formula
-- FROM qc_test_definitions d JOIN materials m ON m.id = d.material_id
-- WHERE m.code = 'SULPHUR_POWDER' AND d.phase::text = 'B' AND d.is_active
-- ORDER BY sort_order;

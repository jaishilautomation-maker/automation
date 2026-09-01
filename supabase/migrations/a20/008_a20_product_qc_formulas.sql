-- =============================================================================
-- A-20 Migration 008: Product QC auto-calculation formulas
--
-- Adds the SOP-provided calculation formulas for the 5 A-20 products so the
-- Product QC form computes results live from raw titration/weighing inputs.
--
-- Formulas (exactly as supplied by the company SOPs):
--   Sulphur SC / Ziddi sulphur content:
--       Sulphur % w/w = (B2 - B1) x 0.03206 x N x 100 / W
--   Sulphur SC suspensibility:
--       Suspensibility % = 1000 x (M - m) / (9 x M)
--   Liquid Boron:
--       Boron (as B) % = 10.811 x V x N / W        (V = NaOH volume used)
--   Liquid Calcium:
--       Calcium = N(EDTA) x B.R x 40 / (10 x W)
--   Zinc SC zinc content:
--       Zinc % = (V2 - V1) x 0.0098012 x 65.38
--   Zinc SC suspension:
--       A = Zinc% x 0.25 / 100
--       B = (V2 - V1) x 0.0098012 x 65.38 / 1000
--       Suspension % = (A - B) / A x 111
--
-- Frontend note: lib/formula.ts computes a calculated field only when EVERY
-- referenced input is filled, so each result stays blank until its inputs are
-- entered. Suspension formulas are written self-contained (no dependency on
-- another calculated field) for robustness.
--
-- Idempotent: raw inputs and result fields are inserted ON CONFLICT DO NOTHING,
-- then every result field's formula/is_calculated is UPDATEd so re-running
-- always converges.
-- =============================================================================

DO $$
DECLARE
    pid_ssc   uuid;  -- SULPHUR_SC
    pid_lb    uuid;  -- LIQUID_BORON
    pid_ziddi uuid;  -- ZIDDI
    pid_lc    uuid;  -- LIQUID_CALCIUM
    pid_zsc   uuid;  -- ZINC_SC
BEGIN

SELECT id INTO pid_ssc   FROM public.products WHERE code = 'SULPHUR_SC';
SELECT id INTO pid_lb    FROM public.products WHERE code = 'LIQUID_BORON';
SELECT id INTO pid_ziddi FROM public.products WHERE code = 'ZIDDI';
SELECT id INTO pid_lc    FROM public.products WHERE code = 'LIQUID_CALCIUM';
SELECT id INTO pid_zsc   FROM public.products WHERE code = 'ZINC_SC';

-- ===========================================================================
-- SULPHUR SC — sulphur content (Phase A & B) + suspensibility (Phase B)
-- Sulphur % = (B2 - B1) x 0.03206 x N x 100 / W
--   B2 = sample burette (existing phase_x_titration_vol)
--   N  = iodine normality (existing phase_x_iodine_normality)
--   W  = sample mass       (existing phase_x_sample_mass)
--   B1 = blank burette      (NEW input, added below)
-- ===========================================================================
IF pid_ssc IS NOT NULL THEN
  -- Phase A: add blank titration input + result
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_ssc,'A','phase_a_titration_blank','Titration Volume — Blank B1','mL','number',5) ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_ssc,'A','sulphur_content','Sulphur Content','%','number',
         '(phase_a_titration_vol - phase_a_titration_blank) * 0.03206 * phase_a_iodine_normality * 100 / phase_a_sample_mass', true, 60)
  ON CONFLICT DO NOTHING;

  -- Phase B: blank titration input + sulphur content result
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_ssc,'B','phase_b_titration_blank','Titration Volume — Blank B1','mL','number',5) ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_ssc,'B','sulphur_content','Sulphur Content','%','number',
         '(phase_b_titration_vol - phase_b_titration_blank) * 0.03206 * phase_b_iodine_normality * 100 / phase_b_sample_mass', true, 60)
  ON CONFLICT DO NOTHING;

  -- Phase B: suspensibility = 1000 x (M - m) / (9 x M)
  --   M = suspension_sample_m (mass in prep), m = sediment aliquot mass.
  --   The sediment mass m is added as a NEW input.
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_ssc,'B','suspension_sediment_m','Suspensibility — Sediment mass m','g','number',6) ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_ssc,'B','suspensibility','Suspensibility','%','number',
         '1000 * (suspension_sample_m - suspension_sediment_m) / (9 * suspension_sample_m)', true, 61)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='(phase_a_titration_vol - phase_a_titration_blank) * 0.03206 * phase_a_iodine_normality * 100 / phase_a_sample_mass', is_calculated=true WHERE product_id=pid_ssc AND phase='A' AND test_key='sulphur_content';
  UPDATE public.qc_test_definitions SET formula='(phase_b_titration_vol - phase_b_titration_blank) * 0.03206 * phase_b_iodine_normality * 100 / phase_b_sample_mass', is_calculated=true WHERE product_id=pid_ssc AND phase='B' AND test_key='sulphur_content';
  UPDATE public.qc_test_definitions SET formula='1000 * (suspension_sample_m - suspension_sediment_m) / (9 * suspension_sample_m)', is_calculated=true WHERE product_id=pid_ssc AND phase='B' AND test_key='suspensibility';
END IF;

-- ===========================================================================
-- LIQUID BORON — Boron (as B) % = 10.811 x V x N / W
--   V = volume of NaOH used = naoh_v2 - naoh_v1
--   N = naoh_normality,  W = mass_taken_w
-- ===========================================================================
IF pid_lb IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_lb,'none','boron_content','Boron Content (as B)','%','number',
         '10.811 * (naoh_v2 - naoh_v1) * naoh_normality / mass_taken_w', true, 60)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='10.811 * (naoh_v2 - naoh_v1) * naoh_normality / mass_taken_w', is_calculated=true WHERE product_id=pid_lb AND test_key='boron_content';
END IF;

-- ===========================================================================
-- LIQUID CALCIUM — Calcium = N(EDTA) x B.R x 40 / (10 x W)
--   N = calcium_normality, B.R = calcium_br, W = calcium_w
-- ===========================================================================
IF pid_lc IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_lc,'none','calcium_content','Calcium Content','%','number',
         'calcium_normality * calcium_br * 40 / (10 * calcium_w)', true, 60)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='calcium_normality * calcium_br * 40 / (10 * calcium_w)', is_calculated=true WHERE product_id=pid_lc AND test_key='calcium_content';
END IF;

-- ===========================================================================
-- ZINC SC (Phase B) — zinc content + suspension
--   Zinc %      = (V2 - V1) x 0.0098012 x 65.38
--                 V2 = zc_v2_without_cyanide, V1 = zc_v1_with_cyanide
--   Suspension %: A = Zinc% x 0.25 / 100
--                 B = (V2s - V1s) x 0.0098012 x 65.38 / 1000
--                 Suspension % = (A - B) / A x 111
--                 V2s = susp_v2_sediment, V1s = susp_v1_sediment
--   Suspension is written self-contained (Zinc% substituted inline).
-- ===========================================================================
IF pid_zsc IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_zsc,'B','zinc_content','Zinc Content','%','number',
         '(zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38', true, 60)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_zsc,'B','suspension','Suspension','%','number',
         '(((zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38 * 0.25 / 100) - ((susp_v2_sediment - susp_v1_sediment) * 0.0098012 * 65.38 / 1000)) / ((zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38 * 0.25 / 100) * 111', true, 61)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='(zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38', is_calculated=true WHERE product_id=pid_zsc AND phase='B' AND test_key='zinc_content';
  UPDATE public.qc_test_definitions SET formula='(((zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38 * 0.25 / 100) - ((susp_v2_sediment - susp_v1_sediment) * 0.0098012 * 65.38 / 1000)) / ((zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38 * 0.25 / 100) * 111', is_calculated=true WHERE product_id=pid_zsc AND phase='B' AND test_key='suspension';
END IF;

-- ===========================================================================
-- ZIDDI (Sulphur 65% WG + 10% Tebuconazole)
--   Sulphur content: same iodine-titration formula as Sulphur SC.
--       Sulphur % = (B2 - B1) x 0.03206 x N x 100 / W
--       B2 = content_iodine_vol, N = content_iodine_normality, W = content_mass_w
--       B1 = blank (NEW input).
--   Suspensibility: 1000 x (M - m) / (9 x M)
--       M = susp_mass_w, m = sediment (NEW input).
--   Tebuconazole content/suspensibility are GC area ratios (gc_tebu_*) — entered
--       manually, no auto-calc (GC areas are not captured as inputs here).
-- ===========================================================================
IF pid_ziddi IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_ziddi,'none','content_iodine_blank','CONTENT — Blank titre B1','mL','number',5) ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_ziddi,'none','sulphur_content','Sulphur Content','%','number',
         '(content_iodine_vol - content_iodine_blank) * 0.03206 * content_iodine_normality * 100 / content_mass_w', true, 60)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_ziddi,'none','susp_sediment_m','SUSPENSIBILITY — Sediment mass m','g','number',6) ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_ziddi,'none','sulphur_suspensibility','Sulphur Suspensibility','%','number',
         '1000 * (susp_mass_w - susp_sediment_m) / (9 * susp_mass_w)', true, 61)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='(content_iodine_vol - content_iodine_blank) * 0.03206 * content_iodine_normality * 100 / content_mass_w', is_calculated=true WHERE product_id=pid_ziddi AND test_key='sulphur_content';
  UPDATE public.qc_test_definitions SET formula='1000 * (susp_mass_w - susp_sediment_m) / (9 * susp_mass_w)', is_calculated=true WHERE product_id=pid_ziddi AND test_key='sulphur_suspensibility';
END IF;

RAISE NOTICE 'A-20 product QC formulas migration complete';
END;
$$;

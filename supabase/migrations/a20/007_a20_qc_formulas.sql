-- =============================================================================
-- A-20 Migration 007: QC Auto-Calculation Formulas
--
-- Adds SOP-derived calculated result fields to qc_test_definitions and wires
-- the `formula` / `is_calculated` columns so the Lab QC forms (RM QC and
-- Product QC) compute parameters live from raw measurement inputs.
--
-- Source: "SOP ALL LAB TEST METHOD" (JSCI/QC/01..08). Only formulas explicitly
-- documented in the SOP are encoded here. Parameters whose formula/constants
-- are NOT in the SOP (e.g. Zinc content by EDTA, Calcium content by EDTA) are
-- intentionally left as manual entry — no formula is invented.
--
-- Formula variables reference sibling test_key names. The frontend
-- (lib/formula.ts evalFormula) and the DB trigger evaluate the same expression;
-- a calculated field stays blank until every referenced input is filled.
--
-- SOP formulas encoded:
--   Purity %          = 100 - (residue / M) * 100        [residue = W2 - E]   (JSCI/QC/01)
--   Acidity (H2SO4) % = (V1 - V2) * N * 4.904 / M                              (JSCI/QC/02)
--   Mesh fineness %   = 100 * (1 - m / M)                [m = retained]        (JSCI/QC/03)
--   Moisture %        = 100 * (M - M1) / M                                     (JSCI/QC/04)
--   Ash %             = 100 * M1 / M                                           (JSCI/QC/05)
--   Oil content %     = massloss / original * 100                             (JSCI/QC/07)
--   Specific gravity  = (W2-W1)*SL / ((W2-W1) - (W3-W4))                       (JSCI/QC/06)
--   Bulk density      = m / V                                                  (JSCI/QC/08)
--
-- Idempotent: new calculated fields are inserted with ON CONFLICT DO NOTHING,
-- then every calculated field's formula/is_calculated/label/unit is UPDATEd so
-- re-running always converges to the correct state (also upgrades rows that were
-- previously seeded as plain inputs, e.g. sg_result, bd_result).
-- =============================================================================

DO $$
DECLARE
    mid_sp   uuid;   -- SULPHUR_POWDER
    mid_zo   uuid;   -- ZINC_OXIDE
    mid_tebu uuid;   -- TEBUCONAZOLE
    mid_bp   uuid;   -- BORIC_POWDER

    pid_ssc  uuid;   -- SULPHUR_SC
    pid_zsc  uuid;   -- ZINC_SC
BEGIN

SELECT id INTO mid_sp   FROM public.materials WHERE code = 'SULPHUR_POWDER';
SELECT id INTO mid_zo   FROM public.materials WHERE code = 'ZINC_OXIDE';
SELECT id INTO mid_tebu FROM public.materials WHERE code = 'TEBUCONAZOLE';
SELECT id INTO mid_bp   FROM public.materials WHERE code = 'BORIC_POWDER';

SELECT id INTO pid_ssc  FROM public.products  WHERE code = 'SULPHUR_SC';
SELECT id INTO pid_zsc  FROM public.products  WHERE code = 'ZINC_SC';

-- =============================================================================
-- Helper: insert-if-missing a calculated field for a MATERIAL.
-- We place calculated results just after their inputs using high sort_order
-- offsets so they render grouped near the bottom of each section.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SULPHUR POWDER (RM QC) — full SOP suite
-- ---------------------------------------------------------------------------
IF mid_sp IS NOT NULL THEN
  -- Purity %
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','purity_result','PURITY — Sulphur purity','%','number',
         '100 - ((purity_w2 - purity_empty_crucible) / purity_sample_mass) * 100', true, 61)
  ON CONFLICT DO NOTHING;

  -- Acidity %
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','acidity_result','ACIDITY — Acidity (as H2SO4)','%','number',
         '(acidity_v1 - acidity_v2) * acidity_n * 4.904 / acidity_m', true, 62)
  ON CONFLICT DO NOTHING;

  -- Sieve fineness (100 / 200 / 325 mesh)
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','sieve100_result','SIEVE 100 MESH — Fineness','%','number',
         '100 * (1 - sieve100_retained / sieve100_sample)', true, 63)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','sieve200_result','SIEVE 200 MESH — Fineness','%','number',
         '100 * (1 - sieve200_retained / sieve200_sample)', true, 64)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','sieve325_result','SIEVE 325 MESH — Fineness','%','number',
         '100 * (1 - sieve325_retained / sieve325_sample)', true, 65)
  ON CONFLICT DO NOTHING;

  -- Moisture %
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','moisture_result','MOISTURE — Moisture','%','number',
         '100 * (moisture_m - moisture_m1) / moisture_m', true, 66)
  ON CONFLICT DO NOTHING;

  -- Ash %
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','ash_result','ASH — Ash content','%','number',
         '100 * ash_m1 / ash_m', true, 67)
  ON CONFLICT DO NOTHING;

  -- Oil content %
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','oil_result','OIL CONTENT — Oil content','%','number',
         'oil_mass_loss / oil_original_mass * 100', true, 68)
  ON CONFLICT DO NOTHING;

  -- Specific gravity (upgrade existing sg_result input -> calculated below)
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','sg_result','SPECIFIC GRAVITY — Specific gravity of sulphur powder',NULL,'number',
         '(sg_w2 - sg_w1) * sg_sl / ((sg_w2 - sg_w1) - (sg_w3 - sg_w4))', true, 69)
  ON CONFLICT DO NOTHING;

  -- Bulk density (upgrade existing bd_result input -> calculated below)
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_sp,'none','bd_result','BULK DENSITY — Bulk density','g/cc','number',
         'bd_mass / bd_volume', true, 70)
  ON CONFLICT DO NOTHING;

  -- Ensure formulas are set even if the rows already existed (e.g. sg_result,
  -- bd_result were originally seeded as plain number inputs).
  UPDATE public.qc_test_definitions SET formula='100 - ((purity_w2 - purity_empty_crucible) / purity_sample_mass) * 100', is_calculated=true WHERE material_id=mid_sp AND test_key='purity_result';
  UPDATE public.qc_test_definitions SET formula='(acidity_v1 - acidity_v2) * acidity_n * 4.904 / acidity_m',            is_calculated=true WHERE material_id=mid_sp AND test_key='acidity_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - sieve100_retained / sieve100_sample)',                      is_calculated=true WHERE material_id=mid_sp AND test_key='sieve100_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - sieve200_retained / sieve200_sample)',                      is_calculated=true WHERE material_id=mid_sp AND test_key='sieve200_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - sieve325_retained / sieve325_sample)',                      is_calculated=true WHERE material_id=mid_sp AND test_key='sieve325_result';
  UPDATE public.qc_test_definitions SET formula='100 * (moisture_m - moisture_m1) / moisture_m',                        is_calculated=true WHERE material_id=mid_sp AND test_key='moisture_result';
  UPDATE public.qc_test_definitions SET formula='100 * ash_m1 / ash_m',                                                 is_calculated=true WHERE material_id=mid_sp AND test_key='ash_result';
  UPDATE public.qc_test_definitions SET formula='oil_mass_loss / oil_original_mass * 100',                              is_calculated=true WHERE material_id=mid_sp AND test_key='oil_result';
  UPDATE public.qc_test_definitions SET formula='(sg_w2 - sg_w1) * sg_sl / ((sg_w2 - sg_w1) - (sg_w3 - sg_w4))',        is_calculated=true, input_type='number' WHERE material_id=mid_sp AND test_key='sg_result';
  UPDATE public.qc_test_definitions SET formula='bd_mass / bd_volume',                                                  is_calculated=true, input_type='number' WHERE material_id=mid_sp AND test_key='bd_result';
END IF;

-- ---------------------------------------------------------------------------
-- ZINC OXIDE (RM QC) — moisture + sieve fineness (SOP methods only).
-- Zinc content by EDTA titration has no formula in the SOP → left manual.
-- ---------------------------------------------------------------------------
IF mid_zo IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_zo,'none','moisture_result','MOISTURE — Moisture','%','number',
         '100 * (moisture_m - moisture_m1) / moisture_m', true, 61)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_zo,'none','sieve200_result','200 MESH — Fineness','%','number',
         '100 * (1 - sieve200_retained / sieve200_sample)', true, 62)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_zo,'none','sieve325_result','325 MESH — Fineness','%','number',
         '100 * (1 - sieve325_retained / sieve325_sample)', true, 63)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='100 * (moisture_m - moisture_m1) / moisture_m',       is_calculated=true WHERE material_id=mid_zo AND test_key='moisture_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - sieve200_retained / sieve200_sample)',     is_calculated=true WHERE material_id=mid_zo AND test_key='sieve200_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - sieve325_retained / sieve325_sample)',     is_calculated=true WHERE material_id=mid_zo AND test_key='sieve325_result';
END IF;

-- ---------------------------------------------------------------------------
-- TEBUCONAZOLE (RM QC) — moisture + sieve fineness (SOP methods only).
-- Content (%) is a direct/GC entry → left manual.
-- ---------------------------------------------------------------------------
IF mid_tebu IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_tebu,'none','moisture_result','MOISTURE — Moisture','%','number',
         '100 * (moisture_m - moisture_m1) / moisture_m', true, 61)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_tebu,'none','sieve200_result','200 MESH — Fineness','%','number',
         '100 * (1 - sieve200_retained / sieve200_sample)', true, 62)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_tebu,'none','sieve325_result','325 MESH — Fineness','%','number',
         '100 * (1 - sieve325_retained / sieve325_sample)', true, 63)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='100 * (moisture_m - moisture_m1) / moisture_m',       is_calculated=true WHERE material_id=mid_tebu AND test_key='moisture_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - sieve200_retained / sieve200_sample)',     is_calculated=true WHERE material_id=mid_tebu AND test_key='sieve200_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - sieve325_retained / sieve325_sample)',     is_calculated=true WHERE material_id=mid_tebu AND test_key='sieve325_result';
END IF;

-- ---------------------------------------------------------------------------
-- BORIC POWDER (RM QC) — moisture + 200 mesh fineness (SOP methods only).
-- Boron content is a direct entry → left manual.
-- ---------------------------------------------------------------------------
IF mid_bp IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_bp,'none','moisture_result','MOISTURE — Moisture','%','number',
         '100 * (moisture_m - moisture_m1) / moisture_m', true, 61)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(mid_bp,'none','sieve200_result','200 MESH — Fineness','%','number',
         '100 * (1 - sieve200_retained / sieve200_sample)', true, 62)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='100 * (moisture_m - moisture_m1) / moisture_m',   is_calculated=true WHERE material_id=mid_bp AND test_key='moisture_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - sieve200_retained / sieve200_sample)', is_calculated=true WHERE material_id=mid_bp AND test_key='sieve200_result';
END IF;

-- ---------------------------------------------------------------------------
-- SULPHUR SC (Product QC, Phase A & B) — wet sieve fineness (mesh SOP).
-- Sulphur-content by iodine titration has no SOP formula/constant → manual.
-- ---------------------------------------------------------------------------
IF pid_ssc IS NOT NULL THEN
  -- Phase A
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_ssc,'A','wet_sieve200_result','Wet Sieve 200 — Fineness','%','number',
         '100 * (1 - wet_sieve200_residue / wet_sieve200_sample)', true, 61)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_ssc,'A','wet_sieve325_result','Wet Sieve 325 — Fineness','%','number',
         '100 * (1 - wet_sieve325_residue / wet_sieve325_sample)', true, 62)
  ON CONFLICT DO NOTHING;
  -- Phase B
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_ssc,'B','wet_sieve200_result','Wet Sieve 200 — Fineness','%','number',
         '100 * (1 - wet_sieve200_residue / wet_sieve200_sample)', true, 61)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_ssc,'B','wet_sieve325_result','Wet Sieve 325 — Fineness','%','number',
         '100 * (1 - wet_sieve325_residue / wet_sieve325_sample)', true, 62)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='100 * (1 - wet_sieve200_residue / wet_sieve200_sample)', is_calculated=true WHERE product_id=pid_ssc AND test_key='wet_sieve200_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - wet_sieve325_residue / wet_sieve325_sample)', is_calculated=true WHERE product_id=pid_ssc AND test_key='wet_sieve325_result';
END IF;

-- ---------------------------------------------------------------------------
-- ZINC SC (Product QC, Phase B) — wet sieve fineness (mesh SOP).
-- Zinc-content by EDTA and suspension have no SOP formula/constant → manual.
-- ---------------------------------------------------------------------------
IF pid_zsc IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_zsc,'B','wet_sieve200_result','Wet Sieve 200 — Fineness','%','number',
         '100 * (1 - wet_sieve200_residue / wet_sieve200_sample)', true, 61)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order)
  VALUES(pid_zsc,'B','wet_sieve325_result','Wet Sieve 325 — Fineness','%','number',
         '100 * (1 - wet_sieve325_residue / wet_sieve325_sample)', true, 62)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET formula='100 * (1 - wet_sieve200_residue / wet_sieve200_sample)', is_calculated=true WHERE product_id=pid_zsc AND test_key='wet_sieve200_result';
  UPDATE public.qc_test_definitions SET formula='100 * (1 - wet_sieve325_residue / wet_sieve325_sample)', is_calculated=true WHERE product_id=pid_zsc AND test_key='wet_sieve325_result';
END IF;

RAISE NOTICE 'A-20 QC formulas migration complete';
END;
$$;

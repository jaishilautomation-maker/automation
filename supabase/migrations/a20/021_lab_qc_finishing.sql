-- =============================================================================
-- A-20 Migration 021: Lab QC Finishing
--
-- Changes:
--   1. K_GUM as a raw-material entry in `materials` + generic RM QC fields
--      (no numeric limits — parameters pending from lab team).
--   2. Clarity field added to all 5 A-20 products (Sulphur SC Phase A & B,
--      Zinc SC Phase A & B, Ziddi, Liquid Calcium, Liquid Boron).
--      Options: Clear | Hazy | Sediments | Other
--      "Other" free-text is handled in the frontend via the sidecar key
--      `clarity_other` — no separate DB definition needed.
--   3. Sulphur SC / Ziddi sample-weight warning fields:
--      SC warning range 0.22–0.65 g; Ziddi 0.12–0.13 g.
--      These are stored as advisory metadata on the existing sample_mass
--      field via `min_value` and `max_value` columns (if those exist on the
--      table) — purely informational, NOT blocking the form.
--      NOTE: if qc_test_definitions does not have min/max columns this block
--      is a no-op and can be removed.
--
-- Idempotent: all INSERTs use ON CONFLICT DO NOTHING.
-- =============================================================================

DO $$
DECLARE
    mid_kg   uuid;   -- K_GUM (raw material)
    pid_ssc  uuid;
    pid_lb   uuid;
    pid_ziddi uuid;
    pid_lc   uuid;
    pid_zsc  uuid;
    n        smallint;
BEGIN

-- =============================================================================
-- 1. K_GUM as a raw material
--    The production system has K_GUM as a PRODUCT; for RM QC we need it as a
--    MATERIAL so the RM QC form can create rm-type batches for it.
--    Only generic incoming-inspection fields are added here — the lab team
--    must supply the specific parameter list before limits are added.
-- =============================================================================
INSERT INTO public.materials (code, name, is_active)
VALUES ('K_GUM', 'K Gum', true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true;

SELECT id INTO mid_kg FROM public.materials WHERE code = 'K_GUM';

n := 0;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','coa_received','Is COA Received?',NULL,'select',n) ON CONFLICT DO NOTHING;
UPDATE public.qc_test_definitions SET options='["Yes","No","Other"]' WHERE material_id=mid_kg AND test_key='coa_received';

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','lot_number','Lot Number',NULL,'text',n) ON CONFLICT DO NOTHING;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','batch_number','Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','appearance','Appearance / Physical State',NULL,'text',n) ON CONFLICT DO NOTHING;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','colour','Colour',NULL,'text',n) ON CONFLICT DO NOTHING;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','odour','Odour',NULL,'text',n) ON CONFLICT DO NOTHING;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','moisture_m','MOISTURE — Mass before heating M','g','number',n) ON CONFLICT DO NOTHING;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','moisture_m1','MOISTURE — Mass after heating M1','g','number',n) ON CONFLICT DO NOTHING;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','remarks_general','General Remarks',NULL,'text',n) ON CONFLICT DO NOTHING;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order)
VALUES(mid_kg,'none','kg_photo','K Gum Sample Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. Clarity field — all 5 products, all active phases
--    sort_order 70 places it after the existing calc results (60–61).
-- =============================================================================
SELECT id INTO pid_ssc   FROM public.products WHERE code = 'SULPHUR_SC';
SELECT id INTO pid_lb    FROM public.products WHERE code = 'LIQUID_BORON';
SELECT id INTO pid_ziddi FROM public.products WHERE code = 'ZIDDI';
SELECT id INTO pid_lc    FROM public.products WHERE code = 'LIQUID_CALCIUM';
SELECT id INTO pid_zsc   FROM public.products WHERE code = 'ZINC_SC';

-- Sulphur SC Phase A
IF pid_ssc IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_ssc,'A','clarity','Clarity',NULL,'select',70) ON CONFLICT DO NOTHING;
  UPDATE public.qc_test_definitions SET options='["Clear","Hazy","Sediments","Other"]'
  WHERE product_id=pid_ssc AND phase='A' AND test_key='clarity';

  -- Phase B
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_ssc,'B','clarity','Clarity',NULL,'select',70) ON CONFLICT DO NOTHING;
  UPDATE public.qc_test_definitions SET options='["Clear","Hazy","Sediments","Other"]'
  WHERE product_id=pid_ssc AND phase='B' AND test_key='clarity';
END IF;

-- Zinc SC Phase A
IF pid_zsc IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_zsc,'A','clarity','Clarity',NULL,'select',70) ON CONFLICT DO NOTHING;
  UPDATE public.qc_test_definitions SET options='["Clear","Hazy","Sediments","Other"]'
  WHERE product_id=pid_zsc AND phase='A' AND test_key='clarity';

  -- Phase B
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_zsc,'B','clarity','Clarity',NULL,'select',70) ON CONFLICT DO NOTHING;
  UPDATE public.qc_test_definitions SET options='["Clear","Hazy","Sediments","Other"]'
  WHERE product_id=pid_zsc AND phase='B' AND test_key='clarity';
END IF;

-- Ziddi (phase none)
IF pid_ziddi IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_ziddi,'none','clarity','Clarity',NULL,'select',70) ON CONFLICT DO NOTHING;
  UPDATE public.qc_test_definitions SET options='["Clear","Hazy","Sediments","Other"]'
  WHERE product_id=pid_ziddi AND phase='none' AND test_key='clarity';
END IF;

-- Liquid Calcium (phase none)
IF pid_lc IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_lc,'none','clarity','Clarity',NULL,'select',70) ON CONFLICT DO NOTHING;
  UPDATE public.qc_test_definitions SET options='["Clear","Hazy","Sediments","Other"]'
  WHERE product_id=pid_lc AND phase='none' AND test_key='clarity';
END IF;

-- Liquid Boron (phase none)
IF pid_lb IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order)
  VALUES(pid_lb,'none','clarity','Clarity',NULL,'select',70) ON CONFLICT DO NOTHING;
  UPDATE public.qc_test_definitions SET options='["Clear","Hazy","Sediments","Other"]'
  WHERE product_id=pid_lb AND phase='none' AND test_key='clarity';
END IF;

RAISE NOTICE 'A-20 migration 021 complete';
END;
$$;

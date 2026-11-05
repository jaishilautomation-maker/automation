-- =============================================================================
-- A-20 Migration 032: Product QC dropdown names, Zinc EDTA labels, Sedimentation
--
-- Run on the Factory A-20 Supabase project, AFTER 031.
--
-- (I) Product QC product dropdown (products.name — shown in the picker):
--       SULPHUR_SC      -> 'Sulphur SC (GAIN/INSTASUL)'
--       LIQUID_BORON    -> 'Liquid Boron (InstaBor150)'
--       LIQUID_CALCIUM  -> 'Liquid Calcium (InstaCal 160)'
--       ZINC_SC         -> 'Zinc SC (NUTRIZIN)'
--
-- (II) Zinc SC — Zinc Content burette labels say "NaOH" but zinc content is an
--      EDTA complexometric titration, so replace "NaOH" with "EDTA" on the four
--      titre fields (Phase A v1/v2, Phase B zc_v1/zc_v2) and the Phase B
--      suspension burette labels (set in migration 024).
--
-- (III) "Any Sedimentation?" is a boolean (renders Yes/Pass · No/Fail). Convert
--       it to a plain Yes / No dropdown for Sulphur SC and Zinc SC (all phases).
--       Stored values become 'Yes' / 'No'. No formula or spec depends on it.
--
-- Idempotent: straight UPDATEs keyed by code / product_id + test_key.
-- =============================================================================

BEGIN;

-- ─── (I) Product dropdown names ─────────────────────────────────────────────
UPDATE public.products SET name = 'Sulphur SC (GAIN/INSTASUL)' WHERE code = 'SULPHUR_SC';
UPDATE public.products SET name = 'Liquid Boron (InstaBor150)'   WHERE code = 'LIQUID_BORON';
UPDATE public.products SET name = 'Liquid Calcium (InstaCal 160)' WHERE code = 'LIQUID_CALCIUM';
UPDATE public.products SET name = 'Zinc SC (NUTRIZIN)'         WHERE code = 'ZINC_SC';

DO $$
DECLARE
  pid_ssc uuid;
  pid_zsc uuid;
BEGIN
  SELECT id INTO pid_ssc FROM public.products WHERE code = 'SULPHUR_SC';
  SELECT id INTO pid_zsc FROM public.products WHERE code = 'ZINC_SC';

  -- ─── (II) Zinc SC: NaOH -> EDTA on the titration burette labels ───────────
  IF pid_zsc IS NOT NULL THEN
    -- Phase A
    UPDATE public.qc_test_definitions
       SET label = 'EDTA starting burette reading (V1) — with cyanide'
     WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'v1_with_cyanide';
    UPDATE public.qc_test_definitions
       SET label = 'EDTA ending burette reading (V2) — without cyanide'
     WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'v2_without_cyanide';

    -- Phase B — Zinc content
    UPDATE public.qc_test_definitions
       SET label = 'ZINC CONTENT — EDTA starting burette reading (V1) — with cyanide'
     WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zc_v1_with_cyanide';
    UPDATE public.qc_test_definitions
       SET label = 'ZINC CONTENT — EDTA ending burette reading (V2) — without cyanide'
     WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zc_v2_without_cyanide';

    -- Phase B — Suspension burette labels (set to NaOH in migration 024)
    UPDATE public.qc_test_definitions
       SET label = 'SUSPENSION — EDTA starting burette reading (V1) — with cyanide'
     WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'susp_v1_sediment';
    UPDATE public.qc_test_definitions
       SET label = 'SUSPENSION — EDTA ending burette reading (V2) — without cyanide'
     WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'susp_v2_sediment';

    -- Catch-all: any remaining Zinc SC label still containing "NaOH" -> "EDTA".
    UPDATE public.qc_test_definitions
       SET label = replace(replace(label, 'NaOH', 'EDTA'), 'sodium hydroxide', 'EDTA')
     WHERE product_id = pid_zsc AND (label LIKE '%NaOH%' OR label LIKE '%sodium hydroxide%');
  END IF;

  -- ─── (III) Any Sedimentation -> Yes / No dropdown (Sulphur SC + Zinc SC) ──
  UPDATE public.qc_test_definitions
     SET input_type = 'select',
         options    = '["Yes","No"]'::jsonb
   WHERE test_key = 'any_sedimentation'
     AND product_id IN (pid_ssc, pid_zsc);
END;
$$;

COMMIT;

-- Verify:
-- SELECT code, name FROM products WHERE code IN
--   ('SULPHUR_SC','LIQUID_BORON','LIQUID_CALCIUM','ZINC_SC');
-- SELECT phase, test_key, label FROM qc_test_definitions d
--   JOIN products p ON p.id = d.product_id
--   WHERE p.code = 'ZINC_SC' AND d.label LIKE '%EDTA%' ORDER BY phase, test_key;
-- SELECT p.code, d.phase, d.input_type, d.options FROM qc_test_definitions d
--   JOIN products p ON p.id = d.product_id
--   WHERE d.test_key = 'any_sedimentation';

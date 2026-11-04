-- =============================================================================
-- Migration 075 (A-20/1 project): FG QC (sulphur powder) + COA fixes
-- 4 Nov 2026 meeting, items C7, C8, D2, D5.
--
-- Run on the Factory A-20/1 Supabase project, AFTER 074.
--
-- D2  Duplicate fields. ROOT CAUSE: qc_test_definitions has
--       UNIQUE (material_id, product_id, phase, test_key)
--     but one of material_id / product_id is always NULL and Postgres treats
--     NULLs as distinct, so every "ON CONFLICT (...) DO NOTHING" seed (001,
--     040, ...) inserted a fresh row each time it was re-run. Delete the extra
--     rows (keep one per parent/phase/test_key) and add partial unique indexes
--     that actually work. Safe: nothing references qc_test_definitions.id and
--     saved results are keyed by test_key in JSONB.
--     Also adds section_label (headers) and fills it for SULPHUR_POWDER phase B.
--
-- D5  Heat loss. Add Empty Crucible Weight and use the ACTUAL sample weight
--     (3 / 5 / 50 g ...), not a fixed one:
--         Heat loss % = (W - (W2 - E)) / W * 100
--         E  = empty crucible weight (heat_loss_crucible)
--         W  = weight of sample taken (heat_loss_m_before)
--         W2 = crucible + residue after heating (heat_loss_w2)
--     The old "mass after" field is deactivated (not deleted) so saved data
--     stays intact.
--
-- C7  parties.code_number: default "Code No." printed above the COA table.
--
-- C8  COA numbering: peek the next number, allow a typed number, and list COAs.
--
-- Idempotent.
-- =============================================================================

BEGIN;

-- ─── D2: de-duplicate, then enforce uniqueness properly ─────────────────────
DELETE FROM public.qc_test_definitions d
USING (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY product_id, phase, test_key ORDER BY is_active DESC, id) AS rn
  FROM public.qc_test_definitions WHERE product_id IS NOT NULL
) x WHERE d.id = x.id AND x.rn > 1;

DELETE FROM public.qc_test_definitions d
USING (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY material_id, phase, test_key ORDER BY is_active DESC, id) AS rn
  FROM public.qc_test_definitions WHERE material_id IS NOT NULL
) x WHERE d.id = x.id AND x.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_defs_product_phase_key
  ON public.qc_test_definitions (product_id, phase, test_key) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_defs_material_phase_key
  ON public.qc_test_definitions (material_id, phase, test_key) WHERE material_id IS NOT NULL;

ALTER TABLE public.qc_test_definitions ADD COLUMN IF NOT EXISTS section_label text;

DO $$
DECLARE mid_sp uuid;
BEGIN
  SELECT id INTO mid_sp FROM public.materials WHERE code = 'SULPHUR_POWDER';
  IF mid_sp IS NULL THEN
    RAISE NOTICE '075: SULPHUR_POWDER not found - skipping FG QC changes';
    RETURN;
  END IF;

  -- ── D5: heat loss with empty crucible + actual sample weight ─────────────
  INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
  VALUES
    (mid_sp,'B','heat_loss_crucible','Empty crucible weight (E)','g','number',103),
    (mid_sp,'B','heat_loss_w2','Crucible + residue after heating (W2)','g','number',105)
  ON CONFLICT DO NOTHING;

  UPDATE public.qc_test_definitions SET label='Weight of sample taken (W)', sort_order=104
    WHERE material_id=mid_sp AND phase='B' AND test_key='heat_loss_m_before';
  UPDATE public.qc_test_definitions SET sort_order=102
    WHERE material_id=mid_sp AND phase='B' AND test_key='heat_loss_temp';
  UPDATE public.qc_test_definitions SET sort_order=103, label='Empty crucible weight (E)'
    WHERE material_id=mid_sp AND phase='B' AND test_key='heat_loss_crucible';
  UPDATE public.qc_test_definitions SET sort_order=105
    WHERE material_id=mid_sp AND phase='B' AND test_key='heat_loss_w2';
  UPDATE public.qc_test_definitions
    SET formula='((heat_loss_m_before - (heat_loss_w2 - heat_loss_crucible)) / heat_loss_m_before) * 100',
        is_calculated=true, sort_order=106
    WHERE material_id=mid_sp AND phase='B' AND test_key='heat_loss_percent';
  -- superseded by W2 - E (kept in DB so old records still read)
  UPDATE public.qc_test_definitions SET is_active=false
    WHERE material_id=mid_sp AND phase='B' AND test_key='heat_loss_m_after';

  -- keep the remaining final-inspection fields after the heat-loss block
  UPDATE public.qc_test_definitions SET sort_order=107 WHERE material_id=mid_sp AND phase='B' AND test_key='alkalinity_naoh';
  UPDATE public.qc_test_definitions SET sort_order=108 WHERE material_id=mid_sp AND phase='B' AND test_key='total_sulphur_percent';
  UPDATE public.qc_test_definitions SET sort_order=109 WHERE material_id=mid_sp AND phase='B' AND test_key='softening_point';
  UPDATE public.qc_test_definitions SET sort_order=110 WHERE material_id=mid_sp AND phase='B' AND test_key='acetone_solubility';

  -- ── D2: section headers ──────────────────────────────────────────────────
  UPDATE public.qc_test_definitions SET section_label='Appearance'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('colour_appearance','appearance_photo');
  UPDATE public.qc_test_definitions SET section_label='Purity (Solubility in CS2)'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('purity_e','purity_w1','purity_w2','purity_percent');
  UPDATE public.qc_test_definitions SET section_label='Insolubility in Toluene'
    WHERE material_id=mid_sp AND phase='B' AND test_key='insolubility_toluene';
  UPDATE public.qc_test_definitions SET section_label='Acidity (as H2SO4)'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('acidity_v1','acidity_v2','acidity_n','acidity_m','acidity_percent');
  UPDATE public.qc_test_definitions SET section_label='Ash Content'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('ash_m','ash_m1','ash_percent');
  UPDATE public.qc_test_definitions SET section_label='Mesh Size - 100 Mesh'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('mesh100_m','mesh100_m_ret','mesh100_pct');
  UPDATE public.qc_test_definitions SET section_label='Mesh Size - 200 Mesh'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('mesh200_m','mesh200_m_ret','mesh200_pct');
  UPDATE public.qc_test_definitions SET section_label='Mesh Size - 325 Mesh'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('mesh325_m','mesh325_m_ret','mesh325_pct');
  UPDATE public.qc_test_definitions SET section_label='Oil Content'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('oil_mass_loss','oil_original_mass','oil_percent');
  UPDATE public.qc_test_definitions SET section_label='Melting Point'
    WHERE material_id=mid_sp AND phase='B' AND test_key='melting_point';
  UPDATE public.qc_test_definitions SET section_label='Specific Gravity'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('sg_w1','sg_w2','sg_w3','sg_w4','sg_sl','sg_value');
  UPDATE public.qc_test_definitions SET section_label='Bulk Density'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('bd_mass','bd_volume','bd_value');
  UPDATE public.qc_test_definitions SET section_label='Heat Loss'
    WHERE material_id=mid_sp AND phase='B' AND test_key IN ('heat_loss_temp','heat_loss_crucible','heat_loss_m_before','heat_loss_w2','heat_loss_percent');
  UPDATE public.qc_test_definitions SET section_label='Alkalinity (as NaOH)'
    WHERE material_id=mid_sp AND phase='B' AND test_key='alkalinity_naoh';
  UPDATE public.qc_test_definitions SET section_label='Total Sulphur Content'
    WHERE material_id=mid_sp AND phase='B' AND test_key='total_sulphur_percent';
  UPDATE public.qc_test_definitions SET section_label='Softening Point'
    WHERE material_id=mid_sp AND phase='B' AND test_key='softening_point';
  UPDATE public.qc_test_definitions SET section_label='Acetone Solubility'
    WHERE material_id=mid_sp AND phase='B' AND test_key='acetone_solubility';

  -- Re-order so every test group is contiguous and Heat Loss etc. follow
  -- bulk density; Appearance stays first.
END $$;

-- ─── C7: default Code No. per party ─────────────────────────────────────────
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS code_number text;
COMMENT ON COLUMN public.parties.code_number IS
  'Default "Code No." printed above the COA table (editable per COA). '
  'NULL falls back to party_code.';

-- ─── C8: COA numbering helpers ──────────────────────────────────────────────
-- Next number that nextval() WOULD hand out (does not consume it).
CREATE OR REPLACE FUNCTION public.fn_coa_peek_next_report_no()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_last bigint; v_called boolean;
BEGIN
  SELECT last_value, is_called INTO v_last, v_called FROM public.coa_report_seq;
  RETURN CASE WHEN v_called THEN v_last + 1 ELSE v_last END;
END $$;

-- Claim a number. p_requested NULL -> next from the sequence. Otherwise use the
-- typed number (must be unused) and advance the sequence past it if needed.
CREATE OR REPLACE FUNCTION public.fn_coa_claim_report_no(p_requested integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next integer;
BEGIN
  IF p_requested IS NULL THEN
    RETURN nextval('public.coa_report_seq');
  END IF;
  IF p_requested <= 0 THEN
    RAISE EXCEPTION 'Test Report No. must be positive';
  END IF;
  IF EXISTS (SELECT 1 FROM public.coa_documents WHERE test_report_no = p_requested) THEN
    RAISE EXCEPTION 'Test Report No. % is already used', p_requested USING ERRCODE = '23505';
  END IF;
  v_next := public.fn_coa_peek_next_report_no();
  IF p_requested >= v_next THEN
    PERFORM setval('public.coa_report_seq', p_requested, true);
  END IF;
  RETURN p_requested;
END $$;

REVOKE ALL ON FUNCTION public.fn_coa_peek_next_report_no() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_coa_claim_report_no(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_coa_peek_next_report_no() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_coa_claim_report_no(integer) TO service_role;

COMMIT;

-- Verify (expect zero rows):
-- SELECT material_id, product_id, phase, test_key, COUNT(*)
-- FROM public.qc_test_definitions GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;

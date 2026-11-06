-- =============================================================================
-- A-20 Migration 039: Phase A -> chemist -> Phase B job-card workflow
--
-- Run on the Factory A-20 Supabase project, AFTER 038.
--
-- Adds (reusing production_job_cards / production_job_card_items /
-- product_formula_items; nothing is rebuilt):
--   1. fn_norm_lot()            lot normalisation (trim + collapse spaces + lower)
--   2. production_job_cards     new workflow columns, lot_no_norm, status CHECK
--   3. job_card_phase_config    per-product config (active ingredient, QC key,
--                               default target %). Which products use the flow.
--   4. notification_recipients  management recipients by entry_type
--                               ('limit_exceeded'). Not hardcoded in code.
--   5. Statuses + guard trigger (the status machine) and chemist RLS
--   6. fn_phase_a_qc_by_lot() / fn_find_batch_by_lot()   normalised lookups
--   7. Product QC Phase A: switch off any "200 mesh" definition (Sulphur SC,
--      Zinc SC). Wet Sieve 5 Micron (sample/residue/fineness) is kept.
--      Phase B is untouched (200 mesh/5 micron stays a COA parameter).
--   8. Lab QC activity tile "Phase A Review"
--
-- Status machine (production_job_cards.status):
--   draft -> phase_a_submitted               operator submits Phase A
--   phase_a_submitted -> phase_b_ready       chemist saves, Phase B calculated
--   phase_a_submitted -> rejected_limit_exceeded   chemist saves, limit exceeded
--   phase_b_ready <-> rejected_limit_exceeded      chemist re-saves (recalc)
--   phase_b_ready -> phase_b_started         operator starts Phase B (LOCKS calc)
--   rejected_limit_exceeded -> phase_b_started     Case 2 only, remark required
--   rejected_limit_exceeded -> submitted           remark required (closes lot)
--   phase_b_started -> submitted             operator completes the card
--   Legacy 'draft'/'submitted' cards, and every product that is not in
--   job_card_phase_config, behave exactly as before.
--
-- Idempotent. No rows are deleted.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Lot normalisation (same rule as the Product QC batch number lookup)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_norm_lot(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;
GRANT EXECUTE ON FUNCTION public.fn_norm_lot(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. production_job_cards: workflow columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_job_cards
    ADD COLUMN IF NOT EXISTS lot_no_norm text
        GENERATED ALWAYS AS (public.fn_norm_lot(lot_no)) STORED,
    ADD COLUMN IF NOT EXISTS phase_a_conc_pct          numeric(12,6),
    ADD COLUMN IF NOT EXISTS phase_a_conc_source       text,
    ADD COLUMN IF NOT EXISTS phase_a_qc_record_id      uuid REFERENCES public.product_qc(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS target_active_pct         numeric(12,6),
    ADD COLUMN IF NOT EXISTS applied_target_pct        numeric(12,6),
    ADD COLUMN IF NOT EXISTS phase_b_calc              jsonb,
    ADD COLUMN IF NOT EXISTS phase_b_calculated_at     timestamptz,
    ADD COLUMN IF NOT EXISTS phase_b_calculated_by     uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS phase_b_started_at        timestamptz,
    ADD COLUMN IF NOT EXISTS limit_exceeded_case       smallint,
    ADD COLUMN IF NOT EXISTS lot_rejected              boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS limit_remark              text,
    ADD COLUMN IF NOT EXISTS limit_remark_by           uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS limit_remark_at           timestamptz,
    ADD COLUMN IF NOT EXISTS compensation              jsonb,
    ADD COLUMN IF NOT EXISTS compensation_consumed_by  uuid REFERENCES public.production_job_cards(id) ON DELETE SET NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pjc_conc_source_chk') THEN
        ALTER TABLE public.production_job_cards ADD CONSTRAINT pjc_conc_source_chk
            CHECK (phase_a_conc_source IS NULL OR phase_a_conc_source IN ('qc_record', 'manual'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pjc_limit_case_chk') THEN
        ALTER TABLE public.production_job_cards ADD CONSTRAINT pjc_limit_case_chk
            CHECK (limit_exceeded_case IS NULL OR limit_exceeded_case IN (1, 2));
    END IF;
    -- NOT VALID: new/updated rows are checked, legacy rows are not re-validated.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pjc_status_chk') THEN
        ALTER TABLE public.production_job_cards ADD CONSTRAINT pjc_status_chk
            CHECK (status IN ('draft', 'submitted', 'phase_a_submitted', 'phase_b_ready',
                              'phase_b_started', 'rejected_limit_exceeded')) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pjc_factory_product_lotnorm
    ON public.production_job_cards (factory_id, product_id, lot_no_norm);
CREATE INDEX IF NOT EXISTS idx_pjc_status
    ON public.production_job_cards (factory_id, status);

-- Phase B quantities are calculated at full precision; widen the column so the
-- stored instruction is not rounded to 3 dp (display stays 2 dp in the UI).
ALTER TABLE public.production_job_card_items
    ALTER COLUMN instructed_qty_kg TYPE numeric(14,6);

-- ---------------------------------------------------------------------------
-- 3. Per-product config
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_card_phase_config (
    job_card_product_code text PRIMARY KEY,           -- products.code of the JOB CARD product
    qc_product_code       text NOT NULL,              -- products.code used in Product QC
    active_ingredient     text NOT NULL,              -- 'Sulphur' | 'Zinc'
    qc_phase_a_test_key   text NOT NULL,              -- Phase A QC test_key giving concentration %
    default_target_pct    numeric(12,6),              -- chemist may edit per card
    is_active             boolean NOT NULL DEFAULT true,
    notes                 text
);

ALTER TABLE public.job_card_phase_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jcpc_select" ON public.job_card_phase_config;
CREATE POLICY "jcpc_select" ON public.job_card_phase_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "jcpc_write" ON public.job_card_phase_config;
CREATE POLICY "jcpc_write" ON public.job_card_phase_config FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.job_card_phase_config TO authenticated;

INSERT INTO public.job_card_phase_config
    (job_card_product_code, qc_product_code, active_ingredient, qc_phase_a_test_key, default_target_pct, is_active, notes)
VALUES
    ('SULPHUR_SC', 'SULPHUR_SC', 'Sulphur', 'sulphur_content', 55.16, true,
     'Sulphur SC job card. Target 55.16 % per MoM.'),
    -- Zinc SC job card is the NUTRIZIN product (QC product code ZINC_SC); its
    -- Phase B groups are B_843 / B_808. Default target 39.50 is the Zinc SC spec
    -- minimum (flagged needs_verification in product_qc_specs) - the chemist can
    -- edit it per card; confirm the right default.
    ('NUTRIZIN',   'ZINC_SC',    'Zinc',    'zinc_content_a',  39.50, true,
     'Zinc SC job card (Nutrizin). Default target 39.50 needs confirmation.')
ON CONFLICT (job_card_product_code) DO NOTHING;

-- Databases where an earlier draft of this migration seeded NUTRIZIN as disabled.
UPDATE public.job_card_phase_config
   SET is_active = true,
       notes = 'Zinc SC job card (Nutrizin). Default target 39.50 needs confirmation.'
 WHERE job_card_product_code = 'NUTRIZIN' AND is_active = false;

-- ---------------------------------------------------------------------------
-- 4. Management recipients (by entry_type)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_recipients (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid        REFERENCES public.factories(id) ON DELETE CASCADE,  -- NULL = every factory
    entry_type text        NOT NULL,                                           -- e.g. 'limit_exceeded'
    email      text        NOT NULL,
    full_name  text,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_recipients
    ON public.notification_recipients (coalesce(factory_id, '00000000-0000-0000-0000-000000000000'::uuid), entry_type, lower(email));

ALTER TABLE public.notification_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nr_admin" ON public.notification_recipients;
CREATE POLICY "nr_admin" ON public.notification_recipients FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_recipients TO authenticated;
GRANT SELECT ON public.notification_recipients TO service_role;

-- Management addresses are NOT seeded. Add them, for example:
--   INSERT INTO notification_recipients (entry_type, email, full_name)
--   VALUES ('limit_exceeded', 'name@company.com', 'Name');

-- ---------------------------------------------------------------------------
-- 5. Status machine guard + chemist RLS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "pjc_update_lab" ON public.production_job_cards;
CREATE POLICY "pjc_update_lab" ON public.production_job_cards FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','lab_manager']::app_role[])
    )
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','lab_manager']::app_role[])
    );

DROP POLICY IF EXISTS "pjci_update_lab" ON public.production_job_card_items;
CREATE POLICY "pjci_update_lab" ON public.production_job_card_items FOR UPDATE TO authenticated
    USING (
        fn_has_role(ARRAY['chemist','lab_manager']::app_role[])
        AND job_card_id IN (SELECT id FROM public.production_job_cards WHERE factory_id IN (SELECT fn_user_factory_ids()))
    );

CREATE OR REPLACE FUNCTION public.fn_pjc_phase_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_wf        boolean;
    v_lab       boolean;
    v_ops       boolean;
    -- chemist-owned columns (the calculation + rejection state)
    v_calc_cols text[] := ARRAY[
        'target_active_pct','applied_target_pct','phase_a_conc_pct','phase_a_conc_source',
        'phase_a_qc_record_id','phase_b_calc','phase_b_calculated_at','phase_b_calculated_by',
        'limit_exceeded_case','lot_rejected','compensation'];
    -- columns a lab-only user may touch besides the calc columns.
    -- compensation_consumed_by: the chemist links the PREVIOUS (rejected) lot to the
    -- next one, even after the operator has completed it, so it is not Phase-B-locked.
    -- lot_no_norm is a stored generated column (not yet computed inside a BEFORE trigger).
    v_lab_extra text[] := ARRAY['status','updated_at','sign_chemist','compensation_consumed_by','lot_no_norm'];
    n_calc jsonb;  o_calc jsonb;
    v_calc_changed   boolean;
    v_other_changed  boolean;
    v_phase_a_edit   boolean;
BEGIN
    -- Service role / SQL editor: no auth user, no guard.
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.job_card_phase_config g
          JOIN public.products p ON p.code = g.job_card_product_code
         WHERE p.id = NEW.product_id AND g.is_active
    ) INTO v_wf;
    IF NOT v_wf THEN RETURN NEW; END IF;

    v_lab := fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[]);
    v_ops := fn_has_role(ARRAY['operator','production_incharge','factory_admin','company_admin']::app_role[]);

    -- ---------------- INSERT: a new card enters as draft or phase_a_submitted
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('draft', 'phase_a_submitted') THEN
            RAISE EXCEPTION 'New job card for this product must start as draft or phase_a_submitted (got %).', NEW.status;
        END IF;
        IF NEW.status = 'phase_a_submitted'
           AND (coalesce(NEW.collected_slurry_phase_a_kg, 0) <= 0 OR btrim(coalesce(NEW.lot_no, '')) = '') THEN
            RAISE EXCEPTION 'Lot number and collected Phase A slurry (kg) are required to submit to the chemist.';
        END IF;
        NEW.phase_a_conc_pct := NULL;  NEW.phase_a_conc_source := NULL;  NEW.phase_a_qc_record_id := NULL;
        NEW.target_active_pct := NULL; NEW.applied_target_pct := NULL;   NEW.phase_b_calc := NULL;
        NEW.phase_b_calculated_at := NULL; NEW.phase_b_calculated_by := NULL; NEW.phase_b_started_at := NULL;
        NEW.limit_exceeded_case := NULL; NEW.lot_rejected := false;
        NEW.limit_remark := NULL; NEW.limit_remark_by := NULL; NEW.limit_remark_at := NULL;
        NEW.compensation := NULL; NEW.compensation_consumed_by := NULL;
        RETURN NEW;
    END IF;

    -- ---------------- UPDATE
    SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO n_calc
      FROM jsonb_each(to_jsonb(NEW)) e WHERE e.key = ANY(v_calc_cols);
    SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO o_calc
      FROM jsonb_each(to_jsonb(OLD)) e WHERE e.key = ANY(v_calc_cols);
    v_calc_changed := n_calc IS DISTINCT FROM o_calc;

    -- 5a. Status transitions
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
               (OLD.status = 'draft'                   AND NEW.status = 'phase_a_submitted')
            OR (OLD.status = 'phase_a_submitted'       AND NEW.status IN ('phase_b_ready', 'rejected_limit_exceeded'))
            OR (OLD.status = 'phase_b_ready'           AND NEW.status IN ('phase_b_started', 'rejected_limit_exceeded'))
            OR (OLD.status = 'rejected_limit_exceeded' AND NEW.status IN ('phase_b_ready', 'phase_b_started', 'submitted'))
            OR (OLD.status = 'phase_b_started'         AND NEW.status = 'submitted')
        ) THEN
            RAISE EXCEPTION 'Job card status change % -> % is not allowed.', OLD.status, NEW.status;
        END IF;

        IF NEW.status = 'phase_a_submitted'
           AND (coalesce(NEW.collected_slurry_phase_a_kg, 0) <= 0 OR btrim(coalesce(NEW.lot_no, '')) = '') THEN
            RAISE EXCEPTION 'Lot number and collected Phase A slurry (kg) are required to submit to the chemist.';
        END IF;

        IF NEW.status IN ('phase_b_ready', 'rejected_limit_exceeded') THEN
            IF NOT v_lab THEN RAISE EXCEPTION 'Only the chemist can review Phase A.'; END IF;
            IF NEW.phase_b_calc IS NULL THEN RAISE EXCEPTION 'Phase B calculation snapshot is required.'; END IF;
            IF NEW.status = 'rejected_limit_exceeded'
               AND (NEW.lot_rejected IS NOT TRUE OR NEW.limit_exceeded_case IS NULL) THEN
                RAISE EXCEPTION 'A limit-exceeded card must be marked lot_rejected with its case.';
            END IF;
            IF NEW.status = 'phase_b_ready' AND NEW.lot_rejected IS TRUE THEN
                RAISE EXCEPTION 'An approved card cannot be a rejected lot.';
            END IF;
        END IF;

        IF NEW.status = 'phase_b_started' THEN
            IF NOT v_ops THEN RAISE EXCEPTION 'Only the operator can start Phase B.'; END IF;
            IF OLD.status = 'rejected_limit_exceeded'
               AND (NEW.limit_exceeded_case IS DISTINCT FROM 2 OR btrim(coalesce(NEW.limit_remark, '')) = '') THEN
                RAISE EXCEPTION 'A remark is required before continuing a limit-exceeded lot (Case 2 only).';
            END IF;
            NEW.phase_b_started_at := now();
        END IF;

        IF NEW.status = 'submitted' AND OLD.status = 'rejected_limit_exceeded'
           AND btrim(coalesce(NEW.limit_remark, '')) = '' THEN
            RAISE EXCEPTION 'A remark is required before closing a limit-exceeded lot.';
        END IF;
    END IF;

    IF NEW.compensation_consumed_by IS DISTINCT FROM OLD.compensation_consumed_by AND NOT v_lab THEN
        RAISE EXCEPTION 'Only the chemist can link a lot for compensation.';
    END IF;

    -- 5b. Calculation / rejection columns: chemist only, and only until Phase B starts
    IF v_calc_changed THEN
        IF NOT v_lab THEN
            RAISE EXCEPTION 'Only the chemist can change the Phase A review / Phase B calculation.';
        END IF;
        IF OLD.status NOT IN ('phase_a_submitted', 'phase_b_ready', 'rejected_limit_exceeded') THEN
            RAISE EXCEPTION 'Phase B is locked (status %).', OLD.status;
        END IF;
    END IF;

    -- 5c. A lab-only user may not edit operator data
    IF v_lab AND NOT v_ops THEN
        SELECT (to_jsonb(NEW) - v_calc_cols - v_lab_extra) IS DISTINCT FROM (to_jsonb(OLD) - v_calc_cols - v_lab_extra)
          INTO v_other_changed;
        IF v_other_changed THEN
            RAISE EXCEPTION 'The chemist can only change the Phase A review fields on a job card.';
        END IF;
    END IF;

    -- 5d. Limit remark: operator, only while the lot is in rejected_limit_exceeded
    IF NEW.limit_remark IS DISTINCT FROM OLD.limit_remark THEN
        IF OLD.status <> 'rejected_limit_exceeded' AND NOT v_calc_changed THEN
            RAISE EXCEPTION 'A limit-exceeded remark can only be entered on a limit-exceeded lot.';
        END IF;
        NEW.limit_remark := nullif(btrim(coalesce(NEW.limit_remark, '')), '');
        IF NEW.limit_remark IS NULL AND OLD.limit_remark IS NOT NULL AND NOT v_calc_changed THEN
            RAISE EXCEPTION 'The limit-exceeded remark cannot be removed.';
        END IF;
        NEW.limit_remark_by := auth.uid();
        NEW.limit_remark_at := now();
    END IF;

    -- 5e. Phase A inputs changed by the operator after a chemist review:
    --     the old calculation no longer applies -> back to the chemist.
    v_phase_a_edit :=
           NEW.collected_slurry_phase_a_kg IS DISTINCT FROM OLD.collected_slurry_phase_a_kg
        OR public.fn_norm_lot(NEW.lot_no) IS DISTINCT FROM public.fn_norm_lot(OLD.lot_no)
        OR NEW.batch_size_kg IS DISTINCT FROM OLD.batch_size_kg;
    IF v_phase_a_edit AND NOT v_calc_changed THEN
        IF OLD.status = 'phase_b_started' THEN
            RAISE EXCEPTION 'Phase B has started: lot number, batch size and Phase A slurry are locked.';
        ELSIF OLD.status IN ('phase_b_ready', 'rejected_limit_exceeded') AND NEW.status = OLD.status THEN
            NEW.status := 'phase_a_submitted';
            NEW.phase_b_calc := NULL;   NEW.phase_b_calculated_at := NULL; NEW.phase_b_calculated_by := NULL;
            NEW.limit_exceeded_case := NULL; NEW.lot_rejected := false;
            NEW.limit_remark := NULL; NEW.limit_remark_by := NULL; NEW.limit_remark_at := NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pjc_phase_guard ON public.production_job_cards;
CREATE TRIGGER trg_pjc_phase_guard
    BEFORE INSERT OR UPDATE ON public.production_job_cards
    FOR EACH ROW EXECUTE FUNCTION public.fn_pjc_phase_guard();

-- Phase B quantities are chemist-owned until Phase B starts, then locked for all.
CREATE OR REPLACE FUNCTION public.fn_pjci_phase_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_status text;
    v_wf     boolean;
    v_phase  text;
BEGIN
    IF auth.uid() IS NULL OR NEW.instructed_qty_kg IS NOT DISTINCT FROM OLD.instructed_qty_kg THEN
        RETURN NEW;
    END IF;

    SELECT c.status,
           EXISTS (SELECT 1 FROM public.job_card_phase_config g
                     JOIN public.products p ON p.code = g.job_card_product_code
                    WHERE p.id = c.product_id AND g.is_active)
      INTO v_status, v_wf
      FROM public.production_job_cards c WHERE c.id = NEW.job_card_id;
    SELECT f.phase INTO v_phase FROM public.product_formula_items f WHERE f.id = NEW.formula_item_id;

    IF NOT coalesce(v_wf, false) OR coalesce(v_phase, '') NOT LIKE 'B%' THEN
        RETURN NEW;
    END IF;

    IF fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[])
       AND v_status IN ('phase_a_submitted', 'phase_b_ready', 'rejected_limit_exceeded') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Phase B quantities are set by the chemist and are read-only (status %).', v_status;
END;
$$;

DROP TRIGGER IF EXISTS trg_pjci_phase_guard ON public.production_job_card_items;
CREATE TRIGGER trg_pjci_phase_guard
    BEFORE UPDATE ON public.production_job_card_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_pjci_phase_guard();

-- ---------------------------------------------------------------------------
-- 6. Normalised lookups
-- ---------------------------------------------------------------------------

-- Phase A Product QC record(s) for a lot (newest first). Matches the lot against
-- the QC batch_no, the linked batch number / lot number and the typed
-- lot_batch_number result, all normalised.
CREATE OR REPLACE FUNCTION public.fn_phase_a_qc_by_lot(
    p_factory_id uuid, p_qc_product_code text, p_lot text)
RETURNS TABLE (id uuid, batch_no text, test_date date, test_results jsonb, submitted_at timestamptz)
LANGUAGE sql STABLE AS $$
    SELECT q.id,
           coalesce(q.batch_no, b.batch_number),
           q.test_date,
           q.test_results,
           q.submitted_at
      FROM public.product_qc q
      JOIN public.products   p ON p.id = q.product_id
      LEFT JOIN public.batches b ON b.id = q.batch_id
     WHERE q.factory_id = p_factory_id
       AND p.code       = p_qc_product_code
       AND q.phase      = 'A'
       AND public.fn_norm_lot(p_lot) <> ''
       AND public.fn_norm_lot(p_lot) IN (
               public.fn_norm_lot(q.batch_no),
               public.fn_norm_lot(b.batch_number),
               public.fn_norm_lot(b.lot_number),
               public.fn_norm_lot(q.test_results ->> 'lot_batch_number'))
     ORDER BY q.submitted_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.fn_phase_a_qc_by_lot(uuid, text, text) TO authenticated;

-- Product QC page: batch number first, then lot number (newest), normalised.
CREATE OR REPLACE FUNCTION public.fn_find_batch_by_lot(
    p_factory_id uuid, p_product_id uuid, p_text text)
RETURNS TABLE (id uuid, batch_number text, lot_number text, production_date date)
LANGUAGE sql STABLE AS $$
    SELECT b.id, b.batch_number, b.lot_number, b.production_date
      FROM public.batches b
     WHERE b.factory_id = p_factory_id
       AND b.product_id = p_product_id
       AND public.fn_norm_lot(p_text) <> ''
       AND public.fn_norm_lot(p_text) IN (public.fn_norm_lot(b.batch_number), public.fn_norm_lot(b.lot_number))
     ORDER BY (public.fn_norm_lot(b.batch_number) = public.fn_norm_lot(p_text)) DESC,
              b.production_date DESC
     LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.fn_find_batch_by_lot(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Product QC Phase A: no "200 mesh" (Sulphur SC, Zinc SC)
--    Kept: wet_sieve200_sample / _residue / _result, which migration 038
--    relabelled "Wet Sieve 5 Micron" (the fineness result needs both weights).
--    Phase B is not touched.
-- ---------------------------------------------------------------------------
UPDATE public.qc_test_definitions d
   SET is_active = false
  FROM public.products p
 WHERE d.product_id = p.id
   AND p.code IN ('SULPHUR_SC', 'ZINC_SC')
   AND d.phase = 'A'
   AND d.test_key NOT LIKE 'wet_sieve200\_%' ESCAPE '\'
   AND (d.test_key LIKE '%sieve200%' OR d.label ILIKE '%200 mesh%' OR d.label ILIKE '%200-mesh%');

-- Phase A fineness spec reads "5 micron" (it is the same wet_sieve200_result key).
UPDATE public.product_qc_specs
   SET parameter_label = 'Wet sieve test (5 micron)'
 WHERE product_code IN ('SULPHUR_SC', 'ZINC_SC')
   AND phase = 'A'
   AND test_key = 'wet_sieve200_result';

-- ---------------------------------------------------------------------------
-- 8. Lab QC tile for the chemist
-- ---------------------------------------------------------------------------
INSERT INTO public.factory_activities (factory_id, module, activity, label, sort_order, is_active)
SELECT f.id, 'lab_qc', 'phase_a_review', 'Phase A Review (Job Cards)', 20, true
  FROM public.factories f
ON CONFLICT (factory_id, module, activity) DO NOTHING;

COMMIT;

-- Verify:
-- SELECT * FROM job_card_phase_config;
-- SELECT status, count(*) FROM production_job_cards GROUP BY 1;
-- SELECT * FROM fn_phase_a_qc_by_lot('<factory uuid>', 'SULPHUR_SC', '  lot  001 ');
-- SELECT d.phase, d.test_key, d.label, d.is_active FROM qc_test_definitions d
--   JOIN products p ON p.id = d.product_id
--  WHERE p.code IN ('SULPHUR_SC','ZINC_SC') AND d.phase = 'A' AND d.test_key LIKE '%sieve%';
-- Add management recipients:
-- INSERT INTO notification_recipients (entry_type, email, full_name) VALUES ('limit_exceeded', '...', '...');

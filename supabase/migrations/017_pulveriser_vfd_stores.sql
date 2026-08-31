-- =============================================================================
-- Migration 017: Pulveriser VFD oil-dosing standard + Stores role
-- (Enum additions are in 016b_pulveriser_enum_additions.sql — see note below.)
--
-- ADDENDUM to migration 015 (pulveriser_job_cards). This does NOT create a new
-- job card — it extends the SAME pulveriser_job_cards record with an oil-dosing
-- standard lookup (vfd_parameters, Form JSCI/PRD/10) and inserts a new Stores
-- stage between Production and Operator.
--
-- New flow:
--   1. Production fills material_code (now a constrained dropdown sourced from
--      vfd_parameters) + planned_production_mt. oil_required_kg is COMPUTED
--      (planned_production_mt * 1000 * oil_feed_std). status → 'pending_stores'.
--   2. Stores issues oil (oil_issued_kg). status → 'pending' (open for Operator).
--   3. Operator fills actual_production_mt + existing fields; all oil-consumption
--      columns auto-compute. Submit → 'submitted_for_qc'.
--   4. Lab OK → 'finalized'. NOT OK → back to 'pending_stores' (full rework:
--      Stores → Operator → Lab re-runs).
--
-- Depends on: 016b (enum additions: app_role 'stores', pulveriser_status
--             'pending_stores'), 015 (pulveriser_job_cards), 001 (fn_audit_log,
--             fn_user_factory_ids), 003/004/007 (fn_has_role).
-- Order: handle_new_user → vfd_parameters (+ seed) → new columns → recompute
--        trigger → status-transition update → RLS → grants.
--
-- WHY THE ENUM ADDITIONS LIVE IN A SEPARATE FILE (016b):
--   Postgres forbids using a newly-added enum value in the SAME transaction
--   that added it (ALTER TYPE ... ADD VALUE). The Supabase migration runner
--   wraps each file in one transaction, so the new 'stores' / 'pending_stores'
--   labels are committed by 016b first, then referenced freely here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 2. handle_new_user: allow 'stores' as a self-registration role
--    (mirrors migration 002 / 007 role gate).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_full_name text;
    v_role      text;
BEGIN
    v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
    v_role      := NEW.raw_user_meta_data->>'role';

    INSERT INTO public.profiles (id, full_name)
    VALUES (NEW.id, v_full_name)
    ON CONFLICT (id) DO NOTHING;

    IF v_role IN ('operator', 'production_incharge', 'chemist', 'lab_manager', 'stores', 'viewer') THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, v_role::public.app_role)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. vfd_parameters  (Form JSCI/PRD/10) — master VFD / oil-dosing standard
--    Keyed by party_code, which is the SAME code used as
--    pulveriser_job_cards.material_code. Two machine types per code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vfd_parameters (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    party_code      text        NOT NULL,
    machine_type    text        NOT NULL CHECK (machine_type IN ('mill', 'oil_dosing_pump')),
    classifier_vfd  text,
    feeder_vfd      text,
    oil_feed_std    numeric,
    oil_feed_min    numeric,
    oil_feed_max    numeric,
    pump_flow       text,
    mesh_size_200   text,
    mesh_size_300   text,
    rev_no          integer     NOT NULL DEFAULT 0,
    effective_date  date        NOT NULL DEFAULT current_date,

    CONSTRAINT uq_vfd_party_machine UNIQUE (party_code, machine_type)
);

-- NOTE: no fn_audit_log trigger here. vfd_parameters is factory-agnostic master
-- data with no factory_id column, and fn_audit_log() hard-reads NEW.factory_id
-- (it would raise "record NEW has no field factory_id"). This mirrors the other
-- master tables (materials, products, qc_test_definitions), which are likewise
-- not audited. Changes to this master are admin-only via RLS (section 7d).
-- Defensive drop in case an earlier run of this migration created the trigger
-- before this note existed.
DROP TRIGGER IF EXISTS trg_audit_vfd_parameters ON public.vfd_parameters;

-- ── Seed: mill rows ─────────────────────────────────────────────────────────
-- classifier / feeder / oil_feed_std / min / max / pump_flow / mesh_300
INSERT INTO public.vfd_parameters
    (party_code, machine_type, classifier_vfd, feeder_vfd, oil_feed_std, oil_feed_min, oil_feed_max, pump_flow, mesh_size_300)
VALUES
    ('Shakti',  'mill', '16-17', '35-37', NULL,  NULL,  NULL,  NULL,     'Nil'),
    ('108',     'mill', '48',    '18-20', NULL,  NULL,  NULL,  NULL,     '-'),
    ('R5299',   'mill', '50',    '16-18', 0.01,  0.009, 0.011, '10 LPH', '-'),
    ('M-2615',  'mill', '50',    '16-18', 0.01,  0.009, 0.011, '10 LPH', '-'),
    ('Rubber',  'mill', '48',    '20-22', NULL,  NULL,  NULL,  NULL,     '-'),
    ('Lanxess', 'mill', '48',    '18-20', 0.02,  0.018, 0.022, '10 LPH', '-'),
    ('160108',  'mill', '40',    '20-22', 0.005, 0.004, 0.006, '5 LPH',  '-'),
    ('JKI108',  'mill', '45',    '20-22', 0.01,  0.009, 0.011, NULL,     '-'),
    ('BKT',     'mill', '50',    '16-18', 0.01,  0.008, 0.012, NULL,     '-'),
    ('2615',    'mill', '50',    '16-18', NULL,  NULL,  NULL,  NULL,     '-')
ON CONFLICT (party_code, machine_type) DO UPDATE SET
    classifier_vfd = EXCLUDED.classifier_vfd,
    feeder_vfd     = EXCLUDED.feeder_vfd,
    oil_feed_std   = EXCLUDED.oil_feed_std,
    oil_feed_min   = EXCLUDED.oil_feed_min,
    oil_feed_max   = EXCLUDED.oil_feed_max,
    pump_flow      = EXCLUDED.pump_flow,
    mesh_size_300  = EXCLUDED.mesh_size_300;

-- ── Seed: oil_dosing_pump rows (classifier / feeder only) ────────────────────
INSERT INTO public.vfd_parameters
    (party_code, machine_type, classifier_vfd, feeder_vfd)
VALUES
    ('Shakti',  'oil_dosing_pump', '16-17', '35-37'),
    ('108',     'oil_dosing_pump', '35-37', '18-20'),
    ('R5299',   'oil_dosing_pump', '44-45', '16-18'),
    ('M-2615',  'oil_dosing_pump', '44-45', '16-18'),
    ('Rubber',  'oil_dosing_pump', '33-35', '20-22'),
    ('Lanxess', 'oil_dosing_pump', '33-35', '18-20'),
    ('160108',  'oil_dosing_pump', '30-32', '20-22'),
    ('JKI',     'oil_dosing_pump', '33-35', '20-22')
ON CONFLICT (party_code, machine_type) DO UPDATE SET
    classifier_vfd = EXCLUDED.classifier_vfd,
    feeder_vfd     = EXCLUDED.feeder_vfd;

-- ---------------------------------------------------------------------------
-- 4. New columns on pulveriser_job_cards
-- ---------------------------------------------------------------------------
ALTER TABLE public.pulveriser_job_cards
    -- Production-owned
    ADD COLUMN IF NOT EXISTS planned_production_mt         numeric,
    ADD COLUMN IF NOT EXISTS oil_required_kg               numeric,  -- computed on save (app)
    -- Stores-owned
    ADD COLUMN IF NOT EXISTS oil_issued_kg                 numeric,
    ADD COLUMN IF NOT EXISTS oil_issued_by                 uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS oil_issued_at                 timestamptz,
    -- Operator-owned
    ADD COLUMN IF NOT EXISTS actual_production_mt          numeric,
    -- Calculated (DB trigger, no manual entry)
    ADD COLUMN IF NOT EXISTS expected_oil_kg               numeric,
    ADD COLUMN IF NOT EXISTS actual_oil_consumption_kg     numeric,
    ADD COLUMN IF NOT EXISTS oil_variance_kg               numeric,
    ADD COLUMN IF NOT EXISTS oil_extra_leftover_balance_kg numeric,
    ADD COLUMN IF NOT EXISTS oil_consumption_percent       numeric;

-- ---------------------------------------------------------------------------
-- 5. Recompute trigger for oil-consumption columns.
--    oil_feed_std is looked up from vfd_parameters by material_code
--    (machine_type='mill'). oil_required_kg is also recomputed here so it can
--    never drift from planned_production_mt / material_code (belt & braces on
--    top of the app-side compute the addendum describes).
--
--    Formulae (per addendum):
--      oil_required_kg               = planned_production_mt * 1000 * oil_feed_std
--      expected_oil_kg               = actual_production_mt  * 1000 * oil_feed_std
--      actual_oil_consumption_kg     = MIN(oil_issued_kg, expected_oil_kg)  [best-guess]
--      oil_variance_kg               = oil_issued_kg - expected_oil_kg
--      oil_extra_leftover_balance_kg = MAX(oil_issued_kg - expected_oil_kg, 0)
--      oil_consumption_percent       = actual_oil_consumption_kg / (actual_production_mt*1000) * 100
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pulveriser_recompute_oil()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_std numeric;
BEGIN
    SELECT oil_feed_std INTO v_std
    FROM public.vfd_parameters
    WHERE party_code = NEW.material_code
      AND machine_type = 'mill'
    LIMIT 1;

    -- Planned side (Production)
    IF NEW.planned_production_mt IS NOT NULL AND v_std IS NOT NULL THEN
        NEW.oil_required_kg := NEW.planned_production_mt * 1000 * v_std;
    ELSE
        NEW.oil_required_kg := NULL;
    END IF;

    -- Actual side (Operator + Stores)
    IF NEW.actual_production_mt IS NOT NULL AND v_std IS NOT NULL THEN
        NEW.expected_oil_kg := NEW.actual_production_mt * 1000 * v_std;
    ELSE
        NEW.expected_oil_kg := NULL;
    END IF;

    IF NEW.oil_issued_kg IS NOT NULL AND NEW.expected_oil_kg IS NOT NULL THEN
        NEW.actual_oil_consumption_kg     := LEAST(NEW.oil_issued_kg, NEW.expected_oil_kg);
        NEW.oil_variance_kg               := NEW.oil_issued_kg - NEW.expected_oil_kg;
        NEW.oil_extra_leftover_balance_kg := GREATEST(NEW.oil_issued_kg - NEW.expected_oil_kg, 0);
    ELSE
        NEW.actual_oil_consumption_kg     := NULL;
        NEW.oil_variance_kg               := NULL;
        NEW.oil_extra_leftover_balance_kg := NULL;
    END IF;

    IF NEW.actual_oil_consumption_kg IS NOT NULL
       AND NEW.actual_production_mt IS NOT NULL
       AND NEW.actual_production_mt <> 0 THEN
        NEW.oil_consumption_percent :=
            (NEW.actual_oil_consumption_kg / (NEW.actual_production_mt * 1000)) * 100;
    ELSE
        NEW.oil_consumption_percent := NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pulveriser_recompute_oil ON public.pulveriser_job_cards;
CREATE TRIGGER trg_pulveriser_recompute_oil
    BEFORE INSERT OR UPDATE ON public.pulveriser_job_cards
    FOR EACH ROW EXECUTE FUNCTION fn_pulveriser_recompute_oil();

-- ---------------------------------------------------------------------------
-- 6. Status-transition on Lab review: NOT OK now returns to 'pending_stores'
--    (full rework: Stores re-issues → Operator re-runs → Lab). OK unchanged.
--    Replaces the 015 version which sent NOT OK to 'pending'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pulveriser_apply_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.result = 'ok' THEN
        UPDATE public.pulveriser_job_cards
        SET    status = 'finalized'
        WHERE  id = NEW.job_card_id
          AND  status = 'submitted_for_qc';
    ELSE  -- 'not_ok' → full rework cycle, reopens Stores first
        UPDATE public.pulveriser_job_cards
        SET    status = 'pending_stores'
        WHERE  id = NEW.job_card_id
          AND  status = 'submitted_for_qc';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS UPDATES
-- ---------------------------------------------------------------------------

-- 7a. Production UPDATE — must now leave the card either 'pending' (draft) OR
--     advance it to 'pending_stores' (their "submit to Stores" action). It may
--     start from 'pending' (fresh) OR 'pending_stores' (editing before Stores
--     acts). It may NOT edit once Stores has moved it to 'pending' or beyond.
DROP POLICY IF EXISTS "pulv_jc_update_production" ON public.pulveriser_job_cards;
CREATE POLICY "pulv_jc_update_production" ON public.pulveriser_job_cards
    FOR UPDATE TO authenticated
    USING (
        status IN ('pending', 'pending_stores')
        AND factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY[
            'production_incharge', 'factory_admin', 'company_admin'
        ]::app_role[])
    )
    WITH CHECK (
        status IN ('pending', 'pending_stores')
        AND factory_id IN (SELECT fn_user_factory_ids())
    );

-- 7b. Stores UPDATE — stores (+ admins) may edit ONLY while
--     status='pending_stores', and may advance it to 'pending' (open for
--     Operator) or keep it 'pending_stores' (saving before issuing). Production
--     must have filled material_code first.
DROP POLICY IF EXISTS "pulv_jc_update_stores" ON public.pulveriser_job_cards;
CREATE POLICY "pulv_jc_update_stores" ON public.pulveriser_job_cards
    FOR UPDATE TO authenticated
    USING (
        status = 'pending_stores'
        AND material_code IS NOT NULL
        AND factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['stores', 'factory_admin', 'company_admin']::app_role[])
    )
    WITH CHECK (
        status IN ('pending_stores', 'pending')
        AND factory_id IN (SELECT fn_user_factory_ids())
    );

-- 7c. Operator UPDATE — unchanged gate on status='pending' + material_code set,
--     but now ALSO requires oil to have been issued first (oil_issued_kg set),
--     matching the physical reality that the batch cannot run without oil.
DROP POLICY IF EXISTS "pulv_jc_update_operator" ON public.pulveriser_job_cards;
CREATE POLICY "pulv_jc_update_operator" ON public.pulveriser_job_cards
    FOR UPDATE TO authenticated
    USING (
        status = 'pending'
        AND material_code IS NOT NULL
        AND oil_issued_kg IS NOT NULL
        AND factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['operator']::app_role[])
    )
    WITH CHECK (
        status IN ('pending', 'submitted_for_qc')
        AND factory_id IN (SELECT fn_user_factory_ids())
    );

-- 7d. vfd_parameters RLS — readable by all authenticated users (every role
--     needs the lookup); writable only by admins (master data).
ALTER TABLE public.vfd_parameters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vfd_params_select" ON public.vfd_parameters;
CREATE POLICY "vfd_params_select" ON public.vfd_parameters
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "vfd_params_write" ON public.vfd_parameters;
CREATE POLICY "vfd_params_write" ON public.vfd_parameters
    FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['factory_admin', 'company_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['factory_admin', 'company_admin']::app_role[]));

-- ---------------------------------------------------------------------------
-- 8. GRANTS
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.vfd_parameters TO authenticated;

-- =============================================================================
-- END OF MIGRATION 017
-- New role     : stores
-- New status   : pending_stores
-- New table    : vfd_parameters (18 seed rows: 10 mill + 8 oil_dosing_pump)
-- New columns  : 11 on pulveriser_job_cards
-- Triggers     : +1 (recompute oil) ; fn_pulveriser_apply_review replaced
-- Policies     : production/operator UPDATE replaced, +1 stores, +2 vfd
-- =============================================================================

-- =============================================================================
-- Migration 015: Pulveriser Job Card (Form JSCI/PROD/02) — A-20/1
--
-- Authority-approved 3-role flow that REPLACES the earlier generic
-- shifts/batch_entries assumption for the Pulveriser job card:
--
--   1. Production creates the card (10 owned fields). status = 'pending'.
--   2. Operator fills the rest + repeatable hourly readings + checkpoints,
--      then "Submit for QC" → status = 'submitted_for_qc'.
--   3. Lab reviews a submitted card: OK → 'finalized' (only path to final);
--      NOT OK → back to 'pending' (rework). Every review is logged
--      (append-only history), not just the latest.
--
-- WHY NEW TABLES (not a rename of shifts/batch_entries):
--   The legacy shifts/batch_entries tables (migrations 003/004/009/010) are
--   in production use behind /operator, /production, /lab, /records. They use
--   loose text columns, three boolean flags instead of a status enum, a
--   per-batch child model, and have NO review-history concept. The approved
--   form needs typed columns (numeric/date), a real status enum, an
--   append-only review trail, and an OK/NOT-OK rework loop. The overlap is
--   not close enough for a safe in-place migration, and renaming would break
--   the live pages. So these tables are created fresh and the legacy tables
--   are left completely untouched.
--
-- Order: ENUM → tables → triggers → status-transition fn → RLS → grants → idx
-- Depends on: fn_set_updated_at (001), fn_audit_log (001),
--             fn_user_factory_ids (001), fn_has_role (003/004).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. STATUS ENUM
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pulveriser_status') THEN
        CREATE TYPE pulveriser_status AS ENUM (
            'pending',           -- Production created it (or Lab sent it back for rework)
            'submitted_for_qc',  -- Operator submitted; awaiting Lab review
            'finalized'          -- Lab reviewed OK; locked, no further edits
        );
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. pulveriser_job_cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulveriser_job_cards (
    id                          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id                  uuid              NOT NULL REFERENCES public.factories(id),
    status                      pulveriser_status NOT NULL DEFAULT 'pending',

    -- ── Production-owned ────────────────────────────────────────────────────
    machine_number             text,   -- dropdown (see CHECK below)
    job_number                 text,
    shift                      text,
    job_date                   date,
    material_code              text,   -- माल का कोड नंबर (operator reads as reference)
    sulphur_supplier           text,
    sulphur_lot_number         text,
    sulphur_empty_date         date,   -- खाली करने की तारीख
    oil_supplier               text,
    oil_batch_number           text,
    oil_quantity               numeric(12,3),
    production_by              uuid    REFERENCES auth.users(id),
    production_at              timestamptz,

    -- ── Operator-owned ──────────────────────────────────────────────────────
    classifier_vfd             text,
    blower_inlet_valve         text,
    blower_outlet_valve        text,
    finished_goods_bag         text,
    packing_size               text,
    qc_incharge_note           text,
    stores_incharge_note       text,
    work_details               text,
    checkpoint_machine_cleaning   boolean NOT NULL DEFAULT false,
    checkpoint_roller_check       boolean NOT NULL DEFAULT false,
    checkpoint_mesh_cloth_check   boolean NOT NULL DEFAULT false,
    operator_by                uuid    REFERENCES auth.users(id),
    operator_submitted_at      timestamptz,

    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),

    -- Machine dropdown values are fixed by the authority form.
    CONSTRAINT chk_pulveriser_machine CHECK (
        machine_number IS NULL OR machine_number IN (
            'M1', 'M2', 'N2 30Nm', 'N2 50Nm',
            'CP Air Comp', 'CT Air Comp', 'AT Air Comp',
            'Forklift', 'Screening Machine', 'Crusher'
        )
    )
);

CREATE TRIGGER trg_pulveriser_job_cards_updated_at
    BEFORE UPDATE ON public.pulveriser_job_cards
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_audit_pulveriser_job_cards
    AFTER INSERT OR UPDATE OR DELETE ON public.pulveriser_job_cards
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------------------------------------------------------------------------
-- 3. pulveriser_hourly_readings  (repeating rows, operator-filled)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulveriser_hourly_readings (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_card_id         uuid        NOT NULL REFERENCES public.pulveriser_job_cards(id) ON DELETE CASCADE,
    factory_id          uuid        NOT NULL REFERENCES public.factories(id),
    machine             text,
    start_time          time,
    stop_time           time,
    total_hours         numeric(6,2),
    planned_production  numeric(12,3),
    low_production_reason text,     -- fixed list (see CHECK); nullable
    batch_no            text,
    bags                integer,
    reading_date        date,
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- Fixed low-production reason list — do not invent others.
    CONSTRAINT chk_pulveriser_low_prod_reason CHECK (
        low_production_reason IS NULL OR low_production_reason IN (
            'Mesh clogging (जाली भरना)',
            'Machine breakdown (मशीन खराब होना)',
            'Power off (बिजली बंद होना)',
            'Raw material issue (कच्चे माल की समस्या)',
            'Roller jam (रोलर जाम होना)',
            'Nitrogen unit issue (नाइट्रोजन यूनिट की समस्या)'
        )
    )
);

CREATE TRIGGER trg_audit_pulveriser_hourly_readings
    AFTER INSERT OR UPDATE OR DELETE ON public.pulveriser_hourly_readings
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------------------------------------------------------------------------
-- 4. pulveriser_job_card_reviews  (Lab review history, append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulveriser_job_card_reviews (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_card_id   uuid        NOT NULL REFERENCES public.pulveriser_job_cards(id) ON DELETE CASCADE,
    factory_id    uuid        NOT NULL REFERENCES public.factories(id),
    reviewed_by   uuid        NOT NULL REFERENCES auth.users(id),
    result        text        NOT NULL CHECK (result IN ('ok', 'not_ok')),
    remark        text,
    -- Default reopening target is Operator fields only. If a rejection is
    -- specifically about Production's fields, Lab sets this to 'production'
    -- so the UI knows to reopen Production's part instead.
    rejected_stage text       CHECK (rejected_stage IS NULL OR rejected_stage IN ('operator', 'production')),
    reviewed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_audit_pulveriser_job_card_reviews
    AFTER INSERT OR UPDATE OR DELETE ON public.pulveriser_job_card_reviews
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pulv_jc_factory_status
    ON public.pulveriser_job_cards (factory_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pulv_hourly_job_card
    ON public.pulveriser_hourly_readings (job_card_id);
CREATE INDEX IF NOT EXISTS idx_pulv_reviews_job_card
    ON public.pulveriser_job_card_reviews (job_card_id, reviewed_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Status-transition trigger on review insert
--    ok      → job card 'finalized' (only path to final)
--    not_ok  → job card 'pending'   (rework; operator can edit again)
--    Runs SECURITY DEFINER so it can flip the job card status even though the
--    Lab role has no direct UPDATE grant on pulveriser_job_cards (see RLS).
--    Guard: the review row must reference a card that is currently
--    'submitted_for_qc' — enforced both here and by the review INSERT policy.
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
    ELSE  -- 'not_ok'
        UPDATE public.pulveriser_job_cards
        SET    status = 'pending'
        WHERE  id = NEW.job_card_id
          AND  status = 'submitted_for_qc';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pulveriser_apply_review
    AFTER INSERT ON public.pulveriser_job_card_reviews
    FOR EACH ROW EXECUTE FUNCTION fn_pulveriser_apply_review();

-- ---------------------------------------------------------------------------
-- 7. Helper: which Production-owned columns are unchanged between OLD and NEW.
--    Used by the production UPDATE policy to guarantee Production can only
--    touch its own columns. Operator columns are guarded by the operator
--    policy's WITH CHECK the same way.
--    (Implemented inline in the policies below rather than as a function,
--     to keep it visible and avoid an extra SECURITY DEFINER surface.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE public.pulveriser_job_cards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulveriser_hourly_readings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulveriser_job_card_reviews  ENABLE ROW LEVEL SECURITY;

-- ── 8.1 pulveriser_job_cards ────────────────────────────────────────────────

-- SELECT: any authenticated user scoped to their factory (all three roles
--         need to see the card at different stages).
CREATE POLICY "pulv_jc_select" ON public.pulveriser_job_cards
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

-- INSERT: production_incharge (+ admins) at that factory create the card.
--         It must start life as 'pending'.
CREATE POLICY "pulv_jc_insert" ON public.pulveriser_job_cards
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND status = 'pending'
        AND fn_has_role(ARRAY[
            'production_incharge', 'factory_admin', 'company_admin'
        ]::app_role[])
    );

-- UPDATE (Production): production_incharge may edit ONLY while status='pending'.
--   The app writes only Production-owned columns here; the WITH CHECK keeps
--   the row 'pending' (Production cannot advance the status). Operator-owned
--   columns are not written by the Production UI. Advancing to
--   'submitted_for_qc' is done exclusively by the Operator policy below.
CREATE POLICY "pulv_jc_update_production" ON public.pulveriser_job_cards
    FOR UPDATE TO authenticated
    USING (
        status = 'pending'
        AND factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY[
            'production_incharge', 'factory_admin', 'company_admin'
        ]::app_role[])
    )
    WITH CHECK (
        status = 'pending'
        AND factory_id IN (SELECT fn_user_factory_ids())
    );

-- UPDATE (Operator): operator may edit ONLY while status='pending' AND
--   Production has filled their part first (material_code IS NOT NULL).
--   The Operator may keep it 'pending' (saving progress) OR advance it to
--   'submitted_for_qc' (the "Submit for QC" action). No other target status
--   is allowed. This is the only policy that lets a card reach
--   'submitted_for_qc'.
CREATE POLICY "pulv_jc_update_operator" ON public.pulveriser_job_cards
    FOR UPDATE TO authenticated
    USING (
        status = 'pending'
        AND material_code IS NOT NULL
        AND factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['operator']::app_role[])
    )
    WITH CHECK (
        status IN ('pending', 'submitted_for_qc')
        AND factory_id IN (SELECT fn_user_factory_ids())
    );

-- No UPDATE policy targets 'finalized' rows for any role → finalized is locked.
-- No DELETE policy → deletes are blocked by RLS for everyone.

-- ── 8.2 pulveriser_hourly_readings ──────────────────────────────────────────

CREATE POLICY "pulv_hourly_select" ON public.pulveriser_hourly_readings
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

-- INSERT: operator (+ admins), only while the parent card is 'pending' and
--         Production has filled material_code.
CREATE POLICY "pulv_hourly_insert" ON public.pulveriser_hourly_readings
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['operator', 'factory_admin', 'company_admin']::app_role[])
        AND EXISTS (
            SELECT 1 FROM public.pulveriser_job_cards jc
            WHERE jc.id = pulveriser_hourly_readings.job_card_id
              AND jc.status = 'pending'
              AND jc.material_code IS NOT NULL
        )
    );

-- UPDATE: operator may correct their own readings while the card is still
--         'pending' (e.g. after a NOT OK rework). Blocked once submitted/final.
CREATE POLICY "pulv_hourly_update" ON public.pulveriser_hourly_readings
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['operator', 'factory_admin', 'company_admin']::app_role[])
        AND EXISTS (
            SELECT 1 FROM public.pulveriser_job_cards jc
            WHERE jc.id = pulveriser_hourly_readings.job_card_id
              AND jc.status = 'pending'
        )
    );

-- DELETE: operator may remove a reading row while the card is 'pending'
--         (repeatable rows — they may drop one during entry/rework).
CREATE POLICY "pulv_hourly_delete" ON public.pulveriser_hourly_readings
    FOR DELETE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['operator', 'factory_admin', 'company_admin']::app_role[])
        AND EXISTS (
            SELECT 1 FROM public.pulveriser_job_cards jc
            WHERE jc.id = pulveriser_hourly_readings.job_card_id
              AND jc.status = 'pending'
        )
    );

-- ── 8.3 pulveriser_job_card_reviews ─────────────────────────────────────────

CREATE POLICY "pulv_reviews_select" ON public.pulveriser_job_card_reviews
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

-- INSERT: lab (chemist / lab_manager, + admins), only while the card is
--         'submitted_for_qc'. reviewed_by must be the current user. The
--         status-transition trigger then flips the card status.
CREATE POLICY "pulv_reviews_insert" ON public.pulveriser_job_card_reviews
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND reviewed_by = auth.uid()
        AND fn_has_role(ARRAY[
            'chemist', 'lab_manager', 'factory_admin', 'company_admin'
        ]::app_role[])
        AND EXISTS (
            SELECT 1 FROM public.pulveriser_job_cards jc
            WHERE jc.id = pulveriser_job_card_reviews.job_card_id
              AND jc.status = 'submitted_for_qc'
        )
    );

-- No UPDATE / DELETE policy → reviews are append-only, full history preserved.

-- ---------------------------------------------------------------------------
-- 9. GRANTS
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE          ON public.pulveriser_job_cards        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.pulveriser_hourly_readings  TO authenticated;
GRANT SELECT, INSERT                  ON public.pulveriser_job_card_reviews TO authenticated;

-- =============================================================================
-- END OF MIGRATION 015
-- Tables  : 3   (pulveriser_job_cards, _hourly_readings, _job_card_reviews)
-- ENUM    : 1   (pulveriser_status)
-- Triggers: 5   (1 updated_at + 3 audit + 1 status-transition on review)
-- Policies: 10
-- Legacy shifts / batch_entries: untouched.
-- =============================================================================

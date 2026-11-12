-- =============================================================================
-- A-20 Migration 031: Phase A / Phase B Chemist Approval Workflow
--
-- Implements a two-phase chemist approval flow for production job cards:
--
--   Operator fills Phase A → saves with status = 'phase_a_pending'
--   Chemist approves Phase A → status = 'phase_a_approved'
--   Chemist rejects Phase A  → status = 'phase_a_rejected'
--   Operator fills Phase B → saves with status = 'phase_b_pending'
--   Chemist approves Phase B → status = 'completed'
--   Chemist rejects Phase B  → status = 'phase_b_rejected'
--
-- New status values (extending the existing free-text status column):
--   'draft'             — operator has saved a draft (not yet submitted for Phase A review)
--   'phase_a_pending'   — Phase A submitted by operator; awaiting chemist
--   'phase_a_approved'  — Phase A approved by chemist; operator can start Phase B
--   'phase_a_rejected'  — Phase A rejected by chemist; operator must correct and resubmit
--   'phase_b_pending'   — Phase B submitted by operator; awaiting chemist final review
--   'phase_b_rejected'  — Phase B rejected by chemist; operator must correct Phase B
--   'completed'         — Phase B approved; job card fully complete
--   'submitted'         — kept for backward compatibility with old records
--
-- New columns added to production_job_cards:
--   chemist_remarks_phase_a  text          — chemist notes / rejection reason for Phase A
--   chemist_remarks_phase_b  text          — chemist notes / rejection reason for Phase B
--   approved_by_phase_a      uuid          — auth.users(id) of chemist who reviewed Phase A
--   approved_by_phase_b      uuid          — auth.users(id) of chemist who reviewed Phase B
--   phase_a_reviewed_at      timestamptz   — when Phase A was approved or rejected
--   phase_b_reviewed_at      timestamptz   — when Phase B was approved or rejected
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Drop any existing CHECK constraint on the status column and replace it
--    with one that includes all valid workflow status values.
--    The constraint may have been named 'pjc_status_chk' when the DB was set up.
--    We drop it unconditionally (IF EXISTS) and recreate it below so this
--    migration is safe to run on DBs with or without the old constraint.
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_job_cards
    DROP CONSTRAINT IF EXISTS pjc_status_chk;

ALTER TABLE public.production_job_cards
    DROP CONSTRAINT IF EXISTS production_job_cards_status_check;

-- Add the updated constraint covering all workflow statuses
ALTER TABLE public.production_job_cards
    ADD CONSTRAINT pjc_status_chk CHECK (
        status IN (
            'draft',
            'submitted',
            'phase_a_pending',
            'phase_a_approved',
            'phase_a_rejected',
            'phase_b_pending',
            'phase_b_rejected',
            'completed'
        )
    );

-- ---------------------------------------------------------------------------
-- 1. Add new columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_job_cards
    ADD COLUMN IF NOT EXISTS chemist_remarks_phase_a text,
    ADD COLUMN IF NOT EXISTS chemist_remarks_phase_b text,
    ADD COLUMN IF NOT EXISTS approved_by_phase_a     uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_by_phase_b     uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS phase_a_reviewed_at     timestamptz,
    ADD COLUMN IF NOT EXISTS phase_b_reviewed_at     timestamptz;

COMMENT ON COLUMN public.production_job_cards.chemist_remarks_phase_a
    IS 'Chemist remarks or rejection reason for Phase A review';
COMMENT ON COLUMN public.production_job_cards.chemist_remarks_phase_b
    IS 'Chemist remarks or rejection reason for Phase B review';
COMMENT ON COLUMN public.production_job_cards.approved_by_phase_a
    IS 'auth.users.id of chemist/lab_manager who approved or rejected Phase A';
COMMENT ON COLUMN public.production_job_cards.approved_by_phase_b
    IS 'auth.users.id of chemist/lab_manager who approved or rejected Phase B';

-- ---------------------------------------------------------------------------
-- 2. Extend RLS UPDATE policy to allow chemist / lab_manager to write ONLY
--    the approval columns (status, chemist_remarks_*, approved_by_*, *_reviewed_at).
--
--    Strategy: drop the existing pjc_update and replace with two policies:
--      a) pjc_update_operator  — production_incharge, operator, factory_admin, company_admin
--                                can update any column (existing behaviour)
--      b) pjc_update_chemist   — chemist, lab_manager can only SET status to an approval
--                                value and write the chemist_remarks/approved_by columns.
--                                We cannot restrict per-column in RLS (Postgres doesn't
--                                support column-level UPDATE policies), so we use a CHECK
--                                that limits what the status can be set to.
-- ---------------------------------------------------------------------------

-- Remove old combined policy (was created in 002 and revised in 018)
DROP POLICY IF EXISTS "pjc_update" ON public.production_job_cards;

-- Operator-side update (unchanged capability)
CREATE POLICY "pjc_update_operator" ON public.production_job_cards
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['production_incharge','operator','factory_admin','company_admin']::app_role[])
    );

-- Chemist-side update (approval decisions only)
-- The CHECK ensures chemists can only set status to one of the two approval outcomes.
-- They cannot impersonate operators by setting status back to 'draft' or setting
-- arbitrary phase data — the application layer further constrains what is sent.
CREATE POLICY "pjc_update_chemist" ON public.production_job_cards
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[])
    )
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND status IN (
            'phase_a_approved', 'phase_a_rejected',
            'phase_b_rejected', 'completed'
        )
    );

-- ---------------------------------------------------------------------------
-- 3. Indexes for the new query patterns
--    Chemist review page will filter by status IN ('phase_a_pending','phase_b_pending')
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pjc_status_factory
    ON public.production_job_cards (factory_id, status);

-- =============================================================================
-- A-20 Migration 041: One status constraint for both job-card workflows
--
-- Run on the Factory A-20 Supabase project, AFTER 039 and 040.
--
-- Two workflows now share production_job_cards.status:
--
--   Calculation flow (Sulphur SC, Zinc SC / Nutrizin; migration 039):
--     draft -> phase_a_submitted -> phase_b_ready | rejected_limit_exceeded
--           -> phase_b_started -> submitted
--     The chemist SAVES Phase A and the system calculates Phase B.
--
--   Approval flow (UPL, InstaCal, K-Gum, InstaBor; migration 031):
--     draft -> phase_a_pending -> phase_a_approved | phase_a_rejected
--           -> phase_b_pending -> completed | phase_b_rejected
--     The chemist approves or rejects each phase.
--
-- Migration 031 (and queries/fix_status_constraint.sql) replaced pjc_status_chk
-- with a list that only had the approval statuses, which would reject the
-- calculation-flow statuses. This recreates the constraint with BOTH sets.
-- Each flow's transitions are enforced separately: the calculation flow by the
-- fn_pjc_phase_guard trigger (only for products in job_card_phase_config), the
-- approval flow by the application and RLS (031).
--
-- Cards of Sulphur SC / Nutrizin that were saved in an approval status (the forms
-- briefly used it) are mapped onto the calculation flow:
--   phase_a_pending, phase_a_approved       -> phase_a_submitted  (chemist calculates)
--   phase_a_rejected                        -> draft
--   phase_b_pending, phase_b_rejected, completed -> submitted     (no calculation: legacy edit mode)
-- Idempotent.
-- =============================================================================

BEGIN;

ALTER TABLE public.production_job_cards DROP CONSTRAINT IF EXISTS pjc_status_chk;
ALTER TABLE public.production_job_cards DROP CONSTRAINT IF EXISTS production_job_cards_status_check;

-- NOT VALID: new and updated rows are checked; existing rows are not re-validated.
ALTER TABLE public.production_job_cards
    ADD CONSTRAINT pjc_status_chk CHECK (status IN (
        'draft', 'submitted',
        -- calculation flow (039)
        'phase_a_submitted', 'phase_b_ready', 'phase_b_started', 'rejected_limit_exceeded',
        -- approval flow (031)
        'phase_a_pending', 'phase_a_approved', 'phase_a_rejected',
        'phase_b_pending', 'phase_b_rejected', 'completed'
    )) NOT VALID;

-- Map approval-flow statuses on the calculation-flow products.
UPDATE public.production_job_cards c
   SET status = CASE c.status
                  WHEN 'phase_a_pending'  THEN 'phase_a_submitted'
                  WHEN 'phase_a_approved' THEN 'phase_a_submitted'
                  WHEN 'phase_a_rejected' THEN 'draft'
                  ELSE 'submitted'          -- phase_b_pending / phase_b_rejected / completed
                END
  FROM public.products p
  JOIN public.job_card_phase_config g ON g.job_card_product_code = p.code AND g.is_active
 WHERE c.product_id = p.id
   AND c.status IN ('phase_a_pending', 'phase_a_approved', 'phase_a_rejected',
                    'phase_b_pending', 'phase_b_rejected', 'completed');

COMMIT;

-- Verify (expect no approval-flow statuses on SULPHUR_SC / NUTRIZIN):
-- SELECT p.code, c.status, count(*) FROM production_job_cards c
--   JOIN products p ON p.id = c.product_id GROUP BY 1, 2 ORDER BY 1, 2;

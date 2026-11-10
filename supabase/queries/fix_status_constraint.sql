-- =============================================================================
-- Fix: production_job_cards status check constraint
--
-- Run this directly in the Supabase SQL editor on the A-20 project.
--
-- The existing constraint only allows 'draft' and 'submitted'.
-- This replaces it with one that includes all Phase A/B workflow statuses.
-- =============================================================================

-- Drop the old constraint (try both common names)
ALTER TABLE public.production_job_cards
    DROP CONSTRAINT IF EXISTS pjc_status_chk;

ALTER TABLE public.production_job_cards
    DROP CONSTRAINT IF EXISTS production_job_cards_status_check;

-- Recreate with all valid workflow values
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

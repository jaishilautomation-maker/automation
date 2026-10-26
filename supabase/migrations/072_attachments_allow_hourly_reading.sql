-- =============================================================================
-- Migration 072 — allow 'hourly_reading' in attachments.entity_type
--
-- Bug: the hourly-reading Lab QC form uploads a photo and tries to insert an
-- `attachments` row with entity_type = 'hourly_reading' (this value is in the
-- app's AttachmentEntityType union in lib/types.ts). But the attachments table's
-- CHECK constraint (migration 001) never included 'hourly_reading':
--
--   CHECK (entity_type IN ('rm_receipt','rm_qc','batch_analysis',
--                          'product_qc','post_production_test','lab_trial'))
--
-- So the Storage upload succeeded but the attachments-row INSERT was rejected
-- with a CHECK violation → no row → the notification email found no photo to
-- attach. (batch_analysis / product_qc were in the list, which is why photos
-- worked there but never for hourly readings.)
--
-- Fix: replace the constraint with one that also permits 'hourly_reading'.
-- Additive and safe — only widens the allowed set.
--
-- Run on the A-20/1 Supabase project, after 071.
-- =============================================================================

ALTER TABLE public.attachments
    DROP CONSTRAINT IF EXISTS chk_entity_type;

ALTER TABLE public.attachments
    ADD CONSTRAINT chk_entity_type CHECK (
        entity_type IN (
            'rm_receipt',
            'rm_qc',
            'batch_analysis',
            'product_qc',
            'post_production_test',
            'lab_trial',
            'hourly_reading'
        )
    );

-- =============================================================================
-- END 072
-- =============================================================================

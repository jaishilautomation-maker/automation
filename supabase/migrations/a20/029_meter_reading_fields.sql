-- =============================================================================
-- A-20 Migration 029: Machine Meter Reading fields
--
-- Adds two nullable numeric columns to production_job_cards for recording
-- the machine's initial and final meter readings on the three Phase-A+B
-- SC/Nutrizin job cards (UPL, SulphurSC, Nutrizin).  The reading difference
-- and calculated running time are derived values displayed in the UI only —
-- they do NOT need their own columns; they are recomputed from these two values.
--
-- New columns:
--   meter_reading_initial  numeric(12,2)  — machine meter reading before run
--   meter_reading_final    numeric(12,2)  — machine meter reading after run
-- =============================================================================

ALTER TABLE public.production_job_cards
    ADD COLUMN IF NOT EXISTS meter_reading_initial  numeric(12,2),
    ADD COLUMN IF NOT EXISTS meter_reading_final    numeric(12,2);

COMMENT ON COLUMN public.production_job_cards.meter_reading_initial
    IS 'Machine meter reading at start of Phase A (UPL / SulphurSC / Nutrizin job cards)';

COMMENT ON COLUMN public.production_job_cards.meter_reading_final
    IS 'Machine meter reading at end of Phase A (UPL / SulphurSC / Nutrizin job cards)';

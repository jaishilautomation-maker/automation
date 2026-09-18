-- =============================================================================
-- Migration 027 — Pulveriser Machine Close (Band) Times
--
-- Operators can record multiple machine close events per job card during a
-- shift. Each row captures: when the machine was closed, and an optional
-- reason / remark.  Rows are append-and-update (operator can re-open the
-- job card and continue adding entries at any point during the shift).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulveriser_machine_close_times (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_card_id     uuid NOT NULL
                    REFERENCES public.pulveriser_job_cards(id) ON DELETE CASCADE,
  factory_id      uuid NOT NULL
                    REFERENCES public.factories(id) ON DELETE RESTRICT,

  -- When the machine was closed
  close_time      time WITHOUT TIME ZONE NOT NULL,   -- HH:MM (24-hour)
  close_date      date NOT NULL DEFAULT CURRENT_DATE,

  -- Optional restart time (when machine was started again after this close)
  restart_time    time WITHOUT TIME ZONE,            -- null = not yet restarted

  -- Reason / remark
  reason          text,

  -- Who recorded it
  recorded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups per job card
CREATE INDEX IF NOT EXISTS idx_pmct_job_card_id
  ON public.pulveriser_machine_close_times (job_card_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.fn_pmct_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pmct_updated_at ON public.pulveriser_machine_close_times;
CREATE TRIGGER trg_pmct_updated_at
  BEFORE UPDATE ON public.pulveriser_machine_close_times
  FOR EACH ROW EXECUTE FUNCTION public.fn_pmct_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.pulveriser_machine_close_times ENABLE ROW LEVEL SECURITY;

-- Operators + factory_admin + company_admin can SELECT rows for their factory
CREATE POLICY "pmct_select" ON public.pulveriser_machine_close_times
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (ur.factory_id = factory_id OR ur.factory_id IS NULL)
        AND ur.role IN ('operator', 'factory_admin', 'company_admin',
                        'production_incharge', 'lab_manager', 'viewer')
    )
  );

-- Only the operator who recorded it (or factory/company admin) can INSERT
CREATE POLICY "pmct_insert" ON public.pulveriser_machine_close_times
  FOR INSERT WITH CHECK (
    recorded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (ur.factory_id = factory_id OR ur.factory_id IS NULL)
        AND ur.role IN ('operator', 'factory_admin', 'company_admin')
    )
  );

-- Operator can UPDATE their own rows; admin can update any
CREATE POLICY "pmct_update" ON public.pulveriser_machine_close_times
  FOR UPDATE USING (
    recorded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (ur.factory_id = factory_id OR ur.factory_id IS NULL)
        AND ur.role IN ('factory_admin', 'company_admin')
    )
  );

-- Operator can DELETE their own rows; admin can delete any
CREATE POLICY "pmct_delete" ON public.pulveriser_machine_close_times
  FOR DELETE USING (
    recorded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (ur.factory_id = factory_id OR ur.factory_id IS NULL)
        AND ur.role IN ('factory_admin', 'company_admin')
    )
  );

-- ---------------------------------------------------------------------------
-- Grant
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.pulveriser_machine_close_times TO authenticated;

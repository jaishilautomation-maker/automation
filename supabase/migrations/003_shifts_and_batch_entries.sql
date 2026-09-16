-- Migration 003: add shifts and batch_entries tables
-- These support the operator job card entry form (operator/page.tsx)
-- and the records view (records/page.tsx).

CREATE TABLE IF NOT EXISTS public.shifts (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    machine              text        NOT NULL,
    jobno                text,
    operator             text,
    shift_date           date        NOT NULL,
    shift_type           text        NOT NULL,   -- 'Day' | 'Night'
    checkpoint_cleaning  boolean     NOT NULL DEFAULT false,
    checkpoint_roller    boolean     NOT NULL DEFAULT false,
    checkpoint_mesh      boolean     NOT NULL DEFAULT false,
    hours_total          numeric(5,2),
    sig_operator         text,
    sig_maintenance      text,
    production_submitted boolean     NOT NULL DEFAULT false,
    lab_submitted        boolean     NOT NULL DEFAULT false,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_shifts_updated_at
    BEFORE UPDATE ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE IF NOT EXISTS public.batch_entries (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id   uuid        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    seq        smallint    NOT NULL,
    from_time  text,
    to_time    text,
    material   text,
    calcifier  text,
    blower_in  text,
    blower_out text,
    work       text
);

-- Helper: check current user's role without causing RLS recursion.
-- SECURITY DEFINER bypasses RLS when querying user_roles internally.
CREATE OR REPLACE FUNCTION fn_has_role(required_roles app_role[])
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = auth.uid()
          AND role = ANY(required_roles)
    );
$$;

-- RLS
ALTER TABLE public.shifts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_entries ENABLE ROW LEVEL SECURITY;

-- Operators see only their own shifts; admins/production/lab see all
CREATE POLICY "shifts_select_own" ON public.shifts
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "shifts_select_admin" ON public.shifts
    FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin','production_incharge','lab_manager','chemist']::app_role[]));

CREATE POLICY "shifts_insert" ON public.shifts
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "shifts_update" ON public.shifts
    FOR UPDATE TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin','production_incharge']::app_role[]));

CREATE POLICY "batch_entries_select" ON public.batch_entries
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shifts
            WHERE shifts.id = batch_entries.shift_id
              AND shifts.user_id = auth.uid()
        )
    );

CREATE POLICY "batch_entries_insert" ON public.batch_entries
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.shifts
            WHERE shifts.id = batch_entries.shift_id
              AND shifts.user_id = auth.uid()
        )
    );

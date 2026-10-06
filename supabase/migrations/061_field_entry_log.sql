-- =============================================================================
-- Migration 061: field_entry_log — field-level audit capture
--
-- Records when each individual field was filled/changed, with the
-- client-reported timestamp (entered_at) and the server receipt time
-- (recorded_at). The gap between the two is the manager's signal for
-- potential backdating.
--
-- Populated by application code on form submit (one batched INSERT per
-- form submission, never one row per keystroke). The schema is identical
-- across all modules — no per-module tables.
--
-- Covered modules: batch_analysis | rm_receipt | rm_qc | job_card |
--                  breakdown | pm
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.field_entry_log (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES auth.users(id),
    module      text        NOT NULL,   -- 'batch_analysis' | 'rm_receipt' | 'rm_qc'
                                        -- | 'job_card' | 'breakdown' | 'pm'
    record_id   uuid        NOT NULL,   -- PK of the row in that module's table
    field_name  text        NOT NULL,
    field_value text,                   -- stored as text; NULL = field was cleared
    entered_at  timestamptz NOT NULL,   -- client-reported time the field was filled
    recorded_at timestamptz NOT NULL DEFAULT now()  -- server receipt time
);

-- Fast lookup: all field entries for a specific record
CREATE INDEX IF NOT EXISTS idx_field_entry_module_record
    ON public.field_entry_log (module, record_id, entered_at);

-- Fast lookup: all entries by a user in a time range (daily digest query)
CREATE INDEX IF NOT EXISTS idx_field_entry_user_recorded
    ON public.field_entry_log (user_id, recorded_at DESC);

-- All entries in a recorded_at window (digest aggregation)
CREATE INDEX IF NOT EXISTS idx_field_entry_recorded_at
    ON public.field_entry_log (recorded_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_entry_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can INSERT their own rows (captured on submit).
DROP POLICY IF EXISTS "fel_insert" ON public.field_entry_log;
CREATE POLICY "fel_insert" ON public.field_entry_log
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Admins and lab managers can SELECT across their factory's records.
-- Chemists/operators can only read their own entries.
DROP POLICY IF EXISTS "fel_select" ON public.field_entry_log;
CREATE POLICY "fel_select" ON public.field_entry_log
    FOR SELECT TO authenticated
    USING (
        -- company/factory admins or lab managers see everything
        fn_has_role(ARRAY[
            'company_admin', 'factory_admin', 'lab_manager'
        ]::app_role[])
        OR
        -- everyone else sees only their own entries
        user_id = auth.uid()
    );

GRANT SELECT, INSERT ON public.field_entry_log TO authenticated;

-- =============================================================================
-- END OF MIGRATION 061
-- =============================================================================

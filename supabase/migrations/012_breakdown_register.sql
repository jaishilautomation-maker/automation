-- =============================================================================
-- Migration 012: Breakdown Register (Form JSCI/PROD/04)
--
-- A-20/1 only. Access: production_incharge, factory_admin, company_admin.
-- Append-only — no UPDATE or DELETE for non-admins.
--
-- sr_no is auto-incremented PER MACHINE within a factory, not globally.
-- The trigger fn_breakdown_sr_no() handles this before each INSERT.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE public.breakdown_register (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id             uuid        NOT NULL REFERENCES public.factories(id),
    machine_name           text        NOT NULL,
    sr_no                  integer     NOT NULL,
    start_at               timestamptz NOT NULL,
    finish_at              timestamptz,          -- nullable: entry may still be ongoing
    nature_of_breakdown    text,
    repair_carried_out     text,
    parts_replaced         text,
    corrective_action      text,
    remarks                text,
    created_by             uuid        NOT NULL REFERENCES auth.users(id),
    created_at             timestamptz NOT NULL DEFAULT now(),

    -- Ensure sr_no is unique per machine per factory
    UNIQUE (factory_id, machine_name, sr_no)
);

-- ---------------------------------------------------------------------------
-- Auto sr_no trigger — increments per (factory_id, machine_name)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_breakdown_sr_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT COALESCE(MAX(sr_no), 0) + 1
    INTO   NEW.sr_no
    FROM   breakdown_register
    WHERE  factory_id   = NEW.factory_id
      AND  machine_name = NEW.machine_name;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_breakdown_sr_no
    BEFORE INSERT ON public.breakdown_register
    FOR EACH ROW EXECUTE FUNCTION fn_breakdown_sr_no();

-- ---------------------------------------------------------------------------
-- Audit trigger (keeps breakdown changes in audit_log)
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_audit_breakdown
    AFTER INSERT OR UPDATE OR DELETE ON public.breakdown_register
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.breakdown_register ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user at this factory
CREATE POLICY "breakdown_select" ON public.breakdown_register
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

-- INSERT: production_incharge, factory_admin, company_admin
CREATE POLICY "breakdown_insert" ON public.breakdown_register
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY[
            'production_incharge', 'factory_admin', 'company_admin'
        ]::app_role[])
    );

-- UPDATE: factory_admin, company_admin only (corrections, rare)
CREATE POLICY "breakdown_update" ON public.breakdown_register
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['factory_admin', 'company_admin']::app_role[])
    );

-- DELETE: blocked for all (no policy = blocked by RLS)

-- ---------------------------------------------------------------------------
-- GRANTs
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.breakdown_register TO authenticated;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX idx_breakdown_factory_machine
    ON public.breakdown_register (factory_id, machine_name, created_at DESC);

CREATE INDEX idx_breakdown_factory_date
    ON public.breakdown_register (factory_id, created_at DESC);

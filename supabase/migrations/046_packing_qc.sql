-- =============================================================================
-- Migration 046 — Packing Material QC (new Lab QC section)
--
-- QC for packing materials (e.g. HDPE bags). One record per test.
-- Item references stores_stock_items (category = 'packaging_material' — note
-- the enum value is 'packaging_material', NOT 'packing_material').
--
-- correlation_percent = actual_weight / po_weight * 100 (computed app-side and
-- stored; a GENERATED column can't reference across rows but this is same-row,
-- so we also enforce it with a trigger for safety).
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qc_pass_fail') THEN
        CREATE TYPE public.qc_pass_fail AS ENUM ('pass', 'fail');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.packing_qc (
    id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id           uuid          NOT NULL REFERENCES public.factories(id),
    item_id              uuid          NOT NULL REFERENCES public.stores_stock_items(id) ON DELETE RESTRICT,

    po_weight            numeric(12, 3),   -- expected weight per PO spec
    actual_weight        numeric(12, 3),   -- measured weight
    -- actual / po * 100; same-row computation → GENERATED STORED is valid here.
    correlation_percent  numeric(12, 3) GENERATED ALWAYS AS (
        CASE WHEN po_weight IS NOT NULL AND po_weight <> 0 AND actual_weight IS NOT NULL
             THEN (actual_weight / po_weight) * 100
             ELSE NULL END
    ) STORED,

    drop_test_result     public.qc_pass_fail,
    strength_check_result public.qc_pass_fail,
    overall_result       public.qc_pass_fail,

    tested_by            uuid          NOT NULL REFERENCES auth.users(id),
    tested_at            timestamptz   NOT NULL DEFAULT now(),
    remarks              text,

    submitted_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at           timestamptz   NOT NULL DEFAULT now(),
    updated_by           uuid          REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_packing_qc_factory ON public.packing_qc (factory_id);
CREATE INDEX IF NOT EXISTS idx_packing_qc_item    ON public.packing_qc (item_id);

DROP TRIGGER IF EXISTS trg_packing_qc_updated_at ON public.packing_qc;
CREATE TRIGGER trg_packing_qc_updated_at
    BEFORE UPDATE ON public.packing_qc
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_packing_qc ON public.packing_qc;
CREATE TRIGGER trg_audit_packing_qc
    AFTER INSERT OR UPDATE OR DELETE ON public.packing_qc
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ─── RLS: same pattern as other Lab QC tables ─────────────────────────────
ALTER TABLE public.packing_qc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "packing_qc_select" ON public.packing_qc;
DROP POLICY IF EXISTS "packing_qc_insert" ON public.packing_qc;
DROP POLICY IF EXISTS "packing_qc_update" ON public.packing_qc;

CREATE POLICY "packing_qc_select" ON public.packing_qc
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "packing_qc_insert" ON public.packing_qc
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[])
    );

CREATE POLICY "packing_qc_update" ON public.packing_qc
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

GRANT SELECT, INSERT, UPDATE ON public.packing_qc TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.packing_qc TO service_role;

-- ─── Register the new Lab QC activity on both factories ───────────────────
-- A-20/1 (factory 1) and A-20 (factory 2). sort_order placed after existing.
INSERT INTO public.factory_activities (factory_id, module, activity, label, sort_order, is_active)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'lab_qc', 'packing_qc', 'Packing Material QC', 10, true),
    ('00000000-0000-0000-0000-000000000002', 'lab_qc', 'packing_qc', 'Packing Material QC', 10, true)
ON CONFLICT (factory_id, module, activity) DO NOTHING;

-- =============================================================================
-- END 046
-- =============================================================================

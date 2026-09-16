-- =============================================================================
-- A-20 Migration 002: Full schema replacement
--
-- Run AFTER 001_init_a20.sql on the JSCI-A20 Supabase project.
--
-- What this migration does:
--   1. Drops the 4 placeholder tables created in 001 (packing_records,
--      maintenance_records, breakdown_records, production_job_cards stubs)
--   2. Adds jsc_code column to materials (shared with A-20/1 via the same
--      materials master — A-20 has its own materials table in its own project)
--   3. Adds the full Lab QC table set (Module D):
--      materials, products, qc_test_definitions, batches, rm_receipts,
--      rm_qc, hourly_readings, batch_analysis, product_qc,
--      post_production_tests, lab_trials, attachments
--   4. Adds Module A — Production Job Card:
--      product_formula_items, production_job_cards, production_job_card_items
--   5. Adds Module B — Packing Machine Maintenance Checklist:
--      packing_maintenance_items (seeded), packing_maintenance_checklists,
--      packing_maintenance_checklist_entries
--   6. Adds Module C — Packing Machine Breakdown Report:
--      packing_breakdown_reports
--   7. RLS on all new tables
--   8. GRANTs
--   9. Seed data: JSC materials master (73 items), A-20 products,
--      factory_activities, packing maintenance items
--
-- ROLES for A-20:
--   operator     — modules A, B, C (all production + packing forms)
--   chemist      — module D Lab QC (entry)
--   lab_manager  — module D Lab QC (corrections + read)
--   factory_admin / company_admin — all modules
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop placeholder stubs from 001 (they have no data yet)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.packing_records        CASCADE;
DROP TABLE IF EXISTS public.maintenance_records    CASCADE;
DROP TABLE IF EXISTS public.breakdown_records      CASCADE;
DROP TABLE IF EXISTS public.production_job_cards   CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Materials table (new in this project — not copied from A-20/1)
--    Add jsc_code so production_formula_items can reference it.
-- ---------------------------------------------------------------------------
CREATE TABLE public.materials (
    id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text    NOT NULL UNIQUE,  -- e.g. 'JSC-1', 'SULPHUR_SC_RM', etc.
    jsc_code    text    UNIQUE,           -- JSC-1 through JSC-73; NULL for non-JSC materials
    name        text    NOT NULL,
    description text,
    is_active   boolean NOT NULL DEFAULT true
);

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "materials_select" ON public.materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "materials_write"  ON public.materials FOR ALL    TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.materials TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Products table
-- ---------------------------------------------------------------------------
CREATE TABLE public.products (
    id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    code          text    NOT NULL UNIQUE,
    name          text    NOT NULL,
    description   text,
    is_trial_only boolean NOT NULL DEFAULT false,
    is_active     boolean NOT NULL DEFAULT true
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_select" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_write"  ON public.products FOR ALL    TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. QC Test Definitions
-- ---------------------------------------------------------------------------
CREATE TABLE public.qc_test_definitions (
    id            uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id   uuid     REFERENCES public.materials(id) ON DELETE CASCADE,
    product_id    uuid     REFERENCES public.products(id)  ON DELETE CASCADE,
    phase         qc_phase NOT NULL DEFAULT 'none',
    test_key      text     NOT NULL,
    label         text     NOT NULL,
    unit          text,
    input_type    text     NOT NULL DEFAULT 'number',
    options       jsonb,
    formula       text,
    is_calculated boolean  NOT NULL DEFAULT false,
    sort_order    smallint NOT NULL DEFAULT 0,
    is_active     boolean  NOT NULL DEFAULT true,
    CONSTRAINT chk_one_parent CHECK (
        (material_id IS NOT NULL AND product_id IS NULL) OR
        (material_id IS NULL     AND product_id IS NOT NULL)
    ),
    UNIQUE (material_id, product_id, phase, test_key)
);

ALTER TABLE public.qc_test_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qc_defs_select" ON public.qc_test_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "qc_defs_write"  ON public.qc_test_definitions FOR ALL    TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.qc_test_definitions TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Batches (traceability anchor for Lab QC)
-- ---------------------------------------------------------------------------
CREATE TABLE public.batches (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number    text          NOT NULL,
    lot_number      text,
    factory_id      uuid          NOT NULL REFERENCES public.factories(id),
    material_id     uuid          REFERENCES public.materials(id),
    product_id      uuid          REFERENCES public.products(id),
    batch_type      batch_type    NOT NULL,
    production_date date          NOT NULL,
    machine         text,
    quantity        numeric(12,3),
    unit            quantity_unit,
    source_batch_id uuid          REFERENCES public.batches(id),
    created_by      uuid          NOT NULL REFERENCES auth.users(id),
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (batch_number, factory_id)
);
CREATE TRIGGER trg_batches_updated_at BEFORE UPDATE ON public.batches FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_audit_batches AFTER INSERT OR UPDATE OR DELETE ON public.batches FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "batches_select" ON public.batches FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "batches_insert" ON public.batches FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['chemist','operator','production_incharge','factory_admin','company_admin']::app_role[]));
CREATE POLICY "batches_update" ON public.batches FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.batches TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. RM Receipts
-- ---------------------------------------------------------------------------
CREATE TABLE public.rm_receipts (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       uuid          NOT NULL REFERENCES public.batches(id) ON DELETE RESTRICT,
    factory_id     uuid          NOT NULL REFERENCES public.factories(id),
    supplier_name  text          NOT NULL,
    invoice_number text,
    vehicle_number text,
    received_date  date          NOT NULL,
    received_by    uuid          NOT NULL REFERENCES auth.users(id),
    quantity       numeric(12,3) NOT NULL,
    unit           quantity_unit NOT NULL,
    remarks        text,
    created_at     timestamptz   NOT NULL DEFAULT now(),
    updated_at     timestamptz   NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_rm_receipts_updated_at BEFORE UPDATE ON public.rm_receipts FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_audit_rm_receipts AFTER INSERT OR UPDATE OR DELETE ON public.rm_receipts FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.rm_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rm_receipts_select" ON public.rm_receipts FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "rm_receipts_insert" ON public.rm_receipts FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['chemist','operator','factory_admin','company_admin']::app_role[]));
CREATE POLICY "rm_receipts_update" ON public.rm_receipts FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.rm_receipts TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. RM QC
-- ---------------------------------------------------------------------------
CREATE TABLE public.rm_qc (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id     uuid        NOT NULL REFERENCES public.batches(id) ON DELETE RESTRICT,
    factory_id   uuid        NOT NULL REFERENCES public.factories(id),
    material_id  uuid        NOT NULL REFERENCES public.materials(id),
    chemist_id   uuid        NOT NULL REFERENCES auth.users(id),
    test_date    date        NOT NULL,
    appearance   text,
    appearance_ok boolean,
    test_results jsonb       NOT NULL DEFAULT '{}',
    remarks      text,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid        REFERENCES auth.users(id)
);
CREATE TRIGGER trg_rm_qc_updated_at BEFORE UPDATE ON public.rm_qc FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_audit_rm_qc AFTER INSERT OR UPDATE OR DELETE ON public.rm_qc FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.rm_qc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rm_qc_select" ON public.rm_qc FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "rm_qc_insert" ON public.rm_qc FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[]));
CREATE POLICY "rm_qc_update" ON public.rm_qc FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.rm_qc TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Hourly Readings (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.hourly_readings (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id     uuid        NOT NULL REFERENCES public.batches(id) ON DELETE RESTRICT,
    factory_id   uuid        NOT NULL REFERENCES public.factories(id),
    recorded_by  uuid        NOT NULL REFERENCES auth.users(id),
    reading_time timestamptz NOT NULL,
    test_results jsonb       NOT NULL DEFAULT '{}',
    remarks      text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_audit_hourly_readings AFTER INSERT OR UPDATE OR DELETE ON public.hourly_readings FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.hourly_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hourly_select" ON public.hourly_readings FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "hourly_insert" ON public.hourly_readings FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['operator','production_incharge','chemist','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT ON public.hourly_readings TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Batch Analysis
-- ---------------------------------------------------------------------------
CREATE TABLE public.batch_analysis (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id      uuid        NOT NULL UNIQUE REFERENCES public.batches(id) ON DELETE RESTRICT,
    factory_id    uuid        NOT NULL REFERENCES public.factories(id),
    chemist_id    uuid        NOT NULL REFERENCES auth.users(id),
    analysis_date date        NOT NULL,
    appearance    text,
    appearance_ok boolean,
    test_results  jsonb       NOT NULL DEFAULT '{}',
    remarks       text,
    submitted_at  timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    uuid        REFERENCES auth.users(id)
);
CREATE TRIGGER trg_batch_analysis_updated_at BEFORE UPDATE ON public.batch_analysis FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_audit_batch_analysis AFTER INSERT OR UPDATE OR DELETE ON public.batch_analysis FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.batch_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ba_select" ON public.batch_analysis FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "ba_insert" ON public.batch_analysis FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[]));
CREATE POLICY "ba_update" ON public.batch_analysis FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.batch_analysis TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Product QC
-- ---------------------------------------------------------------------------
CREATE TABLE public.product_qc (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       uuid        NOT NULL REFERENCES public.batches(id) ON DELETE RESTRICT,
    factory_id     uuid        NOT NULL REFERENCES public.factories(id),
    product_id     uuid        NOT NULL REFERENCES public.products(id),
    phase          qc_phase    NOT NULL DEFAULT 'none',
    chemist_id     uuid        NOT NULL REFERENCES auth.users(id),
    test_date      date        NOT NULL,
    appearance     text,
    appearance_ok  boolean,
    test_results   jsonb       NOT NULL DEFAULT '{}',
    overall_result text,
    remarks        text,
    submitted_at   timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     uuid        REFERENCES auth.users(id),
    UNIQUE (batch_id, product_id, phase)
);
CREATE TRIGGER trg_product_qc_updated_at BEFORE UPDATE ON public.product_qc FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_audit_product_qc AFTER INSERT OR UPDATE OR DELETE ON public.product_qc FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.product_qc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pqc_select" ON public.product_qc FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "pqc_insert" ON public.product_qc FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[]));
CREATE POLICY "pqc_update" ON public.product_qc FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.product_qc TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. Post Production Tests
-- ---------------------------------------------------------------------------
CREATE TABLE public.post_production_tests (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_qc_id uuid        REFERENCES public.product_qc(id) ON DELETE SET NULL,
    batch_id      uuid        NOT NULL REFERENCES public.batches(id) ON DELETE RESTRICT,
    factory_id    uuid        NOT NULL REFERENCES public.factories(id),
    chemist_id    uuid        NOT NULL REFERENCES auth.users(id),
    test_date     date        NOT NULL,
    test_results  jsonb       NOT NULL DEFAULT '{}',
    remarks       text,
    submitted_at  timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    uuid        REFERENCES auth.users(id)
);
CREATE TRIGGER trg_ppt_updated_at BEFORE UPDATE ON public.post_production_tests FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_audit_ppt AFTER INSERT OR UPDATE OR DELETE ON public.post_production_tests FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.post_production_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ppt_select" ON public.post_production_tests FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "ppt_insert" ON public.post_production_tests FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[]));
CREATE POLICY "ppt_update" ON public.post_production_tests FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.post_production_tests TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. Lab Trials
-- ---------------------------------------------------------------------------
CREATE TABLE public.lab_trials (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id     uuid        REFERENCES public.batches(id) ON DELETE RESTRICT,
    factory_id   uuid        NOT NULL REFERENCES public.factories(id),
    product_id   uuid        REFERENCES public.products(id),
    trial_code   text        NOT NULL,
    trial_date   date        NOT NULL,
    chemist_id   uuid        NOT NULL REFERENCES auth.users(id),
    objective    text,
    appearance   text,
    appearance_ok boolean,
    test_results jsonb       NOT NULL DEFAULT '{}',
    conclusion   text,
    status       text        NOT NULL DEFAULT 'ongoing',
    remarks      text,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid        REFERENCES auth.users(id)
);
CREATE TRIGGER trg_lab_trials_updated_at BEFORE UPDATE ON public.lab_trials FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_audit_lab_trials AFTER INSERT OR UPDATE OR DELETE ON public.lab_trials FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.lab_trials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lt_select" ON public.lab_trials FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "lt_insert" ON public.lab_trials FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[]));
CREATE POLICY "lt_update" ON public.lab_trials FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.lab_trials TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. Attachments
-- ---------------------------------------------------------------------------
CREATE TABLE public.attachments (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type  text        NOT NULL,
    entity_id    uuid        NOT NULL,
    factory_id   uuid        NOT NULL REFERENCES public.factories(id),
    storage_path text        NOT NULL,
    file_name    text        NOT NULL,
    mime_type    text,
    size_bytes   integer,
    uploaded_by  uuid        NOT NULL REFERENCES auth.users(id),
    uploaded_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_entity_type CHECK (
        entity_type IN ('rm_receipt','rm_qc','batch_analysis','product_qc',
                        'post_production_test','lab_trial')
    )
);

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attach_select" ON public.attachments FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "attach_insert" ON public.attachments FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['chemist','operator','lab_manager','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT ON public.attachments TO authenticated;

-- ---------------------------------------------------------------------------
-- MODULE A — Production Job Card
-- ---------------------------------------------------------------------------

-- A.1 Product formula master (recipe)
-- One row per component per product (per phase where applicable).
-- instructed_qty_kg is at reference_batch_size_kg scale.
-- UI scales it to the actual batch_size_kg entered by the operator.
CREATE TABLE public.product_formula_items (
    id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id              uuid          NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    phase                   text,                           -- 'A' | 'B' | NULL (single-phase)
    order_no                integer       NOT NULL,         -- display order within a product+phase
    component_name          text          NOT NULL,
    jsc_code                text,                           -- NULL for 'Water', 'Sulphur', etc.
    instructed_qty_kg       numeric(12,3) NOT NULL,
    reference_batch_size_kg numeric(12,3) NOT NULL,
    UNIQUE (product_id, phase, order_no)
);

ALTER TABLE public.product_formula_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pfi_select" ON public.product_formula_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "pfi_write"  ON public.product_formula_items FOR ALL    TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.product_formula_items TO authenticated;

-- A.2 Production Job Card header (one per production run)
CREATE TABLE public.production_job_cards (
    id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id                  uuid          NOT NULL REFERENCES public.factories(id),
    product_id                  uuid          NOT NULL REFERENCES public.products(id),
    lot_no                      text          NOT NULL,
    job_date                    date          NOT NULL DEFAULT CURRENT_DATE,
    operator_id                 uuid          NOT NULL REFERENCES auth.users(id),
    batch_size_kg               numeric(12,3) NOT NULL,
    -- Phase timing (NULL for single-phase products)
    premix_start                time,
    premix_end                  time,
    bead_mill_start             time,
    bead_mill_end               time,
    flow_rate                   numeric(8,3),
    collected_slurry_phase_a_kg numeric(12,3),
    collected_slurry_phase_b_kg numeric(12,3),
    ph                          numeric(5,2),
    status                      text          NOT NULL DEFAULT 'draft',
    -- 'draft' | 'submitted'
    created_at                  timestamptz   NOT NULL DEFAULT now(),
    updated_at                  timestamptz   NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_pjc_updated_at BEFORE UPDATE ON public.production_job_cards FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_audit_pjc AFTER INSERT OR UPDATE OR DELETE ON public.production_job_cards FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.production_job_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pjc_select" ON public.production_job_cards FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "pjc_insert" ON public.production_job_cards FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[]));
CREATE POLICY "pjc_update" ON public.production_job_cards FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.production_job_cards TO authenticated;

-- A.3 Production Job Card line items (actuals per formula component)
CREATE TABLE public.production_job_card_items (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    job_card_id       uuid          NOT NULL REFERENCES public.production_job_cards(id) ON DELETE CASCADE,
    formula_item_id   uuid          NOT NULL REFERENCES public.product_formula_items(id),
    -- Instructed qty scaled to this run's batch_size_kg (copied from formula at save time)
    instructed_qty_kg numeric(12,3) NOT NULL,
    added_qty_kg      numeric(12,3),
    rm_batch_no       text,
    drum_bag_no       text,
    remark            text,
    UNIQUE (job_card_id, formula_item_id)
);

ALTER TABLE public.production_job_card_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pjci_select" ON public.production_job_card_items FOR SELECT TO authenticated
    USING (job_card_id IN (SELECT id FROM public.production_job_cards WHERE factory_id IN (SELECT fn_user_factory_ids())));
CREATE POLICY "pjci_insert" ON public.production_job_card_items FOR INSERT TO authenticated
    WITH CHECK (
        fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[])
        AND job_card_id IN (SELECT id FROM public.production_job_cards WHERE factory_id IN (SELECT fn_user_factory_ids()))
    );
CREATE POLICY "pjci_update" ON public.production_job_card_items FOR UPDATE TO authenticated
    USING (
        fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[])
        AND job_card_id IN (SELECT id FROM public.production_job_cards WHERE factory_id IN (SELECT fn_user_factory_ids()))
    );
GRANT SELECT, INSERT, UPDATE ON public.production_job_card_items TO authenticated;

-- ---------------------------------------------------------------------------
-- MODULE B — Packing Machine Maintenance Checklist
-- ---------------------------------------------------------------------------

-- B.1 Master checklist items (seeded below)
CREATE TABLE public.packing_maintenance_items (
    id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id   uuid    NOT NULL REFERENCES public.factories(id),
    sr_no        integer NOT NULL,
    machine_name text    NOT NULL,
    machine_part text    NOT NULL,
    UNIQUE (factory_id, sr_no)
);

ALTER TABLE public.packing_maintenance_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pmi_select" ON public.packing_maintenance_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "pmi_write"  ON public.packing_maintenance_items FOR ALL    TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.packing_maintenance_items TO authenticated;

-- B.2 Checklist header (one per date filled)
CREATE TABLE public.packing_maintenance_checklists (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id                  uuid        NOT NULL REFERENCES public.factories(id),
    checklist_date              date        NOT NULL DEFAULT CURRENT_DATE,
    operator_sign               uuid        NOT NULL REFERENCES auth.users(id),
    maintenance_engineer_sign   text,
    production_manager_sign     text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (factory_id, checklist_date)   -- one checklist per factory per day
);

ALTER TABLE public.packing_maintenance_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pmc_select" ON public.packing_maintenance_checklists FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "pmc_insert" ON public.packing_maintenance_checklists FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[]));
CREATE POLICY "pmc_update" ON public.packing_maintenance_checklists FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.packing_maintenance_checklists TO authenticated;

-- B.3 Checklist entries (one row per item per checklist)
CREATE TABLE public.packing_maintenance_checklist_entries (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id uuid NOT NULL REFERENCES public.packing_maintenance_checklists(id) ON DELETE CASCADE,
    item_id      uuid NOT NULL REFERENCES public.packing_maintenance_items(id),
    status       text,    -- 'do' | 'do_not' | NULL (not yet filled)
    remark       text,
    UNIQUE (checklist_id, item_id)
);

ALTER TABLE public.packing_maintenance_checklist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pmce_select" ON public.packing_maintenance_checklist_entries FOR SELECT TO authenticated
    USING (checklist_id IN (SELECT id FROM public.packing_maintenance_checklists WHERE factory_id IN (SELECT fn_user_factory_ids())));
CREATE POLICY "pmce_insert" ON public.packing_maintenance_checklist_entries FOR INSERT TO authenticated
    WITH CHECK (
        fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[])
        AND checklist_id IN (SELECT id FROM public.packing_maintenance_checklists WHERE factory_id IN (SELECT fn_user_factory_ids()))
    );
CREATE POLICY "pmce_update" ON public.packing_maintenance_checklist_entries FOR UPDATE TO authenticated
    USING (
        fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[])
        AND checklist_id IN (SELECT id FROM public.packing_maintenance_checklists WHERE factory_id IN (SELECT fn_user_factory_ids()))
    );
GRANT SELECT, INSERT, UPDATE ON public.packing_maintenance_checklist_entries TO authenticated;

-- ---------------------------------------------------------------------------
-- MODULE C — Packing Machine Breakdown Report
-- ---------------------------------------------------------------------------
CREATE TABLE public.packing_breakdown_reports (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id                  uuid        NOT NULL REFERENCES public.factories(id),

    -- Header
    document_no                 text,
    machine_code                text,
    machine_name                text        NOT NULL,
    department                  text        NOT NULL DEFAULT 'Packing',
    reporting_date              date        NOT NULL DEFAULT CURRENT_DATE,
    reporting_time              time,

    -- Problem
    problem_reported            text,
    nature_of_fault             text[]      NOT NULL DEFAULT '{}',
    -- e.g. '{electrical, mechanical}' — values: electrical/mechanical/hydraulic/pneumatic
    attended_by                 text,

    -- Details
    fault_details               text,
    root_cause                  text,
    action_taken                text,
    cause_of_delay              text,
    spare_parts_consumed        text,
    quantity_specification      text,

    -- Handover
    handed_over_date            date,
    handed_over_time            time,

    -- Signatures
    production_supervisor_sign  text,
    production_manager_sign     text,
    maintenance_engineer_sign   text,
    maintenance_head_sign       text,

    -- Production remarks
    production_remarks          text,

    created_by                  uuid        NOT NULL REFERENCES auth.users(id),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_pbr_updated_at BEFORE UPDATE ON public.packing_breakdown_reports FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_audit_pbr AFTER INSERT OR UPDATE OR DELETE ON public.packing_breakdown_reports FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE public.packing_breakdown_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pbr_select" ON public.packing_breakdown_reports FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "pbr_insert" ON public.packing_breakdown_reports FOR INSERT TO authenticated
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[]));
CREATE POLICY "pbr_update" ON public.packing_breakdown_reports FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[]));
GRANT SELECT, INSERT, UPDATE ON public.packing_breakdown_reports TO authenticated;

-- Grant sequences
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ---------------------------------------------------------------------------
-- SEED DATA
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    fid uuid;
    n   integer;
BEGIN
    SELECT id INTO fid FROM public.factories WHERE code = 'DBV_20_2';
    IF fid IS NULL THEN
        RAISE EXCEPTION 'Factory DBV_20_2 not found — run 001_init_a20.sql first';
    END IF;

    -- -----------------------------------------------------------------------
    -- Materials master (JSC code list — 73 items from JSC LIST sheet)
    -- -----------------------------------------------------------------------
    INSERT INTO public.materials (code, jsc_code, name, is_active) VALUES
        ('JSC-1',  'JSC-1',  'SAPCOMER LSC',                           true),
        ('JSC-2',  'JSC-2',  'SPACOMER DN',                            true),
        ('JSC-3',  'JSC-3',  'SPACOMER HR',                            true),
        ('JSC-4',  'JSC-4',  'DISPERSING AGENT LSC',                   true),
        ('JSC-5',  'JSC-5',  'CHEM CF SALT',                           true),
        ('JSC-6',  'JSC-6',  'K.GUM',                                  true),
        ('JSC-7',  'JSC-7',  'SOPROPHOR LIQUID',                       true),
        ('JSC-8',  'JSC-8',  'BETON POWDER',                           true),
        ('JSC-9',  'JSC-9',  'O. GUM',                                 true),
        ('JSC-10', 'JSC-10', 'UFXONE 3A',                              true),
        ('JSC-11', 'JSC-11', 'PVPK 15',                                true),
        ('JSC-12', 'JSC-12', 'PVA',                                    true),
        ('JSC-13', 'JSC-13', 'AMONIUM BI CARBONATE',                   true),
        ('JSC-14', 'JSC-14', 'PVPK 30',                                true),
        ('JSC-15', 'JSC-15', 'PVA 173',                                true),
        ('JSC-16', 'JSC-16', 'KOVEL',                                  true),
        ('JSC-17', 'JSC-17', 'SILICA 25 KGS MFILL 100 (Madhu silica)', true),
        ('JSC-18', 'JSC-18', 'SILICA 20 KGS NK4 (MLA industries)',      true),
        ('JSC-19', 'JSC-19', 'DISPERSOL BB4',                          true),
        ('JSC-20', 'JSC-20', 'DISPERSOL PSR 19',                       true),
        ('JSC-21', 'JSC-21', 'UREA',                                   true),
        ('JSC-22', 'JSC-22', 'SPECTRUN DN',                            true),
        ('JSC-23', 'JSC-23', 'SPECTRUM D 400',                         true),
        ('JSC-24', 'JSC-24', 'ATLOX 4913 LQ',                          true),
        ('JSC-25', 'JSC-25', 'CRIL BSD',                               true),
        ('JSC-26', 'JSC-26', 'ATLOX 1210',                             true),
        ('JSC-27', 'JSC-27', 'TERSPERSE 2105',                         true),
        ('JSC-28', 'JSC-28', 'METCORP DRUM',                           true),
        ('JSC-29', 'JSC-29', 'SODIUM CITRATE',                         true),
        ('JSC-30', 'JSC-30', 'Morwet D-425 Powder',                    true),
        ('JSC-31', 'JSC-31', 'ATLOX 4894',                             true),
        ('JSC-32', 'JSC-32', 'ATLOX Metasperse 550',                   true),
        ('JSC-33', 'JSC-33', 'Precipited Silica',                      true),
        ('JSC-34', 'JSC-34', 'Sodium slat Napthalone',                 true),
        ('JSC-35', 'JSC-35', 'Amonlum Sulphate',                       true),
        ('JSC-36', 'JSC-36', 'Ployfon H',                              true),
        ('JSC-37', 'JSC-37', 'K GUM 0.2%',                             true),
        ('JSC-38', 'JSC-38', 'Domsjo + JSC22 50:50',                   true),
        ('JSC-39', 'JSC-39', 'Domsjo 375 KG + JSC22 125 KG',           true),
        ('JSC-40', 'JSC-40', 'DOMSJO 30 KGS + K S PLUS 15 KGS',       true),
        ('JSC-41', 'JSC-41', 'TEBUCONAZOLE',                           true),
        ('JSC-42', 'JSC-42', 'PROXEL 26.3 KG + MEG 262.5 KG',         true),
        ('JSC-43', 'JSC-43', 'RM OF ZIDDI DF',                         true),
        ('JSC-44', 'JSC-44', 'GUIMOL DN LIQUID',                       true),
        ('JSC-45', 'JSC-45', 'RESIL (DEFOMER)',                        true),
        ('JSC-46', 'JSC-46', 'ZIDDI OVER SIZE MATERIAL',               true),
        ('JSC-47', 'JSC-47', 'JSC 22 & GREENSPERSE',                   true),
        ('JSC-48', 'JSC-48', 'RM OF WDG',                              true),
        ('JSC-49', 'JSC-49', 'SODIUM LYRAL SULPHATE',                  true),
        ('JSC-50', 'JSC-50', 'RM OF WDG',                              true),
        ('JSC-51', 'JSC-51', 'KELZAN S PLUS',                          true),
        ('JSC-52', 'JSC-52', 'MONOETHYLENE GLYCOL',                    true),
        ('JSC-53', 'JSC-53', 'PROXEL',                                 true),
        ('JSC-54', 'JSC-54', 'HIMPERSE 0403 FF 20 KG BAG',             true),
        ('JSC-55', 'JSC-55', 'HIMPERSE 1004 25 KG BAG',                true),
        ('JSC-56', 'JSC-56', 'UNTOP CS 250 25 KG BAG',                 true),
        ('JSC-57', 'JSC-57', 'UNTOP FL 200 KG DRUM',                   true),
        ('JSC-58', 'JSC-58', 'TERSPERSE 2700',                         true),
        ('JSC-59', 'JSC-59', 'SODIUM CMC :DVP600-1000 cps',            true),
        ('JSC-60', 'JSC-60', 'SODIUM CMC : HVP 200-500 cps',           true),
        ('JSC-61', 'JSC-61', 'MORWET EFW 18.14 KG BAG',                true),
        ('JSC-62', 'JSC-62', 'TERWET - 1110 205 KG DRUM',              true),
        ('JSC-63', 'JSC-63', 'GEROPON T 36 25 KG BAG',                 true),
        ('JSC-64', 'JSC-64', 'BRILLIANT BLUE',                         true),
        ('JSC-65', 'JSC-65', 'CARMOSINE',                              true),
        ('JSC-66', 'JSC-66', 'SUNSET YELLOW',                          true),
        ('JSC-67', 'JSC-67', 'TARTRAZINE',                             true),
        ('JSC-68', 'JSC-68', 'ATLOX PN 100',                           true),
        ('JSC-69', 'JSC-69', 'CAPS BUFFER',                            true),
        ('JSC-70', 'JSC-70', 'Quinoline Yellow',                       true),
        ('JSC-71', 'JSC-71', 'Aqniue 8105/TETRON',                     true),
        ('JSC-72', 'JSC-72', 'Sodium Molybdate',                       true),
        ('JSC-73', 'JSC-73', 'Monoethanolamine',                       true)
    ON CONFLICT (code) DO NOTHING;

    -- Non-JSC raw materials used in formulas (Water, Sulphur etc. have no JSC code)
    INSERT INTO public.materials (code, jsc_code, name, is_active) VALUES
        ('WATER',        NULL, 'Water',           true),
        ('SULPHUR_RM',   NULL, 'Sulphur',          true),
        ('TEBU_RM',      NULL, 'Tebuconazole TC',  true)
    ON CONFLICT (code) DO NOTHING;

    -- -----------------------------------------------------------------------
    -- A-20 Products
    -- -----------------------------------------------------------------------
    INSERT INTO public.products (code, name, description, is_trial_only, is_active) VALUES
        ('SULPHUR_SC_UPL', 'Sulphur SC UPL Grade',         NULL, false, true),
        ('KELZAN_PLUS',     'Kelzan Plus 1.4% Solution',    NULL, false, true),
        ('NUTRIZIN',        'Nutrizin',                     NULL, false, true),
        ('INSTACAL',        'Instacal',                     NULL, false, true),
        ('INSTABORE',       'Instabore',                    NULL, false, true),
        ('K_GUM',           'K Gum',                        NULL, false, true)
    ON CONFLICT (code) DO NOTHING;

    -- -----------------------------------------------------------------------
    -- Packing Maintenance Items (Module B seed)
    -- Machine → Part list from the form spec
    -- -----------------------------------------------------------------------
    n := 0;

    -- 1. All Storage Tank
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'All Storage Tank','Bottom Valve');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'All Storage Tank','Leakage Point');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'All Storage Tank','Line up pipe');

    -- 2. Distribution Panel
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Distribution Panel','Phase Checkup');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Distribution Panel','VFD');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Distribution Panel','ON/Off Switch');

    -- 3. Turning Table
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Turning Table','Panel Button');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Turning Table','Gear Oiling');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Turning Table','Motor Cleaning');

    -- 4. Filling Machine
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Filling Machine','Panel Button');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Filling Machine','Bottle Conveyer');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Filling Machine','Gear Box Motor');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Filling Machine','Nozzle Stopper Greasing');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Filling Machine','Gear Greasing');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Filling Machine','Shaft Housing Bearing');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Filling Machine','Gear L/N Key Tightening');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Filling Machine','Nozzle Stopper Chain Greasing');

    -- 5. Capping Machine
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Capping Machine','Panel Button');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Capping Machine','Bottle Conveyer');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Capping Machine','Gear Greasing');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Capping Machine','Cap Tightening Rubber Checking');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Capping Machine','Bottle Tightening Up/Down Shaft Oiling');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Capping Machine','All Motors Cleaning');

    -- 6. Sealing Machine
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Sealing Machine','Conveyer VFD');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Sealing Machine','Clean Filters');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Sealing Machine','Safety Guards');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Sealing Machine','Cooling System');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Sealing Machine','Radiator Or Fans');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Sealing Machine','Water Tank');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Sealing Machine','Motors');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Sealing Machine','Water Flow Pipes');

    -- 7. Labeller Machine
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Labeller Machine','Spacer Motor');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Labeller Machine','Label Belt Motor');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Labeller Machine','Conveyer Motor');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Labeller Machine','VFD Check Up');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Labeller Machine','Servo Motor');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Labeller Machine','Butter Paper Rolling Belt');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Labeller Machine','Label Dispenser Belt');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Labeller Machine','Hand Wheel');

    -- 8. Printer
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Printer','Make Up Level');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Printer','Ink Level');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Printer','Makeup/Ink Tank Pipe');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Printer','Nozzle Pipe');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Printer','Nozzle Head');

    -- 9. Heat Shrink Packing Machine
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Heat Shrink Packing Machine','VFD (Conveyer)');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Heat Shrink Packing Machine','Blower Motor/Fan');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Heat Shrink Packing Machine','Conveyer Motor');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Heat Shrink Packing Machine','Heating Coil');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Heat Shrink Packing Machine','Conveyer Chain');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Heat Shrink Packing Machine','Conveyer Rod');

    -- 10. Pneumatic Compressor
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Pneumatic Compressor','Intake Vents');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Pneumatic Compressor','Air Filter');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Pneumatic Compressor','Pipe Blockage');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Pneumatic Compressor','Compressor Condensation');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Pneumatic Compressor','Check Oil Filter');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Pneumatic Compressor','Inspect Belt');
    n := n + 1; INSERT INTO public.packing_maintenance_items(factory_id,sr_no,machine_name,machine_part) VALUES(fid,n,'Pneumatic Compressor','Motor Bearing');

    RAISE NOTICE 'Seeded % packing maintenance items for factory %', n, fid;

    -- -----------------------------------------------------------------------
    -- factory_activities for A-20 (operator modules A/B/C + lab QC D)
    -- -----------------------------------------------------------------------
    INSERT INTO public.factory_activities (factory_id, module, activity, label, sort_order, is_active) VALUES
        -- job_card module (operator: production job card, packing maintenance, packing breakdown)
        (fid, 'job_card', 'production_job_card',   'Production Job Card',               1, true),
        (fid, 'job_card', 'packing_maintenance',   'Packing Maintenance Checklist',     2, true),
        (fid, 'job_card', 'packing_breakdown',     'Packing Machine Breakdown Report',  3, true),
        -- lab_qc module (chemist/lab_manager — same activities as A-20/1)
        (fid, 'lab_qc',  'rm_receipt',             'Raw Material Receipt',              1, true),
        (fid, 'lab_qc',  'rm_qc',                  'Raw Material QC',                  2, true),
        (fid, 'lab_qc',  'batch_analysis',         'Batch Analysis',                   3, true),
        (fid, 'lab_qc',  'product_qc',             'Product QC',                       4, true),
        (fid, 'lab_qc',  'post_production',        'Post Production Tests',            5, true),
        (fid, 'lab_qc',  'lab_trial',              'Lab Trials',                       6, true)
    ON CONFLICT (factory_id, module, activity) DO NOTHING;

END;
$$;

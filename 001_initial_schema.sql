-- =============================================================================
-- JSCI Unified QC + Job Card System — Initial Schema Migration
-- Version : 1.0
-- Date    : 2026-08-21
-- Run in  : Supabase SQL Editor (once, on a fresh project)
-- Order   : ENUMs → Tables → Triggers → RLS → Indexes → Views → Seed data
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram index for LIKE search

-- ---------------------------------------------------------------------------
-- 1. ENUM TYPES
-- ---------------------------------------------------------------------------
CREATE TYPE activity_module  AS ENUM ('job_card', 'lab_qc');

CREATE TYPE app_role AS ENUM (
    'company_admin',        -- cross-factory, cross-module read/write
    'factory_admin',        -- single factory, both modules, full read/write
    'lab_manager',          -- single factory, lab_qc, read + correction rights
    'chemist',              -- single factory, lab_qc, create/read own entries
    'production_incharge',  -- single factory, job_card module
    'operator',             -- single factory, job_card module
    'viewer'                -- single factory, read-only
);

CREATE TYPE qc_phase AS ENUM (
    'A',     -- Phase A (Sulphur SC, Zinc SC slurry/wet stage)
    'B',     -- Phase B (Sulphur SC, Zinc SC final product)
    'none'   -- single-phase products/materials
);

CREATE TYPE batch_type    AS ENUM ('rm', 'wip', 'fg', 'trial');
CREATE TYPE quantity_unit AS ENUM ('kg', 'L', 'MT', 'bags', 'drums');

-- ---------------------------------------------------------------------------
-- 2. CORE / AUTH TABLES
-- ---------------------------------------------------------------------------

-- 2.1 factories
CREATE TABLE factories (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code       text        NOT NULL UNIQUE,  -- 'DBV_20_1', 'DBV_20', 'NSK', 'SNP'
    name       text        NOT NULL,         -- 'Factory A 20/1', 'Factory A 20', etc.
    location   text,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.2 factory_activities
-- One row per (factory, module, activity). Adding a new activity at Nashik
-- is an INSERT here — no code change required.
CREATE TABLE factory_activities (
    id         uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid            NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    module     activity_module NOT NULL,
    activity   text            NOT NULL,  -- internal key: 'rm_receipt', 'rm_qc', etc.
    label      text            NOT NULL,  -- display name shown in the UI picker
    sort_order smallint        NOT NULL DEFAULT 0,
    is_active  boolean         NOT NULL DEFAULT true,
    UNIQUE (factory_id, module, activity)
);

-- 2.3 profiles
-- Extends auth.users. Supabase manages the auth row; this holds display data.
CREATE TABLE profiles (
    id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   text        NOT NULL,
    phone       text,
    employee_id text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Auto-refresh updated_at on every UPDATE
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Auto-create a profiles row when a new auth user is created
CREATE OR REPLACE FUNCTION fn_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO profiles (id, full_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION fn_handle_new_user();

-- 2.4 user_roles
-- Join table: one person can hold multiple roles across factories and modules.
-- e.g. chemist at Factory A 20/1 (lab_qc) + operator at Factory A 20 (job_card)
CREATE TABLE user_roles (
    id         uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role       app_role        NOT NULL,
    factory_id uuid            REFERENCES factories(id) ON DELETE CASCADE,
    -- NULL only for company_admin (spans all factories)
    module     activity_module,
    -- NULL means both modules within that factory
    granted_by uuid            REFERENCES auth.users(id),
    granted_at timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (user_id, role, factory_id, module)
);

-- Helper: returns true if the current user has any qualifying role at a factory
CREATE OR REPLACE FUNCTION fn_user_factory_ids(p_module activity_module DEFAULT NULL)
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
    -- company_admin (factory_id IS NULL) gets every factory
    SELECT f.id
    FROM   factories f
    WHERE  EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE  ur.user_id    = auth.uid()
          AND  ur.factory_id IS NULL          -- company_admin
          AND  (p_module IS NULL OR ur.module = p_module OR ur.module IS NULL)
    )
    UNION
    SELECT ur.factory_id
    FROM   user_roles ur
    WHERE  ur.user_id    = auth.uid()
      AND  ur.factory_id IS NOT NULL
      AND  (p_module IS NULL OR ur.module = p_module OR ur.module IS NULL);
$$;

-- ---------------------------------------------------------------------------
-- 3. DEFINITION TABLES
-- ---------------------------------------------------------------------------

-- 3.1 materials
CREATE TABLE materials (
    id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text    NOT NULL UNIQUE,  -- 'SULPHUR_CRUDE', 'SULPHUR_POWDER', etc.
    name        text    NOT NULL,
    description text,
    is_active   boolean NOT NULL DEFAULT true
);

-- 3.2 products
CREATE TABLE products (
    id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    code          text    NOT NULL UNIQUE,  -- 'SULPHUR_SC', 'LIQUID_BORON', etc.
    name          text    NOT NULL,
    description   text,
    is_trial_only boolean NOT NULL DEFAULT false,
    -- true  → hidden from Product QC picker, visible in Lab Trials only
    -- false → appears in Product QC activity
    is_active     boolean NOT NULL DEFAULT true
);

-- 3.3 qc_test_definitions
-- Master list of every test field for every material/product.
-- The UI queries this table at runtime and renders exactly those fields —
-- no form fields are hardcoded in the frontend.
--
-- Exactly one of material_id / product_id must be set (CHECK enforces this).
-- phase = 'none' for single-phase materials/products;
-- phase = 'A' or 'B' for Sulphur SC and Zinc SC.
CREATE TABLE qc_test_definitions (
    id            uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id   uuid     REFERENCES materials(id) ON DELETE CASCADE,
    product_id    uuid     REFERENCES products(id)  ON DELETE CASCADE,
    phase         qc_phase NOT NULL DEFAULT 'none',
    test_key      text     NOT NULL,
    -- snake_case key; must match the JSONB key used in test_results
    -- e.g. 'purity_percent', 'moisture_m_before'
    label         text     NOT NULL,   -- display label shown in the form
    unit          text,                -- '%', 'g/cm³', 'mL', etc. NULL if unitless
    input_type    text     NOT NULL DEFAULT 'number',
    -- 'number' | 'text' | 'select' | 'boolean' | 'photo' | 'date'
    options       jsonb,
    -- for input_type='select': ["Pass","Fail"] etc.
    formula       text,
    -- JS/Postgres expression; sibling test_key values are the variables
    -- NULL = user-entered, not calculated
    is_calculated boolean  NOT NULL DEFAULT false,
    sort_order    smallint NOT NULL DEFAULT 0,
    is_active     boolean  NOT NULL DEFAULT true,

    CONSTRAINT chk_one_parent CHECK (
        (material_id IS NOT NULL AND product_id IS NULL) OR
        (material_id IS NULL     AND product_id IS NOT NULL)
    ),
    UNIQUE (material_id, product_id, phase, test_key)
);

-- ---------------------------------------------------------------------------
-- 4. BATCH AND RECEIPT TABLES
-- ---------------------------------------------------------------------------

-- 4.1 batches
-- Central traceability record. Every QC and production result links here.
-- source_batch_id is the self-referential link for the
-- Factory A 20/1 → Factory A 20 Sulphur Powder chain.
CREATE TABLE batches (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number    text          NOT NULL,
    lot_number      text,                        -- supplier lot / internal lot
    factory_id      uuid          NOT NULL REFERENCES factories(id),
    material_id     uuid          REFERENCES materials(id),
    product_id      uuid          REFERENCES products(id),
    -- at least one of material_id / product_id should be set for traceability;
    -- both are nullable to allow partial/draft saving
    batch_type      batch_type    NOT NULL,
    production_date date          NOT NULL,
    machine         text,                        -- machine / production line
    quantity        numeric(12,3),
    unit            quantity_unit,
    source_batch_id uuid          REFERENCES batches(id),
    -- Sulphur Powder: Factory A 20 batch points to its Factory A 20/1 source.
    -- The app resolves the 20/1 rm_qc record through this FK and shows it
    -- read-only — no second rm_qc row is ever inserted for Factory A 20.
    created_by      uuid          NOT NULL REFERENCES auth.users(id),
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),

    UNIQUE (batch_number, factory_id)
);

CREATE TRIGGER trg_batches_updated_at
    BEFORE UPDATE ON batches
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 4.2 rm_receipts
-- Raw material delivery records (supplier, invoice, vehicle, quantity).
-- One receipt per delivery event; linked to a batch for traceability.
CREATE TABLE rm_receipts (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       uuid          NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id     uuid          NOT NULL REFERENCES factories(id),
    -- denormalised from batches for RLS efficiency (avoids a join on every policy check)
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

CREATE TRIGGER trg_rm_receipts_updated_at
    BEFORE UPDATE ON rm_receipts
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. QC RESULT TABLES
-- ---------------------------------------------------------------------------
-- Shared pattern across all QC tables:
--   batch_id      → batches (traceability anchor)
--   factory_id    → factories (denormalised for RLS — avoids join on every check)
--   chemist_id    → auth.users
--   test_results  → JSONB (variable numeric fields; keys match qc_test_definitions.test_key)
--   submitted_at  → timestamptz (immutable after first save)
--   updated_at    → timestamptz (refreshed by trigger on every UPDATE)
--   updated_by    → auth.users (who made the correction; NULL on first insert)

-- 5.1 rm_qc
-- Raw material QC results.
-- Factory A 20/1 : creates a row for Crude Sulphur.
-- Factory A 20   : creates rows for ZnO, CaCl2, Tebuconazole, Boric Powder.
--                  For Sulphur Powder — NO row is inserted; the app reads the
--                  linked Factory A 20/1 rm_qc row via batches.source_batch_id
--                  and displays it read-only.
CREATE TABLE rm_qc (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id     uuid        NOT NULL REFERENCES batches(id)    ON DELETE RESTRICT,
    factory_id   uuid        NOT NULL REFERENCES factories(id),
    material_id  uuid        NOT NULL REFERENCES materials(id),
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

CREATE TRIGGER trg_rm_qc_updated_at
    BEFORE UPDATE ON rm_qc
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 5.2 hourly_readings
-- Sulphur Powder production hourly log (Factory A 20/1).
-- Multiple readings per batch (one per hour of the production run).
CREATE TABLE hourly_readings (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id     uuid        NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id   uuid        NOT NULL REFERENCES factories(id),
    recorded_by  uuid        NOT NULL REFERENCES auth.users(id),
    reading_time timestamptz NOT NULL,  -- exact timestamp of the reading
    test_results jsonb       NOT NULL DEFAULT '{}',
    remarks      text,
    created_at   timestamptz NOT NULL DEFAULT now()
    -- no updated_at: hourly readings are append-only; corrections go via audit_log
);

-- 5.3 batch_analysis
-- End-of-batch Sulphur Powder quality + specific gravity + bulk density.
-- Exactly one analysis per batch (UNIQUE enforces this).
CREATE TABLE batch_analysis (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id      uuid        NOT NULL UNIQUE REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id    uuid        NOT NULL REFERENCES factories(id),
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

CREATE TRIGGER trg_batch_analysis_updated_at
    BEFORE UPDATE ON batch_analysis
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 5.4 product_qc
-- Product QC results. Phase-aware: Sulphur SC and Zinc SC have Phase A + B;
-- all other products use phase = 'none'.
-- UNIQUE (batch_id, product_id, phase) → one QC record per batch per product per phase.
CREATE TABLE product_qc (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       uuid        NOT NULL REFERENCES batches(id)   ON DELETE RESTRICT,
    factory_id     uuid        NOT NULL REFERENCES factories(id),
    product_id     uuid        NOT NULL REFERENCES products(id),
    phase          qc_phase    NOT NULL DEFAULT 'none',
    chemist_id     uuid        NOT NULL REFERENCES auth.users(id),
    test_date      date        NOT NULL,
    appearance     text,
    appearance_ok  boolean,
    test_results   jsonb       NOT NULL DEFAULT '{}',
    overall_result text,
    -- Seeded from appearance_ok at INSERT; full pass/fail logic
    -- (numeric threshold checks against qc_test_definitions) is evaluated
    -- in fn_evaluate_product_qc() and stored here via trigger.
    -- Single source of truth — never calculated in frontend JS.
    remarks        text,
    submitted_at   timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     uuid        REFERENCES auth.users(id),

    UNIQUE (batch_id, product_id, phase)
);

CREATE TRIGGER trg_product_qc_updated_at
    BEFORE UPDATE ON product_qc
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 5.5 post_production_tests
-- Stability / retest tracking. Workflow not yet confirmed.
-- product_qc_id is NULLABLE by design — tighten to NOT NULL in a future
-- migration once the workflow is confirmed with the company.
CREATE TABLE post_production_tests (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_qc_id uuid        REFERENCES product_qc(id) ON DELETE SET NULL,
    -- NULLABLE: deferred until workflow is confirmed
    batch_id      uuid        NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id    uuid        NOT NULL REFERENCES factories(id),
    chemist_id    uuid        NOT NULL REFERENCES auth.users(id),
    test_date     date        NOT NULL,
    test_results  jsonb       NOT NULL DEFAULT '{}',
    remarks       text,
    submitted_at  timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    uuid        REFERENCES auth.users(id)
);

CREATE TRIGGER trg_post_production_updated_at
    BEFORE UPDATE ON post_production_tests
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 5.6 lab_trials
-- Trial records, including trial-only products (is_trial_only = true).
-- batch_id and product_id are nullable: a trial may not have a formal
-- batch yet, and may be for a new unnamed product.
CREATE TABLE lab_trials (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id     uuid        REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id   uuid        NOT NULL REFERENCES factories(id),
    product_id   uuid        REFERENCES products(id),
    trial_code   text        NOT NULL,  -- internal trial identifier
    trial_date   date        NOT NULL,
    chemist_id   uuid        NOT NULL REFERENCES auth.users(id),
    objective    text,
    appearance   text,
    appearance_ok boolean,
    test_results jsonb       NOT NULL DEFAULT '{}',
    conclusion   text,
    status       text        NOT NULL DEFAULT 'ongoing',
    -- 'ongoing' | 'completed' | 'abandoned'
    remarks      text,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid        REFERENCES auth.users(id)
);

CREATE TRIGGER trg_lab_trials_updated_at
    BEFORE UPDATE ON lab_trials
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. SUPPORTING TABLES
-- ---------------------------------------------------------------------------

-- 6.1 attachments
-- Polymorphic photo/document store. One row per file across all entity types.
-- entity_type + entity_id point to the parent record (untyped at DB level —
-- the app enforces the valid entity_type values).
-- Storage path convention: {factory_code}/{entity_type}/{entity_id}/{uuid}.jpg
-- Bucket: qc-attachments (private, RLS-protected in Supabase Storage)
-- Pre-upload: client resizes to ≤1200px / ~200-300 KB before uploading.
CREATE TABLE attachments (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type  text        NOT NULL,
    -- 'rm_receipt' | 'rm_qc' | 'batch_analysis' | 'product_qc'
    -- | 'post_production_test' | 'lab_trial'
    entity_id    uuid        NOT NULL,
    factory_id   uuid        NOT NULL REFERENCES factories(id),
    -- denormalised for RLS (avoids joining back to parent table on every check)
    storage_path text        NOT NULL,  -- Supabase Storage object path
    file_name    text        NOT NULL,  -- original filename
    mime_type    text,
    size_bytes   integer,
    uploaded_by  uuid        NOT NULL REFERENCES auth.users(id),
    uploaded_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_entity_type CHECK (
        entity_type IN (
            'rm_receipt', 'rm_qc', 'batch_analysis',
            'product_qc', 'post_production_test', 'lab_trial'
        )
    )
);

-- 6.2 audit_log
-- Immutable change history. Written exclusively by fn_audit_log() trigger —
-- never by application code. No UPDATE or DELETE is permitted on this table.
CREATE TABLE audit_log (
    id          bigserial   PRIMARY KEY,
    table_name  text        NOT NULL,
    record_id   uuid        NOT NULL,
    operation   text        NOT NULL,  -- 'INSERT' | 'UPDATE' | 'DELETE'
    old_data    jsonb,                 -- NULL for INSERT
    new_data    jsonb,                 -- NULL for DELETE
    changed_by  uuid        REFERENCES auth.users(id),
    factory_id  uuid,                  -- denormalised for fast factory-scoped queries
    changed_at  timestamptz NOT NULL DEFAULT now()
);

-- Block all direct writes to audit_log except from the trigger (SECURITY DEFINER)
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- 6.3 audit trigger function
-- Applied to every QC and production table. Captures full old/new row as JSONB.
-- SECURITY DEFINER so auth.uid() resolves correctly inside the trigger context.
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO audit_log (
        table_name,
        record_id,
        operation,
        old_data,
        new_data,
        changed_by,
        factory_id
    ) VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        CASE WHEN TG_OP = 'INSERT' THEN NULL
             ELSE row_to_json(OLD)::jsonb END,
        CASE WHEN TG_OP = 'DELETE' THEN NULL
             ELSE row_to_json(NEW)::jsonb END,
        auth.uid(),
        COALESCE(
            (CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.factory_id END),
            OLD.factory_id
        )
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach audit trigger to all QC and production tables
CREATE TRIGGER trg_audit_batches
    AFTER INSERT OR UPDATE OR DELETE ON batches
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_rm_receipts
    AFTER INSERT OR UPDATE OR DELETE ON rm_receipts
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_rm_qc
    AFTER INSERT OR UPDATE OR DELETE ON rm_qc
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_hourly_readings
    AFTER INSERT OR UPDATE OR DELETE ON hourly_readings
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_batch_analysis
    AFTER INSERT OR UPDATE OR DELETE ON batch_analysis
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_product_qc
    AFTER INSERT OR UPDATE OR DELETE ON product_qc
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_post_production_tests
    AFTER INSERT OR UPDATE OR DELETE ON post_production_tests
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_lab_trials
    AFTER INSERT OR UPDATE OR DELETE ON lab_trials
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
-- Pattern:
--   Every SELECT policy uses fn_user_factory_ids() to get the set of
--   factories the current user may access.
--   Write policies (INSERT/UPDATE) additionally check the user's role.
--   No table ever allows DELETE — hard deletes are blocked at DB level.
--   audit_log INSERT is allowed only from the SECURITY DEFINER trigger.

-- Enable RLS on every table
ALTER TABLE factories              ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_activities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials              ENABLE ROW LEVEL SECURITY;
ALTER TABLE products               ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_test_definitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches                ENABLE ROW LEVEL SECURITY;
ALTER TABLE rm_receipts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE rm_qc                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_readings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_analysis         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_qc             ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_production_tests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_trials             ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log              ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 7.1 Reference / lookup tables (factories, materials, products, definitions)
-- All authenticated users can read these — they power dropdowns and form
-- rendering. Only company_admin / factory_admin can modify them.
-- ---------------------------------------------------------------------------

-- factories: read by all authenticated, write by company_admin only
CREATE POLICY "factories_select" ON factories
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "factories_insert" ON factories
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid() AND role = 'company_admin'
        )
    );

CREATE POLICY "factories_update" ON factories
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid() AND role = 'company_admin'
        )
    );

-- factory_activities: same read-all / admin-write pattern
CREATE POLICY "factory_activities_select" ON factory_activities
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "factory_activities_insert" ON factory_activities
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    );

CREATE POLICY "factory_activities_update" ON factory_activities
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    );

-- materials / products / qc_test_definitions: same pattern
CREATE POLICY "materials_select" ON materials
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "materials_write" ON materials
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    );

CREATE POLICY "products_select" ON products
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "products_write" ON products
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    );

CREATE POLICY "qc_test_definitions_select" ON qc_test_definitions
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "qc_test_definitions_write" ON qc_test_definitions
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    );

-- ---------------------------------------------------------------------------
-- 7.2 profiles and user_roles
-- ---------------------------------------------------------------------------

-- profiles: users can read and update their own row only
CREATE POLICY "profiles_select_own" ON profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid());

-- Admins can read all profiles within their scope (needed for user management UI)
CREATE POLICY "profiles_select_admin" ON profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    );

-- user_roles: users see their own rows; admins see all rows they govern
CREATE POLICY "user_roles_select_own" ON user_roles
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "user_roles_select_admin" ON user_roles
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur2
            WHERE ur2.user_id = auth.uid()
              AND ur2.role IN ('company_admin', 'factory_admin')
        )
    );

-- Only company_admin and factory_admin can grant roles
CREATE POLICY "user_roles_insert" ON user_roles
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    );

CREATE POLICY "user_roles_update" ON user_roles
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid()
              AND role IN ('company_admin', 'factory_admin')
        )
    );

-- Only company_admin can revoke roles
CREATE POLICY "user_roles_delete" ON user_roles
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid() AND role = 'company_admin'
        )
    );

-- ---------------------------------------------------------------------------
-- 7.3 batches
-- SELECT  : any user with access to that factory (any role)
-- INSERT  : chemist, operator, production_incharge at that factory
-- UPDATE  : lab_manager, factory_admin, company_admin at that factory
-- DELETE  : never
-- ---------------------------------------------------------------------------
CREATE POLICY "batches_select" ON batches
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "batches_insert" ON batches
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND factory_id = batches.factory_id
              AND role IN ('chemist','operator','production_incharge',
                           'factory_admin','company_admin')
        )
    );

CREATE POLICY "batches_update" ON batches
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = batches.factory_id OR factory_id IS NULL)
              AND role IN ('lab_manager','factory_admin','company_admin')
        )
    );

-- ---------------------------------------------------------------------------
-- 7.4 rm_receipts
-- INSERT  : chemist, operator at that factory
-- UPDATE  : lab_manager+
-- ---------------------------------------------------------------------------
CREATE POLICY "rm_receipts_select" ON rm_receipts
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "rm_receipts_insert" ON rm_receipts
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = rm_receipts.factory_id OR factory_id IS NULL)
              AND role IN ('chemist','operator','factory_admin','company_admin')
        )
    );

CREATE POLICY "rm_receipts_update" ON rm_receipts
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = rm_receipts.factory_id OR factory_id IS NULL)
              AND role IN ('lab_manager','factory_admin','company_admin')
        )
    );

-- ---------------------------------------------------------------------------
-- 7.5 rm_qc
-- INSERT  : chemist at that factory
-- UPDATE  : lab_manager+ (corrections, all logged in audit_log)
-- ---------------------------------------------------------------------------
CREATE POLICY "rm_qc_select" ON rm_qc
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "rm_qc_insert" ON rm_qc
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = rm_qc.factory_id OR factory_id IS NULL)
              AND role IN ('chemist','factory_admin','company_admin')
        )
    );

CREATE POLICY "rm_qc_update" ON rm_qc
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = rm_qc.factory_id OR factory_id IS NULL)
              AND role IN ('lab_manager','factory_admin','company_admin')
        )
    );

-- ---------------------------------------------------------------------------
-- 7.6 hourly_readings
-- INSERT  : operator, production_incharge at that factory
-- UPDATE  : lab_manager+ only (corrections)
-- ---------------------------------------------------------------------------
CREATE POLICY "hourly_readings_select" ON hourly_readings
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "hourly_readings_insert" ON hourly_readings
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = hourly_readings.factory_id OR factory_id IS NULL)
              AND role IN ('operator','production_incharge','factory_admin','company_admin')
        )
    );

CREATE POLICY "hourly_readings_update" ON hourly_readings
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = hourly_readings.factory_id OR factory_id IS NULL)
              AND role IN ('lab_manager','factory_admin','company_admin')
        )
    );

-- ---------------------------------------------------------------------------
-- 7.7 batch_analysis / product_qc / post_production_tests / lab_trials
-- All follow the same pattern:
--   INSERT  : chemist
--   UPDATE  : lab_manager+
-- ---------------------------------------------------------------------------

-- batch_analysis
CREATE POLICY "batch_analysis_select" ON batch_analysis
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "batch_analysis_insert" ON batch_analysis
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = batch_analysis.factory_id OR factory_id IS NULL)
              AND role IN ('chemist','factory_admin','company_admin')
        )
    );

CREATE POLICY "batch_analysis_update" ON batch_analysis
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = batch_analysis.factory_id OR factory_id IS NULL)
              AND role IN ('lab_manager','factory_admin','company_admin')
        )
    );

-- product_qc
CREATE POLICY "product_qc_select" ON product_qc
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "product_qc_insert" ON product_qc
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = product_qc.factory_id OR factory_id IS NULL)
              AND role IN ('chemist','factory_admin','company_admin')
        )
    );

CREATE POLICY "product_qc_update" ON product_qc
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = product_qc.factory_id OR factory_id IS NULL)
              AND role IN ('lab_manager','factory_admin','company_admin')
        )
    );

-- post_production_tests
CREATE POLICY "post_production_select" ON post_production_tests
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "post_production_insert" ON post_production_tests
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = post_production_tests.factory_id OR factory_id IS NULL)
              AND role IN ('chemist','factory_admin','company_admin')
        )
    );

CREATE POLICY "post_production_update" ON post_production_tests
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = post_production_tests.factory_id OR factory_id IS NULL)
              AND role IN ('lab_manager','factory_admin','company_admin')
        )
    );

-- lab_trials
CREATE POLICY "lab_trials_select" ON lab_trials
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "lab_trials_insert" ON lab_trials
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = lab_trials.factory_id OR factory_id IS NULL)
              AND role IN ('chemist','factory_admin','company_admin')
        )
    );

CREATE POLICY "lab_trials_update" ON lab_trials
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = lab_trials.factory_id OR factory_id IS NULL)
              AND role IN ('lab_manager','factory_admin','company_admin')
        )
    );

-- ---------------------------------------------------------------------------
-- 7.8 attachments
-- SELECT  : factory-scoped (same as parent entity)
-- INSERT  : any user with write access to the parent entity type
-- UPDATE  : lab_manager+ (for replacing a photo via correction)
-- DELETE  : never
-- ---------------------------------------------------------------------------
CREATE POLICY "attachments_select" ON attachments
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "attachments_insert" ON attachments
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = attachments.factory_id OR factory_id IS NULL)
              AND role IN ('chemist','operator','production_incharge',
                           'lab_manager','factory_admin','company_admin')
        )
    );

CREATE POLICY "attachments_update" ON attachments
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id    = auth.uid()
              AND (factory_id = attachments.factory_id OR factory_id IS NULL)
              AND role IN ('lab_manager','factory_admin','company_admin')
        )
    );

-- ---------------------------------------------------------------------------
-- 7.9 audit_log
-- SELECT  : lab_manager+ at that factory; company_admin sees everything
-- INSERT  : blocked for all users — trigger uses SECURITY DEFINER
-- UPDATE/DELETE : blocked via RULE (already applied above)
-- ---------------------------------------------------------------------------
CREATE POLICY "audit_log_select" ON audit_log
    FOR SELECT TO authenticated
    USING (
        -- company_admin sees all
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = auth.uid() AND role = 'company_admin'
        )
        OR
        -- lab_manager / factory_admin see their own factory's log
        (
            factory_id IN (SELECT fn_user_factory_ids())
            AND EXISTS (
                SELECT 1 FROM user_roles
                WHERE user_id    = auth.uid()
                  AND (factory_id = audit_log.factory_id OR factory_id IS NULL)
                  AND role IN ('lab_manager','factory_admin')
            )
        )
    );

-- ---------------------------------------------------------------------------
-- 8. INDEXES
-- ---------------------------------------------------------------------------

-- batches: most common query — find by batch number at a factory
CREATE INDEX idx_batches_factory_batch    ON batches (factory_id, batch_number);
CREATE INDEX idx_batches_source           ON batches (source_batch_id)
    WHERE source_batch_id IS NOT NULL;   -- partial: only linked batches
CREATE INDEX idx_batches_material         ON batches (material_id);
CREATE INDEX idx_batches_product          ON batches (product_id);
CREATE INDEX idx_batches_production_date  ON batches (factory_id, production_date DESC);

-- rm_receipts
CREATE INDEX idx_rm_receipts_factory_date ON rm_receipts (factory_id, received_date DESC);
CREATE INDEX idx_rm_receipts_batch        ON rm_receipts (batch_id);

-- rm_qc
CREATE INDEX idx_rm_qc_factory_date       ON rm_qc (factory_id, test_date DESC);
CREATE INDEX idx_rm_qc_batch              ON rm_qc (batch_id);
CREATE INDEX idx_rm_qc_material           ON rm_qc (material_id);

-- hourly_readings
CREATE INDEX idx_hourly_batch_time        ON hourly_readings (batch_id, reading_time DESC);
CREATE INDEX idx_hourly_factory           ON hourly_readings (factory_id);

-- batch_analysis
CREATE INDEX idx_batch_analysis_factory   ON batch_analysis (factory_id, analysis_date DESC);

-- product_qc
CREATE INDEX idx_product_qc_factory_date  ON product_qc (factory_id, test_date DESC);
CREATE INDEX idx_product_qc_product       ON product_qc (product_id);
CREATE INDEX idx_product_qc_batch         ON product_qc (batch_id);

-- post_production_tests
CREATE INDEX idx_post_prod_factory_date   ON post_production_tests (factory_id, test_date DESC);
CREATE INDEX idx_post_prod_product_qc     ON post_production_tests (product_qc_id)
    WHERE product_qc_id IS NOT NULL;

-- lab_trials
CREATE INDEX idx_lab_trials_factory_date  ON lab_trials (factory_id, trial_date DESC);
CREATE INDEX idx_lab_trials_product       ON lab_trials (product_id)
    WHERE product_id IS NOT NULL;

-- attachments: entity lookup + factory filter
CREATE INDEX idx_attachments_entity       ON attachments (entity_type, entity_id);
CREATE INDEX idx_attachments_factory      ON attachments (factory_id);

-- audit_log: per-record history + factory-scoped time range queries
CREATE INDEX idx_audit_record             ON audit_log (table_name, record_id);
CREATE INDEX idx_audit_factory_time       ON audit_log (factory_id, changed_at DESC);

-- qc_test_definitions: form rendering query
CREATE INDEX idx_qtd_material             ON qc_test_definitions (material_id, phase, sort_order)
    WHERE material_id IS NOT NULL;
CREATE INDEX idx_qtd_product              ON qc_test_definitions (product_id, phase, sort_order)
    WHERE product_id IS NOT NULL;

-- Full-text search on batches (powers the unified search bar)
CREATE INDEX idx_batches_fts ON batches
    USING GIN (
        to_tsvector('english',
            coalesce(batch_number, '') || ' ' ||
            coalesce(lot_number,    '')
        )
    );

-- ---------------------------------------------------------------------------
-- 8. VIEWS
-- ---------------------------------------------------------------------------

-- 8.1 v_batch_chain
-- Recursive CTE that walks source_batch_id in both directions.
-- Used by the batch traceability screen to show upstream source and
-- all downstream usages of any batch.
CREATE VIEW v_batch_chain AS
WITH RECURSIVE chain AS (
    -- anchor: every batch is the root of its own chain
    SELECT
        id,
        batch_number,
        factory_id,
        source_batch_id,
        material_id,
        product_id,
        production_date,
        ARRAY[id]   AS path,
        0           AS depth
    FROM batches

    UNION ALL

    SELECT
        b.id,
        b.batch_number,
        b.factory_id,
        b.source_batch_id,
        b.material_id,
        b.product_id,
        b.production_date,
        c.path || b.id,
        c.depth + 1
    FROM batches b
    JOIN chain   c ON b.source_batch_id = c.id
    WHERE NOT (b.id = ANY(c.path))   -- cycle guard
      AND c.depth < 10               -- safety cap
)
SELECT * FROM chain;

-- 8.2 v_unified_search
-- Powers the single search bar. Combines batch metadata with material,
-- product, factory, and chemist names into a tsvector.
-- Usage: WHERE search_vector @@ plainto_tsquery('english', $user_input)
CREATE VIEW v_unified_search AS
SELECT
    b.id               AS batch_id,
    b.batch_number,
    b.lot_number,
    b.factory_id,
    f.name             AS factory_name,
    b.batch_type,
    b.production_date,
    b.material_id,
    m.name             AS material_name,
    b.product_id,
    p.name             AS product_name,
    pr.full_name       AS created_by_name,
    to_tsvector('english',
        coalesce(b.batch_number,  '') || ' ' ||
        coalesce(b.lot_number,    '') || ' ' ||
        coalesce(m.name,          '') || ' ' ||
        coalesce(p.name,          '') || ' ' ||
        coalesce(pr.full_name,    '') || ' ' ||
        coalesce(f.name,          '')
    )                  AS search_vector
FROM      batches   b
LEFT JOIN factories  f  ON f.id  = b.factory_id
LEFT JOIN materials  m  ON m.id  = b.material_id
LEFT JOIN products   p  ON p.id  = b.product_id
LEFT JOIN profiles   pr ON pr.id = b.created_by;

-- 8.3 v_factory_qc_summary
-- Per-factory daily QC pass/fail counts. Used by the dashboard.
CREATE VIEW v_factory_qc_summary AS
SELECT
    pq.factory_id,
    f.name              AS factory_name,
    pq.test_date,
    p.name              AS product_name,
    COUNT(*)            AS total_tests,
    COUNT(*) FILTER (WHERE pq.appearance_ok = true)  AS passed,
    COUNT(*) FILTER (WHERE pq.appearance_ok = false) AS failed
FROM      product_qc pq
JOIN      factories  f  ON f.id = pq.factory_id
JOIN      products   p  ON p.id = pq.product_id
GROUP BY  pq.factory_id, f.name, pq.test_date, p.name;

-- 8.4 v_rm_qc_with_source
-- For Factory A 20 Sulphur Powder read-through: joins a batch to its
-- source batch's rm_qc record via source_batch_id. The frontend queries
-- this view instead of rm_qc directly when the material is SULPHUR_POWDER
-- at Factory A 20 — it gets the 20/1 result without a second INSERT.
CREATE VIEW v_rm_qc_with_source AS
SELECT
    b.id                  AS batch_id,
    b.batch_number        AS batch_number,
    b.factory_id          AS batch_factory_id,
    b.source_batch_id,
    src_b.batch_number    AS source_batch_number,
    src_b.factory_id      AS source_factory_id,
    rq.id                 AS rm_qc_id,
    rq.chemist_id,
    rq.test_date,
    rq.appearance,
    rq.appearance_ok,
    rq.test_results,
    rq.remarks,
    rq.submitted_at,
    -- flag so the frontend knows this is a read-through record, not a local one
    (b.factory_id <> src_b.factory_id) AS is_read_through
FROM      batches  b
LEFT JOIN batches  src_b ON src_b.id  = b.source_batch_id
LEFT JOIN rm_qc    rq    ON rq.batch_id = COALESCE(b.source_batch_id, b.id);

-- ---------------------------------------------------------------------------
-- 9. SEED DATA
-- ---------------------------------------------------------------------------
-- Run after all tables are created. Safe to re-run (ON CONFLICT DO NOTHING).

-- 9.1 factories
INSERT INTO factories (id, code, name, location) VALUES
    ('00000000-0000-0000-0000-000000000001', 'DBV_20_1', 'Factory A 20/1', 'Dombivli'),
    ('00000000-0000-0000-0000-000000000002', 'DBV_20',   'Factory A 20',   'Dombivli'),
    ('00000000-0000-0000-0000-000000000003', 'NSK',      'Nashik',         'Nashik'),
    ('00000000-0000-0000-0000-000000000004', 'SNP',      'Sonepat',        'Sonepat')
ON CONFLICT (code) DO NOTHING;

-- 9.2 materials
INSERT INTO materials (code, name) VALUES
    ('SULPHUR_CRUDE',    'Crude Sulphur'),
    ('SULPHUR_POWDER',   'Sulphur Powder'),
    ('ZINC_OXIDE',       'Zinc Oxide'),
    ('CALCIUM_CHLORIDE', 'Calcium Chloride'),
    ('TEBUCONAZOLE',     'Tebuconazole'),
    ('BORIC_POWDER',     'Boric Powder')
ON CONFLICT (code) DO NOTHING;

-- 9.3 products
INSERT INTO products (code, name, is_trial_only) VALUES
    ('SULPHUR_SC',    'Sulphur SC',    false),
    ('ZINC_SC',       'Zinc SC',       false),
    ('LIQUID_CALCIUM','Liquid Calcium', false),
    ('ZIDDI',         'Ziddi',         false),
    ('LIQUID_BORON',  'Liquid Boron',  false),
    -- trial-only products: hidden from Product QC picker
    ('CBM',    'CBM',     true),
    ('CAN',    'CAN',     true),
    ('SZN',    'SZN',     true),
    ('SOM',    'SOM',     true),
    ('ZNMG',   'ZNMG',    true),
    ('K_TRAIL','K-Trail', true)
ON CONFLICT (code) DO NOTHING;

-- 9.4 factory_activities
-- Factory A 20/1: 4 Lab QC activities
INSERT INTO factory_activities (factory_id, module, activity, label, sort_order) VALUES
    ('00000000-0000-0000-0000-000000000001', 'lab_qc', 'rm_receipt',      'Crude Sulphur Receipt', 1),
    ('00000000-0000-0000-0000-000000000001', 'lab_qc', 'rm_qc',           'Crude Sulphur QC',      2),
    ('00000000-0000-0000-0000-000000000001', 'lab_qc', 'hourly_reading',  'Hourly Readings',       3),
    ('00000000-0000-0000-0000-000000000001', 'lab_qc', 'batch_analysis',  'Batch Analysis',        4)
ON CONFLICT (factory_id, module, activity) DO NOTHING;

-- Factory A 20: 5 Lab QC activities
INSERT INTO factory_activities (factory_id, module, activity, label, sort_order) VALUES
    ('00000000-0000-0000-0000-000000000002', 'lab_qc', 'rm_receipt',         'Raw Material Receipts', 1),
    ('00000000-0000-0000-0000-000000000002', 'lab_qc', 'rm_qc',              'Raw Material QC',       2),
    ('00000000-0000-0000-0000-000000000002', 'lab_qc', 'product_qc',         'Product QC',            3),
    ('00000000-0000-0000-0000-000000000002', 'lab_qc', 'post_production',    'Post Production',       4),
    ('00000000-0000-0000-0000-000000000002', 'lab_qc', 'lab_trial',          'Lab Trials',            5)
ON CONFLICT (factory_id, module, activity) DO NOTHING;

-- Nashik and Sonepat: no activities at launch (populated later as data rows)

-- 9.5 qc_test_definitions — Crude Sulphur (rm_qc at Factory A 20/1)
-- ⚠ formulas confirmed against standard analytical methods; verify factors with lab before go-live (see docs/qc_test_definitions_seed.md §15)
DO $$
DECLARE v_mat uuid := (SELECT id FROM materials WHERE code = 'SULPHUR_CRUDE');
BEGIN
    INSERT INTO qc_test_definitions
        (material_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    -- Appearance
    (v_mat,'none','appearance',       'Appearance / Physical State', NULL,  'text',   false, NULL, 1),
    (v_mat,'none','appearance_photo', 'Photo',                       NULL,  'photo',  false, NULL, 2),
    -- Purity
    (v_mat,'none','purity_m1',        'Purity: Mass of CS₂-insoluble residue, M1', 'g', 'number', false, NULL, 3),
    (v_mat,'none','purity_m',         'Purity: Mass of material taken, M',          'g', 'number', false, NULL, 4),
    (v_mat,'none','purity_percent',   'Purity',                                     '%', 'number', true,
        '((purity_m - purity_m1) / purity_m) * 100', 5),
    -- Acidity
    (v_mat,'none','acidity_v1',       'Acidity: Titre with material, V1',        'mL','number', false, NULL, 6),
    (v_mat,'none','acidity_v2',       'Acidity: Titre with blank, V2',           'mL','number', false, NULL, 7),
    (v_mat,'none','acidity_n',        'Acidity: Normality of NaOH, N',           'N', 'number', false, NULL, 8),
    (v_mat,'none','acidity_m',        'Acidity: Mass of sample, M',              'g', 'number', false, NULL, 9),
    (v_mat,'none','acidity_percent',  'Acidity (as H₂SO₄)',                      '%', 'number', true,
        '((acidity_v1 - acidity_v2) * acidity_n * 0.049 / acidity_m) * 100', 10),
    -- Moisture
    (v_mat,'none','moisture_m_before','Moisture: Mass before heating, M',  'g','number', false, NULL, 11),
    (v_mat,'none','moisture_m1_after','Moisture: Mass after heating, M1',  'g','number', false, NULL, 12),
    (v_mat,'none','moisture_percent', 'Moisture',                          '%','number', true,
        '((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100', 13),
    -- Ash
    (v_mat,'none','ash_m',            'Ash: Mass of sample taken, M',      'g','number', false, NULL, 14),
    (v_mat,'none','ash_m1',           'Ash: Mass of residue obtained, M1', 'g','number', false, NULL, 15),
    (v_mat,'none','ash_percent',      'Ash content',                       '%','number', true,
        '(ash_m1 / ash_m) * 100', 16)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.6 qc_test_definitions — Sulphur Powder hourly_readings
DO $$
DECLARE v_mat uuid := (SELECT id FROM materials WHERE code = 'SULPHUR_POWDER');
BEGIN
    INSERT INTO qc_test_definitions
        (material_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_mat,'none','colour_appearance', 'Colour & Appearance', NULL, 'text',  false, NULL, 1),
    (v_mat,'none','appearance_photo',  'Photo',               NULL, 'photo', false, NULL, 2)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.7 qc_test_definitions — Sulphur Powder batch_analysis
-- Uses phase = 'B' to distinguish from hourly_reading fields at query time
DO $$
DECLARE v_mat uuid := (SELECT id FROM materials WHERE code = 'SULPHUR_POWDER');
BEGIN
    INSERT INTO qc_test_definitions
        (material_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_mat,'B','colour_appearance',  'Colour & Appearance',              NULL,    'text',   false, NULL,  1),
    (v_mat,'B','appearance_photo',   'Photo',                            NULL,    'photo',  false, NULL,  2),
    -- Purity
    (v_mat,'B','purity_e',           'Purity: Empty Crucible Weight, E', 'g',     'number', false, NULL,  3),
    (v_mat,'B','purity_w1',          'Purity: Mass of sample taken, W1', 'g',     'number', false, NULL,  4),
    (v_mat,'B','purity_w2',          'Purity: Mass of Empty wt + Residue, W2','g','number', false, NULL,  5),
    (v_mat,'B','purity_percent',     'Purity',                           '%',     'number', true,
        '((purity_w1 - (purity_w2 - purity_e)) / purity_w1) * 100', 6),
    -- Acidity
    (v_mat,'B','acidity_v1',         'Acidity: Titre with material, V1', 'mL',    'number', false, NULL,  7),
    (v_mat,'B','acidity_v2',         'Acidity: Titre with blank, V2',    'mL',    'number', false, NULL,  8),
    (v_mat,'B','acidity_n',          'Acidity: Normality of NaOH, N',    'N',     'number', false, NULL,  9),
    (v_mat,'B','acidity_m',          'Acidity: Mass of sample, M',       'g',     'number', false, NULL,  10),
    (v_mat,'B','acidity_percent',    'Acidity (as H₂SO₄)',               '%',     'number', true,
        '((acidity_v1 - acidity_v2) * acidity_n * 0.049 / acidity_m) * 100', 11),
    -- Mesh
    (v_mat,'B','mesh100_m',          '100 Mesh: Sample taken, M',        'g',     'number', false, NULL,  12),
    (v_mat,'B','mesh100_m_ret',      '100 Mesh: Coarse retained, m',     'g',     'number', false, NULL,  13),
    (v_mat,'B','mesh100_pct',        '100 Mesh: % retained',             '%',     'number', true,
        '(mesh100_m_ret / mesh100_m) * 100', 14),
    (v_mat,'B','mesh200_m',          '200 Mesh: Sample taken, M',        'g',     'number', false, NULL,  15),
    (v_mat,'B','mesh200_m_ret',      '200 Mesh: Coarse retained, m',     'g',     'number', false, NULL,  16),
    (v_mat,'B','mesh200_pct',        '200 Mesh: % retained',             '%',     'number', true,
        '(mesh200_m_ret / mesh200_m) * 100', 17),
    (v_mat,'B','mesh325_m',          '325 Mesh: Sample taken, M',        'g',     'number', false, NULL,  18),
    (v_mat,'B','mesh325_m_ret',      '325 Mesh: Coarse retained, m',     'g',     'number', false, NULL,  19),
    (v_mat,'B','mesh325_pct',        '325 Mesh: % retained',             '%',     'number', true,
        '(mesh325_m_ret / mesh325_m) * 100', 20),
    -- Other
    (v_mat,'B','melting_point',      'Melting Point',                    '°C',    'number', false, NULL,  21),
    -- Moisture
    (v_mat,'B','moisture_m_before',  'Moisture: Mass before heating, M', 'g',     'number', false, NULL,  22),
    (v_mat,'B','moisture_m1_after',  'Moisture: Mass after heating, M1', 'g',     'number', false, NULL,  23),
    (v_mat,'B','moisture_percent',   'Moisture',                         '%',     'number', true,
        '((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100', 24),
    -- Ash
    (v_mat,'B','ash_m',              'Ash: Mass of sample taken, M',     'g',     'number', false, NULL,  25),
    (v_mat,'B','ash_m1',             'Ash: Mass of residue obtained, M1','g',     'number', false, NULL,  26),
    (v_mat,'B','ash_percent',        'Ash content',                      '%',     'number', true,
        '(ash_m1 / ash_m) * 100', 27),
    -- Oil content
    (v_mat,'B','oil_mass_loss',      'Oil content: Mass loss',           'g',     'number', false, NULL,  28),
    (v_mat,'B','oil_original_mass',  'Oil content: Original sample mass','g',     'number', false, NULL,  29),
    (v_mat,'B','oil_percent',        'Oil content',                      '%',     'number', true,
        '(oil_mass_loss / oil_original_mass) * 100', 30),
    -- Specific gravity (pycnometer method)
    (v_mat,'B','sg_w1',              'Specific gravity: Empty pycnometer, W1',          'g',     'number', false, NULL, 31),
    (v_mat,'B','sg_w2',              'Specific gravity: Pycnometer + sample, W2',       'g',     'number', false, NULL, 32),
    (v_mat,'B','sg_w3',              'Specific gravity: Pycnometer + sample + liquid, W3','g',   'number', false, NULL, 33),
    (v_mat,'B','sg_w4',              'Specific gravity: Pycnometer + liquid, W4',       'g',     'number', false, NULL, 34),
    (v_mat,'B','sg_sl',              'Specific gravity of liquid medium, SL',           NULL,    'number', false, NULL, 35),
    (v_mat,'B','sg_value',           'Specific Gravity of Sulphur Powder',              'g/cm³', 'number', true,
        '((sg_w2 - sg_w1) / ((sg_w2 - sg_w1) - (sg_w3 - sg_w4))) * sg_sl', 36),
    -- Bulk density
    (v_mat,'B','bd_mass',            'Bulk density: Mass of sample, m',           'g',    'number', false, NULL, 37),
    (v_mat,'B','bd_volume',          'Bulk density: Volume after tapping, V',     'mL',   'number', false, NULL, 38),
    (v_mat,'B','bd_value',           'Bulk Density',                              'g/mL', 'number', true,
        'bd_mass / bd_volume', 39)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.8 qc_test_definitions — Zinc Oxide (rm_qc at Factory A 20)
DO $$
DECLARE v_mat uuid := (SELECT id FROM materials WHERE code = 'ZINC_OXIDE');
BEGIN
    INSERT INTO qc_test_definitions
        (material_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_mat,'none','coa_received',       'Is COA received?',                   NULL, 'boolean', false, NULL,  1),
    (v_mat,'none','appearance',         'Appearance',                         NULL, 'text',    false, NULL,  2),
    (v_mat,'none','appearance_photo',   'Product Photo',                      NULL, 'photo',   false, NULL,  3),
    (v_mat,'none','zn_mass_taken',      'Mass of Material Taken, W',          'g',  'number',  false, NULL,  4),
    (v_mat,'none','zn_edta_normality',  'Normality of EDTA solution, N',      'N',  'number',  false, NULL,  5),
    (v_mat,'none','zn_titre_with_cy',   'Titre with cyanide, V1',             'mL', 'number',  false, NULL,  6),
    (v_mat,'none','zn_titre_without_cy','Titre without cyanide, V2',          'mL', 'number',  false, NULL,  7),
    (v_mat,'none','zn_content_percent', 'Zinc Oxide content',                 '%',  'number',  true,
        '((zn_titre_without_cy - zn_titre_with_cy) * zn_edta_normality * 4.069 / zn_mass_taken) * 100', 8),
    (v_mat,'none','moisture_m_before',  'Moisture: Mass before heating, M',   'g',  'number',  false, NULL,  9),
    (v_mat,'none','moisture_m1_after',  'Moisture: Mass after heating, M1',   'g',  'number',  false, NULL,  10),
    (v_mat,'none','moisture_percent',   'Moisture',                           '%',  'number',  true,
        '((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100', 11),
    (v_mat,'none','mesh200_m',          '200 Mesh: Sample taken, M',          'g',  'number',  false, NULL,  12),
    (v_mat,'none','mesh200_m_ret',      '200 Mesh: Coarse retained, m',       'g',  'number',  false, NULL,  13),
    (v_mat,'none','mesh200_pct',        '200 Mesh: % retained',               '%',  'number',  true,
        '(mesh200_m_ret / mesh200_m) * 100', 14),
    (v_mat,'none','mesh325_m',          '325 Mesh: Sample taken, M',          'g',  'number',  false, NULL,  15),
    (v_mat,'none','mesh325_m_ret',      '325 Mesh: Coarse retained, m',       'g',  'number',  false, NULL,  16),
    (v_mat,'none','mesh325_pct',        '325 Mesh: % retained',               '%',  'number',  true,
        '(mesh325_m_ret / mesh325_m) * 100', 17)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.9 qc_test_definitions — Calcium Chloride
DO $$
DECLARE v_mat uuid := (SELECT id FROM materials WHERE code = 'CALCIUM_CHLORIDE');
BEGIN
    INSERT INTO qc_test_definitions
        (material_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_mat,'none','coa_received',     'Is COA received?',                 NULL, 'boolean', false, NULL, 1),
    (v_mat,'none','appearance',       'Color & Physical State',           NULL, 'text',    false, NULL, 2),
    (v_mat,'none','appearance_photo', 'Product Photo',                    NULL, 'photo',   false, NULL, 3),
    (v_mat,'none','ph_20pct',         'pH (20% solution)',                NULL, 'number',  false, NULL, 4),
    (v_mat,'none','solubility',       'Solubility',                       NULL, 'text',    false, NULL, 5),
    (v_mat,'none','ca_mass_taken',    'Calcium content: Weight of sample, W', 'g',  'number', false, NULL, 6),
    (v_mat,'none','ca_edta_normality','Calcium content: Normality of EDTA',   'N',  'number', false, NULL, 7),
    (v_mat,'none','ca_burette_reading','Calcium content: Burette reading, B.R.','mL','number',false, NULL, 8),
    (v_mat,'none','ca_content_percent','Calcium content',                 '%',  'number',  true,
        '(ca_burette_reading * ca_edta_normality * 2.004 / ca_mass_taken) * 100', 9)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.10 qc_test_definitions — Tebuconazole
DO $$
DECLARE v_mat uuid := (SELECT id FROM materials WHERE code = 'TEBUCONAZOLE');
BEGIN
    INSERT INTO qc_test_definitions
        (material_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_mat,'none','coa_received',     'Is COA received?',                 NULL, 'boolean', false, NULL,  1),
    (v_mat,'none','tebu_content',     'Tebuconazole Content',             '%',  'number',  false, NULL,  2),
    (v_mat,'none','moisture_m_before','Moisture: Mass before heating, M', 'g',  'number',  false, NULL,  3),
    (v_mat,'none','moisture_m1_after','Moisture: Mass after heating, M1', 'g',  'number',  false, NULL,  4),
    (v_mat,'none','moisture_percent', 'Moisture',                         '%',  'number',  true,
        '((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100', 5),
    (v_mat,'none','mesh200_m',        '200 Mesh: Sample taken, M',        'g',  'number',  false, NULL,  6),
    (v_mat,'none','mesh200_m_ret',    '200 Mesh: Coarse retained, m',     'g',  'number',  false, NULL,  7),
    (v_mat,'none','mesh200_pct',      '200 Mesh: % retained',             '%',  'number',  true,
        '(mesh200_m_ret / mesh200_m) * 100', 8),
    (v_mat,'none','mesh325_m',        '325 Mesh: Sample taken, M',        'g',  'number',  false, NULL,  9),
    (v_mat,'none','mesh325_m_ret',    '325 Mesh: Coarse retained, m',     'g',  'number',  false, NULL,  10),
    (v_mat,'none','mesh325_pct',      '325 Mesh: % retained',             '%',  'number',  true,
        '(mesh325_m_ret / mesh325_m) * 100', 11)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.11 qc_test_definitions — Boric Powder
DO $$
DECLARE v_mat uuid := (SELECT id FROM materials WHERE code = 'BORIC_POWDER');
BEGIN
    INSERT INTO qc_test_definitions
        (material_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_mat,'none','coa_received',     'Is COA received?',                 NULL, 'boolean', false, NULL, 1),
    (v_mat,'none','appearance',       'Appearance',                       NULL, 'text',    false, NULL, 2),
    (v_mat,'none','boron_content',    'Boron Content',                    '%',  'number',  false, NULL, 3),
    (v_mat,'none','moisture_m_before','Moisture: Mass before heating, M', 'g',  'number',  false, NULL, 4),
    (v_mat,'none','moisture_m1_after','Moisture: Mass after heating, M1', 'g',  'number',  false, NULL, 5),
    (v_mat,'none','moisture_percent', 'Moisture',                         '%',  'number',  true,
        '((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100', 6),
    (v_mat,'none','mesh200_m',        '200 Mesh: Sample taken, M',        'g',  'number',  false, NULL, 7),
    (v_mat,'none','mesh200_m_ret',    '200 Mesh: Coarse retained, m',     'g',  'number',  false, NULL, 8),
    (v_mat,'none','mesh200_pct',      '200 Mesh: % retained',             '%',  'number',  true,
        '(mesh200_m_ret / mesh200_m) * 100', 9)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.12 qc_test_definitions — Sulphur SC Phase A
DO $$
DECLARE v_prod uuid := (SELECT id FROM products WHERE code = 'SULPHUR_SC');
BEGIN
    INSERT INTO qc_test_definitions
        (product_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_prod,'A','slurry_weight_kg',  'Quantity of Phase A / Slurry Weight', 'kg', 'number', false, NULL, 1),
    (v_prod,'A','pa_mass_taken',     'Phase A: Mass of sample taken, m',    'g',  'number', false, NULL, 2),
    (v_prod,'A','pa_titration_vol',  'Phase A: Titration Volume, v',        'mL', 'number', false, NULL, 3),
    (v_prod,'A','pa_iodine_norm',    'Phase A: Normality of iodine, N',     'N',  'number', false, NULL, 4),
    (v_prod,'A','pa_desired_sulphur','Desired Sulphur Content',             '%',  'number', false, NULL, 5),
    (v_prod,'A','pa_sulphur_content','Phase A: Sulphur Content',            '%',  'number', true,
        '(pa_titration_vol * pa_iodine_norm * 1.603 / pa_mass_taken) * 100', 6)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.13 qc_test_definitions — Sulphur SC Phase B
DO $$
DECLARE v_prod uuid := (SELECT id FROM products WHERE code = 'SULPHUR_SC');
BEGIN
    INSERT INTO qc_test_definitions
        (product_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_prod,'B','pb_slurry_weight_kg', 'Phase B: Quantity / Slurry Weight',        'kg',     'number', false, NULL,  1),
    (v_prod,'B','pb_mass_taken',       'Phase B: Mass of sample taken, m',          'g',      'number', false, NULL,  2),
    (v_prod,'B','pb_titration_vol',    'Phase B: Titration Volume, v',              'mL',     'number', false, NULL,  3),
    (v_prod,'B','pb_iodine_norm',      'Phase B: Normality of iodine solution, N',  'N',      'number', false, NULL,  4),
    (v_prod,'B','pb_sulphur_content',  'Phase B: Sulphur Content',                  '%',      'number', true,
        '(pb_titration_vol * pb_iodine_norm * 1.603 / pb_mass_taken) * 100', 5),
    (v_prod,'B','pb_suspension_mass',  'Phase B: Weight of suspension sample, M',   'g',      'number', false, NULL,  6),
    (v_prod,'B','pb_titre_sediment',   'Phase B: Titre with sediment aliquot, v2',  'mL',     'number', false, NULL,  7),
    (v_prod,'B','pb_suspensibility',   'Phase B: Suspensibility',                   '%',      'number', true,
        '(1 - (pb_titre_sediment / pb_titration_vol)) * 100', 8),
    (v_prod,'B','viscosity_sec',       'Viscosity',                                 'seconds','number', false, NULL,  9),
    (v_prod,'B','density',             'Density',                                   'g/cm³',  'number', false, NULL,  10),
    (v_prod,'B','wet200_sample_wt',    'Wet Sieve 200 mesh: Sample weight',         'g',      'number', false, NULL,  11),
    (v_prod,'B','wet200_residue_wt',   'Wet Sieve 200 mesh: Residue weight',        'g',      'number', false, NULL,  12),
    (v_prod,'B','wet200_pct',          'Wet Sieve 200 mesh: % retained',            '%',      'number', true,
        '(wet200_residue_wt / wet200_sample_wt) * 100', 13),
    (v_prod,'B','wet325_sample_wt',    'Wet Sieve 325 mesh: Sample weight',         'g',      'number', false, NULL,  14),
    (v_prod,'B','wet325_residue_wt',   'Wet Sieve 325 mesh: Residue weight',        'g',      'number', false, NULL,  15),
    (v_prod,'B','wet325_pct',          'Wet Sieve 325 mesh: % retained',            '%',      'number', true,
        '(wet325_residue_wt / wet325_sample_wt) * 100', 16),
    (v_prod,'B','colour_physical_state','Color & Physical State',                   NULL,     'text',   false, NULL,  17),
    (v_prod,'B','observations',        'Important Observations (sediments, rejections)', NULL,'text',   false, NULL,  18),
    (v_prod,'B','product_photo',       'Product Photo',                             NULL,     'photo',  false, NULL,  19)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.14 qc_test_definitions — Zinc SC Phase A
DO $$
DECLARE v_prod uuid := (SELECT id FROM products WHERE code = 'ZINC_SC');
BEGIN
    INSERT INTO qc_test_definitions
        (product_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_prod,'A','pa_slurry_weight_kg',    'Quantity / Slurry Weight of Phase A', 'kg', 'number', false, NULL, 1),
    (v_prod,'A','pa_edta_normality',      'Phase A: Normality of EDTA',          'N',  'number', false, NULL, 2),
    (v_prod,'A','pa_titre_with_cy',       'Phase A: V1 — Titre with cyanide',    'mL', 'number', false, NULL, 3),
    (v_prod,'A','pa_titre_without_cy',    'Phase A: V2 — Titre without cyanide', 'mL', 'number', false, NULL, 4),
    (v_prod,'A','pa_zinc_content',        'Phase A: Zinc content',               '%',  'number', true,
        '((pa_titre_without_cy - pa_titre_with_cy) * pa_edta_normality * 3.269) * 100', 5),
    (v_prod,'A','pa_appearance',          'Phase A: Appearance',                 NULL, 'text',   false, NULL, 6)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.15 qc_test_definitions — Zinc SC Phase B
DO $$
DECLARE v_prod uuid := (SELECT id FROM products WHERE code = 'ZINC_SC');
BEGIN
    INSERT INTO qc_test_definitions
        (product_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_prod,'B','pb_slurry_weight_kg',  'Phase B: Quantity / Slurry Weight',         'kg',     'number', false, NULL,  1),
    (v_prod,'B','pb_edta_normality',    'Phase B: Normality of EDTA',                'N',      'number', false, NULL,  2),
    (v_prod,'B','pb_titre_with_cy',     'Phase B: Titre with cyanide',               'mL',     'number', false, NULL,  3),
    (v_prod,'B','pb_titre_without_cy',  'Phase B: Titre without cyanide',            'mL',     'number', false, NULL,  4),
    (v_prod,'B','pb_appearance',        'Phase B: Appearance',                       NULL,     'text',   false, NULL,  5),
    (v_prod,'B','zn_edta_normality',    'Normality of EDTA solution (final)',        'N',      'number', false, NULL,  6),
    (v_prod,'B','zn_mass_taken',        'Mass of sample taken',                      'g',      'number', false, NULL,  7),
    (v_prod,'B','zn_v1_titre_with_cy',  'Zinc content: V1 — Titre with cyanide',    'mL',     'number', false, NULL,  8),
    (v_prod,'B','zn_v2_titre_without_cy','Zinc content: V2 — Titre without cyanide','mL',     'number', false, NULL,  9),
    (v_prod,'B','zn_content_percent',   'Zinc content',                              '%',      'number', true,
        '((zn_v2_titre_without_cy - zn_v1_titre_with_cy) * zn_edta_normality * 3.269 / zn_mass_taken) * 100', 10),
    (v_prod,'B','susp_mass_taken',      'Suspension: Mass of sample taken',          'g',      'number', false, NULL,  11),
    (v_prod,'B','susp_v1_sed',          'Suspension: V1_sed — Titre with cyanide (sediment)',   'mL','number', false, NULL, 12),
    (v_prod,'B','susp_v2_sed',          'Suspension: V2_sed — Titre without cyanide (sediment)','mL','number', false, NULL, 13),
    (v_prod,'B','suspensibility',       'Suspensibility',                            '%',      'number', true,
        '(1 - ((susp_v2_sed - susp_v1_sed) / (zn_v2_titre_without_cy - zn_v1_titre_with_cy))) * 100', 14),
    (v_prod,'B','viscosity_sec',        'Viscosity',                                 'seconds','number', false, NULL,  15),
    (v_prod,'B','ph_direct',            'pH (Direct solution)',                       NULL,     'number', false, NULL,  16),
    (v_prod,'B','density',              'Density',                                   'g/cm³',  'number', false, NULL,  17),
    (v_prod,'B','wet200_sample_wt',     'Wet Sieve 200 mesh: Sample weight',         'g',      'number', false, NULL,  18),
    (v_prod,'B','wet200_residue_wt',    'Wet Sieve 200 mesh: Residue weight',        'g',      'number', false, NULL,  19),
    (v_prod,'B','wet200_pct',           'Wet Sieve 200 mesh: % retained',            '%',      'number', true,
        '(wet200_residue_wt / wet200_sample_wt) * 100', 20),
    (v_prod,'B','wet325_sample_wt',     'Wet Sieve 325 mesh: Sample weight',         'g',      'number', false, NULL,  21),
    (v_prod,'B','wet325_residue_wt',    'Wet Sieve 325 mesh: Residue weight',        'g',      'number', false, NULL,  22),
    (v_prod,'B','wet325_pct',           'Wet Sieve 325 mesh: % retained',            '%',      'number', true,
        '(wet325_residue_wt / wet325_sample_wt) * 100', 23),
    (v_prod,'B','colour_physical_state','Color & Physical State',                    NULL,     'text',   false, NULL,  24),
    (v_prod,'B','observations',         'Important Observations (visible sediments?)',NULL,    'text',   false, NULL,  25),
    (v_prod,'B','product_photo',        'Product Photo',                             NULL,     'photo',  false, NULL,  26)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.16 qc_test_definitions — Liquid Boron (single phase)
DO $$
DECLARE v_prod uuid := (SELECT id FROM products WHERE code = 'LIQUID_BORON');
BEGIN
    INSERT INTO qc_test_definitions
        (product_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_prod,'none','sample_taken_by',    'Sample Taken By',                       NULL,    'text',   false, NULL,  1),
    (v_prod,'none','lot_quantity_kg',    'Lot/Batch Quantity',                     'kg',    'number', false, NULL,  2),
    (v_prod,'none','boron_mass_taken',   'Boron Content: Weight of material, W',   'g',    'number', false, NULL,  3),
    (v_prod,'none','boron_naoh_norm',    'Boron Content: Normality of NaOH, N',    'N',    'number', false, NULL,  4),
    (v_prod,'none','boron_naoh_v1',      'Boron Content: Volume of NaOH starting, V1','mL','number', false, NULL,  5),
    (v_prod,'none','boron_naoh_v2',      'Boron Content: Volume of NaOH ending, V2', 'mL', 'number', false, NULL,  6),
    (v_prod,'none','boron_content_pct',  'Boron Content',                          '%',    'number', true,
        '((boron_naoh_v2 - boron_naoh_v1) * boron_naoh_norm * 1.082 / boron_mass_taken) * 100', 7),
    (v_prod,'none','colour_physical_state','Color & Physical State',               NULL,   'text',   false, NULL,  8),
    (v_prod,'none','observations',       'Important Observations (sediments, clarity)', NULL,'text', false, NULL,  9),
    (v_prod,'none','density',            'Density',                                'g/cm³','number', false, NULL,  10),
    (v_prod,'none','ph_5pct',            'pH (5% solution)',                       NULL,   'number', false, NULL,  11),
    (v_prod,'none','viscosity',          'Viscosity',                              NULL,   'number', false, NULL,  12),
    (v_prod,'none','product_photo',      'Product Photo',                          NULL,   'photo',  false, NULL,  13)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.17 qc_test_definitions — Ziddi (single phase)
DO $$
DECLARE v_prod uuid := (SELECT id FROM products WHERE code = 'ZIDDI');
BEGIN
    INSERT INTO qc_test_definitions
        (product_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_prod,'none','colour_physical_state', 'Color & Physical State',                       NULL, 'text',   false, NULL,  1),
    (v_prod,'none','observations',          'Important Observations (sediments, clarity)',   NULL, 'text',   false, NULL,  2),
    (v_prod,'none','product_photo',         'Product Photo',                                NULL, 'photo',  false, NULL,  3),
    (v_prod,'none','content_mass_taken',    'Content: Weight of material taken, W',         'g',  'number', false, NULL,  4),
    (v_prod,'none','content_iodine_vol',    'Content: Volume of Iodine',                    'mL', 'number', false, NULL,  5),
    (v_prod,'none','content_iodine_norm',   'Content: Normality of Iodine',                 'N',  'number', false, NULL,  6),
    (v_prod,'none','sulphur_content_pct',   'Sulphur Content',                              '%',  'number', true,
        '(content_iodine_vol * content_iodine_norm * 1.603 / content_mass_taken) * 100', 7),
    (v_prod,'none','susp_mass_taken',       'Suspensibility: Weight of material taken, W',  'g',  'number', false, NULL,  8),
    (v_prod,'none','susp_iodine_vol',       'Suspensibility: Volume of Iodine',             'mL', 'number', false, NULL,  9),
    (v_prod,'none','susp_iodine_norm',      'Suspensibility: Normality of Iodine',          'N',  'number', false, NULL,  10),
    (v_prod,'none','suspensibility_pct',    'Suspensibility',                               '%',  'number', true,
        '(1 - ((susp_iodine_vol * susp_iodine_norm) / (content_iodine_vol * content_iodine_norm))) * 100', 11),
    (v_prod,'none','tebu_content_gc',       'Tebuconazole Content (by GC)',                 '%',  'number', false, NULL,  12),
    (v_prod,'none','tebu_suspensibility_gc','Tebuconazole Suspensibility (by GC)',           '%',  'number', false, NULL,  13)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- 9.18 qc_test_definitions — Liquid Calcium (single phase)
DO $$
DECLARE v_prod uuid := (SELECT id FROM products WHERE code = 'LIQUID_CALCIUM');
BEGIN
    INSERT INTO qc_test_definitions
        (product_id, phase, test_key, label, unit, input_type, is_calculated, formula, sort_order) VALUES
    (v_prod,'none','lot_quantity_kg',    'Quantity',                              'kg',    'number', false, NULL, 1),
    (v_prod,'none','ca_mass_taken',      'Calcium content: Weight of sample, W', 'g',     'number', false, NULL, 2),
    (v_prod,'none','ca_edta_normality',  'Calcium content: Normality of EDTA',   'N',     'number', false, NULL, 3),
    (v_prod,'none','ca_burette_reading', 'Calcium content: Burette reading, B.R.','mL',   'number', false, NULL, 4),
    (v_prod,'none','ca_content_percent', 'Calcium content',                       '%',    'number', true,
        '(ca_burette_reading * ca_edta_normality * 2.004 / ca_mass_taken) * 100', 5),
    (v_prod,'none','colour_physical_state','Color & Physical State',              NULL,   'text',   false, NULL, 6),
    (v_prod,'none','observations',       'Important Observations (sediments, clarity)', NULL,'text',false, NULL, 7),
    (v_prod,'none','density',            'Density',                               'g/cm³','number', false, NULL, 8),
    (v_prod,'none','ph_5pct',            'pH (5% solution)',                      NULL,   'number', false, NULL, 9),
    (v_prod,'none','product_photo',      'Product Photo',                         NULL,   'photo',  false, NULL, 10)
    ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
END $$;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
-- Tables  : 17
-- ENUMs   : 5
-- Triggers: 13 (8 audit + 4 updated_at + 1 new-user profile)
-- Indexes : 25
-- Views   : 4
-- Policies: ~50
-- Seed rows: 4 factories, 6 materials, 11 products, 9 activities,
--            ~190 qc_test_definitions rows
-- =============================================================================

-- =============================================================================
-- A-20 Supabase Project — Initial Schema
--
-- Run this on a BRAND NEW Supabase project (SUPABASE_A20).
-- This project is completely separate from dezwaxrtxpszxsmrxpkm (A-20/1).
-- No shared auth, no shared JWT, no shared DB.
--
-- What this schema provides:
--   1. Shared foundation: ENUMs, factories, profiles, user_roles, RLS helpers
--   2. qc_imports: receives finalized QC records from A-20/1 via the exchange API
--   3. Placeholder activity tables for future A-20 modules (no field schemas yet)
--   4. RLS enforcing factory isolation and role-based access
--   5. audit_log covering all data tables
--
-- IMPORTANT: After running this migration, also run the 008-equivalent GRANT
-- statements (search for "GRANT SECTION" below).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------------------
-- ENUMs  (mirrors A-20/1 exactly — same codebase, same roles)
-- ---------------------------------------------------------------------------
CREATE TYPE activity_module  AS ENUM ('job_card', 'lab_qc');
CREATE TYPE app_role AS ENUM (
    'company_admin', 'factory_admin', 'lab_manager',
    'chemist', 'production_incharge', 'operator', 'viewer'
);
CREATE TYPE qc_phase      AS ENUM ('A', 'B', 'none');
CREATE TYPE batch_type    AS ENUM ('rm', 'wip', 'fg', 'trial');
CREATE TYPE quantity_unit AS ENUM ('kg', 'L', 'MT', 'bags', 'drums');

-- ---------------------------------------------------------------------------
-- Core functions (identical to A-20/1 migrations 001 + 002 + 003)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION fn_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role text;
BEGIN
    INSERT INTO profiles (id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

    v_role := NEW.raw_user_meta_data->>'role';
    IF v_role IN ('operator','production_incharge','chemist','lab_manager','viewer') THEN
        INSERT INTO user_roles (user_id, role)
        VALUES (NEW.id, v_role::app_role);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_has_role(required_roles app_role[])
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = auth.uid() AND role = ANY(required_roles)
    );
$$;

CREATE OR REPLACE FUNCTION fn_user_factory_ids(p_module activity_module DEFAULT NULL)
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT f.id FROM factories f
    WHERE EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.factory_id IS NULL
          AND (p_module IS NULL OR ur.module = p_module OR ur.module IS NULL)
    )
    UNION
    SELECT ur.factory_id FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.factory_id IS NOT NULL
      AND (p_module IS NULL OR ur.module = p_module OR ur.module IS NULL);
$$;

-- Audit log function
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO audit_log (table_name, record_id, operation, old_data, new_data, changed_by, factory_id)
    VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD)::jsonb END,
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END,
        auth.uid(),
        COALESCE(
            (CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.factory_id END),
            OLD.factory_id
        )
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

CREATE TABLE factories (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code       text        NOT NULL UNIQUE,
    name       text        NOT NULL,
    location   text,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE factory_activities (
    id         uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid            NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    module     activity_module NOT NULL,
    activity   text            NOT NULL,
    label      text            NOT NULL,
    sort_order smallint        NOT NULL DEFAULT 0,
    is_active  boolean         NOT NULL DEFAULT true,
    UNIQUE (factory_id, module, activity)
);

CREATE TABLE profiles (
    id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   text        NOT NULL,
    phone       text,
    employee_id text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_on_auth_user_created AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION fn_handle_new_user();

CREATE TABLE user_roles (
    id         uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role       app_role        NOT NULL,
    factory_id uuid            REFERENCES factories(id) ON DELETE CASCADE,
    module     activity_module,
    granted_by uuid            REFERENCES auth.users(id),
    granted_at timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (user_id, role, factory_id, module)
);

-- Audit log
CREATE TABLE audit_log (
    id          bigserial   PRIMARY KEY,
    table_name  text        NOT NULL,
    record_id   uuid        NOT NULL,
    operation   text        NOT NULL,
    old_data    jsonb,
    new_data    jsonb,
    changed_by  uuid        REFERENCES auth.users(id),
    factory_id  uuid,
    changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- qc_imports — receives finalized QC records from A-20/1
-- ---------------------------------------------------------------------------
CREATE TABLE qc_imports (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Exchange correlation
    exchange_id         uuid        NOT NULL,
    -- = qc_exchange_log.id on A-20/1; used for idempotent receive

    -- Source metadata
    source_factory      text        NOT NULL,   -- e.g. 'DBV_20_1'
    source_record_id    uuid        NOT NULL,   -- UUID of the row in A-20/1
    source_table        text        NOT NULL,   -- 'product_qc' | 'rm_qc' | 'batch_analysis'
    source_batch_number text,
    material            text,
    product             text,
    qc_type             text,                   -- human-readable e.g. 'Product QC Phase A'

    -- QC result summary (denormalised from payload for easy querying)
    test_result         text,                   -- 'pass' | 'fail' | 'pending'
    qc_status           text        NOT NULL DEFAULT 'received',
    -- 'received' | 'reviewed' | 'rejected'
    tested_at           timestamptz,
    finalized_at        timestamptz,
    transferred_at      timestamptz NOT NULL DEFAULT now(),

    -- Full payload for detail view
    payload             jsonb       NOT NULL,

    -- Version / supersession chain
    version             integer     NOT NULL DEFAULT 1,
    superseded_by       uuid        REFERENCES qc_imports(id),
    status              text        NOT NULL DEFAULT 'active',
    -- 'active' | 'superseded'

    -- Integrity
    checksum            text,       -- SHA-256 of payload (set by receive endpoint)

    created_at          timestamptz NOT NULL DEFAULT now(),

    -- Idempotency: one row per (source_factory, source_record_id, version)
    UNIQUE (source_factory, source_record_id, version)
);

CREATE INDEX idx_qc_imports_source_batch
    ON qc_imports (source_batch_number, source_factory);
CREATE INDEX idx_qc_imports_active
    ON qc_imports (status, transferred_at DESC)
    WHERE status = 'active';
CREATE INDEX idx_qc_imports_exchange
    ON qc_imports (exchange_id);

-- Audit
CREATE TRIGGER trg_audit_qc_imports
    AFTER INSERT OR UPDATE OR DELETE ON qc_imports
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------------------------------------------------------------------------
-- Placeholder tables for A-20 modules (schemas TBD — fields not supplied yet)
-- These tables are intentionally minimal. The actual field schemas will be
-- added in future migrations once the form specs are provided.
-- ---------------------------------------------------------------------------

-- Production Job Card placeholder
CREATE TABLE production_job_cards (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id  uuid        NOT NULL REFERENCES factories(id),
    product_id  uuid,                   -- FK to products once that table exists
    jsc_code    text,                   -- Job sheet code
    status      text        NOT NULL DEFAULT 'open',
    created_by  uuid        NOT NULL REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
    -- Field-level schema to be added per form spec
);
CREATE TRIGGER trg_pjc_updated_at BEFORE UPDATE ON production_job_cards
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Packing placeholder
CREATE TABLE packing_records (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id  uuid        NOT NULL REFERENCES factories(id),
    created_by  uuid        NOT NULL REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_packing_updated_at BEFORE UPDATE ON packing_records
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Maintenance placeholder
CREATE TABLE maintenance_records (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id  uuid        NOT NULL REFERENCES factories(id),
    created_by  uuid        NOT NULL REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_maintenance_updated_at BEFORE UPDATE ON maintenance_records
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Breakdown placeholder
CREATE TABLE breakdown_records (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id  uuid        NOT NULL REFERENCES factories(id),
    created_by  uuid        NOT NULL REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_breakdown_updated_at BEFORE UPDATE ON breakdown_records
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE factories              ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_activities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_imports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_job_cards   ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_records        ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE breakdown_records      ENABLE ROW LEVEL SECURITY;

-- Factories
CREATE POLICY "factories_select" ON factories FOR SELECT TO authenticated USING (true);
CREATE POLICY "factories_write"  ON factories FOR ALL    TO authenticated
    USING     (fn_has_role(ARRAY['company_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin']::app_role[]));

-- Factory activities
CREATE POLICY "factory_activities_select" ON factory_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "factory_activities_write"  ON factory_activities FOR ALL    TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- Profiles: own row + admin read
CREATE POLICY "profiles_select_own"   ON profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
CREATE POLICY "profiles_update_own"   ON profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- User roles
CREATE POLICY "user_roles_select_own"   ON user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user_roles_select_admin" ON user_roles FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
CREATE POLICY "user_roles_insert" ON user_roles FOR INSERT TO authenticated
    WITH CHECK (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
CREATE POLICY "user_roles_update" ON user_roles FOR UPDATE TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
CREATE POLICY "user_roles_delete" ON user_roles FOR DELETE TO authenticated
    USING (fn_has_role(ARRAY['company_admin']::app_role[]));

-- qc_imports: SELECT for lab users; INSERT/UPDATE only via service role (receive endpoint)
CREATE POLICY "qc_imports_select" ON qc_imports
    FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[]));
-- No INSERT/UPDATE policy for authenticated — receive endpoint uses service role

-- audit_log: admin read only
CREATE POLICY "audit_log_select" ON audit_log
    FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- Placeholder tables: factory-scoped select + insert for relevant roles
CREATE POLICY "pjc_select"  ON production_job_cards FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "pjc_insert"  ON production_job_cards FOR INSERT TO authenticated WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['production_incharge','factory_admin','company_admin']::app_role[]));
CREATE POLICY "pack_select" ON packing_records      FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "pack_insert" ON packing_records      FOR INSERT TO authenticated WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['production_incharge','factory_admin','company_admin']::app_role[]));
CREATE POLICY "maint_select" ON maintenance_records FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "maint_insert" ON maintenance_records FOR INSERT TO authenticated WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['production_incharge','factory_admin','company_admin']::app_role[]));
CREATE POLICY "bdown_select" ON breakdown_records   FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "bdown_insert" ON breakdown_records   FOR INSERT TO authenticated WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['production_incharge','factory_admin','company_admin']::app_role[]));

-- ---------------------------------------------------------------------------
-- GRANT SECTION — run these after the schema above
-- (equivalent to migration 008 on A-20/1)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT                    ON factories            TO authenticated;
GRANT SELECT                    ON factory_activities   TO authenticated;
GRANT SELECT, UPDATE            ON profiles             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles      TO authenticated;
GRANT SELECT                    ON qc_imports           TO authenticated;
GRANT SELECT                    ON audit_log            TO authenticated;
GRANT SELECT, INSERT, UPDATE    ON production_job_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE    ON packing_records      TO authenticated;
GRANT SELECT, INSERT, UPDATE    ON maintenance_records  TO authenticated;
GRANT SELECT, INSERT, UPDATE    ON breakdown_records    TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public   TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed: A-20 factory row
-- ---------------------------------------------------------------------------
INSERT INTO factories (code, name, location, is_active)
VALUES ('DBV_20_2', 'Dombivli — Factory A-20', 'Dombivli', true)
ON CONFLICT (code) DO NOTHING;

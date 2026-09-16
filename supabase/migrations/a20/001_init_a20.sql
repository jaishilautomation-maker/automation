-- =============================================================================
-- A-20 Supabase Project — Initial Schema (v2 — fixed function ordering)
--
-- Run this on the JSCI-A20 Supabase project (brand new, empty).
-- Completely separate from dezwaxrtxpszxsmrxpkm (A-20/1).
--
-- Order:
--   1. Extensions
--   2. ENUMs
--   3. Simple utility functions (fn_set_updated_at, fn_handle_new_user,
--      fn_audit_log) — these do NOT reference user_roles/factories at
--      definition time so they are safe to create before tables.
--   4. Core tables (factories, factory_activities, profiles, user_roles,
--      audit_log)
--   5. fn_has_role + fn_user_factory_ids — defined AFTER user_roles and
--      factories exist, which is what Supabase requires.
--   6. QC + placeholder tables
--   7. RLS policies (reference fn_has_role — must come after step 5)
--   8. GRANTs
--   9. Seed data
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------------------
-- 2. ENUMs
-- ---------------------------------------------------------------------------
CREATE TYPE activity_module AS ENUM ('job_card', 'lab_qc');

CREATE TYPE app_role AS ENUM (
    'company_admin', 'factory_admin', 'lab_manager',
    'chemist', 'production_incharge', 'operator', 'viewer'
);

CREATE TYPE qc_phase      AS ENUM ('A', 'B', 'none');
CREATE TYPE batch_type    AS ENUM ('rm', 'wip', 'fg', 'trial');
CREATE TYPE quantity_unit AS ENUM ('kg', 'L', 'MT', 'bags', 'drums');

-- ---------------------------------------------------------------------------
-- 3. Simple utility functions (safe before tables exist)
-- ---------------------------------------------------------------------------

-- Auto-updates updated_at on any table that has that column
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Seeds profiles + user_roles when a new auth user is created.
-- Uses SET search_path to resolve enums in Postgres 15+.
CREATE OR REPLACE FUNCTION fn_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
BEGIN
    INSERT INTO public.profiles (id, full_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
    );

    v_role := NEW.raw_user_meta_data->>'role';
    IF v_role IN ('operator','production_incharge','chemist','lab_manager','viewer') THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, v_role::public.app_role);
    END IF;

    RETURN NEW;
END;
$$;

-- Immutable audit trail — called by trigger on every data table
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.audit_log (
        table_name, record_id, operation,
        old_data, new_data, changed_by, factory_id
    ) VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD)::jsonb END,
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END,
        auth.uid(),
        COALESCE(
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.factory_id END,
            OLD.factory_id
        )
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Core tables
-- (fn_has_role / fn_user_factory_ids defined in step 5 after these)
-- ---------------------------------------------------------------------------

CREATE TABLE public.factories (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code       text        NOT NULL UNIQUE,
    name       text        NOT NULL,
    location   text,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.factory_activities (
    id         uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid            NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
    module     activity_module NOT NULL,
    activity   text            NOT NULL,
    label      text            NOT NULL,
    sort_order smallint        NOT NULL DEFAULT 0,
    is_active  boolean         NOT NULL DEFAULT true,
    UNIQUE (factory_id, module, activity)
);

CREATE TABLE public.profiles (
    id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   text        NOT NULL,
    phone       text,
    employee_id text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Fire fn_handle_new_user when a Supabase Auth user is created
CREATE TRIGGER trg_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION fn_handle_new_user();

CREATE TABLE public.user_roles (
    id         uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role       app_role        NOT NULL,
    factory_id uuid            REFERENCES public.factories(id) ON DELETE CASCADE,
    module     activity_module,
    granted_by uuid            REFERENCES auth.users(id),
    granted_at timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (user_id, role, factory_id, module)
);

CREATE TABLE public.audit_log (
    id          bigserial   PRIMARY KEY,
    table_name  text        NOT NULL,
    record_id   uuid        NOT NULL,
    operation   text        NOT NULL,   -- 'INSERT' | 'UPDATE' | 'DELETE'
    old_data    jsonb,
    new_data    jsonb,
    changed_by  uuid        REFERENCES auth.users(id),
    factory_id  uuid,
    changed_at  timestamptz NOT NULL DEFAULT now()
);

-- Block direct writes to audit_log
CREATE RULE audit_log_no_update AS ON UPDATE TO public.audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO public.audit_log DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Role / factory helper functions
--    Defined HERE — after user_roles and factories tables exist.
-- ---------------------------------------------------------------------------

-- Returns true if the current user has any of the given roles
CREATE OR REPLACE FUNCTION fn_has_role(required_roles app_role[])
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role = ANY(required_roles)
    );
$$;

-- Returns the set of factory UUIDs the current user may access
CREATE OR REPLACE FUNCTION fn_user_factory_ids(p_module activity_module DEFAULT NULL)
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    -- company_admin (factory_id IS NULL) → all factories
    SELECT f.id
    FROM   public.factories f
    WHERE  EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE  ur.user_id     = auth.uid()
          AND  ur.factory_id  IS NULL
          AND  (p_module IS NULL OR ur.module = p_module OR ur.module IS NULL)
    )
    UNION
    -- factory-specific roles
    SELECT ur.factory_id
    FROM   public.user_roles ur
    WHERE  ur.user_id     = auth.uid()
      AND  ur.factory_id  IS NOT NULL
      AND  (p_module IS NULL OR ur.module = p_module OR ur.module IS NULL);
$$;

-- ---------------------------------------------------------------------------
-- 6. QC imports + placeholder tables
-- ---------------------------------------------------------------------------

-- qc_imports: receives finalized QC records pushed from A-20/1
CREATE TABLE public.qc_imports (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange_id         uuid        NOT NULL,
    source_factory      text        NOT NULL,
    source_record_id    uuid        NOT NULL,
    source_table        text        NOT NULL,
    source_batch_number text,
    material            text,
    product             text,
    qc_type             text,
    test_result         text,
    qc_status           text        NOT NULL DEFAULT 'received',
    tested_at           timestamptz,
    finalized_at        timestamptz,
    transferred_at      timestamptz NOT NULL DEFAULT now(),
    payload             jsonb       NOT NULL,
    version             integer     NOT NULL DEFAULT 1,
    superseded_by       uuid        REFERENCES public.qc_imports(id),
    status              text        NOT NULL DEFAULT 'active',
    checksum            text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_factory, source_record_id, version)
);

CREATE INDEX idx_qc_imports_source_batch ON public.qc_imports (source_batch_number, source_factory);
CREATE INDEX idx_qc_imports_active       ON public.qc_imports (status, transferred_at DESC) WHERE status = 'active';
CREATE INDEX idx_qc_imports_exchange     ON public.qc_imports (exchange_id);

CREATE TRIGGER trg_audit_qc_imports
    AFTER INSERT OR UPDATE OR DELETE ON public.qc_imports
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Placeholder: Production Job Card
CREATE TABLE public.production_job_cards (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id  uuid        NOT NULL REFERENCES public.factories(id),
    product_id  uuid,
    jsc_code    text,
    status      text        NOT NULL DEFAULT 'open',
    created_by  uuid        NOT NULL REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_pjc_updated_at BEFORE UPDATE ON public.production_job_cards FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Placeholder: Packing
CREATE TABLE public.packing_records (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id  uuid        NOT NULL REFERENCES public.factories(id),
    created_by  uuid        NOT NULL REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_packing_updated_at BEFORE UPDATE ON public.packing_records FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Placeholder: Maintenance
CREATE TABLE public.maintenance_records (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id  uuid        NOT NULL REFERENCES public.factories(id),
    created_by  uuid        NOT NULL REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_maintenance_updated_at BEFORE UPDATE ON public.maintenance_records FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Placeholder: Breakdown
CREATE TABLE public.breakdown_records (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id  uuid        NOT NULL REFERENCES public.factories(id),
    created_by  uuid        NOT NULL REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_breakdown_updated_at BEFORE UPDATE ON public.breakdown_records FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. RLS
-- (All policies use fn_has_role / fn_user_factory_ids — must come after step 5)
-- ---------------------------------------------------------------------------
ALTER TABLE public.factories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factory_activities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_imports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_job_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packing_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.breakdown_records    ENABLE ROW LEVEL SECURITY;

-- factories
CREATE POLICY "factories_select" ON public.factories FOR SELECT TO authenticated USING (true);
CREATE POLICY "factories_write"  ON public.factories FOR ALL    TO authenticated
    USING     (fn_has_role(ARRAY['company_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin']::app_role[]));

-- factory_activities
CREATE POLICY "factory_activities_select" ON public.factory_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "factory_activities_write"  ON public.factory_activities FOR ALL    TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- profiles
CREATE POLICY "profiles_select_own"   ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_select_admin" ON public.profiles FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
CREATE POLICY "profiles_update_own"   ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- user_roles
CREATE POLICY "user_roles_select_own"   ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user_roles_select_admin" ON public.user_roles FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
CREATE POLICY "user_roles_insert"       ON public.user_roles FOR INSERT TO authenticated
    WITH CHECK (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
CREATE POLICY "user_roles_update"       ON public.user_roles FOR UPDATE TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));
CREATE POLICY "user_roles_delete"       ON public.user_roles FOR DELETE TO authenticated
    USING (fn_has_role(ARRAY['company_admin']::app_role[]));

-- qc_imports: lab roles can read; writes only via service role (receive endpoint)
CREATE POLICY "qc_imports_select" ON public.qc_imports FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[]));

-- audit_log
CREATE POLICY "audit_log_select" ON public.audit_log FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- placeholder tables
CREATE POLICY "pjc_select"   ON public.production_job_cards FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "pjc_insert"   ON public.production_job_cards FOR INSERT TO authenticated WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['production_incharge','factory_admin','company_admin']::app_role[]));
CREATE POLICY "pack_select"  ON public.packing_records      FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "pack_insert"  ON public.packing_records      FOR INSERT TO authenticated WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['production_incharge','factory_admin','company_admin']::app_role[]));
CREATE POLICY "maint_select" ON public.maintenance_records  FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "maint_insert" ON public.maintenance_records  FOR INSERT TO authenticated WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['production_incharge','factory_admin','company_admin']::app_role[]));
CREATE POLICY "bdown_select" ON public.breakdown_records    FOR SELECT TO authenticated USING (factory_id IN (SELECT fn_user_factory_ids()));
CREATE POLICY "bdown_insert" ON public.breakdown_records    FOR INSERT TO authenticated WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()) AND fn_has_role(ARRAY['production_incharge','factory_admin','company_admin']::app_role[]));

-- ---------------------------------------------------------------------------
-- 8. GRANTs
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT                         ON public.factories            TO authenticated;
GRANT SELECT                         ON public.factory_activities   TO authenticated;
GRANT SELECT, UPDATE                 ON public.profiles             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles           TO authenticated;
GRANT SELECT                         ON public.qc_imports           TO authenticated;
GRANT SELECT                         ON public.audit_log            TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.production_job_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.packing_records      TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.maintenance_records  TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.breakdown_records    TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Seed
-- ---------------------------------------------------------------------------
INSERT INTO public.factories (code, name, location, is_active)
VALUES ('DBV_20_2', 'Dombivli — Factory A-20', 'Dombivli', true)
ON CONFLICT (code) DO NOTHING;

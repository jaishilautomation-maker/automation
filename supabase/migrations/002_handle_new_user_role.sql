-- Migration 002: extend fn_handle_new_user to also seed user_roles
-- from the 'role' key stored in raw_user_meta_data at sign-up time.
--
-- IMPORTANT: SET search_path = public is required because SECURITY DEFINER
-- functions run with a restricted search path in Postgres 15+. Without it,
-- the app_role enum is not found and the trigger fails with
-- 'type "app_role" does not exist'.
--
-- The function runs as SECURITY DEFINER so it bypasses RLS — intentional,
-- safe, and only fires on auth.users INSERT.
--
-- Valid self-registration roles: operator, production_incharge, chemist.
-- company_admin / factory_admin must be granted manually by an admin.

DROP FUNCTION IF EXISTS fn_handle_new_user() CASCADE;

CREATE FUNCTION fn_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_full_name text;
    v_role      text;
BEGIN
    v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
    v_role      := NEW.raw_user_meta_data->>'role';

    INSERT INTO public.profiles (id, full_name)
    VALUES (NEW.id, v_full_name);

    IF v_role IN ('operator', 'production_incharge', 'chemist', 'lab_manager', 'viewer') THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, v_role::public.app_role);
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION fn_handle_new_user();

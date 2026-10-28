-- =============================================================================
-- A-20 Migration 020: Add 'stores' to app_role + allow it in the new-user trigger
--
-- Problem: a20/001_init_a20.sql created app_role WITHOUT the 'stores' value
--   (unlike the A-20/1 project, where migration 016b added it for the stores
--   module). So creating a stores user on A-20 fails with
--   "Database error creating new user" / invalid enum value.
--
-- The shared app code (app/(app)/stores/*) gates the Stores module on the
-- 'stores' role, so A-20 needs the same enum value.
--
-- Fix:
--   1. ALTER TYPE app_role ADD VALUE 'stores'   (IF NOT EXISTS -> idempotent)
--   2. Extend fn_handle_new_user so a self-created 'stores' user also gets a
--      user_roles row from metadata, matching the other roles.
--
-- NOTE: A newly added enum value cannot be USED in the same transaction that
--   adds it. This migration only ADDS the value and REDEFINES the trigger
--   function (whose body is not executed at migration time), so it is safe to
--   run as a single transaction. The value is first USED later, at runtime,
--   when a stores user is created.
-- =============================================================================

ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'stores';

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
    )
    ON CONFLICT (id) DO NOTHING;

    v_role := NEW.raw_user_meta_data->>'role';
    IF v_role IN ('operator','production_incharge','chemist','lab_manager','stores','viewer') THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, v_role::public.app_role)
        ON CONFLICT (user_id, role, factory_id, module) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

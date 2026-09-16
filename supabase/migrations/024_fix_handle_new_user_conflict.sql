-- =============================================================================
-- Migration 024: harden fn_handle_new_user against duplicate-key errors
--
-- Problem: when a phone-OTP user logs in for the first time on a project where
-- their auth.users row does NOT yet exist (i.e. the seed script hasn't been
-- run, or the number was entered slightly differently), Supabase creates the
-- auth.users row and fires this trigger.  Two failure modes:
--
--   a) profiles INSERT without full_name → NOT NULL violation (if metadata
--      is missing, which it is for plain OTP sign-ins with no user_metadata).
--   b) profiles INSERT with a duplicate id → PK conflict if the row was
--      already created by the seed script then the trigger fires again.
--
-- Fix:
--   - Use ON CONFLICT (id) DO NOTHING on the profiles INSERT so a pre-existing
--     row (from the seed script) is silently kept.
--   - Fall back to the phone number as full_name when raw_user_meta_data has
--     no full_name and no email — prevents the NOT NULL violation for bare
--     OTP sign-ins.
--   - Keep the user_roles INSERT with ON CONFLICT DO NOTHING (already present
--     in migration 017, replicated here for safety).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_full_name text;
    v_role      text;
BEGIN
    -- Prefer explicit full_name metadata, fall back to email, then phone.
    -- Phone is always present for OTP sign-ins; ensures NOT NULL is never hit.
    v_full_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(NEW.email, ''),
        NEW.phone
    );

    v_role := NEW.raw_user_meta_data->>'role';

    -- ON CONFLICT DO NOTHING: if the seed script already created this row,
    -- leave it intact (preserves the admin-set full_name).
    INSERT INTO public.profiles (id, full_name)
    VALUES (NEW.id, v_full_name)
    ON CONFLICT (id) DO NOTHING;

    -- Only seed user_roles for self-registration roles, and only if the row
    -- doesn't already exist (seed script may have set a different factory_id).
    IF v_role IN ('operator', 'production_incharge', 'chemist', 'lab_manager', 'stores', 'viewer') THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, v_role::public.app_role)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

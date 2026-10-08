-- =============================================================================
-- Migration 063: fn_operator_names — resolve operator user ids to display names
--
-- Why: the Pulveriser Operator dashboard shows a "last 24 hours" handover panel
--   so a night-shift operator can see what the previous (e.g. day-shift)
--   operator already filled. Each job card stores operator_by (a uuid). A plain
--   operator CANNOT read another user's profiles row (RLS restricts profiles
--   SELECT to the user's own row + admins). Rather than widen that policy, this
--   SECURITY DEFINER function returns only { id, full_name } for a given set of
--   user ids — and only for users who share at least one factory with the
--   caller (or the caller is an admin). This keeps the exposure minimal.
--
-- Usage (browser): supabase.rpc('fn_operator_names', { p_ids: ['uuid', ...] })
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_operator_names(p_ids uuid[])
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.full_name
  FROM public.profiles p
  WHERE p.id = ANY(p_ids)
    AND (
      -- caller is a company/factory admin → may resolve any name
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role IN ('company_admin', 'factory_admin')
      )
      -- OR caller shares at least one factory with the target user
      OR EXISTS (
        SELECT 1
        FROM public.user_roles me
        JOIN public.user_roles them
          ON (me.factory_id = them.factory_id OR me.factory_id IS NULL OR them.factory_id IS NULL)
        WHERE me.user_id = auth.uid()
          AND them.user_id = p.id
      )
    );
$$;

-- Callable by any logged-in user; the function body enforces the scoping.
GRANT EXECUTE ON FUNCTION public.fn_operator_names(uuid[]) TO authenticated;

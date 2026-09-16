-- =============================================================================
-- Migration 011: Deactivate Nashik and Sonepat factories
--
-- Architecture change: the current Supabase project (dezwaxrtxpszxsmrxpkm)
-- is being scoped to Dombivli A-20/1 only.
--
-- Nashik (NSK) and Sonepat (SNP) are not yet active and should not appear
-- in the factory picker or any user-facing dropdown.
--
-- SAFE: rows are NOT deleted. All existing data (if any) is preserved.
-- is_active = false hides these factories from:
--   - module-context.tsx factory picker (already filters is_active = true)
--   - company_admin factory list (already filters is_active = true)
--   - RLS fn_user_factory_ids() via the factories JOIN (inactive factories
--     produce no rows, so users assigned to them see nothing — correct)
--
-- Reversible: SET is_active = true to re-enable either factory.
-- =============================================================================

UPDATE public.factories
SET    is_active = false
WHERE  code IN ('NSK', 'SNP');

-- Verify: after running this, the following should return 2 rows:
-- SELECT code, name, is_active FROM factories ORDER BY code;
-- Expected: DBV_20_1 = true, DBV_20_2 = true, NSK = false, SNP = false

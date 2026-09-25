-- =============================================================================
-- Migration 049 (A-20/1 project): Storage RLS for the `report-templates` bucket
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 048.
--
-- Purpose
-- -------
-- Holds the hand-authored Excel (.xlsx) report templates (one per product +
-- form-type, e.g. `sulphur-powder_final-inspection.xlsx`) and their field-map
-- JSON sidecars (`sulphur-powder_final-inspection.json`). At finalization the
-- report generator (lib/reports/generate-filled-report.ts) DOWNLOADS the
-- template in-memory via the service-role key, populates the Named Ranges,
-- exports a Buffer, and emails it as an attachment. Populated reports are
-- NEVER written back here or anywhere persistent — this bucket only ever holds
-- the blank templates + field maps.
--
-- The bucket itself must be created MANUALLY in the Supabase dashboard (same
-- convention as `qc-attachments` in migration 010):
--   Storage → New bucket → Name: "report-templates" → Private (NOT public)
--
-- Access model
-- ------------
--   * The generator runs server-side with SUPABASE_SERVICE_ROLE_KEY, which
--     bypasses Storage RLS entirely — so no policy is needed for it to read.
--   * The policies below let lab_manager / factory_admin / company_admin
--     UPLOAD and REPLACE templates from the app if we ever add an admin
--     upload screen. Normal authenticated users get read-only, so nothing in
--     the browser can tamper with a template.
--   * No public access — the bucket is private.
-- =============================================================================

-- SELECT: any authenticated user may read a template (needed if the app ever
-- previews a template; the generator itself uses the service role).
CREATE POLICY "report_templates_select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'report-templates');

-- INSERT: only lab managers / admins may upload a new template or field map.
CREATE POLICY "report_templates_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'report-templates'
    AND fn_has_role(ARRAY[
        'lab_manager','factory_admin','company_admin'
    ]::app_role[])
);

-- UPDATE: only lab managers / admins may replace an existing template.
CREATE POLICY "report_templates_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'report-templates'
    AND fn_has_role(ARRAY[
        'lab_manager','factory_admin','company_admin'
    ]::app_role[])
)
WITH CHECK (
    bucket_id = 'report-templates'
    AND fn_has_role(ARRAY[
        'lab_manager','factory_admin','company_admin'
    ]::app_role[])
);

-- DELETE: only lab managers / admins may remove a template.
CREATE POLICY "report_templates_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'report-templates'
    AND fn_has_role(ARRAY[
        'lab_manager','factory_admin','company_admin'
    ]::app_role[])
);

-- Migration 049 complete: report-templates storage RLS policies created.
-- REMINDER: create the private "report-templates" bucket in the dashboard.

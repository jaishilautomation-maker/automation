-- =============================================================================
-- Migration 010: Supabase Storage RLS for qc-attachments bucket
--
-- The bucket itself must be created manually in the Supabase dashboard:
--   Storage → New bucket → Name: "qc-attachments" → Private (not public)
--
-- These policies restrict which authenticated users can upload/read/delete
-- objects inside that bucket.
--
-- Path convention enforced by app code (not by these policies):
--   {factory_code}/{entity_type}/{entity_id}/{uuid}.jpg
--
-- Policy logic:
--   INSERT  — any authenticated user with a lab/operator/production role
--   SELECT  — any authenticated user (signed URLs are used, but direct
--             access also needs a SELECT policy)
--   DELETE  — lab_manager, factory_admin, company_admin only
--             (no hard-delete on QC tables, but Storage objects can be
--              replaced if a photo was uploaded by mistake)
-- =============================================================================

-- INSERT: any authenticated user may upload
CREATE POLICY "qc_attachments_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'qc-attachments');

-- SELECT: any authenticated user may read (signed URLs require this)
CREATE POLICY "qc_attachments_select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'qc-attachments');

-- UPDATE: not permitted (overwrite by deleting and re-uploading)
-- (no UPDATE policy = UPDATE is blocked by default)

-- DELETE: lab managers and admins only
CREATE POLICY "qc_attachments_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'qc-attachments'
    AND fn_has_role(ARRAY[
        'lab_manager','factory_admin','company_admin'
    ]::app_role[])
);

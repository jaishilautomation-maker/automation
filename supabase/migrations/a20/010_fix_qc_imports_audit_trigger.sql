-- =============================================================================
-- A-20 Migration 010: Fix qc_imports audit trigger
--
-- Problem:
--   The trg_audit_qc_imports trigger calls fn_audit_log(), which tries to read
--   NEW.factory_id. But qc_imports has no factory_id column, so every INSERT
--   into qc_imports fails with:
--     "record 'new' has no field 'factory_id'"
--   This blocked every incoming QC sync from A-20/1.
--
-- Fix:
--   Drop the incompatible audit trigger from qc_imports. The table already has
--   full traceability via exchange_id, checksum, source_factory, transferred_at
--   and version — the generic factory_id audit trail is not needed here.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_audit_qc_imports ON public.qc_imports;

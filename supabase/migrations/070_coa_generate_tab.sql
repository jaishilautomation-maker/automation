-- =============================================================================
-- Migration 070 — Generate COA tab (JSCI/QC/17)
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 069.
--
-- Adds everything the chemist-facing "Generate COA" tab needs on top of the
-- COA scaffolding from 037 / 045 / 047:
--
--   Part A — coa_customer_specs: + test_method, remarks, sort_order
--            (the certificate's "TEST METHOD" and "REMARKS" columns, and a
--             fixed per-party row order like the paper form).
--
--   Part B — parties: + default_ship_to  (optional single default address);
--            NEW party_ship_to_addresses table (a party may have several
--            dispatch addresses — e.g. CEAT plants — shown as a dropdown).
--
--   Part C — coa_documents: reworked to be driven by batch_analysis (the live
--            Final-Inspection table) instead of a single product_qc row, and
--            to store an immutable JSONB snapshot that is the source of truth
--            for re-rendering the PDF. product_qc_id becomes NULLABLE.
--
--   Part D — RLS: INSERT/SELECT for chemist (+ admins) in A-20/1; the snapshot
--            is immutable (no column except email_status/email_error may change
--            after insert) so an issued COA always re-renders identically.
--
-- This migration is ADDITIVE and touches ONLY the COA tables + parties. It does
-- not alter batch_analysis, product_qc, or any Job Card / Lab QC table, so it
-- cannot break those flows.
-- =============================================================================

-- ─── Part A: coa_customer_specs — method / remarks / order ──────────────────
ALTER TABLE public.coa_customer_specs
    ADD COLUMN IF NOT EXISTS test_method text,
    ADD COLUMN IF NOT EXISTS remarks     text,
    ADD COLUMN IF NOT EXISTS sort_order  smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.coa_customer_specs.test_method IS
    'Printed in the COA "TEST METHOD" column, e.g. "IS-6655", "IS-7086", '
    '"GTIC F-2405". NULL prints blank.';
COMMENT ON COLUMN public.coa_customer_specs.remarks IS
    'Printed in the COA "REMARKS" column, e.g. "CODE NO: M2615", '
    '"BT CODE: CS01". NULL prints blank.';
COMMENT ON COLUMN public.coa_customer_specs.sort_order IS
    'Row order on the certificate (ascending). Lets each party pin its rows to '
    'the fixed JSCI/QC/17 Sr. No. layout independent of insert order.';

-- ─── Part B: party default + multi-address dropdown ─────────────────────────
ALTER TABLE public.parties
    ADD COLUMN IF NOT EXISTS default_ship_to text;

COMMENT ON COLUMN public.parties.default_ship_to IS
    'Optional single default ship-to address prefilled on the COA form. For '
    'customers with several plants (CEAT, MRF) use party_ship_to_addresses '
    'instead — that drives a dropdown.';

CREATE TABLE IF NOT EXISTS public.party_ship_to_addresses (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    party_code  text        NOT NULL REFERENCES public.parties(party_code) ON DELETE CASCADE,
    label       text        NOT NULL,          -- short name shown in the dropdown, e.g. "Dahej plant"
    address     text        NOT NULL,          -- full ship-to block printed on the COA
    sort_order  smallint    NOT NULL DEFAULT 0,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid        REFERENCES auth.users(id),
    UNIQUE (party_code, label)
);

CREATE INDEX IF NOT EXISTS idx_party_ship_to_party
    ON public.party_ship_to_addresses (party_code, sort_order);

ALTER TABLE public.party_ship_to_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "party_ship_to_select" ON public.party_ship_to_addresses;
DROP POLICY IF EXISTS "party_ship_to_write"  ON public.party_ship_to_addresses;

-- Readable by all authenticated (needed to populate the dropdown); writable by
-- admins only (master data), matching parties (044).
CREATE POLICY "party_ship_to_select" ON public.party_ship_to_addresses
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "party_ship_to_write" ON public.party_ship_to_addresses
    FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['factory_admin','company_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['factory_admin','company_admin']::app_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_ship_to_addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_ship_to_addresses TO service_role;

-- Seed the two addresses visible on the sample certificates (COA #395, #400).
-- All other customers' addresses are supplied later by an admin; until then the
-- chemist types the ship-to manually (the form requires a non-blank address).
INSERT INTO public.party_ship_to_addresses (party_code, label, address, sort_order)
VALUES
    ('M2615', 'Dahej (Gujarat)',
     E'M.R.F. LTD. (GUJARAT) DAHEJ.\nPLOT NO.D2-16, DAHEJ INDUSTRIAL ESTATE,\nTAL.VAGRA, DIST. BHARUCH,\nGUJARAT-392130', 0),
    ('BT-CS01', 'Baleswar (Odisha)',
     E'DALMIA BHARAT REFRACTORIES LTD.\nKHATA NO.497/1925\nPLOT NO.1747/2023\nROAD/STREET: BALASORE\nLOCALITY/SUBLOCALITY: CHHANPUR,\nCITY/TOWN/VILLAGE: BALESWAR\nDISTRICT: BALESWAR, STATE: ODISHA\nPIN CODE: 756056', 0)
ON CONFLICT (party_code, label) DO NOTHING;

-- ─── Part C: coa_documents — batch_analysis driven + immutable snapshot ─────
-- product_qc_id was NOT NULL and FK'd to a single product_qc row. The live COA
-- is driven by batch_analysis (one or more batches), so make it NULLABLE and
-- keep it only as an optional back-reference.
ALTER TABLE public.coa_documents
    ALTER COLUMN product_qc_id DROP NOT NULL;

ALTER TABLE public.coa_documents
    ADD COLUMN IF NOT EXISTS party_code     text,                       -- the party certified against
    ADD COLUMN IF NOT EXISTS ship_to        text,                       -- resolved + possibly-edited ship-to block
    ADD COLUMN IF NOT EXISTS doc_label      text NOT NULL DEFAULT 'Invoice No.',  -- 'Invoice No.' | 'Challan No.'
    ADD COLUMN IF NOT EXISTS truck_no       text,                       -- alias for vehicle_no on the new form
    ADD COLUMN IF NOT EXISTS batch_numbers  text[],                     -- e.g. {'347','349'}
    ADD COLUMN IF NOT EXISTS mfg_dates      date[],                     -- one per batch
    ADD COLUMN IF NOT EXISTS quantity_mt    numeric(12, 3),             -- total MT for this COA
    ADD COLUMN IF NOT EXISTS snapshot       jsonb,                      -- source of truth (see below)
    ADD COLUMN IF NOT EXISTS email_status   text,                       -- 'sent' | 'failed' | NULL (pending)
    ADD COLUMN IF NOT EXISTS email_error    text,
    ADD COLUMN IF NOT EXISTS created_by     uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS created_at     timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.coa_documents.snapshot IS
    'Complete resolved COA as of generation time: letterhead, meta, and the '
    'fully-resolved parameter rows (label, per-batch actuals, min, max, method, '
    'remarks, pass/fail). The PDF is ALWAYS re-rendered from this — QC records '
    'or spec limits may change later, but an issued COA must render identically.';
COMMENT ON COLUMN public.coa_documents.email_status IS
    'NULL = send pending/in-progress, ''sent'' = delivered, ''failed'' = delivery '
    'failed (number already consumed; use Retry send — never a new number).';

CREATE INDEX IF NOT EXISTS idx_coa_docs_invoice
    ON public.coa_documents (invoice_no);

-- ─── Part D: RLS — chemist can issue; snapshot immutable ────────────────────
-- 037 created coa_docs_insert for chemist/lab_manager/factory_admin/company_admin
-- and coa_docs_update for lab_manager/factory_admin/company_admin. We KEEP insert
-- as-is (chemist can create — matches the "all chemists" decision) but REPLACE
-- the update policy with an immutability guard: a chemist (and admins) may touch
-- ONLY email_status / email_error (needed for the Retry-send path); every other
-- column is frozen after insert, enforced by a trigger below.

DROP POLICY IF EXISTS "coa_docs_update" ON public.coa_documents;

CREATE POLICY "coa_docs_update" ON public.coa_documents
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[])
    )
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[])
    );

-- Immutability trigger: only email_status / email_error may change on UPDATE.
-- Any attempt to alter the snapshot, number, dispatch details, etc. is rejected.
-- (Corrections = a brand-new COA with a new number; void/reissue is out of scope.)
CREATE OR REPLACE FUNCTION public.fn_coa_documents_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF  NEW.id             IS DISTINCT FROM OLD.id
     OR NEW.test_report_no IS DISTINCT FROM OLD.test_report_no
     OR NEW.factory_id     IS DISTINCT FROM OLD.factory_id
     OR NEW.party_code     IS DISTINCT FROM OLD.party_code
     OR NEW.customer_name  IS DISTINCT FROM OLD.customer_name
     OR NEW.ship_to        IS DISTINCT FROM OLD.ship_to
     OR NEW.doc_label      IS DISTINCT FROM OLD.doc_label
     OR NEW.invoice_no     IS DISTINCT FROM OLD.invoice_no
     OR NEW.vehicle_no     IS DISTINCT FROM OLD.vehicle_no
     OR NEW.truck_no       IS DISTINCT FROM OLD.truck_no
     OR NEW.lot_no         IS DISTINCT FROM OLD.lot_no
     OR NEW.batch_no       IS DISTINCT FROM OLD.batch_no
     OR NEW.batch_numbers  IS DISTINCT FROM OLD.batch_numbers
     OR NEW.mfg_date       IS DISTINCT FROM OLD.mfg_date
     OR NEW.mfg_dates      IS DISTINCT FROM OLD.mfg_dates
     OR NEW.qty            IS DISTINCT FROM OLD.qty
     OR NEW.quantity_mt    IS DISTINCT FROM OLD.quantity_mt
     OR NEW.snapshot       IS DISTINCT FROM OLD.snapshot
     OR NEW.created_by     IS DISTINCT FROM OLD.created_by
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at
     OR NEW.generated_by   IS DISTINCT FROM OLD.generated_by
    THEN
        RAISE EXCEPTION
            'coa_documents is immutable: only email_status / email_error may '
            'change after a COA is issued (test_report_no %). Create a new COA '
            'for corrections.', OLD.test_report_no
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coa_documents_immutable ON public.coa_documents;
CREATE TRIGGER trg_coa_documents_immutable
    BEFORE UPDATE ON public.coa_documents
    FOR EACH ROW EXECUTE FUNCTION public.fn_coa_documents_immutable();

-- ─── Test Report No. seed ───────────────────────────────────────────────────
-- test_report_no is auto-assigned from coa_report_seq (037). The chemist never
-- types it. The sequence currently continues from wherever it is (START WITH 1).
--
-- >>> TO CONTINUE THE PAPER REGISTER: uncomment the next line and set it to the
-- >>> LAST Test Report No. issued on paper. The NEXT generated COA will be
-- >>> that number + 1. Leave commented to keep the current sequence value.
-- SELECT setval('public.coa_report_seq', 400, true);   -- e.g. last paper no. = 400 -> next = 401

-- ─── Atomic report-number claim ─────────────────────────────────────────────
-- The COA generator claims the next number via this RPC (nextval is atomic) so
-- the number can be baked into the immutable snapshot BEFORE the row is inserted
-- (the snapshot is frozen on insert by the trigger above). Two concurrent
-- callers get two distinct numbers; UNIQUE(test_report_no) is the final guard.
CREATE OR REPLACE FUNCTION public.fn_coa_next_report_no()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT nextval('public.coa_report_seq');
$$;

GRANT EXECUTE ON FUNCTION public.fn_coa_next_report_no() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_coa_next_report_no() TO service_role;

-- =============================================================================
-- END 070
-- =============================================================================

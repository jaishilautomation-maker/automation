-- =============================================================================
-- Migration 042 (A-20/1 project): widen v_factory_qc_summary to all QC tables
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 041.
--
-- Problem: the Lab QC dashboard (app/(app)/dashboard/page.tsx) queries
-- v_factory_qc_summary and shows "No QC records in this period" even when
-- rm_qc / batch_analysis / lab_trials records exist. Root cause: the view
-- (001_initial_schema.sql, 8.3) only ever selected from product_qc — it never
-- included rm_qc, batch_analysis, or lab_trials. Any factory whose QC activity
-- is concentrated in those tables (e.g. Crude Sulphur incoming inspection,
-- Sulphur Powder batch analysis) will always show an empty dashboard, because
-- from this view's perspective zero qualifying rows exist.
--
-- Fix: rebuild the view as a UNION ALL across all four QC tables that carry
-- appearance_ok (rm_qc, batch_analysis, product_qc, lab_trials), using each
-- table's own "label" (material name / "Batch Analysis" / product name /
-- trial code) as the product_name column so the existing dashboard grouping
-- table (`Object.entries(byProduct)...`) works unmodified.
--
-- hourly_readings is intentionally excluded — it's an append-only log with no
-- appearance_ok column (no pass/fail concept per SOP).
--
-- CREATE OR REPLACE VIEW is safe/idempotent as long as the column list and
-- order are unchanged (they are — same 7 columns as before).
-- =============================================================================

CREATE OR REPLACE VIEW public.v_factory_qc_summary AS
SELECT
    rq.factory_id,
    f.name                                            AS factory_name,
    rq.test_date,
    COALESCE(m.name, 'Raw Material QC')               AS product_name,
    COUNT(*)                                          AS total_tests,
    COUNT(*) FILTER (WHERE rq.appearance_ok = true)   AS passed,
    COUNT(*) FILTER (WHERE rq.appearance_ok = false)  AS failed
FROM      public.rm_qc rq
JOIN      public.factories f ON f.id = rq.factory_id
LEFT JOIN public.materials m ON m.id = rq.material_id
GROUP BY  rq.factory_id, f.name, rq.test_date, m.name

UNION ALL

SELECT
    ba.factory_id,
    f.name                          AS factory_name,
    ba.analysis_date                AS test_date,
    'Batch Analysis'                AS product_name,
    COUNT(*)                        AS total_tests,
    COUNT(*) FILTER (WHERE ba.appearance_ok = true)  AS passed,
    COUNT(*) FILTER (WHERE ba.appearance_ok = false) AS failed
FROM      public.batch_analysis ba
JOIN      public.factories f ON f.id = ba.factory_id
GROUP BY  ba.factory_id, f.name, ba.analysis_date

UNION ALL

SELECT
    pq.factory_id,
    f.name              AS factory_name,
    pq.test_date,
    p.name               AS product_name,
    COUNT(*)             AS total_tests,
    COUNT(*) FILTER (WHERE pq.appearance_ok = true)  AS passed,
    COUNT(*) FILTER (WHERE pq.appearance_ok = false) AS failed
FROM      public.product_qc pq
JOIN      public.factories f ON f.id = pq.factory_id
JOIN      public.products  p ON p.id = pq.product_id
GROUP BY  pq.factory_id, f.name, pq.test_date, p.name

UNION ALL

SELECT
    lt.factory_id,
    f.name                                    AS factory_name,
    lt.trial_date                             AS test_date,
    COALESCE('Trial: ' || lt.trial_code, 'Lab Trial') AS product_name,
    COUNT(*)                                  AS total_tests,
    COUNT(*) FILTER (WHERE lt.appearance_ok = true)  AS passed,
    COUNT(*) FILTER (WHERE lt.appearance_ok = false) AS failed
FROM      public.lab_trials lt
JOIN      public.factories f ON f.id = lt.factory_id
GROUP BY  lt.factory_id, f.name, lt.trial_date, lt.trial_code;

GRANT SELECT ON public.v_factory_qc_summary TO authenticated;
GRANT SELECT ON public.v_factory_qc_summary TO service_role;

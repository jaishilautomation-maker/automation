-- =============================================================================
-- A-20 Migration 006: Create views required by the shared frontend
--
-- The dashboard page queries v_factory_qc_summary which only existed in A-20/1.
-- Create it here so the Lab QC dashboard works on A-20 as well.
-- Also create v_unified_search for the search page.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- v_factory_qc_summary
-- Per-factory daily pass/fail counts from product_qc + products + factories
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_factory_qc_summary AS
SELECT
    pq.factory_id,
    f.name                              AS factory_name,
    pq.test_date,
    p.name                              AS product_name,
    COUNT(*)                            AS total_tests,
    COUNT(*) FILTER (WHERE pq.appearance_ok = true)  AS passed,
    COUNT(*) FILTER (WHERE pq.appearance_ok = false) AS failed
FROM   public.product_qc  pq
JOIN   public.products    p  ON p.id  = pq.product_id
JOIN   public.factories   f  ON f.id  = pq.factory_id
GROUP  BY pq.factory_id, f.name, pq.test_date, p.name;

GRANT SELECT ON public.v_factory_qc_summary TO authenticated;

-- ---------------------------------------------------------------------------
-- v_unified_search
-- Full-text search across batches + factories + materials + products
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_unified_search AS
SELECT
    b.id                                AS batch_id,
    b.batch_number,
    b.lot_number,
    b.factory_id,
    f.name                              AS factory_name,
    b.batch_type,
    b.production_date,
    b.material_id,
    m.name                              AS material_name,
    b.product_id,
    p.name                              AS product_name,
    pr.full_name                        AS created_by_name,
    to_tsvector('english',
        coalesce(b.batch_number, '') || ' ' ||
        coalesce(b.lot_number, '')   || ' ' ||
        coalesce(m.name, '')         || ' ' ||
        coalesce(p.name, '')         || ' ' ||
        coalesce(f.name, '')         || ' ' ||
        coalesce(pr.full_name, '')
    )                                   AS search_vector
FROM   public.batches   b
LEFT JOIN public.materials  m  ON m.id  = b.material_id
LEFT JOIN public.products   p  ON p.id  = b.product_id
JOIN      public.factories  f  ON f.id  = b.factory_id
LEFT JOIN public.profiles   pr ON pr.id = b.created_by;

GRANT SELECT ON public.v_unified_search TO authenticated;

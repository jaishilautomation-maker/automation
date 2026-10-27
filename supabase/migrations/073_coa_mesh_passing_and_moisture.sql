-- =============================================================================
-- Migration 073 — COA mesh "% passing" display + deactivate moisture test
--
-- Two reviewer-requested changes (confirmed against the real customer spec
-- sheets and the live Jaishil COAs):
--
--   #2  MRF (M2615) mesh must print as "% PASSING", not "% retained".
--       batch_analysis stores mesh as % RETAINED (meshNNN_pct = retained/
--       sample*100). The real MRF COAs (test reports #875, #202) print the
--       passing figure (100, 99.93, 94.26 …). So add a per-spec flag
--       `display_as_passing`; when true the COA shows (100 - retained) and the
--       pass/fail is evaluated on that passing basis. Customers who genuinely
--       spec "sieve residue max X" (CEAT, Apollo, Birla) keep retained
--       (flag stays false), so this is per-customer, not global.
--
--   #3  Remove the Moisture test from the Final Inspection form, using Heat
--       Loss instead. Implemented as DEACTIVATION (is_active = false) of the
--       SULPHUR_POWDER phase-B `moisture_percent` qc_test_definition, NOT a
--       delete — every historical batch_analysis.test_results.moisture_percent
--       value is preserved, and any COA snapshot already issued is unaffected.
--
-- NOTE on #1 (WE-10 "insoluble residue" instead of purity): deferred. WE-10 is
-- Bridgestone, which uses a different certificate template not yet built, AND
-- its spec is "insoluble in CARBON DISULFIDE" whereas our QC field is
-- insolubility in TOLUENE — a different test. Not mapped here to avoid
-- certifying against the wrong solvent. Revisit with the Bridgestone template.
--
-- Run on the A-20/1 Supabase project, after 072.
-- =============================================================================

-- ─── Part A: display_as_passing flag on coa_customer_specs ──────────────────
ALTER TABLE public.coa_customer_specs
    ADD COLUMN IF NOT EXISTS display_as_passing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.coa_customer_specs.display_as_passing IS
    'TRUE for a mesh row whose ACTUAL should print as % PASSING (= 100 - '
    'retained) rather than the % retained stored in batch_analysis. The spec '
    'min/max for this row are then also on the passing basis. Used by MRF, '
    'whose COAs report "% passing on wet sieve". Default false = report retained.';

-- ─── Part B: MRF mesh rows (on the passing basis) ───────────────────────────
-- MRF's real COA prints three mesh rows as "% passing on wet sieve":
--   150µ / 100 mesh, 75µ / 200 mesh, 45µ / 325 mesh.
-- The only numeric sieve spec visible on MRF paperwork is 200-mesh min 95.00
-- (test report #202). 100-mesh prints ~100 (effectively min 99). 325-mesh is
-- reported but carries no stated limit. Rows are inserted with
-- display_as_passing = true and labelled accordingly; adjust min/max here if
-- MRF confirms tighter limits.
INSERT INTO public.coa_customer_specs
    (party_code, customer_name, parameter, parameter_label, unit,
     min_value, max_value, target_value, needs_verification, display_as_passing)
VALUES
    ('M2615','MRF Ltd','mesh100_pct','% passing on wet sieve (150µ) 100 mesh','%',99.0, NULL, NULL, true,  true),
    ('M2615','MRF Ltd','mesh200_pct','% passing on wet sieve (75µ) 200 mesh', '%',95.0, NULL, NULL, false, true),
    ('M2615','MRF Ltd','mesh325_pct','% passing on wet sieve (45µ) 325 mesh', '%',NULL, NULL, NULL, true,  true)
ON CONFLICT (customer_name, parameter, product_code) DO UPDATE
   SET parameter_label     = EXCLUDED.parameter_label,
       min_value           = EXCLUDED.min_value,
       max_value           = EXCLUDED.max_value,
       display_as_passing  = EXCLUDED.display_as_passing,
       needs_verification  = EXCLUDED.needs_verification,
       is_active           = true;

-- ─── Part C: deactivate the moisture test definition (keep historical data) ──
-- SULPHUR_POWDER, phase 'B', test_key 'moisture_percent' → is_active = false so
-- it no longer renders on the Final Inspection form. Heat Loss (heat_loss_percent,
-- added in 040) remains and is the replacement. Also deactivate the raw moisture
-- input fields that feed it so the form doesn't show orphaned inputs.
UPDATE public.qc_test_definitions d
   SET is_active = false
  FROM public.materials m
 WHERE d.material_id = m.id
   AND m.code = 'SULPHUR_POWDER'
   AND d.phase = 'B'
   AND d.test_key IN ('moisture_percent', 'moisture_m_before', 'moisture_m1_after');

-- =============================================================================
-- END 073
-- =============================================================================

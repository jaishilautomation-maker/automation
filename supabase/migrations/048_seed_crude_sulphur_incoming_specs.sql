-- =============================================================================
-- Migration 048 — Seed Crude Sulphur INCOMING QC specs (IS-6655 A / B Grade)
--
-- Source: JSCI/QC/03 "TEST REPORT OF CRUDE SULPHUR INCOMING" spec sheet.
-- This gives the RM QC Crude Sulphur form the same live per-parameter spec +
-- pass/fail badge that Batch Analysis already has — driven by the shared
-- coa_customer_specs table so no new plumbing is needed.
--
-- HOW IT PLUGS IN:
--   The chemist does NOT pick a grade. The RM QC page auto-loads the A-grade
--   limits (party_code = 'SULPHUR_A_GRADE') to show each parameter's spec +
--   pass/fail inline, then DETERMINES the grade from the entered values:
--       purity >= 98 AND all A limits met            → A
--       purity 90–97.99, or purity >= 98 but a limit exceeded → B
--       purity < 90                                  → Reject
--   We register two synthetic "grade" party codes:
--       SULPHUR_A_GRADE  → IS-6655 A Grade limits  (used by the page)
--       SULPHUR_B_GRADE  → IS-6655 B Grade limits  (reference only; the page
--                           derives B from the A-grade check, does not load it)
--
--   parameter MUST match an ACTIVE Crude Sulphur (material SULPHUR_CRUDE, phase
--   'none') qc_test_definitions test_key so the field badge lines up:
--       purity_percent, acidity_percent, ash_percent, moisture_percent.
--
--   ⚠ heat_loss_percent: the spec sheet has a "Heat of loss at 70C/2hr" row,
--   but the CURRENT active Crude Sulphur field set (001, after the 034/039
--   revert) captures MOISTURE, not heat-loss — there is NO active
--   heat_loss_percent field. So a heat_loss_percent spec row would have no field
--   to attach to and is intentionally NOT seeded here. If a heat-loss field is
--   later added to Crude Sulphur RM QC, add its A/B rows in a follow-up
--   migration. (Moisture is seeded against the sheet's heat-loss limits as the
--   closest active analog and flagged needs_verification — see note below.)
--
-- SHEET LIMITS (%)             A GRADE            B GRADE
--   Purity / solubility CS2    98  – 100          90 – 97.99
--   Acidity as H2SO4           max 0.010          ABOVE 0.010   (worse-than-A band)
--   Ash content                max 0.10           ABOVE 0.10
--   Heat of loss 70C/2hr       max 0.30           ABOVE 0.30
--
-- ⚠ GRADE-B SEMANTICS: the sheet's B-grade columns state "ABOVE X" — i.e. the
--   B band is the range WORSE than A grade. Encoding acidity/ash B as
--   "min 0.010 / min 0.10" is literal to the sheet but means a clean low reading
--   would read as "below the B band". In practice incoming material is graded A
--   when it meets the A limits; B is the fallback band. The A-grade rows are the
--   ones that matter for the pass/fail decision. All B-grade "above" rows are
--   flagged needs_verification=true so a human confirms how B should evaluate.
--
-- Idempotent: parties upsert ON CONFLICT DO NOTHING; specs cleared for these two
-- grade codes first, then re-inserted. Uses the table UNIQUE
-- (customer_name, parameter, product_code).
-- =============================================================================

-- Register the two synthetic grade "parties" so the RM QC Grade selector can
-- list + look them up through the existing parties/specs plumbing.
INSERT INTO public.parties (party_code, customer_name) VALUES
    ('SULPHUR_A_GRADE', 'Crude Sulphur — A Grade (IS-6655)'),
    ('SULPHUR_B_GRADE', 'Crude Sulphur — B Grade (IS-6655)')
ON CONFLICT (party_code) DO NOTHING;

-- Converge on re-run: clear any prior seed for these two grade codes.
DELETE FROM public.coa_customer_specs
WHERE party_code IN ('SULPHUR_A_GRADE', 'SULPHUR_B_GRADE');

INSERT INTO public.coa_customer_specs
    (party_code, customer_name, parameter, parameter_label, unit, min_value, max_value, target_value, needs_verification)
VALUES
    -- ── A GRADE (IS-6655) ─────────────────────────────────────────────────
    ('SULPHUR_A_GRADE','Crude Sulphur — A Grade (IS-6655)','purity_percent','Purity / solubility in CS2','%',98.0,100.0,NULL,false),
    ('SULPHUR_A_GRADE','Crude Sulphur — A Grade (IS-6655)','acidity_percent','Acidity (as H2SO4)','%',NULL,0.010,NULL,false),
    ('SULPHUR_A_GRADE','Crude Sulphur — A Grade (IS-6655)','ash_percent','Ash content','%',NULL,0.10,NULL,false),
    -- Moisture stands in for the sheet's "Heat of loss 70C/2hr" (no active
    -- heat-loss field on Crude Sulphur). Flagged for verification.
    ('SULPHUR_A_GRADE','Crude Sulphur — A Grade (IS-6655)','moisture_percent','Heat of loss (70C/2hr)','%',NULL,0.30,NULL,true),

    -- ── B GRADE (IS-6655) — "ABOVE A-grade" band; all need_verification ─────
    ('SULPHUR_B_GRADE','Crude Sulphur — B Grade (IS-6655)','purity_percent','Purity / solubility in CS2','%',90.0,97.99,NULL,false),
    ('SULPHUR_B_GRADE','Crude Sulphur — B Grade (IS-6655)','acidity_percent','Acidity (as H2SO4)','%',0.010,NULL,NULL,true),
    ('SULPHUR_B_GRADE','Crude Sulphur — B Grade (IS-6655)','ash_percent','Ash content','%',0.10,NULL,NULL,true),
    ('SULPHUR_B_GRADE','Crude Sulphur — B Grade (IS-6655)','moisture_percent','Heat of loss (70C/2hr)','%',0.30,NULL,NULL,true);

-- =============================================================================
-- END 048
-- Seeded IS-6655 A/B grade incoming specs for Crude Sulphur RM QC.
-- needs_verification=true rows: the moisture↔heat-loss mapping and every
-- B-grade "above" bound — confirm against the physical JSCI/QC/03 sheet and
-- decide B-grade evaluation semantics before relying on the pass/fail result.
-- =============================================================================

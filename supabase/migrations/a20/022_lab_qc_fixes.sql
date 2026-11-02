-- =============================================================================
-- A-20 Migration 022: Lab QC fixes
--
-- Fix 1 (Issue 1 + 2) — sort_order: interleave each calculated result
-- immediately after its last input so the frontend's flat sort_order render
-- puts the result box directly under its inputs.
--
-- Strategy: for each material/product, re-number all fields using a dense
-- sequence.  Inputs keep their relative order; each calculated result is
-- assigned sort_order = (last_input_sort_order_of_its_group) + 1, and
-- subsequent groups are shifted up to keep room.  We use explicit constant
-- values to be idempotent.
--
-- Fix 2 (Issue 2) — also corrects sg_result / bd_result for SULPHUR_POWDER
-- which were seeded as plain inputs at sort_order 23–29 then had their
-- formula set by migration 007 but sort_order was never updated.
--
-- Fix 3 (Issue 3) — Product QC: make batch_id nullable, add batch_no text
-- column, drop the old UNIQUE(batch_id,product_id,phase) constraint and
-- replace with one that works for both linked and unlinked batches.
-- =============================================================================

-- ============================================================
-- PART A: sort_order re-numbering (Issues 1 & 2)
-- ============================================================

-- ── SULPHUR POWDER ──────────────────────────────────────────
-- Group layout (new sort_orders):
--   1  coa_received          (select)
--   2  purity_required       (select)
--   3  batch_number          (text)
-- Purity group (inputs 10–12, result 13):
--   10 purity_empty_crucible
--   11 purity_sample_mass
--   12 purity_w2
--   13 purity_result         ← calc result immediately after group
-- Acidity group (20–24, result 25):
--   20 acidity_v1
--   21 acidity_v2
--   22 acidity_n
--   23 acidity_m
--   25 acidity_result
-- Sieve 100 (30–31, result 32):
--   30 sieve100_sample
--   31 sieve100_retained
--   32 sieve100_result
-- Sieve 200 (40–41, result 42):
--   40 sieve200_sample
--   41 sieve200_retained
--   42 sieve200_result
-- Sieve 325 (50–51, result 52):
--   50 sieve325_sample
--   51 sieve325_retained
--   52 sieve325_result
-- Moisture group (60–61, result 62):
--   60 moisture_m
--   61 moisture_m1
--   62 moisture_result
-- Ash group (70–71, result 72):
--   70 ash_m1
--   71 ash_m
--   72 ash_result
-- Oil content group (80–81, result 82):
--   80 oil_mass_loss
--   81 oil_original_mass
--   82 oil_result
-- Specific gravity group (90–95, result 96):
--   90 sg_w1
--   91 sg_w2
--   92 sg_w3
--   93 sg_w4
--   94 sg_sl
--   96 sg_result
-- Bulk density group (100–101, result 102):
--   100 bd_mass
--   101 bd_volume
--   102 bd_result
-- Trailing fields:
--   110 melting_point
--   111 colour_appearance
--   120 sp_photo

DO $$
DECLARE
  mid_sp   uuid; mid_zo uuid; mid_cc uuid; mid_tebu uuid; mid_bp uuid;
  pid_ssc  uuid; pid_lb uuid; pid_ziddi uuid; pid_lc uuid; pid_zsc uuid;
BEGIN

SELECT id INTO mid_sp   FROM public.materials WHERE code='SULPHUR_POWDER';
SELECT id INTO mid_zo   FROM public.materials WHERE code='ZINC_OXIDE';
SELECT id INTO mid_cc   FROM public.materials WHERE code='CALCIUM_CHLORIDE';
SELECT id INTO mid_tebu FROM public.materials WHERE code='TEBUCONAZOLE';
SELECT id INTO mid_bp   FROM public.materials WHERE code='BORIC_POWDER';
SELECT id INTO pid_ssc  FROM public.products  WHERE code='SULPHUR_SC';
SELECT id INTO pid_lb   FROM public.products  WHERE code='LIQUID_BORON';
SELECT id INTO pid_ziddi FROM public.products WHERE code='ZIDDI';
SELECT id INTO pid_lc   FROM public.products  WHERE code='LIQUID_CALCIUM';
SELECT id INTO pid_zsc  FROM public.products  WHERE code='ZINC_SC';

-- ── SULPHUR POWDER ──────────────────────────────────────────────────────────
IF mid_sp IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET sort_order=1   WHERE material_id=mid_sp AND test_key='coa_received';
  UPDATE public.qc_test_definitions SET sort_order=2   WHERE material_id=mid_sp AND test_key='purity_required';
  UPDATE public.qc_test_definitions SET sort_order=3   WHERE material_id=mid_sp AND test_key='batch_number';
  UPDATE public.qc_test_definitions SET sort_order=10  WHERE material_id=mid_sp AND test_key='purity_empty_crucible';
  UPDATE public.qc_test_definitions SET sort_order=11  WHERE material_id=mid_sp AND test_key='purity_sample_mass';
  UPDATE public.qc_test_definitions SET sort_order=12  WHERE material_id=mid_sp AND test_key='purity_w2';
  UPDATE public.qc_test_definitions SET sort_order=13  WHERE material_id=mid_sp AND test_key='purity_result';
  UPDATE public.qc_test_definitions SET sort_order=20  WHERE material_id=mid_sp AND test_key='acidity_v1';
  UPDATE public.qc_test_definitions SET sort_order=21  WHERE material_id=mid_sp AND test_key='acidity_v2';
  UPDATE public.qc_test_definitions SET sort_order=22  WHERE material_id=mid_sp AND test_key='acidity_n';
  UPDATE public.qc_test_definitions SET sort_order=23  WHERE material_id=mid_sp AND test_key='acidity_m';
  UPDATE public.qc_test_definitions SET sort_order=25  WHERE material_id=mid_sp AND test_key='acidity_result';
  UPDATE public.qc_test_definitions SET sort_order=30  WHERE material_id=mid_sp AND test_key='sieve100_sample';
  UPDATE public.qc_test_definitions SET sort_order=31  WHERE material_id=mid_sp AND test_key='sieve100_retained';
  UPDATE public.qc_test_definitions SET sort_order=32  WHERE material_id=mid_sp AND test_key='sieve100_result';
  UPDATE public.qc_test_definitions SET sort_order=40  WHERE material_id=mid_sp AND test_key='sieve200_sample';
  UPDATE public.qc_test_definitions SET sort_order=41  WHERE material_id=mid_sp AND test_key='sieve200_retained';
  UPDATE public.qc_test_definitions SET sort_order=42  WHERE material_id=mid_sp AND test_key='sieve200_result';
  UPDATE public.qc_test_definitions SET sort_order=50  WHERE material_id=mid_sp AND test_key='sieve325_sample';
  UPDATE public.qc_test_definitions SET sort_order=51  WHERE material_id=mid_sp AND test_key='sieve325_retained';
  UPDATE public.qc_test_definitions SET sort_order=52  WHERE material_id=mid_sp AND test_key='sieve325_result';
  UPDATE public.qc_test_definitions SET sort_order=60  WHERE material_id=mid_sp AND test_key='moisture_m';
  UPDATE public.qc_test_definitions SET sort_order=61  WHERE material_id=mid_sp AND test_key='moisture_m1';
  UPDATE public.qc_test_definitions SET sort_order=62  WHERE material_id=mid_sp AND test_key='moisture_result';
  UPDATE public.qc_test_definitions SET sort_order=70  WHERE material_id=mid_sp AND test_key='ash_m1';
  UPDATE public.qc_test_definitions SET sort_order=71  WHERE material_id=mid_sp AND test_key='ash_m';
  UPDATE public.qc_test_definitions SET sort_order=72  WHERE material_id=mid_sp AND test_key='ash_result';
  UPDATE public.qc_test_definitions SET sort_order=80  WHERE material_id=mid_sp AND test_key='oil_mass_loss';
  UPDATE public.qc_test_definitions SET sort_order=81  WHERE material_id=mid_sp AND test_key='oil_original_mass';
  UPDATE public.qc_test_definitions SET sort_order=82  WHERE material_id=mid_sp AND test_key='oil_result';
  UPDATE public.qc_test_definitions SET sort_order=90  WHERE material_id=mid_sp AND test_key='sg_w1';
  UPDATE public.qc_test_definitions SET sort_order=91  WHERE material_id=mid_sp AND test_key='sg_w2';
  UPDATE public.qc_test_definitions SET sort_order=92  WHERE material_id=mid_sp AND test_key='sg_w3';
  UPDATE public.qc_test_definitions SET sort_order=93  WHERE material_id=mid_sp AND test_key='sg_w4';
  UPDATE public.qc_test_definitions SET sort_order=94  WHERE material_id=mid_sp AND test_key='sg_sl';
  UPDATE public.qc_test_definitions SET sort_order=96  WHERE material_id=mid_sp AND test_key='sg_result';
  UPDATE public.qc_test_definitions SET sort_order=100 WHERE material_id=mid_sp AND test_key='bd_mass';
  UPDATE public.qc_test_definitions SET sort_order=101 WHERE material_id=mid_sp AND test_key='bd_volume';
  UPDATE public.qc_test_definitions SET sort_order=102 WHERE material_id=mid_sp AND test_key='bd_result';
  UPDATE public.qc_test_definitions SET sort_order=110 WHERE material_id=mid_sp AND test_key='melting_point';
  UPDATE public.qc_test_definitions SET sort_order=111 WHERE material_id=mid_sp AND test_key='colour_appearance';
  UPDATE public.qc_test_definitions SET sort_order=120 WHERE material_id=mid_sp AND test_key='sp_photo';
END IF;

-- ── ZINC OXIDE ──────────────────────────────────────────────────────────────
-- 1  coa_received
-- 2  lot_number
-- 3  batch_number
-- 4  mass_taken
-- 5  normality_edta
-- 6  titre_with_cyanide
-- 7  titre_without_cyanide
-- Moisture group (10–11, result 12):
-- 10 moisture_m
-- 11 moisture_m1
-- 12 moisture_result
-- Sieve 200 (20–21, result 22):
-- 20 sieve200_sample
-- 21 sieve200_retained
-- 22 sieve200_result
-- Sieve 325 (30–31, result 32):
-- 30 sieve325_sample
-- 31 sieve325_retained
-- 32 sieve325_result
-- 40 appearance
-- 50 zo_photo
IF mid_zo IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET sort_order=1  WHERE material_id=mid_zo AND test_key='coa_received';
  UPDATE public.qc_test_definitions SET sort_order=2  WHERE material_id=mid_zo AND test_key='lot_number';
  UPDATE public.qc_test_definitions SET sort_order=3  WHERE material_id=mid_zo AND test_key='batch_number';
  UPDATE public.qc_test_definitions SET sort_order=4  WHERE material_id=mid_zo AND test_key='mass_taken';
  UPDATE public.qc_test_definitions SET sort_order=5  WHERE material_id=mid_zo AND test_key='normality_edta';
  UPDATE public.qc_test_definitions SET sort_order=6  WHERE material_id=mid_zo AND test_key='titre_with_cyanide';
  UPDATE public.qc_test_definitions SET sort_order=7  WHERE material_id=mid_zo AND test_key='titre_without_cyanide';
  UPDATE public.qc_test_definitions SET sort_order=10 WHERE material_id=mid_zo AND test_key='moisture_m';
  UPDATE public.qc_test_definitions SET sort_order=11 WHERE material_id=mid_zo AND test_key='moisture_m1';
  UPDATE public.qc_test_definitions SET sort_order=12 WHERE material_id=mid_zo AND test_key='moisture_result';
  UPDATE public.qc_test_definitions SET sort_order=20 WHERE material_id=mid_zo AND test_key='sieve200_sample';
  UPDATE public.qc_test_definitions SET sort_order=21 WHERE material_id=mid_zo AND test_key='sieve200_retained';
  UPDATE public.qc_test_definitions SET sort_order=22 WHERE material_id=mid_zo AND test_key='sieve200_result';
  UPDATE public.qc_test_definitions SET sort_order=30 WHERE material_id=mid_zo AND test_key='sieve325_sample';
  UPDATE public.qc_test_definitions SET sort_order=31 WHERE material_id=mid_zo AND test_key='sieve325_retained';
  UPDATE public.qc_test_definitions SET sort_order=32 WHERE material_id=mid_zo AND test_key='sieve325_result';
  UPDATE public.qc_test_definitions SET sort_order=40 WHERE material_id=mid_zo AND test_key='appearance';
  UPDATE public.qc_test_definitions SET sort_order=50 WHERE material_id=mid_zo AND test_key='zo_photo';
END IF;

-- ── CALCIUM CHLORIDE ────────────────────────────────────────────────────────
-- Calcium content group (1–3, result 4):
--  1 calcium_w
--  2 calcium_normality
--  3 calcium_br
--  4 calcium_result (calc — add via INSERT below if missing, else UPDATE sort_order)
-- NOTE: Calcium Chloride RM QC has its own calcium inputs but no calc result
-- was added for it in migration 007. Only Product QC (Liquid Calcium) has
-- the calcium_content calc. Leave this material's calcium fields in order.
IF mid_cc IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET sort_order=1  WHERE material_id=mid_cc AND test_key='coa_received';
  UPDATE public.qc_test_definitions SET sort_order=2  WHERE material_id=mid_cc AND test_key='lot_number';
  UPDATE public.qc_test_definitions SET sort_order=3  WHERE material_id=mid_cc AND test_key='batch_number';
  UPDATE public.qc_test_definitions SET sort_order=4  WHERE material_id=mid_cc AND test_key='calcium_w';
  UPDATE public.qc_test_definitions SET sort_order=5  WHERE material_id=mid_cc AND test_key='calcium_normality';
  UPDATE public.qc_test_definitions SET sort_order=6  WHERE material_id=mid_cc AND test_key='calcium_br';
  UPDATE public.qc_test_definitions SET sort_order=7  WHERE material_id=mid_cc AND test_key='color_physical_state';
  UPDATE public.qc_test_definitions SET sort_order=8  WHERE material_id=mid_cc AND test_key='ph_20pct';
  UPDATE public.qc_test_definitions SET sort_order=9  WHERE material_id=mid_cc AND test_key='solubility';
  UPDATE public.qc_test_definitions SET sort_order=10 WHERE material_id=mid_cc AND test_key='cc_photo';
END IF;

-- ── TEBUCONAZOLE ────────────────────────────────────────────────────────────
-- 1 coa_received  2 lot_number  3 batch_number  4 content
-- Moisture (10–11, result 12):
-- Sieve 200 (20–21, result 22):
-- Sieve 325 (30–31, result 32):
IF mid_tebu IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET sort_order=1  WHERE material_id=mid_tebu AND test_key='coa_received';
  UPDATE public.qc_test_definitions SET sort_order=2  WHERE material_id=mid_tebu AND test_key='lot_number';
  UPDATE public.qc_test_definitions SET sort_order=3  WHERE material_id=mid_tebu AND test_key='batch_number';
  UPDATE public.qc_test_definitions SET sort_order=4  WHERE material_id=mid_tebu AND test_key='content';
  UPDATE public.qc_test_definitions SET sort_order=10 WHERE material_id=mid_tebu AND test_key='moisture_m';
  UPDATE public.qc_test_definitions SET sort_order=11 WHERE material_id=mid_tebu AND test_key='moisture_m1';
  UPDATE public.qc_test_definitions SET sort_order=12 WHERE material_id=mid_tebu AND test_key='moisture_result';
  UPDATE public.qc_test_definitions SET sort_order=20 WHERE material_id=mid_tebu AND test_key='sieve200_sample';
  UPDATE public.qc_test_definitions SET sort_order=21 WHERE material_id=mid_tebu AND test_key='sieve200_retained';
  UPDATE public.qc_test_definitions SET sort_order=22 WHERE material_id=mid_tebu AND test_key='sieve200_result';
  UPDATE public.qc_test_definitions SET sort_order=30 WHERE material_id=mid_tebu AND test_key='sieve325_sample';
  UPDATE public.qc_test_definitions SET sort_order=31 WHERE material_id=mid_tebu AND test_key='sieve325_retained';
  UPDATE public.qc_test_definitions SET sort_order=32 WHERE material_id=mid_tebu AND test_key='sieve325_result';
END IF;

-- ── BORIC POWDER ────────────────────────────────────────────────────────────
-- 1 coa_received  2 lot_number  3 batch_number  4 boron_content  5 appearance
-- Moisture (10–11, result 12):
-- Sieve 200 (20–21, result 22):
IF mid_bp IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET sort_order=1  WHERE material_id=mid_bp AND test_key='coa_received';
  UPDATE public.qc_test_definitions SET sort_order=2  WHERE material_id=mid_bp AND test_key='lot_number';
  UPDATE public.qc_test_definitions SET sort_order=3  WHERE material_id=mid_bp AND test_key='batch_number';
  UPDATE public.qc_test_definitions SET sort_order=4  WHERE material_id=mid_bp AND test_key='boron_content';
  UPDATE public.qc_test_definitions SET sort_order=5  WHERE material_id=mid_bp AND test_key='appearance';
  UPDATE public.qc_test_definitions SET sort_order=10 WHERE material_id=mid_bp AND test_key='moisture_m';
  UPDATE public.qc_test_definitions SET sort_order=11 WHERE material_id=mid_bp AND test_key='moisture_m1';
  UPDATE public.qc_test_definitions SET sort_order=12 WHERE material_id=mid_bp AND test_key='moisture_result';
  UPDATE public.qc_test_definitions SET sort_order=20 WHERE material_id=mid_bp AND test_key='sieve200_sample';
  UPDATE public.qc_test_definitions SET sort_order=21 WHERE material_id=mid_bp AND test_key='sieve200_retained';
  UPDATE public.qc_test_definitions SET sort_order=22 WHERE material_id=mid_bp AND test_key='sieve200_result';
END IF;

-- ── SULPHUR SC (Product QC) ─────────────────────────────────────────────────
-- Phase A:
--  1 lot_batch_number
--  2 phase_a_slurry_weight
--  3 phase_a_sample_mass
--  4 phase_a_titration_vol
--  5 phase_a_iodine_normality
--  5.5→ 6 phase_a_titration_blank   (added by 008)
--  7 sulphur_content                ← result immediately after titration inputs
--  8 desired_sulphur_content
--  9 viscosity
-- 10 density
-- Wet sieve 200 (20–21, result 22):
--  20 wet_sieve200_sample
--  21 wet_sieve200_residue
--  22 wet_sieve200_result
-- Wet sieve 325 (30–31, result 32):
--  30 wet_sieve325_sample
--  31 wet_sieve325_residue
--  32 wet_sieve325_result
-- 40 colour_physical_state
-- 41 observations
-- 42 product_photo
-- 50 clarity                        (from migration 021)
IF pid_ssc IS NOT NULL THEN
  -- Phase A
  UPDATE public.qc_test_definitions SET sort_order=1  WHERE product_id=pid_ssc AND phase='A' AND test_key='lot_batch_number';
  UPDATE public.qc_test_definitions SET sort_order=2  WHERE product_id=pid_ssc AND phase='A' AND test_key='phase_a_slurry_weight';
  UPDATE public.qc_test_definitions SET sort_order=3  WHERE product_id=pid_ssc AND phase='A' AND test_key='phase_a_sample_mass';
  UPDATE public.qc_test_definitions SET sort_order=4  WHERE product_id=pid_ssc AND phase='A' AND test_key='phase_a_titration_vol';
  UPDATE public.qc_test_definitions SET sort_order=5  WHERE product_id=pid_ssc AND phase='A' AND test_key='phase_a_iodine_normality';
  UPDATE public.qc_test_definitions SET sort_order=6  WHERE product_id=pid_ssc AND phase='A' AND test_key='phase_a_titration_blank';
  UPDATE public.qc_test_definitions SET sort_order=7  WHERE product_id=pid_ssc AND phase='A' AND test_key='sulphur_content';
  UPDATE public.qc_test_definitions SET sort_order=8  WHERE product_id=pid_ssc AND phase='A' AND test_key='desired_sulphur_content';
  UPDATE public.qc_test_definitions SET sort_order=9  WHERE product_id=pid_ssc AND phase='A' AND test_key='viscosity';
  UPDATE public.qc_test_definitions SET sort_order=10 WHERE product_id=pid_ssc AND phase='A' AND test_key='density';
  UPDATE public.qc_test_definitions SET sort_order=20 WHERE product_id=pid_ssc AND phase='A' AND test_key='wet_sieve200_sample';
  UPDATE public.qc_test_definitions SET sort_order=21 WHERE product_id=pid_ssc AND phase='A' AND test_key='wet_sieve200_residue';
  UPDATE public.qc_test_definitions SET sort_order=22 WHERE product_id=pid_ssc AND phase='A' AND test_key='wet_sieve200_result';
  UPDATE public.qc_test_definitions SET sort_order=30 WHERE product_id=pid_ssc AND phase='A' AND test_key='wet_sieve325_sample';
  UPDATE public.qc_test_definitions SET sort_order=31 WHERE product_id=pid_ssc AND phase='A' AND test_key='wet_sieve325_residue';
  UPDATE public.qc_test_definitions SET sort_order=32 WHERE product_id=pid_ssc AND phase='A' AND test_key='wet_sieve325_result';
  UPDATE public.qc_test_definitions SET sort_order=40 WHERE product_id=pid_ssc AND phase='A' AND test_key='colour_physical_state';
  UPDATE public.qc_test_definitions SET sort_order=41 WHERE product_id=pid_ssc AND phase='A' AND test_key='observations';
  UPDATE public.qc_test_definitions SET sort_order=42 WHERE product_id=pid_ssc AND phase='A' AND test_key='product_photo';
  UPDATE public.qc_test_definitions SET sort_order=50 WHERE product_id=pid_ssc AND phase='A' AND test_key='clarity';

  -- Phase B:
  --  1 lot_batch_number
  --  2 phase_b_slurry_weight
  --  3 phase_b_sample_mass
  --  4 phase_b_titration_vol
  --  5 phase_b_iodine_normality
  --  6 phase_b_titration_blank
  --  7 sulphur_content            ← result
  -- Suspensibility group (10–12, result 13):
  -- 10 suspension_sample_m
  -- 11 sediment_aliquot_v2
  -- 12 suspension_sediment_m      (added by 008)
  -- 13 suspensibility             ← result
  -- 20 viscosity  21 density
  -- Wet sieve 200 (30–31, result 32):
  -- Wet sieve 325 (40–41, result 42):
  -- 50 colour_physical_state  51 observations  52 product_photo  60 clarity
  UPDATE public.qc_test_definitions SET sort_order=1  WHERE product_id=pid_ssc AND phase='B' AND test_key='lot_batch_number';
  UPDATE public.qc_test_definitions SET sort_order=2  WHERE product_id=pid_ssc AND phase='B' AND test_key='phase_b_slurry_weight';
  UPDATE public.qc_test_definitions SET sort_order=3  WHERE product_id=pid_ssc AND phase='B' AND test_key='phase_b_sample_mass';
  UPDATE public.qc_test_definitions SET sort_order=4  WHERE product_id=pid_ssc AND phase='B' AND test_key='phase_b_titration_vol';
  UPDATE public.qc_test_definitions SET sort_order=5  WHERE product_id=pid_ssc AND phase='B' AND test_key='phase_b_iodine_normality';
  UPDATE public.qc_test_definitions SET sort_order=6  WHERE product_id=pid_ssc AND phase='B' AND test_key='phase_b_titration_blank';
  UPDATE public.qc_test_definitions SET sort_order=7  WHERE product_id=pid_ssc AND phase='B' AND test_key='sulphur_content';
  UPDATE public.qc_test_definitions SET sort_order=10 WHERE product_id=pid_ssc AND phase='B' AND test_key='suspension_sample_m';
  UPDATE public.qc_test_definitions SET sort_order=11 WHERE product_id=pid_ssc AND phase='B' AND test_key='sediment_aliquot_v2';
  UPDATE public.qc_test_definitions SET sort_order=12 WHERE product_id=pid_ssc AND phase='B' AND test_key='suspension_sediment_m';
  UPDATE public.qc_test_definitions SET sort_order=13 WHERE product_id=pid_ssc AND phase='B' AND test_key='suspensibility';
  UPDATE public.qc_test_definitions SET sort_order=20 WHERE product_id=pid_ssc AND phase='B' AND test_key='viscosity';
  UPDATE public.qc_test_definitions SET sort_order=21 WHERE product_id=pid_ssc AND phase='B' AND test_key='density';
  UPDATE public.qc_test_definitions SET sort_order=30 WHERE product_id=pid_ssc AND phase='B' AND test_key='wet_sieve200_sample';
  UPDATE public.qc_test_definitions SET sort_order=31 WHERE product_id=pid_ssc AND phase='B' AND test_key='wet_sieve200_residue';
  UPDATE public.qc_test_definitions SET sort_order=32 WHERE product_id=pid_ssc AND phase='B' AND test_key='wet_sieve200_result';
  UPDATE public.qc_test_definitions SET sort_order=40 WHERE product_id=pid_ssc AND phase='B' AND test_key='wet_sieve325_sample';
  UPDATE public.qc_test_definitions SET sort_order=41 WHERE product_id=pid_ssc AND phase='B' AND test_key='wet_sieve325_residue';
  UPDATE public.qc_test_definitions SET sort_order=42 WHERE product_id=pid_ssc AND phase='B' AND test_key='wet_sieve325_result';
  UPDATE public.qc_test_definitions SET sort_order=50 WHERE product_id=pid_ssc AND phase='B' AND test_key='colour_physical_state';
  UPDATE public.qc_test_definitions SET sort_order=51 WHERE product_id=pid_ssc AND phase='B' AND test_key='observations';
  UPDATE public.qc_test_definitions SET sort_order=52 WHERE product_id=pid_ssc AND phase='B' AND test_key='product_photo';
  UPDATE public.qc_test_definitions SET sort_order=60 WHERE product_id=pid_ssc AND phase='B' AND test_key='clarity';
END IF;

-- ── LIQUID BORON ────────────────────────────────────────────────────────────
-- Titration group (4–7, result 8):
--  1 sample_taken_by  2 lot_batch_number  3 lot_batch_quantity
--  4 mass_taken_w
--  5 naoh_normality
--  6 naoh_v1
--  7 naoh_v2
--  8 boron_content    ← result directly after NaOH inputs
--  9 colour_physical_state  10 observations  11 density  12 ph_5pct
-- 13 viscosity  14 product_photo  20 clarity
IF pid_lb IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET sort_order=1  WHERE product_id=pid_lb AND test_key='sample_taken_by';
  UPDATE public.qc_test_definitions SET sort_order=2  WHERE product_id=pid_lb AND test_key='lot_batch_number';
  UPDATE public.qc_test_definitions SET sort_order=3  WHERE product_id=pid_lb AND test_key='lot_batch_quantity';
  UPDATE public.qc_test_definitions SET sort_order=4  WHERE product_id=pid_lb AND test_key='mass_taken_w';
  UPDATE public.qc_test_definitions SET sort_order=5  WHERE product_id=pid_lb AND test_key='naoh_normality';
  UPDATE public.qc_test_definitions SET sort_order=6  WHERE product_id=pid_lb AND test_key='naoh_v1';
  UPDATE public.qc_test_definitions SET sort_order=7  WHERE product_id=pid_lb AND test_key='naoh_v2';
  UPDATE public.qc_test_definitions SET sort_order=8  WHERE product_id=pid_lb AND test_key='boron_content';
  UPDATE public.qc_test_definitions SET sort_order=9  WHERE product_id=pid_lb AND test_key='colour_physical_state';
  UPDATE public.qc_test_definitions SET sort_order=10 WHERE product_id=pid_lb AND test_key='observations';
  UPDATE public.qc_test_definitions SET sort_order=11 WHERE product_id=pid_lb AND test_key='density';
  UPDATE public.qc_test_definitions SET sort_order=12 WHERE product_id=pid_lb AND test_key='ph_5pct';
  UPDATE public.qc_test_definitions SET sort_order=13 WHERE product_id=pid_lb AND test_key='viscosity';
  UPDATE public.qc_test_definitions SET sort_order=14 WHERE product_id=pid_lb AND test_key='product_photo';
  UPDATE public.qc_test_definitions SET sort_order=20 WHERE product_id=pid_lb AND test_key='clarity';
END IF;

-- ── ZIDDI ───────────────────────────────────────────────────────────────────
-- (fields seeded in 003 for ZIDDI — read from DB; layout below)
-- Sulphur content group (inputs + blank + result):
-- Suspensibility group (M input + sediment input + result):
-- etc.  Use UPDATE by test_key — safe since ZIDDI has unique test_keys.
IF pid_ziddi IS NOT NULL THEN
  -- Content (sulphur by iodine): blank at 5, vol/normality/mass from 003's seed
  -- We set the results to appear right after the last titration input.
  -- First set the base inputs (003 seeded them sequentially, we only care about result position):
  UPDATE public.qc_test_definitions SET sort_order=6  WHERE product_id=pid_ziddi AND test_key='content_iodine_blank';
  UPDATE public.qc_test_definitions SET sort_order=7  WHERE product_id=pid_ziddi AND test_key='sulphur_content';
  -- Suspensibility: sediment input added by 008 at sort_order 6 — move to after susp inputs
  UPDATE public.qc_test_definitions SET sort_order=16 WHERE product_id=pid_ziddi AND test_key='susp_sediment_m';
  UPDATE public.qc_test_definitions SET sort_order=17 WHERE product_id=pid_ziddi AND test_key='sulphur_suspensibility';
  UPDATE public.qc_test_definitions SET sort_order=50 WHERE product_id=pid_ziddi AND test_key='clarity';
END IF;

-- ── LIQUID CALCIUM ──────────────────────────────────────────────────────────
-- (from 003's LIQUID_CALCIUM seed — check actual test_keys)
-- The Liquid Calcium product qc fields are seeded in 003 Section 10 (not shown
-- in previous reads). Use safe UPDATE-by-test_key.
IF pid_lc IS NOT NULL THEN
  -- Place calcium_content result immediately after its 3 inputs
  UPDATE public.qc_test_definitions SET sort_order=50 WHERE product_id=pid_lc AND test_key='calcium_content';
  UPDATE public.qc_test_definitions SET sort_order=70 WHERE product_id=pid_lc AND test_key='clarity';
END IF;

-- ── ZINC SC ─────────────────────────────────────────────────────────────────
IF pid_zsc IS NOT NULL THEN
  -- Phase A: wet sieve 200/325 results after their inputs
  UPDATE public.qc_test_definitions SET sort_order=22 WHERE product_id=pid_zsc AND phase='A' AND test_key='wet_sieve200_result';
  UPDATE public.qc_test_definitions SET sort_order=32 WHERE product_id=pid_zsc AND phase='A' AND test_key='wet_sieve325_result';
  UPDATE public.qc_test_definitions SET sort_order=50 WHERE product_id=pid_zsc AND phase='A' AND test_key='clarity';
  -- Phase B: zinc_content after its 2 inputs; suspension after its inputs
  -- zinc_content inputs: zc_v2_without_cyanide, zc_v1_with_cyanide (from 003)
  -- suspension inputs: susp_v2_sediment, susp_v1_sediment (from 003)
  UPDATE public.qc_test_definitions SET sort_order=22 WHERE product_id=pid_zsc AND phase='B' AND test_key='wet_sieve200_result';
  UPDATE public.qc_test_definitions SET sort_order=32 WHERE product_id=pid_zsc AND phase='B' AND test_key='wet_sieve325_result';
  UPDATE public.qc_test_definitions SET sort_order=60 WHERE product_id=pid_zsc AND phase='B' AND test_key='zinc_content';
  UPDATE public.qc_test_definitions SET sort_order=62 WHERE product_id=pid_zsc AND phase='B' AND test_key='suspension';
  UPDATE public.qc_test_definitions SET sort_order=70 WHERE product_id=pid_zsc AND phase='B' AND test_key='clarity';
END IF;

RAISE NOTICE 'Migration 022 Part A (sort_order re-numbering) complete';
END;
$$;

-- ============================================================
-- PART B: product_qc table — make batch_id nullable, add batch_no
-- (Issue 3)
-- ============================================================

-- 1. Add batch_no text column (nullable, stores typed batch number)
ALTER TABLE public.product_qc
  ADD COLUMN IF NOT EXISTS batch_no text;

-- 2. Drop the NOT NULL constraint on batch_id (make it optional)
ALTER TABLE public.product_qc
  ALTER COLUMN batch_id DROP NOT NULL;

-- 3. Drop old unique constraint and replace with one that handles NULL batch_id.
--    Postgres NULLs are never equal so UNIQUE(batch_id, product_id, phase) would
--    allow multiple NULLs — we want to prevent duplicate unlinked records too.
--    Strategy: keep the FK-based unique for linked records; add a partial unique
--    on batch_no for unlinked records.
ALTER TABLE public.product_qc
  DROP CONSTRAINT IF EXISTS product_qc_batch_id_product_id_phase_key;

-- Unique index for FK-linked records (batch_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS product_qc_linked_unique
  ON public.product_qc (batch_id, product_id, phase)
  WHERE batch_id IS NOT NULL;

-- Unique index for unlinked records (batch_id IS NULL, keyed on batch_no)
CREATE UNIQUE INDEX IF NOT EXISTS product_qc_unlinked_unique
  ON public.product_qc (factory_id, batch_no, product_id, phase)
  WHERE batch_id IS NULL AND batch_no IS NOT NULL;

-- 4. Backfill batch_no from the linked batch row for any existing records
--    so the column is not entirely empty after migration.
UPDATE public.product_qc pqc
SET batch_no = b.batch_number
FROM public.batches b
WHERE pqc.batch_id = b.id
  AND pqc.batch_no IS NULL;

-- 5. Grant service_role access (already done in migration 019 globally,
--    but be explicit for the new column)
GRANT SELECT, INSERT, UPDATE ON public.product_qc TO service_role;

RAISE NOTICE 'Migration 022 Part B (product_qc batch_id nullable + batch_no) complete';

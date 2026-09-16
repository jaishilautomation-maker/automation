-- =============================================================================
-- A-20 Migration 003: QC Seed Data
--
-- Seeds:
--   1. 5 RM materials for Lab QC (Sulphur Powder, Zinc Oxide, Calcium Chloride,
--      Tebuconazole, Boric Powder)
--   2. 5 products for Product QC (Sulphur SC, Liquid Boron, Ziddi,
--      Liquid Calcium, Zinc SC)
--   3. qc_test_definitions for all 5 RM materials
--   4. qc_test_definitions for all 5 products (phase-aware for Sulphur SC,
--      Zinc SC)
--
-- All test fields exactly match the source specification.
-- No formulas invented — formula column left NULL for all fields.
-- Optional tests stored as nullable JSONB values (no NOT NULL on test results).
-- =============================================================================

DO $$
DECLARE
    -- Material UUIDs
    mid_sp   uuid;   -- SULPHUR_POWDER
    mid_zo   uuid;   -- ZINC_OXIDE
    mid_cc   uuid;   -- CALCIUM_CHLORIDE
    mid_tebu uuid;   -- TEBUCONAZOLE
    mid_bp   uuid;   -- BORIC_POWDER

    -- Product UUIDs
    pid_ssc  uuid;   -- SULPHUR_SC
    pid_lb   uuid;   -- LIQUID_BORON
    pid_ziddi uuid;  -- ZIDDI
    pid_lc   uuid;   -- LIQUID_CALCIUM
    pid_zsc  uuid;   -- ZINC_SC

    n smallint;
BEGIN

-- =============================================================================
-- 1. Upsert RM materials
-- =============================================================================
INSERT INTO public.materials (code, name, is_active)
VALUES
    ('SULPHUR_POWDER',    'Sulphur Powder',    true),
    ('ZINC_OXIDE',        'Zinc Oxide',        true),
    ('CALCIUM_CHLORIDE',  'Calcium Chloride',  true),
    ('TEBUCONAZOLE',      'Tebuconazole',      true),
    ('BORIC_POWDER',      'Boric Powder',      true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true;

SELECT id INTO mid_sp   FROM public.materials WHERE code = 'SULPHUR_POWDER';
SELECT id INTO mid_zo   FROM public.materials WHERE code = 'ZINC_OXIDE';
SELECT id INTO mid_cc   FROM public.materials WHERE code = 'CALCIUM_CHLORIDE';
SELECT id INTO mid_tebu FROM public.materials WHERE code = 'TEBUCONAZOLE';
SELECT id INTO mid_bp   FROM public.materials WHERE code = 'BORIC_POWDER';

-- =============================================================================
-- 2. Upsert products
-- =============================================================================
INSERT INTO public.products (code, name, is_trial_only, is_active)
VALUES
    ('SULPHUR_SC',    'Sulphur SC',     false, true),
    ('LIQUID_BORON',  'Liquid Boron',   false, true),
    ('ZIDDI',         'Ziddi',          false, true),
    ('LIQUID_CALCIUM','Liquid Calcium', false, true),
    ('ZINC_SC',       'Zinc SC',        false, true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true;

SELECT id INTO pid_ssc   FROM public.products WHERE code = 'SULPHUR_SC';
SELECT id INTO pid_lb    FROM public.products WHERE code = 'LIQUID_BORON';
SELECT id INTO pid_ziddi FROM public.products WHERE code = 'ZIDDI';
SELECT id INTO pid_lc    FROM public.products WHERE code = 'LIQUID_CALCIUM';
SELECT id INTO pid_zsc   FROM public.products WHERE code = 'ZINC_SC';

-- =============================================================================
-- 3. qc_test_definitions — SULPHUR POWDER
-- =============================================================================
n := 0;

-- Common / identification
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','coa_received','Is COA Received?',NULL,'select',n) ON CONFLICT DO NOTHING;
UPDATE public.qc_test_definitions SET options='["Yes","No","Other"]' WHERE material_id=mid_sp AND test_key='coa_received';
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','purity_required','Purity Required (min 99%)?',NULL,'select',n) ON CONFLICT DO NOTHING;
UPDATE public.qc_test_definitions SET options='["Yes","No","Other"]' WHERE material_id=mid_sp AND test_key='purity_required';
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','batch_number','Sulphur Powder Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;

-- Purity
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','purity_empty_crucible','PURITY — Empty Crucible Weight (E)','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','purity_sample_mass','PURITY — Mass of sample taken for test','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','purity_w2','PURITY — Mass of Empty weight + Residue W2','g','number',n) ON CONFLICT DO NOTHING;

-- Acidity
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','acidity_v1','ACIDITY — Titre with material V1','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','acidity_v2','ACIDITY — Titre with blank V2','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','acidity_n','ACIDITY — Normality of NaOH solution N',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','acidity_m','ACIDITY — Mass of sample taken M','g','number',n) ON CONFLICT DO NOTHING;

-- Sieve 100 mesh
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sieve100_sample','SIEVE 100 MESH — Sample taken M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sieve100_retained','SIEVE 100 MESH — Coarse material retained m','g','number',n) ON CONFLICT DO NOTHING;

-- Sieve 200 mesh
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sieve200_sample','SIEVE 200 MESH — Sample taken M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sieve200_retained','SIEVE 200 MESH — Coarse material retained m','g','number',n) ON CONFLICT DO NOTHING;

-- Sieve 325 mesh
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sieve325_sample','SIEVE 325 MESH — Sample taken M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sieve325_retained','SIEVE 325 MESH — Coarse material retained m','g','number',n) ON CONFLICT DO NOTHING;

-- Moisture
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','moisture_m','MOISTURE — Mass before heating M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','moisture_m1','MOISTURE — Mass after heating M1','g','number',n) ON CONFLICT DO NOTHING;

-- Ash
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','ash_m1','ASH — Mass of residue obtained M1','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','ash_m','ASH — Mass of sample taken M','g','number',n) ON CONFLICT DO NOTHING;

-- Oil content
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','oil_mass_loss','OIL CONTENT — Mass loss','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','oil_original_mass','OIL CONTENT — Original sample mass','g','number',n) ON CONFLICT DO NOTHING;

-- Specific gravity
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sg_w1','SPECIFIC GRAVITY — Empty pycnometer W1','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sg_w2','SPECIFIC GRAVITY — Pycnometer + sample W2','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sg_w3','SPECIFIC GRAVITY — Pycnometer + sample + liquid W3','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sg_w4','SPECIFIC GRAVITY — Pycnometer + liquid W4','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sg_sl','SPECIFIC GRAVITY — Specific gravity of liquid medium SL',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sg_result','SPECIFIC GRAVITY — Specific gravity of sulphur powder',NULL,'number',n) ON CONFLICT DO NOTHING;

-- Bulk density
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','bd_mass','BULK DENSITY — Mass of sample m','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','bd_volume','BULK DENSITY — Volume after tapping V','cc','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','bd_result','BULK DENSITY — Bulk density','g/cc','number',n) ON CONFLICT DO NOTHING;

-- Other
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','melting_point','Melting Point','°C','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','colour_appearance','Colour Appearance',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_sp,'none','sp_photo','Sulphur Powder Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 4. qc_test_definitions — ZINC OXIDE
-- =============================================================================
n := 0;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','coa_received','Is COA Received?',NULL,'select',n) ON CONFLICT DO NOTHING;
UPDATE public.qc_test_definitions SET options='["Yes","No","Other"]' WHERE material_id=mid_zo AND test_key='coa_received';
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','lot_number','Lot Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','batch_number','Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','mass_taken','Mass of Material Taken','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','normality_edta','Normality of EDTA solution',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','titre_with_cyanide','Titre with cyanide','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','titre_without_cyanide','Titre without cyanide','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','moisture_m','MOISTURE — Mass before heating M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','moisture_m1','MOISTURE — Mass after heating M1','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','sieve200_sample','200 MESH — Sample taken M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','sieve200_retained','200 MESH — Coarse material retained M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','sieve325_sample','325 MESH — Sample taken M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','sieve325_retained','325 MESH — Coarse material retained M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','appearance','Appearance',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_zo,'none','zo_photo','Zinc Oxide Product Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 5. qc_test_definitions — CALCIUM CHLORIDE
-- =============================================================================
n := 0;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','coa_received','Is COA Received?',NULL,'select',n) ON CONFLICT DO NOTHING;
UPDATE public.qc_test_definitions SET options='["Yes","No","Other"]' WHERE material_id=mid_cc AND test_key='coa_received';
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','lot_number','Lot Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','batch_number','Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','calcium_w','CALCIUM CONTENT — Weight of sample W','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','calcium_normality','CALCIUM CONTENT — Normality of EDTA solution',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','calcium_br','CALCIUM CONTENT — Burette reading B.R.','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','color_physical_state','Color & Physical State',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','ph_20pct','pH (20% solution)',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','solubility','Solubility',NULL,'select',n) ON CONFLICT DO NOTHING;
UPDATE public.qc_test_definitions SET options='["Clear","Opalescent","Other"]' WHERE material_id=mid_cc AND test_key='solubility';
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_cc,'none','cc_photo','Calcium Chloride Product Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 6. qc_test_definitions — TEBUCONAZOLE
-- =============================================================================
n := 0;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','coa_received','Is COA Received?',NULL,'select',n) ON CONFLICT DO NOTHING;
UPDATE public.qc_test_definitions SET options='["Yes","No","Other"]' WHERE material_id=mid_tebu AND test_key='coa_received';
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','lot_number','Lot Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','batch_number','Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','content','Content','%','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','moisture_m','MOISTURE — Mass before heating M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','moisture_m1','MOISTURE — Mass after heating M1','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','sieve200_sample','200 MESH — Sample taken M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','sieve200_retained','200 MESH — Coarse material retained M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','sieve325_sample','325 MESH — Sample taken M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_tebu,'none','sieve325_retained','325 MESH — Coarse material retained M','g','number',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 7. qc_test_definitions — BORIC POWDER
-- =============================================================================
n := 0;

n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_bp,'none','coa_received','Is COA Received?',NULL,'select',n) ON CONFLICT DO NOTHING;
UPDATE public.qc_test_definitions SET options='["Yes","No","Other"]' WHERE material_id=mid_bp AND test_key='coa_received';
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_bp,'none','lot_number','Lot Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_bp,'none','batch_number','Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_bp,'none','boron_content','Boron Content Powder','%','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_bp,'none','appearance','Appearance',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_bp,'none','moisture_m','MOISTURE — Mass before heating M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_bp,'none','moisture_m1','MOISTURE — Mass after heating M1','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_bp,'none','sieve200_sample','200 MESH — Sample taken M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(material_id,phase,test_key,label,unit,input_type,sort_order) VALUES(mid_bp,'none','sieve200_retained','200 MESH — Coarse material retained M','g','number',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 8. qc_test_definitions — SULPHUR SC  (Phase A and Phase B)
-- =============================================================================
n := 0;

-- Phase A
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','lot_batch_number','Lot/Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','phase_a_slurry_weight','Quantity of Phase A / Slurry Weight','kg','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','phase_a_sample_mass','Mass of sample taken m','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','phase_a_titration_vol','Titration Volume v','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','phase_a_iodine_normality','Normality of iodine',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','desired_sulphur_content','Desired Sulphur Content','%','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','viscosity','Viscosity','seconds','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','density','Density','g/cm³','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','wet_sieve200_sample','Wet Sieve 200 — Sample weight','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','wet_sieve200_residue','Wet Sieve 200 — Residue weight','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','wet_sieve325_sample','Wet Sieve 325 — Sample weight','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','wet_sieve325_residue','Wet Sieve 325 — Residue weight','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','colour_physical_state','Color & Physical State',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','observations','Important Observations / visible sediments / rejection reason',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'A','product_photo','Product Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

-- Phase B
n := 0;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','lot_batch_number','Lot/Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','phase_b_slurry_weight','Quantity / Slurry Weight','kg','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','phase_b_sample_mass','Mass of sample taken m','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','phase_b_titration_vol','Titration Volume v','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','phase_b_iodine_normality','Normality of iodine solution N',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','suspension_sample_m','Weight of suspension sample M','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','sediment_aliquot_v2','Titre with sediment aliquot v2','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','viscosity','Viscosity','seconds','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','density','Density','g/cm³','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','wet_sieve200_sample','Wet Sieve 200 — Sample weight','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','wet_sieve200_residue','Wet Sieve 200 — Residue weight','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','wet_sieve325_sample','Wet Sieve 325 — Sample weight','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','wet_sieve325_residue','Wet Sieve 325 — Residue weight','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','colour_physical_state','Color & Physical State',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','observations','Important Observations / visible sediments / rejection reason',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ssc,'B','product_photo','Product Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 9. qc_test_definitions — LIQUID BORON (single phase = none)
-- =============================================================================
n := 0;

n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','sample_taken_by','Sample Taken By',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','lot_batch_number','Lot/Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','lot_batch_quantity','Lot/Batch Quantity','kg','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','mass_taken_w','Weight of material taken W','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','naoh_normality','Normality sodium hydroxide N',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','naoh_v1','NaOH starting V1','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','naoh_v2','NaOH ending V2','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','colour_physical_state','Color & Physical State',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','observations','Important Observations',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','density','Density','g/cm³','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','ph_5pct','pH (5% solution)',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','viscosity','Viscosity','seconds','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lb,'none','product_photo','Product Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 10. qc_test_definitions — ZIDDI (single phase = none)
-- =============================================================================
n := 0;

n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','lot_batch_number','Lot/Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
-- Content
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','content_mass_w','CONTENT — Weight of material taken W','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','content_iodine_vol','CONTENT — Volume of Iodine','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','content_iodine_normality','CONTENT — Normality of Iodine',NULL,'number',n) ON CONFLICT DO NOTHING;
-- Suspensibility
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','susp_mass_w','SUSPENSIBILITY — Weight of material taken W','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','susp_iodine_vol','SUSPENSIBILITY — Volume of Iodine','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','susp_iodine_normality','SUSPENSIBILITY — Normality of Iodine',NULL,'number',n) ON CONFLICT DO NOTHING;
-- GC
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','gc_tebu_content','Tebuconazole Content (by GC)','%','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','gc_tebu_suspensibility','Tebuconazole Suspensibility (by GC)','%','number',n) ON CONFLICT DO NOTHING;
-- Final
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','colour_physical_state','Color & Physical State',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','observations','Important Observations',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_ziddi,'none','product_photo','Product Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 11. qc_test_definitions — LIQUID CALCIUM (single phase = none)
-- =============================================================================
n := 0;

n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','lot_batch_number','Lot/Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','quantity','Quantity','kg','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','calcium_w','CALCIUM CONTENT — Weight of sample W','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','calcium_normality','CALCIUM CONTENT — Normality EDTA',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','calcium_br','CALCIUM CONTENT — Burette reading B.R.','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','colour_physical_state','Color & Physical State',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','observations','Important Observations',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','density','Density','g/cm³','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','ph_5pct','pH (5% solution)',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_lc,'none','product_photo','Product Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

-- =============================================================================
-- 12. qc_test_definitions — ZINC SC (Phase A and Phase B)
-- =============================================================================
n := 0;

-- Phase A
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'A','lot_batch_number','Lot/Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'A','phase_a_slurry_weight','Quantity / Slurry Weight Phase A','kg','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'A','normality_edta','Normality EDTA',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'A','v1_with_cyanide','V1 titre with cyanide','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'A','v2_without_cyanide','V2 titre without cyanide','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'A','appearance','Appearance',NULL,'text',n) ON CONFLICT DO NOTHING;

-- Phase B
n := 0;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','lot_batch_number','Lot/Batch Number',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','phase_b_slurry_weight','Quantity / Slurry Weight','kg','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','normality_edta','Normality EDTA',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','titre_with_cyanide','Titre with cyanide','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','titre_without_cyanide','Titre without cyanide','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','appearance','Appearance',NULL,'text',n) ON CONFLICT DO NOTHING;
-- Zinc content
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','zc_normality_edta','ZINC CONTENT — Normality EDTA',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','zc_mass_sample','ZINC CONTENT — Mass of sample','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','zc_v1_with_cyanide','ZINC CONTENT — V1 titre with cyanide','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','zc_v2_without_cyanide','ZINC CONTENT — V2 titre without cyanide','mL','number',n) ON CONFLICT DO NOTHING;
-- Suspension
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','susp_mass','SUSPENSION — Suspension mass','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','susp_v1_sediment','SUSPENSION — V1 sediment titre','mL','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','susp_v2_sediment','SUSPENSION — V2 sediment titre','mL','number',n) ON CONFLICT DO NOTHING;
-- Physical
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','viscosity','Viscosity','seconds','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','ph_direct','pH Direct solution',NULL,'number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','density','Density','g/cm³','number',n) ON CONFLICT DO NOTHING;
-- Wet sieve
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','wet_sieve200_sample','Wet Sieve 200 — Sample','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','wet_sieve200_residue','Wet Sieve 200 — Residue','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','wet_sieve325_sample','Wet Sieve 325 — Sample','g','number',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','wet_sieve325_residue','Wet Sieve 325 — Residue','g','number',n) ON CONFLICT DO NOTHING;
-- Final
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','colour_physical_state','Color & Physical State',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','observations','Important Observations',NULL,'text',n) ON CONFLICT DO NOTHING;
n := n + 1; INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES(pid_zsc,'B','product_photo','Product Photo',NULL,'photo',n) ON CONFLICT DO NOTHING;

RAISE NOTICE 'A-20 QC seed complete';
END;
$$;

-- =============================================================================
-- Migration 047 — Seed coa_customer_specs from the 13 customer/vendor spec sheets
--
-- Source: the uploaded RAW MATERIAL SPECIFICATION sheets (CEAT R5299 & R108,
-- MRF M2615, Apollo 160108, JK Tyre JKI-108, LANXESS, Birla Tyre BT-CS01,
-- Bridgestone WE-10 & WE-15, Kremoint, Punjab Chemicals, UPL, BKT).
--
-- KEY MAPPING NOTES (read before trusting these rows):
--
-- 1. party_code MUST match parties.party_code (seeded from vfd_parameters):
--      Ceat R5299, Ceat 108, M2615, Apollo 160108, JKI-108, LANXESS, BKT,
--      Rubber, Shakti, Plain-2615, Plain Lanxess, Sulphur Powder.
--    Sheets whose code has no matching party row (Birla BT-CS01, Bridgestone
--    WE-10/WE-15, Kremoint, Punjab Chemicals, UPL) are inserted with their own
--    party_code AND a parties row is upserted for them, so the dropdown can
--    show them once selected. customer_name carries the readable name.
--
-- 2. parameter MUST match a batch_analysis test_key (material SULPHUR_POWDER,
--    phase 'B') so the live pass/fail lookup works. Available keys:
--      purity_percent, acidity_percent, ash_percent, moisture_percent,
--      mesh100_pct, mesh200_pct, mesh325_pct, heat_loss_percent, melting_point,
--      oil_percent, sg_value, total_sulphur_percent, insolubility_toluene,
--      alkalinity_naoh, softening_point, acetone_solubility.
--
-- 3. ⚠ MESH CONVENTION: batch_analysis mesh*_pct is "% RETAINED"
--    (retained/sample*100). Several sheets state "sieve residue max X" (=retained,
--    maps directly) while others state "% passing min Y" (opposite). Where a sheet
--    gives "passing min Y", it is converted to retained "max (100 - Y)" and the
--    row is flagged needs_verification=true so a human confirms the intent.
--
-- 4. needs_verification=true is set on: all Punjab Chemicals rows (fully
--    handwritten), Apollo oil_content (ambiguous target/min/max pairing in scan),
--    and every "% passing"→"% retained" mesh conversion.
--
-- Idempotent: parties upsert ON CONFLICT DO NOTHING; specs use the table's
-- UNIQUE (customer_name, parameter, product_code). We also clear any prior seed
-- for these parties first so re-running converges.
-- =============================================================================

-- Ensure parties exist for sheets whose code isn't already in vfd_parameters.
INSERT INTO public.parties (party_code, customer_name) VALUES
    ('BT-CS01',       'Birla Tyre (DTRL)'),
    ('WE-10',         'Bridgestone India (WE-10)'),
    ('WE-15',         'Bridgestone India (WE-15)'),
    ('Kremoint',      'Kremoint Pharma'),
    ('Punjab Chem',   'Punjab Chemicals'),
    ('UPL',           'UPL Ltd')
ON CONFLICT (party_code) DO NOTHING;

-- Give the vfd-sourced parties readable customer names (upsert customer_name).
UPDATE public.parties SET customer_name = 'CEAT Ltd (R5299)'   WHERE party_code = 'Ceat R5299' AND (customer_name IS NULL OR customer_name = party_code);
UPDATE public.parties SET customer_name = 'CEAT Ltd (R108)'    WHERE party_code = 'Ceat 108'   AND (customer_name IS NULL OR customer_name = party_code);
UPDATE public.parties SET customer_name = 'MRF Ltd'            WHERE party_code = 'M2615'       AND (customer_name IS NULL OR customer_name = party_code);
UPDATE public.parties SET customer_name = 'Apollo Tyres'       WHERE party_code = 'Apollo 160108' AND (customer_name IS NULL OR customer_name = party_code);
UPDATE public.parties SET customer_name = 'JK Tyre'            WHERE party_code = 'JKI-108'     AND (customer_name IS NULL OR customer_name = party_code);
UPDATE public.parties SET customer_name = 'LANXESS'            WHERE party_code = 'LANXESS'     AND (customer_name IS NULL OR customer_name = party_code);
UPDATE public.parties SET customer_name = 'Balkrishna (BKT)'   WHERE party_code = 'BKT'         AND (customer_name IS NULL OR customer_name = party_code);

-- Clear any previous seed for these parties so re-runs converge cleanly.
DELETE FROM public.coa_customer_specs
WHERE party_code IN (
    'Ceat R5299','Ceat 108','M2615','Apollo 160108','JKI-108','LANXESS','BKT',
    'BT-CS01','WE-10','WE-15','Kremoint','Punjab Chem','UPL'
);

-- Helper columns: (party_code, customer_name, parameter, parameter_label, unit,
--                  min_value, max_value, target_value, needs_verification)
INSERT INTO public.coa_customer_specs
    (party_code, customer_name, parameter, parameter_label, unit, min_value, max_value, target_value, needs_verification)
VALUES
    -- ── CEAT R5299 (sheet: Solubility CS2 min 99.5; Acidity max 0.05; Heat loss max 0.20;
    --    Ash max 0.15; Melting 113-121 target 117; Oil 0.9-1.1 target 1.0;
    --    Sieve residue 100 max 0.00; 200 max 0.50; 325 max 10.0) ──
    ('Ceat R5299','CEAT Ltd (R5299)','purity_percent','Solubility in CS2','%',99.5,NULL,NULL,false),
    ('Ceat R5299','CEAT Ltd (R5299)','acidity_percent','Acidity (as H2SO4)','%',NULL,0.05,NULL,false),
    ('Ceat R5299','CEAT Ltd (R5299)','heat_loss_percent','Heat loss (70C/2hr)','%',NULL,0.20,NULL,false),
    ('Ceat R5299','CEAT Ltd (R5299)','ash_percent','Ash content','%',NULL,0.15,NULL,false),
    ('Ceat R5299','CEAT Ltd (R5299)','melting_point','Melting point','C',113,121,117,false),
    ('Ceat R5299','CEAT Ltd (R5299)','oil_percent','Oil content','%',0.9,1.1,1.0,false),
    ('Ceat R5299','CEAT Ltd (R5299)','mesh100_pct','Sieve residue 100 mesh','%',NULL,0.00,NULL,false),
    ('Ceat R5299','CEAT Ltd (R5299)','mesh200_pct','Sieve residue 200 mesh','%',NULL,0.50,NULL,false),
    ('Ceat R5299','CEAT Ltd (R5299)','mesh325_pct','Sieve residue 325 mesh','%',NULL,10.0,NULL,false),

    -- ── CEAT R108 (Solubility min 98.0; Acidity max 0.02; Heat loss max 0.30;
    --    Ash max 0.10; Sieve residue 100 max 0.50; 200 max 1.00) ──
    ('Ceat 108','CEAT Ltd (R108)','purity_percent','Solubility in CS2','%',98.0,NULL,NULL,false),
    ('Ceat 108','CEAT Ltd (R108)','acidity_percent','Acidity (as H2SO4)','%',NULL,0.02,NULL,false),
    ('Ceat 108','CEAT Ltd (R108)','heat_loss_percent','Heat loss (70C/2hr)','%',NULL,0.30,NULL,false),
    ('Ceat 108','CEAT Ltd (R108)','ash_percent','Ash content','%',NULL,0.10,NULL,false),
    ('Ceat 108','CEAT Ltd (R108)','mesh100_pct','Sieve residue 100 mesh','%',NULL,0.50,NULL,false),
    ('Ceat 108','CEAT Ltd (R108)','mesh200_pct','Sieve residue 200 mesh','%',NULL,1.00,NULL,false),

    -- ── MRF M2615 (Heat loss max 0.15; Ash max 0.15; Acidity max 0.01;
    --    Solubility CS2 min 99; Melting 113-119; Sp.Gravity 2.05-2.15) ──
    ('M2615','MRF Ltd','heat_loss_percent','Heat loss','%',NULL,0.15,NULL,false),
    ('M2615','MRF Ltd','ash_percent','Ash content','%',NULL,0.15,NULL,false),
    ('M2615','MRF Ltd','acidity_percent','Acidity (as H2SO4)','%',NULL,0.01,NULL,false),
    ('M2615','MRF Ltd','purity_percent','Solubility in CS2','%',99.0,NULL,NULL,false),
    ('M2615','MRF Ltd','melting_point','Melting point','C',113,119,NULL,false),
    ('M2615','MRF Ltd','sg_value','Specific gravity @27C','g/cm3',2.05,2.15,NULL,false),

    -- ── Apollo 160108 (Total sulphur min 99.00; Loss on heating 70C max 0.150;
    --    Ash max 0.100; Sieve 150um/100mesh max 0.500; Sieve 75um max 9.000;
    --    Acidity max 0.010; Oil content target 0.500 min 0.250 max 0.750 -- AMBIGUOUS;
    --    Insoluble in toluene max 0.500) ──
    ('Apollo 160108','Apollo Tyres','total_sulphur_percent','Total sulphur','%',99.00,NULL,NULL,false),
    ('Apollo 160108','Apollo Tyres','heat_loss_percent','Loss on heating (70C)','%',NULL,0.150,NULL,false),
    ('Apollo 160108','Apollo Tyres','ash_percent','Ash content (750C)','%',NULL,0.100,NULL,false),
    ('Apollo 160108','Apollo Tyres','mesh100_pct','Sieve residue 150um/100 mesh','%',NULL,0.500,NULL,false),
    ('Apollo 160108','Apollo Tyres','mesh200_pct','Sieve residue 75um/200 mesh','%',NULL,9.000,NULL,false),
    ('Apollo 160108','Apollo Tyres','acidity_percent','Acidity (as H2SO4)','%',NULL,0.010,NULL,false),
    ('Apollo 160108','Apollo Tyres','oil_percent','Oil content','%',0.250,0.750,0.500,true),   -- ⚠ ambiguous scan
    ('Apollo 160108','Apollo Tyres','insolubility_toluene','Insoluble in toluene','%',NULL,0.500,NULL,false),

    -- ── JK Tyre JKI-108 (Wet sieve 100 mesh max 0.30; Wet sieve 200 mesh min 4.0 max 7.0 -- % passing? scan ambiguous;
    --    Solubility CS2 min 98.0; Sp.Gravity target 2.050; Oil target 0.75 max 1.00;
    --    Acidity max 0.10; Ash max 0.10; Heat loss max 0.15) ──
    ('JKI-108','JK Tyre','mesh100_pct','Wet sieve 100 mesh (retained)','%',NULL,0.30,NULL,false),
    ('JKI-108','JK Tyre','mesh200_pct','Wet sieve 200 mesh','%',4.0,7.0,NULL,true),   -- ⚠ scan unclear passing vs retained
    ('JKI-108','JK Tyre','purity_percent','Solubility in CS2','%',98.0,NULL,NULL,false),
    ('JKI-108','JK Tyre','sg_value','Specific gravity @25C','g/cm3',NULL,NULL,2.050,false),
    ('JKI-108','JK Tyre','oil_percent','Oil content','%',NULL,1.00,0.75,false),
    ('JKI-108','JK Tyre','acidity_percent','Acidity (as H2SO4)','%',NULL,0.10,NULL,false),
    ('JKI-108','JK Tyre','ash_percent','Ash content','%',NULL,0.10,NULL,false),
    ('JKI-108','JK Tyre','heat_loss_percent','Heat loss (70C/2hr)','%',NULL,0.15,NULL,false),

    -- ── LANXESS (Melting min 117; Assay/purity min 97.5; Ash max 0.1;
    --    Sieve residue 200 mesh max 0.5; Oil content 1.5-2.3) ──
    ('LANXESS','LANXESS','melting_point','Melting point','C',117,NULL,NULL,false),
    ('LANXESS','LANXESS','purity_percent','Assay (solubility)','%',97.5,NULL,NULL,false),
    ('LANXESS','LANXESS','ash_percent','Ash content','%',NULL,0.1,NULL,false),
    ('LANXESS','LANXESS','mesh200_pct','Sieve residue 200 mesh','%',NULL,0.5,NULL,false),
    ('LANXESS','LANXESS','oil_percent','Oil content','%',1.5,2.3,NULL,false),

    -- ── Birla Tyre BT-CS01 (Toluene insolubility max 0.20; Ash 600C max 0.10;
    --    Heat loss 70C max 0.30; Mineral acidity max 0.10; Sieve 88um/170mesh max 0.20;
    --    Oil content nominal 1% +/-0.20 => 0.80-1.20) ──
    ('BT-CS01','Birla Tyre (DTRL)','insolubility_toluene','Toluene insolubility','%',NULL,0.20,NULL,false),
    ('BT-CS01','Birla Tyre (DTRL)','ash_percent','Ash (600C/20min)','%',NULL,0.10,NULL,false),
    ('BT-CS01','Birla Tyre (DTRL)','heat_loss_percent','Heat loss (70C/2hr)','%',NULL,0.30,NULL,false),
    ('BT-CS01','Birla Tyre (DTRL)','acidity_percent','Mineral acidity (as H2SO4)','%',NULL,0.10,NULL,false),
    ('BT-CS01','Birla Tyre (DTRL)','mesh200_pct','Sieve residue 88um/170 mesh','%',NULL,0.20,NULL,true),  -- ⚠ 170 mesh mapped onto 200-mesh key
    ('BT-CS01','Birla Tyre (DTRL)','oil_percent','Oil content','%',0.80,1.20,1.0,false),

    -- ── Bridgestone WE-10 (Total sulphur 94.5-95.5 center 95.0; Oil 4.5-5.5 center 5.0;
    --    Ash max 0.15; Heat loss max 0.2; Free acid max 0.03; Insoluble in CS2 max 0.5;
    --    Sieve residue 150um max 0.1) ──
    ('WE-10','Bridgestone India (WE-10)','total_sulphur_percent','Total sulphur','%',94.5,95.5,95.0,false),
    ('WE-10','Bridgestone India (WE-10)','oil_percent','Oil content','%',4.5,5.5,5.0,false),
    ('WE-10','Bridgestone India (WE-10)','ash_percent','Ash content','%',NULL,0.15,NULL,false),
    ('WE-10','Bridgestone India (WE-10)','heat_loss_percent','Heat loss (moisture)','%',NULL,0.2,NULL,false),
    ('WE-10','Bridgestone India (WE-10)','acidity_percent','Free acid (as H2SO4)','%',NULL,0.03,NULL,false),
    ('WE-10','Bridgestone India (WE-10)','mesh100_pct','Sieve residue 150um','%',NULL,0.1,NULL,true),  -- ⚠ 150um mapped onto 100-mesh key

    -- ── Bridgestone WE-15 (Total sulphur 95.0+/-0.5; Oil 5.0+/-0.5; Free acid max 0.03;
    --    Sieve residue 150um max 0.10; Ash max 0.15; Heat loss max 0.2;
    --    Insoluble in CS2 max 0.5; Aniline point max 105) ──
    ('WE-15','Bridgestone India (WE-15)','total_sulphur_percent','Total sulphur','%',94.5,95.5,95.0,false),
    ('WE-15','Bridgestone India (WE-15)','oil_percent','Oil content','%',4.5,5.5,5.0,false),
    ('WE-15','Bridgestone India (WE-15)','acidity_percent','Free acid (as H2SO4)','%',NULL,0.03,NULL,false),
    ('WE-15','Bridgestone India (WE-15)','mesh100_pct','Sieve residue 150 micron','%',NULL,0.10,NULL,true),  -- ⚠ 150um mapped onto 100-mesh key
    ('WE-15','Bridgestone India (WE-15)','ash_percent','Ash content','%',NULL,0.15,NULL,false),
    ('WE-15','Bridgestone India (WE-15)','heat_loss_percent','Heat loss','%',NULL,0.2,NULL,false),

    -- ── Kremoint Pharma (Precipitated Sulfur USP: Residue on ignition NMT 0.3;
    --    Water NMT 0.5; Assay 99.50-100.50) ──
    ('Kremoint','Kremoint Pharma','ash_percent','Residue on ignition','%',NULL,0.3,NULL,false),
    ('Kremoint','Kremoint Pharma','moisture_percent','Water','%',NULL,0.5,NULL,false),
    ('Kremoint','Kremoint Pharma','purity_percent','Assay (on anhydrous basis)','%',99.50,100.50,NULL,false),

    -- ── Punjab Chemicals (FULLY HANDWRITTEN — every row needs_verification) ──
    ('Punjab Chem','Punjab Chemicals','purity_percent','Purity','%',99.5,NULL,NULL,true),
    ('Punjab Chem','Punjab Chemicals','melting_point','Melting point','C',117,118,NULL,true),
    ('Punjab Chem','Punjab Chemicals','moisture_percent','Moisture','%',NULL,0.20,NULL,true),
    ('Punjab Chem','Punjab Chemicals','ash_percent','Ash','%',NULL,0.15,NULL,true),
    ('Punjab Chem','Punjab Chemicals','acidity_percent','Acidity','%',NULL,0.015,NULL,true),
    ('Punjab Chem','Punjab Chemicals','purity_percent','Solubility in CS2','%',99.5,NULL,NULL,true),

    -- ── UPL Ltd (Sulphur content min 99.5; Moisture max 0.5; Bulk density 0.50-0.70) ──
    ('UPL','UPL Ltd','purity_percent','Sulphur content','%',99.5,NULL,NULL,false),
    ('UPL','UPL Ltd','moisture_percent','Moisture content','%',NULL,0.5,NULL,false),

    -- ── BKT (Heat loss 70C max 0.15; Ash 600C max 0.10; Melting 113-123;
    --    Solubility CS2 min 98.0; Oil 0.80-1.20; Sp.Gravity 1.97-2.07) ──
    ('BKT','Balkrishna (BKT)','heat_loss_percent','Heat loss (70C/2hr)','%',NULL,0.15,NULL,false),
    ('BKT','Balkrishna (BKT)','ash_percent','Ash content (600C/2hr)','%',NULL,0.10,NULL,false),
    ('BKT','Balkrishna (BKT)','melting_point','Melting point','C',113,123,NULL,false),
    ('BKT','Balkrishna (BKT)','purity_percent','Solubility in CS2','%',98.0,NULL,NULL,false),
    ('BKT','Balkrishna (BKT)','oil_percent','Oil content','%',0.80,1.20,1.0,false),
    ('BKT','Balkrishna (BKT)','sg_value','Specific gravity','g/cm3',1.97,2.07,NULL,false);

-- =============================================================================
-- END 047
-- Seeded 13 parties' finished-product specs. Rows with needs_verification=true
-- (Punjab Chemicals ×6, Apollo oil, JK Tyre 200-mesh, and every micron→mesh or
-- passing→retained mapping) MUST be confirmed against the physical sheet before
-- a COA / pass-fail decision relies on them.
-- =============================================================================

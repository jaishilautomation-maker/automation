-- =============================================================================
-- Migration 076 (A-20/1 project): ship-to addresses EXACTLY as on the COAs
--
-- Source: "COA OF MRF, CEAT, ETC. WITH DIFF ADDRESS.docx" (the 4 Nov 2026
-- reference set). Migration 071 transcribed these from a scan and abbreviated
-- them (e.g. CEAT Bhandup lost "BHANDUP VILLAGE ROAD"; Halol lost the village /
-- taluka lines) - that is the "half address" on the COA (C1).
--
-- Text below is copied character-for-character from the document, including
-- its own spellings (GUJRATH, TOWAN, TELANGANA. etc.), because it prints on a
-- customer-facing certificate. Correct a line here and re-run to change it.
--
-- Labels are unchanged from 071 so existing selections keep working. Where the
-- document shows the same plant twice (MRF Kottayam) the fuller variant is used.
-- NOT seeded (one-off consignees, still entered by hand on the form): Ace Tyre,
-- HMSU Rollers, B K Rubber, Mr. Vijay, Sempertrains, and the Sri Lanka CEAT
-- addresses (their party/grade grouping is still unconfirmed).
--
-- Idempotent. Run AFTER 071.
-- =============================================================================

INSERT INTO public.party_ship_to_addresses (party_code, label, address, sort_order) VALUES
-- ── MRF (M2615) ──────────────────────────────────────────────────────────────
('M2615', 'Medak (Telangana)',
 E'MRF LTD.\nSADASHIVE PETH,\nMEDAK – 502291\nTELANGANA.', 1),
('M2615', 'Kottayam (Kerala)',
 E'MRF LTD.\nP.B NO.2., VADAVATHOOR\nKOTTAYAM.\nKERALA-686010.', 2),
('M2615', 'Ponda (Goa)',
 E'MRF LTD.\nP.N. No.1, PONDA,\nGOA-403401', 3),
('M2615', 'Dahej (Gujarat)',
 E'M.R.F.LTD. (GUJARAT) DAHEJ.\nPLOT NO.D2-16, DAHEJ INDUSTRIAL ESTATE,\nTAL.VAGRA, DIST. BHARUCH,\nGUJARAT-392130', 4),

-- ── CEAT R5299 plants ────────────────────────────────────────────────────────
('Ceat R5299', 'Bhandup (Mumbai)',
 E'CEAT LTD.  BHANDUP\nBHANDUP VILLAGE ROAD,\nBHANDUP (W)  MUMBAI - 400078', 1),
('Ceat R5299', 'Nashik (Satpur)',
 E'CEAT LTD. NASHIK.\nPLOT NO - 82 M.I.D.C. INDUSTRIAL AREA,\nSATPUR , NASHIK -422007', 2),
('Ceat R5299', 'Nagpur (Butibori)',
 E'CEAT LTD\nPLOT NO, SZ-39,BUTIBORI ,\nM.I.D.C. NAGPUR -441108', 3),
('Ceat R5299', 'Halol (Gujarat)',
 E'RADIAL PLANT\nCEAT LTD. HALOL\nAT Get muwala po chandrapura ,\ntal. Halol dist panchmahal\nGUJRATH 389350', 4),
('Ceat R5299', 'Radial Plant (Gujarat)',
 E'RADIAL PLANT\nCEAT LTD.\nGUJARAT 389350', 5),
('Ceat R5299', 'Specialty Tyres (Ambernath)',
 E'CEAT SPECIALTY TYRES LTD.\nPLOT NO –G- 2, M.I.D.C. INDUSTRIAL AREA.\nANAND NAGAR,  ADDITIONAL AMBERNATH\nAMBERNATH.', 6),

-- ── CEAT 108 "A/C CEAT" resellers ────────────────────────────────────────────
('Ceat 108', 'Vilas Polymer (A/C CEAT), Medak',
 E'VILAS POLYMER LTD.UNIT-II\nA/C CEAT LTD\nPLOT NO.175,176,183,184 &185\nPHASE –III,IP PASHAMYLARAM,(MANDAL)\nMEDAK(DISTRICT) TELANGANA-502307', 1),
('Ceat 108', 'Mysore Polymers (A/C CEAT-Bangalore)',
 E'MYSORE POLYMERS AND RUBBER PRODUCTS PVT LTD.\nA/C CEAT LTD-BANGALORE\nNO-20-P K.R.S ROAD META GALLI POST,\nMYSORE.', 2),
('Ceat 108', 'Rubber King Tyre (A/C CEAT Gujarat)',
 E'RUBBER KING TYRE PVT LTD. UNIT - II\nA/C CEAT LTD. (Gujarat)\nPLOT NO 214 & 215, G.I.D.C. VIRAMGAON\nGUJARAT – 382150', 3),
('Ceat 108', 'Vibrant Products (A/C CEAT-Bangalore)',
 E'VIBRANT PRODUCTS\nA/C CEAT LTD-BANGALORE\nA-32,KSSIDC INDUSTRIAL AREA,\nKUMBALGODU BANGALORE-560074', 4),
('Ceat 108', 'Innovative Tyres (A/C CEAT-Halol)',
 E'INNOVATIVE TYRES AND TUBES LTD.\nA/C CEAT LTD -HALOL\nTUBE DIVISION,PLOT NO.17O4 ,\nG.I.D.C.DIST-PANCHMAHAL,HALOL\nGUJARAT-383950', 5),

-- ── Dalmia (BT-CS01) ─────────────────────────────────────────────────────────
('BT-CS01', 'Baleswar (Odisha)',
 E'DALMIA BHARAT REFRACTORIES LTD.\nKHATA NO.497/1925\nPLOT NO.1747/2023\nROAD/STREET: BALASORE\nLOCALITY/SUBLOCALITY: CHHANPUR,\nCITY/TOWAN/VILLAGE: BALESWAR\nDISTRICT: BALESWAR, STATE : ODISHA\nPIN CODE: 756056', 1)

ON CONFLICT (party_code, label) DO UPDATE
   SET address = EXCLUDED.address,
       sort_order = EXCLUDED.sort_order,
       is_active = true;

-- Dalmia has a single plant, so it stays the prefilled default.
UPDATE public.parties
   SET default_ship_to = (
        SELECT address FROM public.party_ship_to_addresses
         WHERE party_code = 'BT-CS01' AND label = 'Baleswar (Odisha)')
 WHERE party_code = 'BT-CS01';

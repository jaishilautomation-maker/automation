-- =============================================================================
-- Migration 071 — Seed party_ship_to_addresses from the real COA address book
--
-- Source: the customer COA PDF ("COA OF MRF-CEAT-ETC WITH DIFF ADDRESS", 27
-- certificates). One row per customer PLANT, so customers with several plants
-- (MRF, CEAT) show as several options in the Generate-COA ship-to dropdown.
--
-- SCOPE (per the manager's confirmation):
--   • Seeded: the clear, repeat customers — MRF (4 plants), CEAT R5299 plants,
--     CEAT 108 "A/C" resellers, Dalmia.
--   • NOT seeded (handled by the form's manual ship-to entry): one-off
--     consignees (Ace Tyre, HMSU Rollers, Sempertrains, Mr. Vijay, etc.).
--   • NOT handled here: Bridgestone (WE-10/WE-15) uses a different certificate
--     template and is out of scope for the JSCI/QC/17 generator.
--
-- Addresses are stored VERBATIM from the certificates (they print on a
-- customer-facing document and must be exact). party_code values match the
-- existing parties master (seeded in 044 / 047).
--
-- Idempotent: ON CONFLICT (party_code, label) DO UPDATE refreshes the address,
-- so re-running converges and lets you correct an address by editing + re-running.
-- Run AFTER 070 (needs party_ship_to_addresses + parties.default_ship_to).
-- =============================================================================

-- Supersede the two sample rows 070 seeded (MRF Dahej, Dalmia) — they are
-- re-inserted below with their final labels/addresses, so remove the seeds to
-- avoid duplicate-ish labels.
DELETE FROM public.party_ship_to_addresses
 WHERE (party_code, label) IN (
    ('M2615',   'Dahej (Gujarat)'),
    ('BT-CS01', 'Baleswar (Odisha)')
 );

INSERT INTO public.party_ship_to_addresses (party_code, label, address, sort_order) VALUES
-- ── MRF (M2615) — 4 plants ────────────────────────────────────────────────
('M2615', 'Medak (Telangana)',
 E'M.R.F. LTD.\nSADASHIVE PETH,\nMEDAK,\nTELANGANA - 502291', 1),
('M2615', 'Kottayam (Kerala)',
 E'M.R.F. LTD.\nP.B. NO.2, VADAVATHOOR,\nKOTTAYAM,\nKERALA - 686010', 2),
('M2615', 'Ponda (Goa)',
 E'M.R.F. LTD.\nPLOT NO.1, PONDA,\nGOA - 403401', 3),
('M2615', 'Dahej (Gujarat)',
 E'M.R.F. LTD. (GUJARAT) DAHEJ.\nPLOT NO.D2-16, DAHEJ INDUSTRIAL ESTATE,\nTAL.VAGRA, DIST. BHARUCH,\nGUJARAT - 392130', 4),

-- ── CEAT R5299 (Ceat R5299) — plants certified against grade R5299 ─────────
('Ceat R5299', 'Bhandup (Mumbai)',
 E'CEAT LTD.\nBHANDUP,\nMUMBAI - 400078', 1),
('Ceat R5299', 'Nashik (Satpur)',
 E'CEAT LTD.\nSATPUR,\nNASHIK - 422007', 2),
('Ceat R5299', 'Nagpur (Butibori)',
 E'CEAT LTD.\nBUTIBORI,\nNAGPUR - 441108', 3),
('Ceat R5299', 'Halol (Gujarat)',
 E'CEAT LTD.\nHALOL,\nDIST. PANCHMAHAL,\nGUJARAT - 389350', 4),
('Ceat R5299', 'Radial Plant (Gujarat)',
 E'CEAT LTD. - RADIAL PLANT,\nGUJARAT - 389350', 5),
('Ceat R5299', 'Specialty Tyres (Ambernath)',
 E'CEAT SPECIALTY TYRES,\nAMBERNATH', 6),

-- ── CEAT 108 (Ceat 108) — "A/C CEAT" resellers certified against grade 108 ─
('Ceat 108', 'Vilas Polymer (A/C CEAT), Medak',
 E'VILAS POLYMER (A/C CEAT)\nMEDAK - 502307', 1),
('Ceat 108', 'Mysore Polymers (A/C CEAT-Bangalore)',
 E'MYSORE POLYMERS (A/C CEAT - BANGALORE)\nMYSORE', 2),
('Ceat 108', 'Rubber King Tyre (A/C CEAT Gujarat)',
 E'RUBBER KING TYRE (A/C CEAT GUJARAT)\nVIRAMGAON - 382150', 3),
('Ceat 108', 'Vibrant Products (A/C CEAT-Bangalore)',
 E'VIBRANT PRODUCTS (A/C CEAT - BANGALORE)\nBANGALORE - 560074', 4),
('Ceat 108', 'Innovative Tyres (A/C CEAT-Halol)',
 E'INNOVATIVE TYRES (A/C CEAT - HALOL)\nGUJARAT - 383950', 5),

-- ── Dalmia (BT-CS01) — 1 plant ─────────────────────────────────────────────
('BT-CS01', 'Baleswar (Odisha)',
 E'DALMIA BHARAT REFRACTORIES LTD.\nKHATA NO.497/1925\nPLOT NO.1747/2023\nROAD/STREET: BALASORE\nLOCALITY/SUBLOCALITY: CHHANPUR,\nCITY/TOWN/VILLAGE: BALESWAR\nDISTRICT: BALESWAR, STATE: ODISHA\nPIN CODE: 756056', 1)

ON CONFLICT (party_code, label) DO UPDATE
   SET address = EXCLUDED.address,
       sort_order = EXCLUDED.sort_order,
       is_active = true;

-- ── Single-plant defaults: prefill the COA ship-to automatically. ───────────
-- Only Dalmia has exactly one plant, so it is the only safe default. MRF/CEAT
-- have multiple plants, so the chemist must pick from the dropdown (no default).
UPDATE public.parties
   SET default_ship_to = (
        SELECT address FROM public.party_ship_to_addresses
         WHERE party_code = 'BT-CS01' AND label = 'Baleswar (Odisha)'
   )
 WHERE party_code = 'BT-CS01';

-- =============================================================================
-- END 071
--
-- NOTE — addresses to VERIFY against the physical certificates before first
-- customer use (I transcribed from the PDF; confirm pin codes / plot numbers):
--   • All MRF + CEAT street lines were abbreviated in the scan; the plant names
--     and pin codes are the reliable part. Edit any row above and re-run.
--   • "Associated CEAT (Sri Lanka)" / "CEAT Kelani (Sri Lanka)" appeared under
--     BOTH R5299 and 108 — NOT seeded pending confirmation of the export address.
--   • A/C resellers are grouped under Ceat 108 by the grade on their COA.
-- =============================================================================

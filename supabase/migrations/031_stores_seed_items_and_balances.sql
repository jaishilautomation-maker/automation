-- =============================================================================
-- Migration 031: Stores seed — stock items + opening balances (Sept 15 2026)
--
-- Inserts the confirmed active items into stores_stock_items and one opening-
-- balance ledger row per item with the closing balances as at 14-09-2026
-- (the last date visible in the provided DPR Excel and Oil Report).
--
-- DATA SOURCES (documents supplied 15-09-2026):
--   RM  tab  — RAW MATERIAL 2026-27  (closing balance 14-09-2026 column)
--   PM  tab  — PACKING MATERIAL 2026-27  (closing balance 14-09-2026)
--   FM  tab  — FINISHED GOODS (SULPHUR POWDER) 2026-27  (bal-in-bags 14-09-2026)
--   PDF 1    — Power Oil Citrine M 4150 Consumption Report (tank qty 15-09-2026)
--
-- ITEMS EXCLUDED (confirmed unused / dummy by business — meeting 16-09-2026):
--   P.Silica             — all-zero activity, flagged as dummy
--   Poweroil Sapphire L3060  — 0.000 balance, no activity
--   Poweroil Citrine L4070   — 0.000 balance, no activity
--
-- FINISHED GOODS NOTE:
--   FM sheet stores in BAGS. 1 bag = 25 kg (standard packing).
--   FG closing balances are stored in kg in this ledger.
--   Rejected / "Rejected" labelled rows are excluded — they are not saleable
--   stock and are tracked separately on the FM sheet.
--
-- ITEM CODES:
--   RM  items use the exact material name as item_code (uppercase, spaces→_)
--   PM  items use the bag/label description as item_code
--   FG  items use the product/party code as item_code (matches
--       pulveriser_job_cards.material_code for the FG auto-ledger trigger)
--
-- FACTORY: DBV_20_1  (id = 00000000-0000-0000-0000-000000000001)
--
-- Depends on: 027 (stores_stock_items, stores_stock_ledger, enums).
-- =============================================================================

DO $$
DECLARE
    v_factory_id  uuid := '00000000-0000-0000-0000-000000000001';
    v_date        date := '2026-09-14';   -- opening-balance date

    -- item ids (declared so ledger INSERTs can reference them)
    v_crude_sulphur       uuid;
    v_elasto_oil          uuid;
    v_chem_grind_oil      uuid;
    v_power_oil_citrine   uuid;
    v_gear_oil            uuid;
    v_mag_carbonate       uuid;

    -- Packing material ids
    v_bag_ceat_108        uuid;
    v_bag_mrf_m2615       uuid;
    v_bag_lanxess         uuid;
    v_bag_r5299           uuid;
    v_bag_apollo_160108   uuid;
    v_bag_bridgestone      uuid;
    v_bag_rubber_maker    uuid;
    v_bag_jki_108         uuid;
    v_bag_old_bags        uuid;

    -- Finished goods ids  (item_code must match pulveriser_job_cards.material_code)
    v_fg_ceat_108         uuid;
    v_fg_mrf_m2615        uuid;
    v_fg_r5299            uuid;
    v_fg_lanxess          uuid;
    v_fg_bridgestone_we10 uuid;
    v_fg_rubber_maker     uuid;
    v_fg_jki_108          uuid;
    v_fg_old_bags         uuid;

BEGIN

-- =============================================================================
-- 1.  RAW MATERIALS
-- =============================================================================

-- CRUDE SULPHUR  (C/Bal 14-09-2026: 306.050 kg — RM tab row 1663)
INSERT INTO public.stores_stock_items
    (id, factory_id, item_code, item_name, category, unit, min_threshold, is_active)
VALUES
    (gen_random_uuid(), v_factory_id,
     'CRUDE_SULPHUR', 'Crude Sulphur', 'raw_material', 'kg', 5000, true)
ON CONFLICT (factory_id, item_code) DO NOTHING
RETURNING id INTO v_crude_sulphur;

-- fallback if already exists
IF v_crude_sulphur IS NULL THEN
    SELECT id INTO v_crude_sulphur FROM public.stores_stock_items
    WHERE factory_id = v_factory_id AND item_code = 'CRUDE_SULPHUR';
END IF;

-- ELASTO 541 OIL  (C/Bal: 1002.800 kg — RM tab row 1664)
INSERT INTO public.stores_stock_items
    (id, factory_id, item_code, item_name, category, unit, min_threshold, is_active)
VALUES
    (gen_random_uuid(), v_factory_id,
     'ELASTO_541_OIL', 'Elasto 541 Oil', 'raw_material', 'kg', 200, true)
ON CONFLICT (factory_id, item_code) DO NOTHING
RETURNING id INTO v_elasto_oil;

IF v_elasto_oil IS NULL THEN
    SELECT id INTO v_elasto_oil FROM public.stores_stock_items
    WHERE factory_id = v_factory_id AND item_code = 'ELASTO_541_OIL';
END IF;

-- CHEM GRIND OIL  (C/Bal: 107.113 kg — RM tab row 1666)
INSERT INTO public.stores_stock_items
    (id, factory_id, item_code, item_name, category, unit, min_threshold, is_active)
VALUES
    (gen_random_uuid(), v_factory_id,
     'CHEM_GRIND_OIL', 'Chem Grind Oil', 'raw_material', 'kg', 50, true)
ON CONFLICT (factory_id, item_code) DO NOTHING
RETURNING id INTO v_chem_grind_oil;

IF v_chem_grind_oil IS NULL THEN
    SELECT id INTO v_chem_grind_oil FROM public.stores_stock_items
    WHERE factory_id = v_factory_id AND item_code = 'CHEM_GRIND_OIL';
END IF;

-- POWER OIL CITRINE M 4150  (C/Bal: 2111.31 kg — RM tab row 1671;
--   also cross-referenced against the Oil Consumption PDF tank qty 3114.11 on 15-09-2026
--   which includes drum stock. We use the RM ledger figure 2111.31 as the tank-only
--   closing balance at 14-09-2026 per the RM sheet.)
-- NOTE: this is also stored as item_code = 'OIL' to satisfy the auto-deduction
-- trigger in migration 029 (fn_pulveriser_rm_deduction looks up item_code = 'OIL').
INSERT INTO public.stores_stock_items
    (id, factory_id, item_code, item_name, category, unit, min_threshold, is_active)
VALUES
    (gen_random_uuid(), v_factory_id,
     'OIL', 'Power Oil Citrine M 4150', 'raw_material', 'kg', 500, true)
ON CONFLICT (factory_id, item_code) DO NOTHING
RETURNING id INTO v_power_oil_citrine;

IF v_power_oil_citrine IS NULL THEN
    SELECT id INTO v_power_oil_citrine FROM public.stores_stock_items
    WHERE factory_id = v_factory_id AND item_code = 'OIL';
END IF;

-- GEAR OIL 320 / PARTHAN  (C/Bal: 335.000 kg — RM tab row 1669)
INSERT INTO public.stores_stock_items
    (id, factory_id, item_code, item_name, category, unit, min_threshold, is_active)
VALUES
    (gen_random_uuid(), v_factory_id,
     'GEAR_OIL_320', 'Gear Oil 320/PARTHAN', 'raw_material', 'kg', 50, true)
ON CONFLICT (factory_id, item_code) DO NOTHING
RETURNING id INTO v_gear_oil;

IF v_gear_oil IS NULL THEN
    SELECT id INTO v_gear_oil FROM public.stores_stock_items
    WHERE factory_id = v_factory_id AND item_code = 'GEAR_OIL_320';
END IF;

-- MAGNESIUM CARBONATE  (C/Bal: 516.646 kg — RM tab row 1670)
INSERT INTO public.stores_stock_items
    (id, factory_id, item_code, item_name, category, unit, min_threshold, is_active)
VALUES
    (gen_random_uuid(), v_factory_id,
     'MAGNESIUM_CARBONATE', 'Magnesium Carbonate', 'raw_material', 'kg', 100, true)
ON CONFLICT (factory_id, item_code) DO NOTHING
RETURNING id INTO v_mag_carbonate;

IF v_mag_carbonate IS NULL THEN
    SELECT id INTO v_mag_carbonate FROM public.stores_stock_items
    WHERE factory_id = v_factory_id AND item_code = 'MAGNESIUM_CARBONATE';
END IF;

-- SULPHUR (canonical RM code for auto-deduction trigger, migration 029)
-- Crude Sulphur IS the sulphur raw material. We add a second item_code alias
-- that the trigger uses so both the human-readable RM entry AND the trigger
-- can co-exist. If the business later wants to merge these, update item_code
-- of CRUDE_SULPHUR to 'SULPHUR' and drop this row.
-- For now: separate item so the trigger fires on item_code='SULPHUR'.
-- Opening balance = same as CRUDE_SULPHUR (306.050 kg).
INSERT INTO public.stores_stock_items
    (id, factory_id, item_code, item_name, category, unit, min_threshold, is_active)
VALUES
    (gen_random_uuid(), v_factory_id,
     'SULPHUR', 'Crude Sulphur (auto-deduction alias)', 'raw_material', 'kg', 5000, true)
ON CONFLICT (factory_id, item_code) DO NOTHING;

-- =============================================================================
-- 2.  PACKING MATERIALS  (PM tab — closing balance 14-09-2026, unit = bags/nos)
-- =============================================================================

INSERT INTO public.stores_stock_items
    (id, factory_id, item_code, item_name, category, unit, min_threshold, is_active)
VALUES
    (gen_random_uuid(), v_factory_id, 'BAG_CEAT_108_EXPORT',   'CEAT 108/EXPORT Bags',     'packaging_material', 'nos', 1000, true),
    (gen_random_uuid(), v_factory_id, 'BAG_MRF_M2615',         'MRF M-2615 Bags',           'packaging_material', 'nos', 1000, true),
    (gen_random_uuid(), v_factory_id, 'BAG_LANXESS',           'LANXESS Bags',              'packaging_material', 'nos', 500,  true),
    (gen_random_uuid(), v_factory_id, 'BAG_CEAT_R5299',        'CEAT R5299 Bags',           'packaging_material', 'nos', 1000, true),
    (gen_random_uuid(), v_factory_id, 'BAG_APOLLO_160108',     'APOLLO TYRE 160108 Bags',   'packaging_material', 'nos', 500,  true),
    (gen_random_uuid(), v_factory_id, 'BAG_BRIDGESTONE_WE10',  'BRIDGESTONE WE-10 Bags',    'packaging_material', 'nos', 500,  true),
    (gen_random_uuid(), v_factory_id, 'BAG_RUBBER_MAKER_50KG', 'RUBBER MAKER 50 KG Bags',   'packaging_material', 'nos', 500,  true),
    (gen_random_uuid(), v_factory_id, 'BAG_JKI_108_50KG',      'JKI-108 50 KG Bags',        'packaging_material', 'nos', 500,  true),
    (gen_random_uuid(), v_factory_id, 'BAG_OLD_BAGS',          'Old Bags (various)',         'packaging_material', 'nos', 2000, true)
ON CONFLICT (factory_id, item_code) DO NOTHING;

-- Fetch PM item ids for ledger inserts
SELECT id INTO v_bag_ceat_108        FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BAG_CEAT_108_EXPORT';
SELECT id INTO v_bag_mrf_m2615       FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BAG_MRF_M2615';
SELECT id INTO v_bag_lanxess         FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BAG_LANXESS';
SELECT id INTO v_bag_r5299           FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BAG_CEAT_R5299';
SELECT id INTO v_bag_apollo_160108   FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BAG_APOLLO_160108';
SELECT id INTO v_bag_bridgestone     FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BAG_BRIDGESTONE_WE10';
SELECT id INTO v_bag_rubber_maker    FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BAG_RUBBER_MAKER_50KG';
SELECT id INTO v_bag_jki_108         FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BAG_JKI_108_50KG';
SELECT id INTO v_bag_old_bags        FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BAG_OLD_BAGS';

-- =============================================================================
-- 3.  FINISHED GOODS  (FM tab — closing balance in BAGS 14-09-2026; ×25 = kg)
--     item_code = party code used in pulveriser_job_cards.material_code
-- =============================================================================

INSERT INTO public.stores_stock_items
    (id, factory_id, item_code, item_name, category, unit, min_threshold, is_active)
VALUES
    -- FM row 4319: CEAT-108/EXPORT  0 bags → 0 kg
    (gen_random_uuid(), v_factory_id, 'CEAT-108/EXPORT',   'CEAT 108 / Export FG',         'finished_good', 'kg', NULL, true),
    -- FM row 4320: MRF LIMITED (M-2615)  76 bags → 1900 kg
    (gen_random_uuid(), v_factory_id, 'MRF-M2615',         'MRF Limited M-2615 FG',         'finished_good', 'kg', NULL, true),
    -- FM row 4321: EXPORT Plain Bag 25 KG  7 bags → 175 kg
    (gen_random_uuid(), v_factory_id, 'EXPORT-PLAIN-25KG', 'Export Plain Bag 25 KG FG',     'finished_good', 'kg', NULL, true),
    -- FM row 4323: CEAT HALOL/NAGPUR R5299  5 bags → 135 kg  (approx, sheet shows 0.135 MT)
    (gen_random_uuid(), v_factory_id, 'R5299',             'CEAT R5299 FG',                 'finished_good', 'kg', NULL, true),
    -- FM row 4325: CODE 2615 w/o Oil (MRF Grade)  45 bags → 1125 kg
    (gen_random_uuid(), v_factory_id, 'CODE-2615-NO-OIL',  'Code 2615 w/o Oil (MRF Grade)', 'finished_good', 'kg', NULL, true),
    -- FM row 4333: BRIDGESTONE WE-10  102 bags → 2550 kg
    (gen_random_uuid(), v_factory_id, 'BKT',               'Bridgestone WE-10 FG',          'finished_good', 'kg', NULL, true),
    -- FM row 4334: BRIDGESTONE/Lanxess Semifinish  51 bags → 1275 kg
    (gen_random_uuid(), v_factory_id, 'Lanxess',           'Lanxess Semifinish FG',         'finished_good', 'kg', NULL, true),
    -- FM row 4335: RUBBER MAKER 50 KG  14 bags → 700 kg (50 kg bags)
    (gen_random_uuid(), v_factory_id, 'Rubber',            'Rubber Maker 50 KG FG',         'finished_good', 'kg', NULL, true),
    -- FM row 4336: OLD BAGS (SHAKTI & OTHERS)  455 bags → 11375 kg  (25 kg bags)
    (gen_random_uuid(), v_factory_id, 'Shakti',            'Old Bags / Shakti FG',          'finished_good', 'kg', NULL, true),
    -- FM row 4337: J.K. INDUSTRIES  150 bags → 3750 kg
    (gen_random_uuid(), v_factory_id, 'JKI108',            'J.K. Industries / JKI-108 FG',  'finished_good', 'kg', NULL, true),
    -- FM row 4338: FOR PESTICIDE FORMULATION (SC)  60 bags → 1500 kg
    (gen_random_uuid(), v_factory_id, '160108',            'Pesticide Formulation SC FG',   'finished_good', 'kg', NULL, true)
ON CONFLICT (factory_id, item_code) DO NOTHING;

-- Fetch FG item ids for ledger inserts
SELECT id INTO v_fg_ceat_108         FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'CEAT-108/EXPORT';
SELECT id INTO v_fg_mrf_m2615        FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'MRF-M2615';
SELECT id INTO v_fg_r5299            FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'R5299';
SELECT id INTO v_fg_lanxess          FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'Lanxess';
SELECT id INTO v_fg_bridgestone_we10 FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'BKT';
SELECT id INTO v_fg_rubber_maker     FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'Rubber';
SELECT id INTO v_fg_jki_108          FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'JKI108';
SELECT id INTO v_fg_old_bags         FROM public.stores_stock_items WHERE factory_id = v_factory_id AND item_code = 'Shakti';

-- =============================================================================
-- 4.  OPENING BALANCE LEDGER ROWS  (one per item, transaction_source='manual',
--     qty_received = opening balance, closing_balance = same)
--
--     We skip items with NULL ids (not inserted / already had conflict and
--     SELECT failed) to avoid FK violations.
-- =============================================================================

-- ── Raw Materials ────────────────────────────────────────────────────────────

IF v_crude_sulphur IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_crude_sulphur, v_date, 'manual',
            306.050, 0, 0, 306.050,
            'opening', 'Opening balance — DPR RM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_elasto_oil IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_elasto_oil, v_date, 'manual',
            1002.800, 0, 0, 1002.800,
            'opening', 'Opening balance — DPR RM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_chem_grind_oil IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_chem_grind_oil, v_date, 'manual',
            107.113, 0, 0, 107.113,
            'opening', 'Opening balance — DPR RM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_power_oil_citrine IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_power_oil_citrine, v_date, 'manual',
            2111.310, 0, 0, 2111.310,
            'opening', 'Opening balance — DPR RM tab 14-09-2026 (tank balance; excludes drum stock shown in Oil Report)')
    ON CONFLICT DO NOTHING;
END IF;

IF v_gear_oil IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_gear_oil, v_date, 'manual',
            335.000, 0, 0, 335.000,
            'opening', 'Opening balance — DPR RM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_mag_carbonate IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_mag_carbonate, v_date, 'manual',
            516.646, 0, 0, 516.646,
            'opening', 'Opening balance — DPR RM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

-- ── Packing Materials ─────────────────────────────────────────────────────────
-- Balances from PM tab 14-09-2026 (unit: nos/bags)

IF v_bag_ceat_108 IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_bag_ceat_108, v_date, 'manual',
            6640, 0, 0, 6640,
            'opening', 'Opening balance — DPR PM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_bag_mrf_m2615 IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_bag_mrf_m2615, v_date, 'manual',
            4958, 0, 0, 4958,
            'opening', 'Opening balance — DPR PM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_bag_lanxess IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_bag_lanxess, v_date, 'manual',
            3581, 0, 0, 3581,
            'opening', 'Opening balance — DPR PM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_bag_r5299 IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_bag_r5299, v_date, 'manual',
            6406, 0, 0, 6406,
            'opening', 'Opening balance — DPR PM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_bag_apollo_160108 IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_bag_apollo_160108, v_date, 'manual',
            2701, 0, 0, 2701,
            'opening', 'Opening balance — DPR PM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_bag_bridgestone IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_bag_bridgestone, v_date, 'manual',
            3291, 0, 0, 3291,
            'opening', 'Opening balance — DPR PM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_bag_rubber_maker IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_bag_rubber_maker, v_date, 'manual',
            3441, 0, 0, 3441,
            'opening', 'Opening balance — DPR PM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_bag_jki_108 IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_bag_jki_108, v_date, 'manual',
            2550, 0, 0, 2550,
            'opening', 'Opening balance — DPR PM tab 14-09-2026')
    ON CONFLICT DO NOTHING;
END IF;

IF v_bag_old_bags IS NOT NULL THEN
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_bag_old_bags, v_date, 'manual',
            15122, 0, 0, 15122,
            'opening', 'Opening balance — DPR PM tab 14-09-2026 (after 610 dispatch on 14-09)')
    ON CONFLICT DO NOTHING;
END IF;

-- ── Finished Goods ────────────────────────────────────────────────────────────
-- Balances from FM tab 14-09-2026 (bags × 25 kg = kg, except Rubber Maker 50 kg bags)

IF v_fg_ceat_108 IS NOT NULL THEN
    -- 0 bags on 14-09-2026
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_fg_ceat_108, v_date, 'manual',
            0, 0, 0, 0,
            'opening', 'Opening balance — FM tab 14-09-2026 (0 bags)')
    ON CONFLICT DO NOTHING;
END IF;

IF v_fg_mrf_m2615 IS NOT NULL THEN
    -- 76 bags × 25 kg = 1900 kg
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_fg_mrf_m2615, v_date, 'manual',
            1900, 0, 0, 1900,
            'opening', 'Opening balance — FM tab 14-09-2026 (76 bags × 25 kg)')
    ON CONFLICT DO NOTHING;
END IF;

IF v_fg_r5299 IS NOT NULL THEN
    -- 5 bags × 25 kg = 125 kg  (FM shows 0.135 MT = 135 kg; use 135 kg)
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_fg_r5299, v_date, 'manual',
            135, 0, 0, 135,
            'opening', 'Opening balance — FM tab 14-09-2026 (0.135 MT = 135 kg)')
    ON CONFLICT DO NOTHING;
END IF;

IF v_fg_lanxess IS NOT NULL THEN
    -- 51 bags × 25 kg = 1275 kg  (FM shows 1.276 MT; use 1276 kg)
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_fg_lanxess, v_date, 'manual',
            1276, 0, 0, 1276,
            'opening', 'Opening balance — FM tab 14-09-2026 (1.276 MT)')
    ON CONFLICT DO NOTHING;
END IF;

IF v_fg_bridgestone_we10 IS NOT NULL THEN
    -- 102 bags × 25 kg = 2550 kg  (FM shows 2.550 MT)
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_fg_bridgestone_we10, v_date, 'manual',
            2550, 0, 0, 2550,
            'opening', 'Opening balance — FM tab 14-09-2026 (102 bags × 25 kg)')
    ON CONFLICT DO NOTHING;
END IF;

IF v_fg_rubber_maker IS NOT NULL THEN
    -- 14 bags × 50 kg = 700 kg  (Rubber Maker uses 50 kg bags)
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_fg_rubber_maker, v_date, 'manual',
            700, 0, 0, 700,
            'opening', 'Opening balance — FM tab 14-09-2026 (14 bags × 50 kg)')
    ON CONFLICT DO NOTHING;
END IF;

IF v_fg_jki_108 IS NOT NULL THEN
    -- 150 bags × 50 kg = 7500 kg  (J.K. Industries — 50 kg bags, FM shows 7.500 MT)
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_fg_jki_108, v_date, 'manual',
            7500, 0, 0, 7500,
            'opening', 'Opening balance — FM tab 14-09-2026 (150 bags × 50 kg)')
    ON CONFLICT DO NOTHING;
END IF;

IF v_fg_old_bags IS NOT NULL THEN
    -- 455 bags × 25 kg = 11375 kg  (FM shows 11375 kg before 360 dispatch; C/Bal = 649 bags)
    -- FM row 4336: C/Bal IN BAGS = 649 → 649 × 25 = 16225 kg
    -- But dispatch on 14-09 = 360 bags. C/Bal = 455 + 554 - 360 = 649 bags × 25 = 16225 kg
    INSERT INTO public.stores_stock_ledger
        (factory_id, item_id, transaction_date, transaction_source,
         qty_received, qty_issued, dispatch_qty, closing_balance,
         reference_type, remark)
    VALUES (v_factory_id, v_fg_old_bags, v_date, 'manual',
            16225, 0, 0, 16225,
            'opening', 'Opening balance — FM tab 14-09-2026 (649 bags × 25 kg, after 360-bag dispatch)')
    ON CONFLICT DO NOTHING;
END IF;

END $$;

-- =============================================================================
-- END OF MIGRATION 031
-- Seeds: stores_stock_items (RM × 7, PM × 9, FG × 11)
-- Seeds: stores_stock_ledger opening balance rows for each item
-- Date : 14-09-2026 (last complete DPR date in supplied documents)
-- Note : P.Silica, Poweroil Sapphire L3060, Poweroil Citrine L4070 excluded
--        as confirmed dummy/inactive items (all-zero activity).
-- =============================================================================

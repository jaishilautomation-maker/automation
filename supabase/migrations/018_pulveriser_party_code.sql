-- =============================================================================
-- Migration 018: Split Party/CODE from material_code on pulveriser job cards
--
-- Reverses part of 017's "material_code == party_code" assumption. The two are
-- now SEPARATE, both visible on the card:
--   • material_code — माल का कोड नंबर, free-text (as it was before 017)
--   • party_code    — Party/CODE, a dropdown sourced from vfd_parameters.
--                     THIS is what drives the oil-dosing / VFD lookup.
--
-- So the oil-consumption recompute trigger is repointed from material_code to
-- party_code. RLS gates on material_code (Production-filled check, operator
-- gate) are left unchanged — material_code is still the required Production
-- field the operator waits on.
--
-- Depends on: 017 (vfd_parameters, oil columns, fn_pulveriser_recompute_oil).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New column
-- ---------------------------------------------------------------------------
ALTER TABLE public.pulveriser_job_cards
    ADD COLUMN IF NOT EXISTS party_code text;   -- == vfd_parameters.party_code (mill)

-- ---------------------------------------------------------------------------
-- 2. Repoint the oil recompute trigger to look up oil_feed_std by party_code
--    instead of material_code. Everything else in the function is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pulveriser_recompute_oil()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_std numeric;
BEGIN
    SELECT oil_feed_std INTO v_std
    FROM public.vfd_parameters
    WHERE party_code = NEW.party_code
      AND machine_type = 'mill'
    LIMIT 1;

    -- Planned side (Production)
    IF NEW.planned_production_mt IS NOT NULL AND v_std IS NOT NULL THEN
        NEW.oil_required_kg := NEW.planned_production_mt * 1000 * v_std;
    ELSE
        NEW.oil_required_kg := NULL;
    END IF;

    -- Actual side (Operator + Stores)
    IF NEW.actual_production_mt IS NOT NULL AND v_std IS NOT NULL THEN
        NEW.expected_oil_kg := NEW.actual_production_mt * 1000 * v_std;
    ELSE
        NEW.expected_oil_kg := NULL;
    END IF;

    IF NEW.oil_issued_kg IS NOT NULL AND NEW.expected_oil_kg IS NOT NULL THEN
        NEW.actual_oil_consumption_kg     := LEAST(NEW.oil_issued_kg, NEW.expected_oil_kg);
        NEW.oil_variance_kg               := NEW.oil_issued_kg - NEW.expected_oil_kg;
        NEW.oil_extra_leftover_balance_kg := GREATEST(NEW.oil_issued_kg - NEW.expected_oil_kg, 0);
    ELSE
        NEW.actual_oil_consumption_kg     := NULL;
        NEW.oil_variance_kg               := NULL;
        NEW.oil_extra_leftover_balance_kg := NULL;
    END IF;

    IF NEW.actual_oil_consumption_kg IS NOT NULL
       AND NEW.actual_production_mt IS NOT NULL
       AND NEW.actual_production_mt <> 0 THEN
        NEW.oil_consumption_percent :=
            (NEW.actual_oil_consumption_kg / (NEW.actual_production_mt * 1000)) * 100;
    ELSE
        NEW.oil_consumption_percent := NULL;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger definition itself is unchanged (already created in 017); the
-- CREATE OR REPLACE above swaps the function body in place.

-- =============================================================================
-- END OF MIGRATION 018
-- New column : pulveriser_job_cards.party_code
-- Changed    : fn_pulveriser_recompute_oil now keys the oil lookup on party_code
-- =============================================================================

-- =============================================================================
-- A-20 Migration 011: Re-activate K GUM for production job card
--
-- Migration 009 deactivated K_GUM to hide it from the Lab Trials dropdown.
-- However, "K GUM / KELZAN PLUS 1.4% SOLUTION" is one of the six confirmed
-- A-20 production job card products and must remain accessible in the
-- production job card form.
--
-- Fix: re-activate K_GUM so it appears in the production dropdown.
-- The lab-trials page filters its own product list separately (is_trial_only
-- or explicit code exclusion), so re-activating K_GUM does not re-expose it
-- in lab trials unless those queries are changed.
-- =============================================================================

UPDATE public.products
SET is_active = true
WHERE code = 'K_GUM';

-- Verify: SELECT code, name, is_active FROM products WHERE code = 'K_GUM';
-- Expected: K_GUM | K GUM/KELZAN PLUS 1.4% SOLUTION | true

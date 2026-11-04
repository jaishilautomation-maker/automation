-- =============================================================================
-- Migration 074: WE-10 (Bridgestone) vfd_parameters row + email event types
--
-- CHANGE 1 — WE-10 vfd_parameters mill row
--   The production job-card Party/CODE dropdown is driven by vfd_parameters
--   (machine_type = 'mill'). WE-10 (Bridgestone India) already has a parties
--   row and coa_customer_specs (migration 047) but no mill vfd row, so it
--   never appeared in the production dropdown. Add it now.
--
--   oil_feed_std = 0.05 (5% of planned batch kg = oil required kg), matching
--   the WE-10 spec sheet: oil content 4.5–5.5% target 5.0%. Classifier and
--   feeder VFDs are not yet confirmed by engineering — left NULL so they show
--   "—" in the UI rather than a wrong value.
--
-- CHANGE 2 — this SQL file covers only the DB side.
--   The send-email.ts server-side change (adding breakdown_register and
--   pm_completion to FACTORY_EVENT_TYPES) is done in code (no SQL needed).
-- =============================================================================

INSERT INTO public.vfd_parameters
    (party_code, machine_type, classifier_vfd, feeder_vfd, oil_feed_std,
     oil_feed_min, oil_feed_max, pump_flow, mesh_size_300)
VALUES
    ('WE-10', 'mill', NULL, NULL, 0.05, 0.045, 0.055, NULL, '-')
ON CONFLICT (party_code, machine_type) DO UPDATE SET
    oil_feed_std  = EXCLUDED.oil_feed_std,
    oil_feed_min  = EXCLUDED.oil_feed_min,
    oil_feed_max  = EXCLUDED.oil_feed_max,
    mesh_size_300 = EXCLUDED.mesh_size_300;

-- =============================================================================
-- END 074
-- =============================================================================

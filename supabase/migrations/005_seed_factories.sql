-- Migration 005: seed factory rows for Dombivli, Nashik, Sonepat
-- These are the four factories named in the arch doc (§16).
-- Nashik and Sonepat activities are deferred (arch §17 decision 4) —
-- they get rows here so factory_id FKs resolve; activities added later.

INSERT INTO public.factories (code, name, location, is_active)
VALUES
    ('DBV_20_1', 'Dombivli — Factory 20/1', 'Dombivli', true),
    ('DBV_20_2', 'Dombivli — Factory 20/2', 'Dombivli', true),
    ('NSK',      'Nashik',                   'Nashik',   true),
    ('SNP',      'Sonepat',                  'Sonepat',  true)
ON CONFLICT (code) DO NOTHING;

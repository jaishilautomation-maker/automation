-- =============================================================================
-- Migration 013: Preventive Maintenance (Form JSCI/PROD/06)
--
-- A-20/1 only. Access: production_incharge, factory_admin, company_admin.
--
-- Architecture:
--   pm_schedule_items — static seed data (machine → component → task → freq)
--   pm_completions    — append-only log of "Mark done" actions
--
-- Due status is COMPUTED in the query layer (not stored):
--   next_due = MAX(completed_at for this item) + frequency_weeks * 7 days
--   If no completion exists → overdue (since the beginning of time)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- pm_schedule_items
-- ---------------------------------------------------------------------------
CREATE TABLE public.pm_schedule_items (
    id               uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id       uuid     NOT NULL REFERENCES public.factories(id),
    sr_no            integer  NOT NULL,
    machine          text     NOT NULL,
    component        text     NOT NULL,
    task             text     NOT NULL,
    frequency_weeks  integer  NOT NULL,   -- repeat interval in weeks

    UNIQUE (factory_id, sr_no)
);

ALTER TABLE public.pm_schedule_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pm_schedule_select" ON public.pm_schedule_items
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

-- Only admins can modify the schedule
CREATE POLICY "pm_schedule_write" ON public.pm_schedule_items
    FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['factory_admin','company_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['factory_admin','company_admin']::app_role[]));

GRANT SELECT, INSERT, UPDATE ON public.pm_schedule_items TO authenticated;

-- ---------------------------------------------------------------------------
-- pm_completions
-- ---------------------------------------------------------------------------
CREATE TABLE public.pm_completions (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_item_id uuid        NOT NULL REFERENCES public.pm_schedule_items(id),
    completed_at     timestamptz NOT NULL DEFAULT now(),
    completed_by     uuid        NOT NULL REFERENCES auth.users(id),
    notes            text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pm_completions_item_date
    ON public.pm_completions (schedule_item_id, completed_at DESC);

ALTER TABLE public.pm_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pm_completions_select" ON public.pm_completions
    FOR SELECT TO authenticated
    USING (
        schedule_item_id IN (
            SELECT id FROM pm_schedule_items
            WHERE factory_id IN (SELECT fn_user_factory_ids())
        )
    );

CREATE POLICY "pm_completions_insert" ON public.pm_completions
    FOR INSERT TO authenticated
    WITH CHECK (
        fn_has_role(ARRAY['production_incharge','factory_admin','company_admin']::app_role[])
        AND schedule_item_id IN (
            SELECT id FROM pm_schedule_items
            WHERE factory_id IN (SELECT fn_user_factory_ids())
        )
    );

GRANT SELECT, INSERT ON public.pm_completions TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed: pm_schedule_items for DBV_20_1 (Dombivli A-20/1)
--
-- Source: Form JSCI/PROD/06 as supplied.
-- factory_id resolved via subquery on factories.code = 'DBV_20_1'
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    fid uuid;
    n   integer := 0;
BEGIN
    SELECT id INTO fid FROM public.factories WHERE code = 'DBV_20_1';
    IF fid IS NULL THEN
        RAISE EXCEPTION 'Factory DBV_20_1 not found — run migrations 001+006 first';
    END IF;

    -- Helper: insert one item, incrementing sr_no
    -- Machine 1: Roller
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Roller','Bearing','Bearing greasing',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Roller','Oil Seal','Oil seal replacement',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Roller','Roller','Servicing',12);

    -- Machine 2: Blower
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Blower','Electric Plug','Electric plug check',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Blower','Bearing','Bearing greasing',4);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Blower','Belt','Belt check',4);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Blower','Fan','Fan check',12);

    -- Machine 3: Feeder
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Feeder','Bearing / Bush','Bearing/bush greasing',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Feeder','Gear Box','Gear box oil check',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Feeder','Electric Plug','Electric plug check',1);

    -- Machine 4: Classifier
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Classifier','Screen','Screen cleaning',2);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Classifier','Bearing','Bearing greasing',12);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Classifier','Gear Box','Gear box servicing',24);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Classifier','Belt','Belt check',2);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Classifier','Electric Plug','Electric plug check',2);

    -- Machine 5: Main Shaft
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Main Shaft','Bearing','Bearing greasing',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Main Shaft','Electric Plug','Electric plug check',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Main Shaft','Coupling','Coupling check',2);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Main Shaft','Gear Box','Gear box oil check',2);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Main Shaft','Belt','Belt check',2);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Main Shaft','Bracket','Bracket cleaning',2);

    -- Machine 6: Air Lock Valve
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Air Lock Valve','Bearing','Bearing greasing',2);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Air Lock Valve','Gear Box','Gear box oil check',2);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Air Lock Valve','Electric Plug','Electric plug check',1);

    -- Machine 7: Conveyor
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Conveyor','Bearing','Bearing greasing',2);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Conveyor','Gear Box','Gear box oil check',2);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Conveyor','Chain','Chain greasing',2);

    -- Machine 8: Screening Machine
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Screening Machine','Bearing','Bearing greasing',12);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Screening Machine','Spring','Spring checking',24);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Screening Machine','Deck / Mesh','Deck cleaning / mesh replacement',4);

    -- Machine 9: Base Plate
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Base Plate','Base Plate','Cleaning',1);

    -- Machine 10: Dust Collector
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Dust Collector','Dust Collector','Cleaning',1);

    -- Machine 11: Classifier Pipe
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Classifier Pipe','Classifier Pipe','Cleaning',1);

    -- Machine 12: Cyclone Pipe
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Cyclone Pipe','Cyclone Pipe','Cleaning',1);

    -- Machine 13: Weighing Scale
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Weighing Scale','Weighing Scale','Cleaning',1);

    -- Machine 14: Dosing Pump
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Dosing Pump','Gear Box','Gear box oil check',4);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Dosing Pump','Electric Plug','Electric plug check',4);

    -- Machine 15: Air Compressor
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Air Compressor','Filter','Filter cleaning',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Air Compressor','Oil','Oil change',4);

    -- Machine 16: Nitrogen Generator
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Nitrogen Generator','Air Pressure','Air pressure check',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Nitrogen Generator','Compressor Filter','Compressor filter cleaning',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Nitrogen Generator','Water Pressure','Water pressure check',1);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Nitrogen Generator','Solenoid Valve','Solenoid valve cleaning',6);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Nitrogen Generator','Moisture Separator','Moisture separator cylinder check',12);
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Nitrogen Generator','Compressor Oil','Compressor oil servicing',2);

    -- Machine 17: Stitching Machine
    n := n + 1; INSERT INTO pm_schedule_items(factory_id,sr_no,machine,component,task,frequency_weeks) VALUES(fid,n,'Stitching Machine','Stitching Machine','Cleaning',1);

    RAISE NOTICE 'Inserted % PM schedule items for factory %', n, fid;
END;
$$;

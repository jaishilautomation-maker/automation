-- =============================================================================
-- Migration 020: Pulveriser hourly readings — coded start/stop readings
--
-- The pulveriser hour meter is read as a coded number, NOT a wall clock:
--   reading 780  ->  7 hrs + (80/100 * 60) min  =  7 hrs 48 min  (= 7.80 hours)
--   running time = (stop_reading - start_reading), same coded space, then the
--                  same split applies: last two digits are hundredths-of-hour.
--
-- So start_time / stop_time can no longer be Postgres `time` values (a coded
-- reading like '780' is not a valid time-of-day). They become text to hold the
-- raw coded reading exactly as entered. total_hours stays numeric(6,2) and now
-- stores the CONVERTED decimal running hours (coded diff / 100).
--
-- Depends on: 015 (pulveriser_hourly_readings).
-- =============================================================================

-- Convert start_time / stop_time from `time` to `text`.
-- Existing rows (if any) are cast to their text form so no data is lost.
ALTER TABLE public.pulveriser_hourly_readings
    ALTER COLUMN start_time TYPE text USING start_time::text;

ALTER TABLE public.pulveriser_hourly_readings
    ALTER COLUMN stop_time  TYPE text USING stop_time::text;

-- =============================================================================
-- END OF MIGRATION 020
-- start_time / stop_time : time -> text (coded hour-meter readings)
-- total_hours            : unchanged numeric(6,2); now = coded diff / 100
-- =============================================================================

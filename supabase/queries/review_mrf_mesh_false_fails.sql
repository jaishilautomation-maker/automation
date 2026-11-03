-- =============================================================================
-- READ-ONLY REVIEW QUERY: MRF (M2615) batch_analysis records where mesh rows
-- "failed" under the old % retained formula.
--
-- CONTEXT:
--   The batch analysis form stored % RETAINED (m/M × 100) in mesh*_pct but
--   compared it against MRF's PASSING-basis spec limits (min 99/95). Since
--   retained is always a small number (e.g. 0.04%), every MRF mesh row showed
--   "✗ Fail" even when the batch was actually within spec on the passing basis.
--
--   The fix (applied in the UI) now derives % passing = 100 - retained and
--   compares THAT against the spec. This query lists the historical records
--   that may have been false Fails / false rework under the old formula.
--
--   SAVED RECORDS ARE NOT MODIFIED. This is a read-only SELECT for lab review.
-- =============================================================================

SELECT
  b.batch_number,
  ba.analysis_date,
  ba.party_code,
  ba.appearance_ok,
  ba.rework_action,
  -- Stored % retained values (what the old formula computed)
  (ba.test_results ->> 'mesh100_m')::text         AS mesh100_m,
  (ba.test_results ->> 'mesh100_m_ret')::text     AS mesh100_m_ret,
  (ba.test_results ->> 'mesh100_pct')::numeric    AS mesh100_pct_retained,
  (ba.test_results ->> 'mesh200_m')::text         AS mesh200_m,
  (ba.test_results ->> 'mesh200_m_ret')::text     AS mesh200_m_ret,
  (ba.test_results ->> 'mesh200_pct')::numeric    AS mesh200_pct_retained,
  (ba.test_results ->> 'mesh325_m')::text         AS mesh325_m,
  (ba.test_results ->> 'mesh325_m_ret')::text     AS mesh325_m_ret,
  (ba.test_results ->> 'mesh325_pct')::numeric    AS mesh325_pct_retained,
  -- Derived % passing (what the new formula computes)
  CASE
    WHEN (ba.test_results ->> 'mesh100_pct')::numeric IS NOT NULL
    THEN 100 - (ba.test_results ->> 'mesh100_pct')::numeric
  END AS mesh100_pct_passing,
  CASE
    WHEN (ba.test_results ->> 'mesh200_pct')::numeric IS NOT NULL
    THEN 100 - (ba.test_results ->> 'mesh200_pct')::numeric
  END AS mesh200_pct_passing,
  CASE
    WHEN (ba.test_results ->> 'mesh325_pct')::numeric IS NOT NULL
    THEN 100 - (ba.test_results ->> 'mesh325_pct')::numeric
  End AS mesh325_pct_passing,
  -- Was this a false Fail? (old: retained < min → fail; new: passing >= min → pass)
  CASE
    WHEN (ba.test_results ->> 'mesh100_pct')::numeric IS NOT NULL
     AND (ba.test_results ->> 'mesh100_pct')::numeric < 99.0      -- old: retained < min 99 → FAIL
     AND (100 - (ba.test_results ->> 'mesh100_pct')::numeric) >= 99.0  -- new: passing >= 99 → PASS
    THEN 'FALSE FAIL'
    ELSE ''
  END AS mesh100_false_fail,
  CASE
    WHEN (ba.test_results ->> 'mesh200_pct')::numeric IS NOT NULL
     AND (ba.test_results ->> 'mesh200_pct')::numeric < 95.0      -- old: retained < min 95 → FAIL
     AND (100 - (ba.test_results ->> 'mesh200_pct')::numeric) >= 95.0  -- new: passing >= 95 → PASS
    THEN 'FALSE FAIL'
    ELSE ''
  END AS mesh200_false_fail,
  ba.remarks,
  ba.id,
  ba.created_at
FROM batch_analysis ba
JOIN batches b ON b.id = ba.batch_id
WHERE ba.party_code = 'M2615'
  AND (
    -- Has at least one mesh pct value stored
    (ba.test_results ->> 'mesh100_pct') IS NOT NULL
    OR (ba.test_results ->> 'mesh200_pct') IS NOT NULL
    OR (ba.test_results ->> 'mesh325_pct') IS NOT NULL
  )
ORDER BY ba.analysis_date DESC;

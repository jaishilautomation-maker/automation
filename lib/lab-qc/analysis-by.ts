// =============================================================================
// "Analysis By" — the fixed list of lab chemists who physically ran the test.
//
// Captured on Batch Analysis, Hourly Reading, and RM QC forms IN ADDITION to
// the auto-recorded login user (chemist_id / recorded_by), which stays the
// authoritative identity. The selected name is stored in test_results.analysis_by
// (the same JSONB pattern the forms use for shift / lot_no / machine) and in the
// field audit log.
//
// Edit this list to change who appears in the dropdown.
// =============================================================================

export const ANALYSIS_BY_OPTIONS = [
  "Mr. Narendra Mahajan",
  "Mr. Ganesh Rathod",
  "Mr. Sachin Kochre",
  "Mr. Sagar Pawse",
] as const;

export type AnalysisByName = (typeof ANALYSIS_BY_OPTIONS)[number];

/** JSONB key the forms write the selected name into (within test_results). */
export const ANALYSIS_BY_KEY = "analysis_by";

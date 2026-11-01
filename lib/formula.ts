// =============================================================================
// Formula evaluation for dynamic QC forms
//
// qc_test_definitions.formula contains JS-compatible arithmetic expressions
// where operands are sibling test_key names, e.g.:
//   "((acidity_v1 - acidity_v2) * acidity_n * 0.049 / acidity_m) * 100"
//
// evalFormula() substitutes the current test_results JSONB values as
// variables and evaluates the expression.  It is ONLY used for the live
// preview shown to the chemist while they type — the DB trigger
// fn_evaluate_product_qc() is the authoritative source for stored results.
//
// Safety: we use Function() constructor with a controlled variable scope
// instead of eval() so we get a clean scope with no globals.
// The formula strings come from our own DB (not user input), so the risk
// is internal, but we still guard against exceptions.
// =============================================================================

/**
 * Evaluate a formula string given the current test result values.
 *
 * @param formula  Expression string, e.g. "(v1 - v2) * n * 0.049 / m * 100"
 * @param values   Current key→value map from the form state (string inputs)
 * @param unit     Optional unit string from qc_test_definitions — used to
 *                 determine rounding precision.  "%" results round to 2 d.p.;
 *                 all others round to 4 d.p.
 * @returns        Numeric result, or null if any operand is missing / expression throws.
 */
export function evalFormula(
  formula: string,
  values: Record<string, string>,
  unit?: string | null,
): number | null {
  if (!formula) return null;

  try {
    // Build a numeric variable map — skip keys that are empty / NaN
    const numericVars: Record<string, number> = {};
    for (const [key, raw] of Object.entries(values)) {
      const n = parseFloat(raw);
      if (!isNaN(n)) numericVars[key] = n;
    }

    // Check that all variables referenced in the formula are present.
    // Simple heuristic: extract word tokens and check each identifier.
    const tokens = formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    for (const token of tokens) {
      if (!(token in numericVars)) return null; // missing input
    }

    // Build a Function with the variables declared as parameters
    const paramNames = Object.keys(numericVars);
    const paramValues = Object.values(numericVars);

    // eslint-disable-next-line no-new-func
    const fn = new Function(...paramNames, `return (${formula});`);
    const result = fn(...paramValues) as number;

    if (!isFinite(result)) return null;

    // % results → 2 d.p. (match A-20/1 convention); everything else → 4 d.p.
    const isPercent = unit?.trim() === "%";
    const factor = isPercent ? 100 : 10000;
    return Math.round(result * factor) / factor;
  } catch {
    return null;
  }
}

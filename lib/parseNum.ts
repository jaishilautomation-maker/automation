/**
 * parseNum — Parse a numeric string to Number or null.
 *
 * Used for parsing form values to numbers, especially for calculations.
 * An empty or invalid field returns null (not 0) to distinguish
 * "not entered" from "zero".
 *
 * Examples:
 * - parseNum("") → null
 * - parseNum(".") → null
 * - parseNum("-") → null
 * - parseNum("-.") → null
 * - parseNum("0") → 0
 * - parseNum("0.5") → 0.5
 * - parseNum("-5.2") → -5.2
 * - parseNum("invalid") → NaN (caller should handle)
 *
 * @param s The string to parse
 * @returns Number or null
 */
export function parseNum(s: unknown): number | null {
  if (typeof s !== "string") {
    return null;
  }

  const trimmed = s.trim();

  // Empty or placeholder-like values
  if (!trimmed || trimmed === "." || trimmed === "-" || trimmed === "-.") {
    return null;
  }

  const num = Number(trimmed);

  // isNaN check: return null for invalid strings, not NaN
  return isNaN(num) ? null : num;
}

/**
 * Utility: Format a number for display, showing "—" for null/empty.
 * Useful for calculated fields that should show a dash when input is incomplete.
 *
 * @param value The number to format
 * @param decimals Optional: number of decimal places
 * @returns Formatted string or "—"
 */
export function formatNumOrDash(
  value: number | null | undefined,
  decimals?: number,
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "—";
  }

  if (decimals !== undefined) {
    return value.toFixed(decimals);
  }

  return String(value);
}
